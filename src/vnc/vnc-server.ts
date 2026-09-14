/**
 * VNC WebSocket server for screen sharing
 * Handles screen streaming and input events from mobile clients
 */

import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID as uuidv4 } from 'crypto';
import { getAuthToken } from '../auth';
import { capabilities, getInstanceIdentity, InstanceIdentity } from '../instance';
import { protectedBind, authorized, messageBudget, validKey, validMouse, validScroll } from '../security';
import { ScreenCaptureManager } from './screen-capture';
import { handleMouseEvent, handleKeyboardEvent, getScreenSize, typeString, handleScrollEvent, releaseMouseButton } from './input-handler';
import type {
  VNCClientMessage,
  VNCMouseEvent,
  VNCKeyboardEvent,
  VNCQualityUpdate,
  VNCClientState,
  ScreenDimensions,
} from './types';

const DEFAULT_VNC_PORT = 11043;
// One physical pointer per process: another client cannot interrupt a held drag.
let pointerOwner: string | null = null;

/**
 * Per-connection handler for VNC clients
 */
class VNCConnection {
  private unsubscribe: (() => void) | null = null;
  private isStreaming = false;
  private heldButtons = new Set<'left' | 'right' | 'middle'>();
  private disposed = false;

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
    const budget = messageBudget();
    this.ws.on('message', async (message: Buffer | string) => {
      if (this.disposed || this.ws.readyState !== WebSocket.OPEN) return;
      if (!budget(Buffer.byteLength(message))) { this.ws.close(1008, 'Message limit exceeded'); return; }
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

      if (pointerOwner && pointerOwner !== this.clientId && ['vnc_mouse_event', 'vnc_scroll', 'vnc_scroll_event'].includes(message.type)) { this.sendError('Another phone is dragging. Try again when it finishes.'); return; }
      if (['vnc_mouse_event', 'vnc_scroll', 'vnc_scroll_event', 'vnc_keyboard_event', 'vnc_type'].includes(message.type) && !this.isStreaming) throw new Error('Start desktop streaming before sending input');

      switch (message.type) {
        case 'ping':
          this.send({ type: 'pong', timestamp: Date.now() });
          break;
        case 'vnc_start':
          this.startStreaming();
          break;

        case 'vnc_stop':
          this.stopStreaming();
          break;

        case 'vnc_mouse_event':
          if (!validMouse(message)) throw new Error('Invalid mouse event');
          if (message.eventType === 'up' && !this.heldButtons.has(message.button || 'left')) break;
          handleMouseEvent(message as VNCMouseEvent);
          if (message.eventType === 'down') { this.heldButtons.add(message.button || 'left'); pointerOwner = this.clientId; }
          if (message.eventType === 'up') { this.heldButtons.delete(message.button || 'left'); if (!this.heldButtons.size) pointerOwner = null; }
          break;

        case 'vnc_scroll':
        case 'vnc_scroll_event':
          if (!validScroll(message)) throw new Error('Invalid scroll event');
          handleScrollEvent(message);
          break;

        case 'vnc_input_reset':
          this.resetInput();
          break;

        case 'vnc_keyboard_event':
          if (!validKey(message)) throw new Error('Invalid key event');
          handleKeyboardEvent(message as VNCKeyboardEvent);
          break;

        case 'vnc_type':
          // Type text string
          const typeMsg = message as { text: string };
          if (typeof typeMsg.text !== 'string' || typeMsg.text.length > 4096) throw new Error('Invalid text');
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
    this.resetInput();
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
    if (!this.isStreaming || this.ws.readyState !== WebSocket.OPEN || this.ws.bufferedAmount > 0) return;

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
  private resetInput(): void {
    for (const button of this.heldButtons) releaseMouseButton(button);
    this.heldButtons.clear();
    if (pointerOwner === this.clientId) pointerOwner = null;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
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
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(port: number = DEFAULT_VNC_PORT, host: string = '127.0.0.1', private instance?: InstanceIdentity) {
    this.port = port;
    this.host = host;
  }

  /**
   * Start the VNC WebSocket server
   */
  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        if (!protectedBind(this.host)) throw new Error("Use a private Wi-Fi/Tailscale interface, or localhost behind a TLS proxy.");
        const token = getAuthToken();
        this.wss = new WebSocketServer({
          port: this.port,
          host: this.host,
          maxPayload: 64 * 1024, perMessageDeflate: false,
          verifyClient: ({ req }: { req: import('http').IncomingMessage }) => (this.wss?.clients.size ?? 0) < 4 && authorized(req, token),
        });

        this.wss.on('connection', this.handleConnection.bind(this));

        this.wss.on('error', (error: Error) => {
          console.error('[VNC] Server error:', error);
          reject(error);
        });

        this.wss.on('listening', () => {
          try {
            this.port = (this.wss!.address() as import('net').AddressInfo).port;
            this.instance ??= getInstanceIdentity(this.port);
            this.heartbeat = setInterval(() => {
              for (const socket of this.wss?.clients ?? []) {
                const state = (socket as WebSocket & { alive?: boolean });
                if (state.alive === false) { socket.terminate(); continue; }
                state.alive = false; socket.ping();
              }
            }, 15000);
            this.heartbeat.unref();
            console.log(`[VNC] Server listening on ${this.host}:${this.port}`);
            resolve();
          } catch (error) { void this.shutdown().then(() => reject(error)); }
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

    socket.send(JSON.stringify(capabilities(this.instance!, this.port)));

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
      (socket as WebSocket & { alive?: boolean }).alive = true;
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
    const address = this.wss?.address();
    return address && typeof address !== 'string' ? address.port : this.port;
  }

  /**
   * Shutdown the server
   */
  public async shutdown(): Promise<void> {
    console.log('[VNC] Shutting down server...');
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }



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
      for (const socket of this.wss.clients) socket.terminate();
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
  host: string = '127.0.0.1',
  instance?: InstanceIdentity
): Promise<VNCServer> {
  const server = new VNCServer(port, host, instance);
  await server.start();
  return server;
}

export default VNCServer;
