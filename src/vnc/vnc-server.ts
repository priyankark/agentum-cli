/**
 * VNC WebSocket server for screen sharing
 * Handles screen streaming and input events from mobile clients
 */

import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { ScreenCaptureManager } from './screen-capture';
import { handleMouseEvent, handleKeyboardEvent, getScreenSize, typeString } from './input-handler';
import type {
  VNCClientMessage,
  VNCMouseEvent,
  VNCKeyboardEvent,
  VNCQualityUpdate,
  VNCClientState,
  ScreenDimensions,
} from './types';

const DEFAULT_VNC_PORT = 11043;

/**
 * Per-connection handler for VNC clients
 */
class VNCConnection {
  private unsubscribe: (() => void) | null = null;
  private isStreaming = false;

  constructor(
    private ws: WebSocket,
    private clientId: string,
    private onDisconnect: (clientId: string) => void
  ) {
    this.setupWebSocketHandlers();
  }

  /**
   * Set up WebSocket event handlers
   */
  private setupWebSocketHandlers(): void {
    this.ws.on('message', async (message: Buffer | string) => {
      await this.handleMessage(message);
    });

    this.ws.on('close', () => {
      this.dispose();
    });

    this.ws.on('error', (error) => {
      console.error(`[VNC] Client ${this.clientId} error:`, error);
      this.dispose();
    });
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(rawMessage: Buffer | string): Promise<void> {
    try {
      const messageData = rawMessage.toString();
      const message: VNCClientMessage = JSON.parse(messageData);

      switch (message.type) {
        case 'vnc_start':
          this.startStreaming();
          break;

        case 'vnc_stop':
          this.stopStreaming();
          break;

        case 'vnc_mouse_event':
          handleMouseEvent(message as VNCMouseEvent);
          break;

        case 'vnc_keyboard_event':
          handleKeyboardEvent(message as VNCKeyboardEvent);
          break;

        case 'vnc_type':
          // Type text string
          const typeMsg = message as { text: string };
          if (typeMsg.text) {
            typeString(typeMsg.text);
          }
          break;

        case 'vnc_quality_update':
          ScreenCaptureManager.getInstance().updateQualitySettings(
            message as VNCQualityUpdate
          );
          break;

        default:
          console.warn(`[VNC] Unknown message type: ${(message as any).type}`);
      }
    } catch (error) {
      console.error(`[VNC] Error parsing message:`, error);
      this.sendError('Invalid message format');
    }
  }

  /**
   * Start streaming frames to this client
   */
  private startStreaming(): void {
    if (this.isStreaming) return;

    console.log(`[VNC] Client ${this.clientId} started streaming`);
    this.isStreaming = true;

    // Subscribe to frame updates
    const manager = ScreenCaptureManager.getInstance();
    this.unsubscribe = manager.subscribe((frame, dimensions) => {
      this.sendFrame(frame, dimensions);
    });

    // Send started confirmation
    this.send({
      type: 'vnc_started',
      dimensions: getScreenSize(),
      timestamp: Date.now(),
    });
  }

  /**
   * Stop streaming frames to this client
   */
  private stopStreaming(): void {
    if (!this.isStreaming) return;

    console.log(`[VNC] Client ${this.clientId} stopped streaming`);
    this.isStreaming = false;

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    // Send stopped confirmation
    this.send({
      type: 'vnc_stopped',
      timestamp: Date.now(),
    });
  }

  /**
   * Send a frame to the client
   */
  private sendFrame(frame: Buffer, dimensions: ScreenDimensions): void {
    if (!this.isStreaming || this.ws.readyState !== WebSocket.OPEN) return;

    // Convert to base64 for transmission
    const base64Image = frame.toString('base64');

    this.send({
      type: 'vnc_screen_update',
      image: base64Image,
      dimensions,
      timestamp: Date.now(),
    });
  }

  /**
   * Send a message to the client
   */
  private send(message: Record<string, unknown>): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error(`[VNC] Error sending to client ${this.clientId}:`, error);
    }
  }

  /**
   * Send error message
   */
  private sendError(error: string): void {
    this.send({
      type: 'vnc_error',
      error,
      timestamp: Date.now(),
    });
  }

  /**
   * Get streaming status
   */
  public getIsStreaming(): boolean {
    return this.isStreaming;
  }

  /**
   * Cleanup resources
   */
  public dispose(): void {
    this.stopStreaming();
    this.onDisconnect(this.clientId);
  }
}

/**
 * VNC WebSocket Server
 * Manages VNC connections on a separate port from the main terminal server
 */
export class VNCServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, VNCConnection> = new Map();
  private clientStates: Map<string, VNCClientState> = new Map();
  private port: number;
  private host: string;

  constructor(port: number = DEFAULT_VNC_PORT, host: string = '0.0.0.0') {
    this.port = port;
    this.host = host;
  }

  /**
   * Start the VNC WebSocket server
   */
  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          port: this.port,
          host: this.host,
        });

        this.wss.on('connection', this.handleConnection.bind(this));

        this.wss.on('error', (error: Error) => {
          console.error('[VNC] Server error:', error);
          if (!this.wss) {
            reject(error);
          }
        });

        this.wss.on('listening', () => {
          console.log(`[VNC] Server listening on ${this.host}:${this.port}`);
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(
    socket: WebSocket,
    request: { socket: { remoteAddress?: string } }
  ): void {
    const clientId = uuidv4();
    const remoteAddress = request.socket.remoteAddress || 'unknown';

    console.log(`[VNC] Client connected: ${clientId} from ${remoteAddress}`);

    // Create client state
    const state: VNCClientState = {
      id: clientId,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      isStreaming: false,
    };
    this.clientStates.set(clientId, state);

    // Create connection handler
    const connection = new VNCConnection(
      socket,
      clientId,
      this.handleDisconnect.bind(this)
    );
    this.clients.set(clientId, connection);

    // Handle pong for health check
    socket.on('pong', () => {
      const clientState = this.clientStates.get(clientId);
      if (clientState) {
        clientState.lastActivity = Date.now();
      }
    });
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(clientId: string): void {
    console.log(`[VNC] Client disconnected: ${clientId}`);
    this.clients.delete(clientId);
    this.clientStates.delete(clientId);
  }

  /**
   * Get connected client count
   */
  public getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get streaming client count
   */
  public getStreamingClientCount(): number {
    let count = 0;
    for (const connection of this.clients.values()) {
      if (connection.getIsStreaming()) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get server port
   */
  public getPort(): number {
    return this.port;
  }

  /**
   * Shutdown the server
   */
  public async shutdown(): Promise<void> {
    console.log('[VNC] Shutting down server...');

    // Shutdown screen capture manager
    ScreenCaptureManager.getInstance().shutdown();

    // Close all client connections
    for (const [clientId, connection] of this.clients.entries()) {
      try {
        connection.dispose();
      } catch {
        // Ignore errors during shutdown
      }
      this.clients.delete(clientId);
    }

    // Close WebSocket server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => {
          resolve();
        });
      });
      this.wss = null;
    }

    console.log('[VNC] Server shutdown complete');
  }
}

/**
 * Create and start a new VNC server instance
 */
export async function createVNCServer(
  port: number = DEFAULT_VNC_PORT,
  host: string = '0.0.0.0'
): Promise<VNCServer> {
  const server = new VNCServer(port, host);
  await server.start();
  return server;
}

export default VNCServer;
