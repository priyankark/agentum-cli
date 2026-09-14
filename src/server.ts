/**
 * WebSocket server for AirCodum-Agentum
 * Handles mobile client connections and message routing
 */

import { WebSocketServer, WebSocket } from 'ws';
import * as fs from 'fs';
import { getAuthToken, privateDir } from './auth';
import { capabilities, getInstanceIdentity, InstanceIdentity } from './instance';
import { protectedBind, authorized, MAX_PAYLOAD, messageBudget } from './security';
import * as path from 'path';
import { randomUUID as uuidv4 } from 'crypto';
import { SessionManager } from './session';
import { ClaudeSessionManager, ClaudeMessage, ClaudeSessionConfig } from './claude-session';
import { CodexSessionManager, CodexMessage, CodexSessionConfig } from './codex-session';
import { CopilotSessionManager, CopilotMessage, CopilotSessionConfig } from './copilot-session';
import { VNCServer, createVNCServer } from './vnc';
import {
  ServerConfig,
  ConnectedClient,
  MessageType,
  WebSocketMessage,
  InputMessage,
  ResizeMessage,
  AttachMessage,
  CreateSessionMessage,
  ClaudeSendPromptMessage,
  ClaudeCreateSessionMessage,
  CodexSendPromptMessage,
  CodexCreateSessionMessage,
  CopilotSendPromptMessage,
  CopilotCreateSessionMessage,
  BaseMessage,
} from './types';

const DEFAULT_PORT = 11042;

const DEFAULT_HEARTBEAT_INTERVAL = 30000;
const DEFAULT_MAX_OUTPUT_BUFFER = 1000;

/**
 * AgentumServer handles WebSocket connections from mobile clients
 * and manages PTY sessions
 */
export class AgentumServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ConnectedClient> = new Map();
  private sessionManager: SessionManager;
  private claudeSessionManager: ClaudeSessionManager;
  private codexSessionManager: CodexSessionManager;
  private copilotSessionManager: CopilotSessionManager;
  private vncServer: VNCServer | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private config: Required<ServerConfig>;
  private instance!: InstanceIdentity;
  private isShuttingDown = false;
  private ready = false;
  private mediaDir: string;
  private creationTimes: number[] = [];
  private creationBudget(): boolean {
    this.creationTimes = this.creationTimes.filter(time => Date.now() - time < 60000);
    if (this.creationTimes.length >= 8) return false;
    this.creationTimes.push(Date.now()); return true;
  }

  constructor(config: Partial<ServerConfig> = {}) {
    this.config = {
      port: config.port ?? DEFAULT_PORT,
      host: config.allowRemoteConnections === false ? '127.0.0.1' : (config.host || '0.0.0.0'),
      heartbeatInterval: config.heartbeatInterval || DEFAULT_HEARTBEAT_INTERVAL,
      maxOutputBuffer: config.maxOutputBuffer || DEFAULT_MAX_OUTPUT_BUFFER,
      allowRemoteConnections: config.allowRemoteConnections ?? true,
      vncPort: config.vncPort ?? ((config.port ?? DEFAULT_PORT) === 0 ? 0 : (config.port ?? DEFAULT_PORT) + 1),
      instanceName: config.instanceName ?? '',
      enableVnc: config.enableVnc ?? true,
    };

    if (![this.config.port, this.config.vncPort].every(port => Number.isInteger(port) && port >= 0 && port <= 65535)) throw new Error('Ports must be between 1 and 65535');

    // Initialize PTY session manager with event handlers
    this.sessionManager = new SessionManager({
      onOutput: this.handleSessionOutput.bind(this),
      onExit: this.handleSessionExit.bind(this),
      onError: this.handleSessionError.bind(this),
    });

    // Initialize Claude headless session manager
    this.claudeSessionManager = new ClaudeSessionManager({
      onMessage: this.handleClaudeMessage.bind(this),
      onThinking: this.handleClaudeThinking.bind(this),
      onToolUse: this.handleClaudeToolUse.bind(this),
      onToolResult: this.handleClaudeToolResult.bind(this),
      onSessionStart: this.handleClaudeSessionStart.bind(this),
      onSessionEnd: this.handleClaudeSessionEnd.bind(this),
      onError: this.handleClaudeError.bind(this),
      onRawOutput: this.handleClaudeRawOutput.bind(this),
    });

    // Initialize OpenAI Codex session manager
    this.codexSessionManager = new CodexSessionManager({
      onMessage: this.handleCodexMessage.bind(this),
      onToolUse: this.handleCodexToolUse.bind(this),
      onToolResult: this.handleCodexToolResult.bind(this),
      onSessionStart: this.handleCodexSessionStart.bind(this),
      onSessionEnd: this.handleCodexSessionEnd.bind(this),
      onError: this.handleCodexError.bind(this),
      onRawOutput: this.handleCodexRawOutput.bind(this),
    });

    // Initialize GitHub Copilot session manager
    this.copilotSessionManager = new CopilotSessionManager({
      onMessage: this.handleCopilotMessage.bind(this),
      onThinking: this.handleCopilotThinking.bind(this),
      onToolUse: this.handleCopilotToolUse.bind(this),
      onToolResult: this.handleCopilotToolResult.bind(this),
      onSessionStart: this.handleCopilotSessionStart.bind(this),
      onSessionEnd: this.handleCopilotSessionEnd.bind(this),
      onError: this.handleCopilotError.bind(this),
      onRawOutput: this.handleCopilotRawOutput.bind(this),
    });

    // Prepare media/temp directory - use /tmp by default for universal access
    const configuredTemp = process.env.AGENTUM_TEMP_DIR;
    this.mediaDir = configuredTemp || path.join(privateDir, 'media');
    try {
      fs.mkdirSync(this.mediaDir, { recursive: true, mode: 0o700 });
      console.log(`[MEDIA] Using media inbox at: ${this.mediaDir}`);
    } catch (e) {
      console.error(`[MEDIA] Failed to create media directory at ${this.mediaDir}:`, e);
    }
  }

  /**
   * Start the WebSocket server
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        if (!protectedBind(this.config.host)) throw new Error("Use a private Wi-Fi/Tailscale interface, or localhost behind a TLS proxy.");
        const token = getAuthToken();
        this.wss = new WebSocketServer({
          port: this.config.port,
          host: this.config.host,
          maxPayload: MAX_PAYLOAD, perMessageDeflate: false,
          verifyClient: ({ req }: { req: import('http').IncomingMessage }) => (this.wss?.clients.size ?? 0) < 4 && authorized(req, token),
        });

        this.wss.on('connection', this.handleConnection.bind(this));

        this.wss.on('error', (error: Error) => {
          console.error('WebSocket server error:', error);
          reject(error);
        });

        this.wss.on('listening', async () => {
          try {
            this.config.port = (this.wss!.address() as import('net').AddressInfo).port;
            this.instance = getInstanceIdentity(this.config.port, this.config.instanceName || undefined);
            console.log(
              `Agentum WebSocket server listening on ${this.config.host}:${this.config.port}`
            );

            // Start VNC server if enabled
            if (this.config.enableVnc) {
              try {
                this.vncServer = await createVNCServer(this.config.vncPort, this.config.host, this.instance);
                console.log(
                  `VNC WebSocket server listening on ${this.config.host}:${this.config.vncPort}`
                );
              } catch (error) {
                console.error(`Failed to start VNC server: ${(error as Error).message}`);
                // Don't fail the main server if VNC fails
              }
            }

            this.ready = true;
            for (const clientId of this.clients.keys()) this.sendInitialState(clientId);

            // Start heartbeat interval
            this.startHeartbeat();

            // Start cleanup interval for old sessions
            this.startCleanupInterval();

            resolve();
          } catch (error) { await this.shutdown(); reject(error); }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(socket: WebSocket, request: { socket: { remoteAddress?: string } }): void {
    const clientId = uuidv4();
    const remoteAddress = request.socket.remoteAddress || 'unknown';

    console.log(`Client connected: ${clientId} from ${remoteAddress}`);

    // Create client record
    const client: ConnectedClient = {
      id: clientId,
      socket,
      connectedAt: Date.now(),
      lastPing: Date.now(),
      recentUploads: [],
    };

    this.clients.set(clientId, client);

    // Set up socket event handlers
    const budget = messageBudget();
    let pending = 0;
    socket.on('message', (data: Buffer | string, isBinary: boolean) => {
      if (!budget(Buffer.byteLength(data)) || pending >= 16) { socket.close(1008, 'Message limit exceeded'); return; }
      pending++;
      void this.handleMessage(clientId, data, isBinary).catch(() => this.sendError(clientId, 'Invalid request')).finally(() => { pending--; });
    });

    socket.on('close', () => {
      this.handleDisconnect(clientId);
    });

    socket.on('error', (error: Error) => {
      console.error(`Client ${clientId} socket error:`, error);
      this.handleDisconnect(clientId);
    });

    socket.on('pong', () => {
      const existingClient = this.clients.get(clientId);
      if (existingClient) {
        existingClient.lastPing = Date.now();
      }
    });

    this.sendInitialState(clientId);
  }

  private sendInitialState(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!this.ready || !client) return;
    this.sendCapabilities(client.socket);
    this.sendSessionList(clientId);
    this.sendClaudeSessionList(clientId);
    this.sendCodexSessionList(clientId);
    this.sendCopilotSessionList(clientId);
  }

  public getConnectionDetails() { return { port: this.config.port, vncPort: this.vncServer?.getPort(), instance: this.instance }; }

  private sendCapabilities(socket: WebSocket): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(capabilities(this.instance, this.vncServer?.getPort())));
  }

  /**
   * Handle incoming message from client
   */
  private async handleMessage(clientId: string, rawData: Buffer | string, isBinary: boolean): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (isBinary) { this.handleBinaryUpload(clientId, Buffer.from(rawData)); return; }
    if (Buffer.byteLength(rawData) > 64 * 1024) { this.sendError(clientId, 'Text message too large'); return; }
    try {
      // Try to parse as JSON first (could be binary buffer containing JSON text)
      let data: string;
      if (Buffer.isBuffer(rawData)) {
        data = rawData.toString('utf8');
      } else {
        data = rawData;
      }

      // Check if it looks like JSON
      const trimmed = data.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        const message: WebSocketMessage = JSON.parse(data);
        if (!message || typeof message.type !== 'string') throw new Error('Invalid message');
        for (const name of ['sessionId', 'data', 'prompt', 'command', 'name', 'cwd', 'workingDirectory']) {
          const value = (message as any)[name];
          if (value !== undefined && (typeof value !== 'string' || value.length > 32768)) throw new Error('Invalid field');
        }
        if (message.type === MessageType.RESIZE || message.type === MessageType.CREATE_SESSION) {
          for (const name of ['cols', 'rows']) {
            const value = (message as any)[name];
            if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 500)) throw new Error('Invalid terminal size');
          }
        }

      const creationTypes = [MessageType.CREATE_SESSION, MessageType.CLAUDE_CREATE_SESSION, MessageType.CODEX_CREATE_SESSION, MessageType.COPILOT_CREATE_SESSION];
      if (creationTypes.includes(message.type) && !this.creationBudget()) throw new Error('Session creation limit exceeded');
      switch (message.type) {
        case MessageType.INPUT:
          this.handleInput(clientId, message as InputMessage);
          break;

        case MessageType.RESIZE:
          this.handleResize(clientId, message as ResizeMessage);
          break;

        case MessageType.ATTACH:
          this.handleAttach(clientId, message as AttachMessage);
          break;

        case MessageType.DETACH:
          this.handleDetach(clientId);
          break;

        case MessageType.LIST_SESSIONS:
          this.sendSessionList(clientId);
          break;

        case MessageType.KILL_SESSION:
          this.handleKillSession(clientId, message.sessionId!);
          break;

        case MessageType.CREATE_SESSION:
          this.handleCreateSession(clientId, message as CreateSessionMessage);
          break;

        case MessageType.PING:
          this.sendToClient(clientId, {
            type: MessageType.PONG,
            timestamp: Date.now(),
          });
          break;

        // Claude Headless Mode Messages
        case MessageType.CLAUDE_CREATE_SESSION:
          this.handleClaudeCreateSession(clientId, message as ClaudeCreateSessionMessage);
          break;

        case MessageType.CLAUDE_SEND_PROMPT:
          await this.handleClaudeSendPrompt(clientId, message as ClaudeSendPromptMessage);
          break;

        case MessageType.CLAUDE_LIST_SESSIONS:
          this.sendClaudeSessionList(clientId);
          break;

        case MessageType.CLAUDE_ATTACH_SESSION:
          this.handleClaudeAttachSession(clientId, message.sessionId!);
          break;

        case MessageType.CLAUDE_DETACH_SESSION:
          this.handleClaudeDetachSession(clientId);
          break;

        case MessageType.CLAUDE_KILL_SESSION:
          this.handleClaudeKillSession(clientId, message.sessionId!);
          break;

        case MessageType.CLAUDE_GET_HISTORY:
          this.handleClaudeGetHistory(clientId, message.sessionId!);
          break;

        case MessageType.TRIGGER_NOTIFICATION:
          this.handleTriggerNotification(clientId, message as any);
          break;

        // OpenAI Codex Messages
        case MessageType.CODEX_CREATE_SESSION:
          this.handleCodexCreateSession(clientId, message as CodexCreateSessionMessage);
          break;

        case MessageType.CODEX_SEND_PROMPT:
          await this.handleCodexSendPrompt(clientId, message as CodexSendPromptMessage);
          break;

        case MessageType.CODEX_LIST_SESSIONS:
          this.sendCodexSessionList(clientId);
          break;

        case MessageType.CODEX_ATTACH_SESSION:
          this.handleCodexAttachSession(clientId, message.sessionId!);
          break;

        case MessageType.CODEX_DETACH_SESSION:
          this.handleCodexDetachSession(clientId);
          break;

        case MessageType.CODEX_KILL_SESSION:
          this.handleCodexKillSession(clientId, message.sessionId!);
          break;

        case MessageType.CODEX_GET_HISTORY:
          this.handleCodexGetHistory(clientId, message.sessionId!);
          break;

        // GitHub Copilot Messages
        case MessageType.COPILOT_CREATE_SESSION:
          this.handleCopilotCreateSession(clientId, message as CopilotCreateSessionMessage);
          break;

        case MessageType.COPILOT_SEND_PROMPT:
          await this.handleCopilotSendPrompt(clientId, message as CopilotSendPromptMessage);
          break;

        case MessageType.COPILOT_LIST_SESSIONS:
          this.sendCopilotSessionList(clientId);
          break;

        case MessageType.COPILOT_ATTACH_SESSION:
          this.handleCopilotAttachSession(clientId, message.sessionId!);
          break;

        case MessageType.COPILOT_DETACH_SESSION:
          this.handleCopilotDetachSession(clientId);
          break;

        case MessageType.COPILOT_KILL_SESSION:
          this.handleCopilotKillSession(clientId, message.sessionId!);
          break;

        case MessageType.COPILOT_GET_HISTORY:
          this.handleCopilotGetHistory(clientId, message.sessionId!);
          break;

        default:
          this.sendError(clientId, `Unknown message type: ${message.type}`);
      }
      } else { throw new Error('Expected a JSON object'); }
    } catch (error) {
      console.error(`Error parsing message from ${clientId}:`, error);
      this.sendError(clientId, 'Invalid message format');
    }
  }

  /**
   * Handle binary upload from client (e.g., camera photo)
   */
  private handleBinaryUpload(clientId: string, data: Buffer): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Detect file type by magic bytes
    const ext = this.detectFileExtension(data);
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..+/, '');
    const shortId = clientId.split('-')[0];
    const fileName = `upload_${shortId}_${timestamp}_${uuidv4()}.${ext}`;
    const filePath = path.join(this.mediaDir, fileName);

    try {
      fs.writeFileSync(filePath, data, { flag: 'wx', mode: 0o600 });
      if (!client.recentUploads) client.recentUploads = [];
      client.recentUploads.push(filePath);
      // Keep only the last 10 uploads per client
      if (client.recentUploads.length > 10) {
        client.recentUploads = client.recentUploads.slice(-10);
      }
      console.log(`[UPLOAD] Saved binary upload from ${clientId} -> ${filePath}`);

      // Acknowledge to sender with a notification
      this.sendToClient(clientId, {
        type: MessageType.NOTIFICATION,
        title: 'Image received',
        body: `Saved to ${filePath}`,
        priority: 'normal',
        notificationType: 'info',
        timestamp: Date.now(),
      });
    } catch (e) {
      console.error(`[UPLOAD] Failed to save upload from ${clientId}:`, e);
      this.sendError(clientId, 'Failed to save uploaded file');
    }
  }

  /**
   * Best-effort detection of common image formats
   */
  private detectFileExtension(buf: Buffer): string {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
    if (
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    )
      return 'png';
    if (buf.length >= 4 && buf.slice(0, 4).toString('ascii') === 'GIF8') return 'gif';
    if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP')
      return 'webp';
    return 'bin';
  }

  /**
   * Handle input from client
   */
  private handleInput(clientId: string, message: InputMessage): void {
    const client = this.clients.get(clientId);
    const messageSessionId = message.sessionId;
    console.log(
      `[INPUT] Client ${clientId}: attached to session ${client?.sessionId}, message.sessionId: ${messageSessionId}, message.data length: ${message.data?.length}`
    );

    if (!client) {
      console.log(`[INPUT] ERROR: Client ${clientId} not found`);
      this.sendError(clientId, 'Client not found');
      return;
    }

    // Prefer message.sessionId if provided, but verify client is attached to that session
    let targetSessionId = client.sessionId;

    if (messageSessionId) {
      // If client provided a sessionId, verify it matches their attached session
      // or auto-attach them if they're not attached to any session
      if (!client.sessionId) {
        // Client not attached, try to attach to the requested session
        const session = this.sessionManager.getSession(messageSessionId);
        if (session) {
          client.sessionId = messageSessionId;
          this.sessionManager.addClientToSession(messageSessionId, clientId);
          targetSessionId = messageSessionId;
          console.log(`[INPUT] Auto-attached client ${clientId} to session ${messageSessionId}`);
        } else {
          console.log(`[INPUT] ERROR: Session ${messageSessionId} not found`);
          this.sendError(clientId, `Session not found: ${messageSessionId}`);
          return;
        }
      } else if (client.sessionId !== messageSessionId) {
        // Client is attached to a different session - warn but use their attached session
        console.log(`[INPUT] WARNING: Client sent input for session ${messageSessionId} but is attached to ${client.sessionId}`);
        // Use the message's sessionId since client explicitly specified it
        targetSessionId = messageSessionId;
      }
    }

    if (!targetSessionId) {
      console.log(`[INPUT] ERROR: Client not attached to any session`);
      this.sendError(clientId, 'Not attached to a session');
      return;
    }

    const success = this.sessionManager.writeToSession(
      targetSessionId,
      message.data
    );
    console.log(`[INPUT] Write to session ${targetSessionId}: ${success ? 'success' : 'failed'}`);
    if (!success) {
      this.sendError(clientId, 'Failed to write to session');
    }
  }

  /**
   * Handle resize from client
   */
  private handleResize(clientId: string, message: ResizeMessage): void {
    const client = this.clients.get(clientId);
    if (!client || !client.sessionId) {
      this.sendError(clientId, 'Not attached to a session');
      return;
    }

    this.sessionManager.resizeSession(
      client.sessionId,
      message.cols,
      message.rows
    );
  }

  /**
   * Handle attach request
   */
  private handleAttach(clientId: string, message: AttachMessage): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const session = this.sessionManager.getSession(message.sessionId);
    if (!session) {
      this.sendError(clientId, `Session not found: ${message.sessionId}`);
      return;
    }

    // Detach from current session if attached
    if (client.sessionId) {
      this.sessionManager.removeClientFromSession(client.sessionId, clientId);
    }

    // Attach to new session
    client.sessionId = message.sessionId;
    this.sessionManager.addClientToSession(message.sessionId, clientId);

    // Send attach confirmation
    this.sendToClient(clientId, {
      type: MessageType.SESSION_ATTACHED,
      sessionId: message.sessionId,
      timestamp: Date.now(),
    });

    // Replay output buffer
    const buffer = this.sessionManager.getOutputBuffer(message.sessionId);
    console.log(`[ATTACH] Client ${clientId} attached to session ${message.sessionId}`);
    console.log(`[ATTACH] Replaying ${buffer.length} buffered chunks to client`);

    for (let i = 0; i < buffer.length; i++) {
      const data = buffer[i];
      console.log(`[REPLAY] Chunk ${i + 1}/${buffer.length}: ${data.length} bytes`);
      this.sendToClient(clientId, {
        type: MessageType.OUTPUT,
        sessionId: message.sessionId,
        data,
        output: data,
        timestamp: Date.now(),
        isReplay: true,  // Mark as replay so client can handle differently if needed
      });
    }
  }

  /**
   * Handle detach request
   */
  private handleDetach(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client || !client.sessionId) return;

    const sessionId = client.sessionId;
    this.sessionManager.removeClientFromSession(sessionId, clientId);
    client.sessionId = undefined;

    this.sendToClient(clientId, {
      type: MessageType.SESSION_DETACHED,
      sessionId,
      timestamp: Date.now(),
    });

    console.log(`Client ${clientId} detached from session ${sessionId}`);
  }

  /**
   * Handle create session request
   */
  private handleCreateSession(
    clientId: string,
    message: CreateSessionMessage
  ): void {
    try {
      const session = this.sessionManager.createSession({
        name: message.name || message.command,
        command: message.command,
        cols: message.cols,
        rows: message.rows,
      });

      // Auto-attach client to new session
      const client = this.clients.get(clientId);
      if (client) {
        if (client.sessionId) {
          this.sessionManager.removeClientFromSession(client.sessionId, clientId);
        }
        client.sessionId = session.id;
        this.sessionManager.addClientToSession(session.id, clientId);
        console.log(`[CREATE] Auto-attached client ${clientId} to session ${session.id}`);
      } else {
        console.log(`[CREATE] WARNING: Could not find client ${clientId} to attach`);
      }

      this.sendToClient(clientId, {
        type: MessageType.SESSION_CREATED,
        sessionId: session.id,
        timestamp: Date.now(),
      });

      // Send attach confirmation so client knows it's attached
      this.sendToClient(clientId, {
        type: MessageType.SESSION_ATTACHED,
        sessionId: session.id,
        timestamp: Date.now(),
      });

      // Replay any buffered output (shell prompt, etc.)
      const buffer = this.sessionManager.getOutputBuffer(session.id);
      if (buffer.length > 0) {
        console.log(`[CREATE] Replaying ${buffer.length} buffered chunks to client ${clientId}`);
        for (let i = 0; i < buffer.length; i++) {
          const data = buffer[i];
          this.sendToClient(clientId, {
            type: MessageType.OUTPUT,
            sessionId: session.id,
            data,
            output: data,
            timestamp: Date.now(),
            isReplay: true,
          });
        }
      }

      // Broadcast session list update
      this.broadcastSessionList();

    } catch (error) {
      console.error('Error creating session:', error);
      this.sendError(
        clientId,
        `Failed to create session: ${(error as Error).message}`
      );
    }
  }

  /**
   * Handle kill session request
   */
  private handleKillSession(clientId: string, sessionId: string): void {
    const success = this.sessionManager.killSession(sessionId);
    if (success) {
      this.sendToClient(clientId, {
        type: MessageType.SESSION_KILLED,
        sessionId,
        timestamp: Date.now(),
      });

      // Notify all clients attached to this session
      this.broadcastToSession(sessionId, {
        type: MessageType.SESSION_ENDED,
        sessionId,
        timestamp: Date.now(),
      });

      // Broadcast session list update
      this.broadcastSessionList();

      console.log(`Session ${sessionId} killed by client ${clientId}`);
    } else {
      this.sendError(clientId, `Failed to kill session: ${sessionId}`);
    }
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove from all sessions
    this.sessionManager.removeClientFromAllSessions(clientId);

    // Remove client
    this.clients.delete(clientId);

    console.log(`Client disconnected: ${clientId}`);
  }

  /**
   * Handle session output
   */
  private handleSessionOutput(sessionId: string, data: string): void {
    const attachedClients = Array.from(this.clients.values()).filter(
      (c) => c.sessionId === sessionId
    );

    // Show preview of data (first 100 chars, escape control chars for readability)
    console.log(`[OUTPUT] Session ${sessionId}:`);
    console.log(`  - Data length: ${data.length} bytes`);
    console.log(`  - Attached clients: ${attachedClients.length}`);
    attachedClients.forEach(c => console.log(`    - Client: ${c.id}`));

    if (attachedClients.length === 0) {
      console.log(`  - WARNING: No clients attached to receive this output!`);
    }

    this.broadcastToSession(sessionId, {
      type: MessageType.OUTPUT,
      sessionId,
      data,
      // Provide 'output' alias for clients expecting this property name
      output: data,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle session exit
   */
  private handleSessionExit(
    sessionId: string,
    exitCode: number,
    signal?: string
  ): void {
    const session = this.sessionManager.getSession(sessionId);
    const sessionName = session?.name || sessionId;
    const isSuccess = exitCode === 0;

    console.log(
      `Session ${sessionId} exited with code ${exitCode}${signal ? ` (signal: ${signal})` : ''}`
    );

    // Notify all connected clients
    this.broadcastToSession(sessionId, {
      type: MessageType.COMMAND_COMPLETE,
      sessionId,
      exitCode,
      signal,
      timestamp: Date.now(),
    });

    // Send notification message for mobile notifications
    const notificationTitle = isSuccess
      ? `${sessionName} completed`
      : `${sessionName} failed`;
    const notificationBody = isSuccess
      ? 'Command completed successfully'
      : `Command exited with code ${exitCode}`;

    this.broadcastToAll({
      type: MessageType.NOTIFICATION,
      sessionId,
      title: notificationTitle,
      body: notificationBody,
      priority: isSuccess ? 'normal' : 'high',
      notificationType: 'command_complete',
      exitCode,
      timestamp: Date.now(),
    });

    // Broadcast updated session list
    this.broadcastSessionList();
  }

  /**
   * Handle session error
   */
  private handleSessionError(sessionId: string, error: Error): void {
    console.error(`Session ${sessionId} error:`, error);

    this.broadcastToSession(sessionId, {
      type: MessageType.ERROR,
      sessionId,
      error: error.message,
      timestamp: Date.now(),
    });
  }

  /**
   * Send message to a specific client
   */
  private sendToClient(clientId: string, message: BaseMessage): void {
    const client = this.clients.get(clientId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) return;

    if (client.socket.bufferedAmount > MAX_PAYLOAD) { client.socket.close(1008, "Client is too slow"); return; }
    try {
      const jsonMsg = JSON.stringify(message);
      client.socket.send(jsonMsg);
      console.log(`[SEND] Success to ${clientId}`);
    } catch (error) {
      console.error(`[SEND] Error to client ${clientId}:`, error);
    }
  }

  /**
   * Send error message to client
   */
  private sendError(clientId: string, error: string, code?: string): void {
    this.sendToClient(clientId, {
      type: MessageType.ERROR,
      error,
      code,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast message to all clients attached to a session
   */
  private broadcastToSession(sessionId: string, message: BaseMessage): void {
    let sentCount = 0;
    for (const [clientId, client] of this.clients.entries()) {
      if (client.sessionId === sessionId) {
        console.log(`[BROADCAST] Sending ${message.type} to client ${clientId}`);
        this.sendToClient(clientId, message);
        sentCount++;
      }
    }
    if (sentCount === 0) {
      console.log(`[BROADCAST] No clients found for session ${sessionId}`);
    }
  }

  /**
   * Broadcast a message to all connected clients
   */
  private broadcastToAll(message: BaseMessage): void {
    for (const [clientId] of this.clients.entries()) {
      this.sendToClient(clientId, message);
    }
  }

  /**
   * Send session list to a specific client
   */
  private sendSessionList(clientId: string): void {
    const sessions = this.sessionManager.getSessionInfoList();
    this.sendToClient(clientId, {
      type: MessageType.SESSION_LIST,
      sessions,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast session list to all clients
   */
  private broadcastSessionList(): void {
    const sessions = this.sessionManager.getSessionInfoList();
    const message: BaseMessage = {
      type: MessageType.SESSION_LIST,
      timestamp: Date.now(),
    };

    for (const clientId of this.clients.keys()) {
      this.sendToClient(clientId, {
        ...message,
        sessions,
      } as BaseMessage);
    }
  }

  /**
   * Start heartbeat interval to check client health
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = this.config.heartbeatInterval * 2;

      for (const [clientId, client] of this.clients.entries()) {
        if (now - client.lastPing > timeout) {
          console.log(`Client ${clientId} timed out`);
          client.socket.terminate();
          this.handleDisconnect(clientId);
        } else if (client.socket.readyState === WebSocket.OPEN) {
          client.socket.ping();

          // Also send heartbeat message
          this.sendToClient(clientId, {
            type: MessageType.HEARTBEAT,
            timestamp: now,
          });
        }
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Start cleanup interval for old sessions
   */
  private startCleanupInterval(): void {
    // Clean up completed sessions every hour
    this.cleanupInterval = setInterval(() => {
      const cleaned = this.sessionManager.cleanupOldSessions();
      if (cleaned > 0) {
        console.log(`Cleaned up ${cleaned} old sessions`);
        this.broadcastSessionList();
      }
    }, 3600000);
  }

  /**
   * Create a session programmatically (for CLI use)
   */
  createSession(
    command: string,
    name?: string,
    cols?: number,
    rows?: number
  ): string {
    const session = this.sessionManager.createSession({
      name: name || command,
      command,
      cols,
      rows,
    });
    return session.id;
  }

  /**
   * Get session manager for external access
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get server port
   */
  getPort(): number {
    return this.config.port;
  }

  /**
   * Get VNC server port
   */
  getVncPort(): number {
    return this.config.vncPort;
  }

  /**
   * Get VNC server instance
   */
  getVncServer(): VNCServer | null {
    return this.vncServer;
  }

  /**
   * Check if VNC is enabled
   */
  isVncEnabled(): boolean {
    return this.config.enableVnc && this.vncServer !== null;
  }

  // ===========================================================================
  // Claude Headless Mode Handlers
  // ===========================================================================

  /**
   * Handle Claude create session request
   */
  private handleClaudeCreateSession(
    clientId: string,
    message: ClaudeCreateSessionMessage
  ): void {
    try {
      const config: ClaudeSessionConfig = {
        name: message.name,
        workingDirectory: message.workingDirectory,
        allowedTools: message.allowedTools,
        model: message.model,
        systemPrompt: message.systemPrompt,
        resumeSessionId: message.resumeSessionId,
      };

      const session = this.claudeSessionManager.createSession(config);

      // Auto-attach client to new session
      const client = this.clients.get(clientId);
      if (client) {
        client.claudeSessionId = session.id;
        this.claudeSessionManager.addClientToSession(session.id, clientId);
      }

      this.sendToClient(clientId, {
        type: MessageType.CLAUDE_SESSION_CREATED,
        sessionId: session.id,
        name: session.name,
        timestamp: Date.now(),
      });

      // Broadcast updated session list
      this.broadcastClaudeSessionList();

      console.log(`[CLAUDE] Session ${session.id} created for client ${clientId}`);
    } catch (error) {
      this.sendToClient(clientId, {
        type: MessageType.CLAUDE_ERROR,
        sessionId: '',
        error: (error as Error).message,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle Claude send prompt request
   */
  private async handleClaudeSendPrompt(
    clientId: string,
    message: ClaudeSendPromptMessage
  ): Promise<void> {
    const { sessionId, prompt } = message;

    if (!sessionId || !prompt) {
      this.sendToClient(clientId, {
        type: MessageType.CLAUDE_ERROR,
        sessionId: sessionId || '',
        error: 'Session ID and prompt are required',
        timestamp: Date.now(),
      });
      return;
    }

    try {
      const wrapped = this.buildWrappedPrompt(clientId, prompt);
      await this.claudeSessionManager.sendPrompt(sessionId, wrapped);
    } catch (error) {
      this.sendToClient(clientId, {
        type: MessageType.CLAUDE_ERROR,
        sessionId,
        error: (error as Error).message,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Build meta wrapper for Claude prompts, advertising media inbox and helper commands
   */
  private buildWrappedPrompt(clientId: string, userPrompt: string): string {
    const client = this.clients.get(clientId);
    const uploads = client?.recentUploads || [];
    const mediaDir = this.mediaDir;

    const recent = uploads.length
      ? `Recent uploads from this device (most recent last):\n${uploads.map((p) => `- ${p}`).join('\n')}`
      : 'No recent uploads recorded for this device.';

    const serverPort = this.config.port;
    const helper = [
      `Agentum server port: ${serverPort}`,
      `Media inbox directory: ${mediaDir}`,
      'Helper commands you can run with the Bash tool:',
      `- Capture current screen to the media inbox: 'ag screenshot' (saves to ${mediaDir})`,
      `- Send a phone notification: 'ag notify --port ${serverPort} --title "Title" --body "Message" --priority normal'`,
      'Prefer absolute paths when reading files.',
    ].join('\n');

    return [
      '<meta-context>',
      helper,
      recent,
      '</meta-context>',
      '',
      userPrompt,
    ].join('\n');
  }

  /**
   * Handle a client-triggered phone notification broadcast
   */
  private handleTriggerNotification(clientId: string, message: { title: string; body: string; priority?: string; notificationType?: string }): void {
    const title = message.title || 'Agentum';
    const body = message.body || '';
    const priority = (message.priority as 'low' | 'normal' | 'high' | 'urgent') || 'normal';
    const notificationType = (message.notificationType as string) || 'info';

    this.broadcastToAll({
      type: MessageType.NOTIFICATION,
      title,
      body,
      priority,
      notificationType,
      timestamp: Date.now(),
    });

    // Also acknowledge back to the sender
    this.sendToClient(clientId, {
      type: MessageType.NOTIFICATION,
      title: 'Notification sent',
      body: `${title}: ${body}`,
      priority: 'normal',
      notificationType: 'info',
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Claude attach session request
   */
  private handleClaudeAttachSession(clientId: string, sessionId: string): void {
    const session = this.claudeSessionManager.getSession(sessionId);
    if (!session) {
      this.sendToClient(clientId, {
        type: MessageType.CLAUDE_ERROR,
        sessionId,
        error: `Session not found: ${sessionId}`,
        timestamp: Date.now(),
      });
      return;
    }

    const client = this.clients.get(clientId);
    if (client) {
      // Detach from current Claude session if attached
      if (client.claudeSessionId) {
        this.claudeSessionManager.removeClientFromSession(client.claudeSessionId, clientId);
      }

      client.claudeSessionId = sessionId;
      this.claudeSessionManager.addClientToSession(sessionId, clientId);

      // Send attach confirmation
      this.sendToClient(clientId, {
        type: MessageType.CLAUDE_SESSION_ATTACHED,
        sessionId,
        timestamp: Date.now(),
      });

      // Send message history
      this.handleClaudeGetHistory(clientId, sessionId);

      console.log(`[CLAUDE] Client ${clientId} attached to session ${sessionId}`);
    }
  }

  /**
   * Handle Claude detach session request
   */
  private handleClaudeDetachSession(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client || !client.claudeSessionId) return;

    const sessionId = client.claudeSessionId;
    this.claudeSessionManager.removeClientFromSession(sessionId, clientId);
    client.claudeSessionId = undefined;

    this.sendToClient(clientId, {
      type: MessageType.CLAUDE_SESSION_DETACHED,
      sessionId,
      timestamp: Date.now(),
    });

    console.log(`[CLAUDE] Client ${clientId} detached from session ${sessionId}`);
  }

  /**
   * Handle Claude kill session request
   */
  private handleClaudeKillSession(clientId: string, sessionId: string): void {
    const success = this.claudeSessionManager.killSession(sessionId);

    if (success) {
      // Notify all clients attached to this session
      for (const [cId, client] of this.clients.entries()) {
        if (client.claudeSessionId === sessionId) {
          client.claudeSessionId = undefined;
          this.sendToClient(cId, {
            type: MessageType.CLAUDE_SESSION_ENDED,
            sessionId,
            result: 'Session killed by user',
            totalCost: 0,
            isError: false,
            timestamp: Date.now(),
          });
        }
      }

      this.broadcastClaudeSessionList();
      console.log(`[CLAUDE] Session ${sessionId} killed by client ${clientId}`);
    } else {
      this.sendToClient(clientId, {
        type: MessageType.CLAUDE_ERROR,
        sessionId,
        error: `Failed to kill session: ${sessionId}`,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle Claude get history request
   */
  private handleClaudeGetHistory(clientId: string, sessionId: string): void {
    const messages = this.claudeSessionManager.getMessageHistory(sessionId);

    this.sendToClient(clientId, {
      type: MessageType.CLAUDE_HISTORY,
      sessionId,
      messages,
      timestamp: Date.now(),
    });
  }

  /**
   * Send Claude session list to a specific client
   */
  private sendClaudeSessionList(clientId: string): void {
    const sessions = this.claudeSessionManager.getSessionInfoList();
    this.sendToClient(clientId, {
      type: MessageType.CLAUDE_SESSION_LIST,
      sessions,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast Claude session list to all clients
   */
  private broadcastClaudeSessionList(): void {
    const sessions = this.claudeSessionManager.getSessionInfoList();
    for (const clientId of this.clients.keys()) {
      this.sendToClient(clientId, {
        type: MessageType.CLAUDE_SESSION_LIST,
        sessions,
        timestamp: Date.now(),
      });
    }
  }

  // ===========================================================================
  // Claude Event Handlers (from ClaudeSessionManager)
  // ===========================================================================

  /**
   * Handle Claude message event
   */
  private handleClaudeMessage(sessionId: string, message: ClaudeMessage): void {
    this.broadcastToClaudeSession(sessionId, {
      type: MessageType.CLAUDE_MESSAGE,
      sessionId,
      message: {
        id: message.id,
        role: message.role,
        content: message.content,
        toolName: message.toolName,
        toolInput: message.toolInput,
        toolResult: message.toolResult,
        isThinking: message.isThinking,
        isError: message.isError,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Claude thinking status
   */
  private handleClaudeThinking(sessionId: string, isThinking: boolean, content?: string): void {
    this.broadcastToClaudeSession(sessionId, {
      type: MessageType.CLAUDE_THINKING,
      sessionId,
      isThinking,
      content,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Claude tool use
   */
  private handleClaudeToolUse(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    toolUseId?: string
  ): void {
    this.broadcastToClaudeSession(sessionId, {
      type: MessageType.CLAUDE_TOOL_USE,
      sessionId,
      toolName,
      toolInput,
      toolUseId,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Claude tool result
   */
  private handleClaudeToolResult(
    sessionId: string,
    toolUseId: string,
    result: string,
    isError: boolean
  ): void {
    this.broadcastToClaudeSession(sessionId, {
      type: MessageType.CLAUDE_TOOL_RESULT,
      sessionId,
      toolName: toolUseId,
      result,
      isError,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Claude session start
   */
  private handleClaudeSessionStart(sessionId: string, claudeSessionId: string): void {
    this.broadcastToClaudeSession(sessionId, {
      type: MessageType.CLAUDE_SESSION_STARTED,
      sessionId,
      claudeSessionId,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Claude session end
   */
  private handleClaudeSessionEnd(
    sessionId: string,
    result: string,
    cost: number,
    isError: boolean
  ): void {
    this.broadcastToClaudeSession(sessionId, {
      type: MessageType.CLAUDE_SESSION_ENDED,
      sessionId,
      result,
      totalCost: cost,
      isError,
      timestamp: Date.now(),
    });

    // Also send a notification
    this.broadcastToAll({
      type: MessageType.NOTIFICATION,
      sessionId,
      title: isError ? `Claude Error` : `Claude Response Complete`,
      body: isError ? result.slice(0, 100) : `Response received (${cost ? `$${cost.toFixed(4)}` : 'no cost'})`,
      priority: isError ? 'high' : 'normal',
      notificationType: 'command_complete',
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Claude error
   */
  private handleClaudeError(sessionId: string, error: Error): void {
    this.broadcastToClaudeSession(sessionId, {
      type: MessageType.CLAUDE_ERROR,
      sessionId,
      error: error.message,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Claude raw output (for debugging)
   */
  private handleClaudeRawOutput(sessionId: string, line: string): void {
    this.broadcastToClaudeSession(sessionId, {
      type: MessageType.CLAUDE_RAW_OUTPUT,
      sessionId,
      line,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast message to all clients attached to a Claude session
   */
  private broadcastToClaudeSession(sessionId: string, message: BaseMessage): void {
    for (const [clientId, client] of this.clients.entries()) {
      if (client.claudeSessionId === sessionId) {
        this.sendToClient(clientId, message);
      }
    }
  }

  /**
   * Get Claude session manager for external access
   */
  getClaudeSessionManager(): ClaudeSessionManager {
    return this.claudeSessionManager;
  }

  // ===========================================================================
  // OpenAI Codex Handlers
  // ===========================================================================

  /**
   * Handle Codex create session request
   */
  private handleCodexCreateSession(
    clientId: string,
    message: CodexCreateSessionMessage
  ): void {
    try {
      const config: CodexSessionConfig = {
        name: message.name,
        workingDirectory: message.workingDirectory,
        model: message.model,
        skipGitRepoCheck: message.skipGitRepoCheck,
      };

      const session = this.codexSessionManager.createSession(config);

      // Auto-attach client to new session
      const client = this.clients.get(clientId);
      if (client) {
        client.codexSessionId = session.id;
        this.codexSessionManager.addClientToSession(session.id, clientId);
      }

      this.sendToClient(clientId, {
        type: MessageType.CODEX_SESSION_CREATED,
        sessionId: session.id,
        name: session.name,
        timestamp: Date.now(),
      });

      // Broadcast updated session list
      this.broadcastCodexSessionList();

      console.log(`[CODEX] Session ${session.id} created for client ${clientId}`);
    } catch (error) {
      this.sendToClient(clientId, {
        type: MessageType.CODEX_ERROR,
        sessionId: '',
        error: (error as Error).message,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle Codex send prompt request
   */
  private async handleCodexSendPrompt(
    clientId: string,
    message: CodexSendPromptMessage
  ): Promise<void> {
    const { sessionId, prompt } = message;

    if (!sessionId || !prompt) {
      this.sendToClient(clientId, {
        type: MessageType.CODEX_ERROR,
        sessionId: sessionId || '',
        error: 'Session ID and prompt are required',
        timestamp: Date.now(),
      });
      return;
    }

    try {
      await this.codexSessionManager.sendPrompt(sessionId, prompt);
    } catch (error) {
      this.sendToClient(clientId, {
        type: MessageType.CODEX_ERROR,
        sessionId,
        error: (error as Error).message,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle Codex attach session request
   */
  private handleCodexAttachSession(clientId: string, sessionId: string): void {
    const session = this.codexSessionManager.getSession(sessionId);
    if (!session) {
      this.sendToClient(clientId, {
        type: MessageType.CODEX_ERROR,
        sessionId,
        error: `Session not found: ${sessionId}`,
        timestamp: Date.now(),
      });
      return;
    }

    const client = this.clients.get(clientId);
    if (client) {
      // Detach from current Codex session if attached
      if (client.codexSessionId) {
        this.codexSessionManager.removeClientFromSession(client.codexSessionId, clientId);
      }

      client.codexSessionId = sessionId;
      this.codexSessionManager.addClientToSession(sessionId, clientId);

      // Send attach confirmation
      this.sendToClient(clientId, {
        type: MessageType.CODEX_SESSION_ATTACHED,
        sessionId,
        timestamp: Date.now(),
      });

      // Send message history
      this.handleCodexGetHistory(clientId, sessionId);

      console.log(`[CODEX] Client ${clientId} attached to session ${sessionId}`);
    }
  }

  /**
   * Handle Codex detach session request
   */
  private handleCodexDetachSession(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client || !client.codexSessionId) return;

    const sessionId = client.codexSessionId;
    this.codexSessionManager.removeClientFromSession(sessionId, clientId);
    client.codexSessionId = undefined;

    this.sendToClient(clientId, {
      type: MessageType.CODEX_SESSION_DETACHED,
      sessionId,
      timestamp: Date.now(),
    });

    console.log(`[CODEX] Client ${clientId} detached from session ${sessionId}`);
  }

  /**
   * Handle Codex kill session request
   */
  private handleCodexKillSession(clientId: string, sessionId: string): void {
    const success = this.codexSessionManager.killSession(sessionId);

    if (success) {
      // Notify all clients attached to this session
      for (const [cId, client] of this.clients.entries()) {
        if (client.codexSessionId === sessionId) {
          client.codexSessionId = undefined;
          this.sendToClient(cId, {
            type: MessageType.CODEX_SESSION_ENDED,
            sessionId,
            result: 'Session killed by user',
            isError: false,
            timestamp: Date.now(),
          });
        }
      }

      this.broadcastCodexSessionList();
      console.log(`[CODEX] Session ${sessionId} killed by client ${clientId}`);
    } else {
      this.sendToClient(clientId, {
        type: MessageType.CODEX_ERROR,
        sessionId,
        error: `Failed to kill session: ${sessionId}`,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle Codex get history request
   */
  private handleCodexGetHistory(clientId: string, sessionId: string): void {
    const messages = this.codexSessionManager.getMessageHistory(sessionId);

    this.sendToClient(clientId, {
      type: MessageType.CODEX_HISTORY,
      sessionId,
      messages,
      timestamp: Date.now(),
    });
  }

  /**
   * Send Codex session list to a specific client
   */
  private sendCodexSessionList(clientId: string): void {
    const sessions = this.codexSessionManager.getSessionInfoList();
    this.sendToClient(clientId, {
      type: MessageType.CODEX_SESSION_LIST,
      sessions,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast Codex session list to all clients
   */
  private broadcastCodexSessionList(): void {
    const sessions = this.codexSessionManager.getSessionInfoList();
    for (const clientId of this.clients.keys()) {
      this.sendToClient(clientId, {
        type: MessageType.CODEX_SESSION_LIST,
        sessions,
        timestamp: Date.now(),
      });
    }
  }

  // ===========================================================================
  // Codex Event Handlers (from CodexSessionManager)
  // ===========================================================================

  /**
   * Handle Codex message event
   */
  private handleCodexMessage(sessionId: string, message: CodexMessage): void {
    this.broadcastToCodexSession(sessionId, {
      type: MessageType.CODEX_MESSAGE,
      sessionId,
      message: {
        id: message.id,
        role: message.role,
        content: message.content,
        toolName: message.toolName,
        toolInput: message.toolInput,
        toolResult: message.toolResult,
        isError: message.isError,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Codex tool use
   */
  private handleCodexToolUse(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    toolUseId?: string
  ): void {
    this.broadcastToCodexSession(sessionId, {
      type: MessageType.CODEX_TOOL_USE,
      sessionId,
      toolName,
      toolInput,
      toolUseId,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Codex tool result
   */
  private handleCodexToolResult(
    sessionId: string,
    toolUseId: string,
    result: string,
    isError: boolean
  ): void {
    this.broadcastToCodexSession(sessionId, {
      type: MessageType.CODEX_TOOL_RESULT,
      sessionId,
      toolName: toolUseId,
      result,
      isError,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Codex session start
   */
  private handleCodexSessionStart(sessionId: string, codexThreadId: string): void {
    this.broadcastToCodexSession(sessionId, {
      type: MessageType.CODEX_SESSION_STARTED,
      sessionId,
      codexThreadId,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Codex session end
   */
  private handleCodexSessionEnd(
    sessionId: string,
    result: string,
    isError: boolean
  ): void {
    this.broadcastToCodexSession(sessionId, {
      type: MessageType.CODEX_SESSION_ENDED,
      sessionId,
      result,
      isError,
      timestamp: Date.now(),
    });

    // Also send a notification
    this.broadcastToAll({
      type: MessageType.NOTIFICATION,
      sessionId,
      title: isError ? `Codex Error` : `Codex Response Complete`,
      body: isError ? result.slice(0, 100) : `Response received`,
      priority: isError ? 'high' : 'normal',
      notificationType: 'command_complete',
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Codex error
   */
  private handleCodexError(sessionId: string, error: Error): void {
    this.broadcastToCodexSession(sessionId, {
      type: MessageType.CODEX_ERROR,
      sessionId,
      error: error.message,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Codex raw output (for debugging)
   */
  private handleCodexRawOutput(sessionId: string, line: string): void {
    this.broadcastToCodexSession(sessionId, {
      type: MessageType.CODEX_RAW_OUTPUT,
      sessionId,
      line,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast message to all clients attached to a Codex session
   */
  private broadcastToCodexSession(sessionId: string, message: BaseMessage): void {
    for (const [clientId, client] of this.clients.entries()) {
      if (client.codexSessionId === sessionId) {
        this.sendToClient(clientId, message);
      }
    }
  }

  /**
   * Get Codex session manager for external access
   */
  getCodexSessionManager(): CodexSessionManager {
    return this.codexSessionManager;
  }

  // ===========================================================================
  // GitHub Copilot Handlers
  // ===========================================================================

  /**
   * Handle Copilot create session request
   */
  private handleCopilotCreateSession(
    clientId: string,
    message: CopilotCreateSessionMessage
  ): void {
    try {
      const config: CopilotSessionConfig = {
        name: message.name,
        workingDirectory: message.workingDirectory,
        model: message.model,
        systemPrompt: message.systemPrompt,
        githubToken: message.githubToken,
      };

      const session = this.copilotSessionManager.createSession(config);

      // Auto-attach client to new session
      const client = this.clients.get(clientId);
      if (client) {
        client.copilotSessionId = session.id;
        this.copilotSessionManager.addClientToSession(session.id, clientId);
      }

      this.sendToClient(clientId, {
        type: MessageType.COPILOT_SESSION_CREATED,
        sessionId: session.id,
        name: session.name,
        timestamp: Date.now(),
      });

      // Broadcast updated session list
      this.broadcastCopilotSessionList();

      console.log(`[COPILOT] Session ${session.id} created for client ${clientId}`);
    } catch (error) {
      this.sendToClient(clientId, {
        type: MessageType.COPILOT_ERROR,
        sessionId: '',
        error: (error as Error).message,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle Copilot send prompt request
   */
  private async handleCopilotSendPrompt(
    clientId: string,
    message: CopilotSendPromptMessage
  ): Promise<void> {
    const { sessionId, prompt } = message;

    if (!sessionId || !prompt) {
      this.sendToClient(clientId, {
        type: MessageType.COPILOT_ERROR,
        sessionId: sessionId || '',
        error: 'Session ID and prompt are required',
        timestamp: Date.now(),
      });
      return;
    }

    try {
      await this.copilotSessionManager.sendPrompt(sessionId, prompt);
    } catch (error) {
      this.sendToClient(clientId, {
        type: MessageType.COPILOT_ERROR,
        sessionId,
        error: (error as Error).message,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle Copilot attach session request
   */
  private handleCopilotAttachSession(clientId: string, sessionId: string): void {
    const session = this.copilotSessionManager.getSession(sessionId);
    if (!session) {
      this.sendToClient(clientId, {
        type: MessageType.COPILOT_ERROR,
        sessionId,
        error: `Session not found: ${sessionId}`,
        timestamp: Date.now(),
      });
      return;
    }

    const client = this.clients.get(clientId);
    if (client) {
      // Detach from current Copilot session if attached
      if (client.copilotSessionId) {
        this.copilotSessionManager.removeClientFromSession(client.copilotSessionId, clientId);
      }

      client.copilotSessionId = sessionId;
      this.copilotSessionManager.addClientToSession(sessionId, clientId);

      // Send attach confirmation
      this.sendToClient(clientId, {
        type: MessageType.COPILOT_SESSION_ATTACHED,
        sessionId,
        timestamp: Date.now(),
      });

      // Send message history
      this.handleCopilotGetHistory(clientId, sessionId);

      console.log(`[COPILOT] Client ${clientId} attached to session ${sessionId}`);
    }
  }

  /**
   * Handle Copilot detach session request
   */
  private handleCopilotDetachSession(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client || !client.copilotSessionId) return;

    const sessionId = client.copilotSessionId;
    this.copilotSessionManager.removeClientFromSession(sessionId, clientId);
    client.copilotSessionId = undefined;

    this.sendToClient(clientId, {
      type: MessageType.COPILOT_SESSION_DETACHED,
      sessionId,
      timestamp: Date.now(),
    });

    console.log(`[COPILOT] Client ${clientId} detached from session ${sessionId}`);
  }

  /**
   * Handle Copilot kill session request
   */
  private handleCopilotKillSession(clientId: string, sessionId: string): void {
    const success = this.copilotSessionManager.killSession(sessionId);

    if (success) {
      // Notify all clients attached to this session
      for (const [cId, client] of this.clients.entries()) {
        if (client.copilotSessionId === sessionId) {
          client.copilotSessionId = undefined;
          this.sendToClient(cId, {
            type: MessageType.COPILOT_SESSION_ENDED,
            sessionId,
            result: 'Session killed by user',
            totalTokens: 0,
            isError: false,
            timestamp: Date.now(),
          });
        }
      }

      this.broadcastCopilotSessionList();
      console.log(`[COPILOT] Session ${sessionId} killed by client ${clientId}`);
    } else {
      this.sendToClient(clientId, {
        type: MessageType.COPILOT_ERROR,
        sessionId,
        error: `Failed to kill session: ${sessionId}`,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle Copilot get history request
   */
  private handleCopilotGetHistory(clientId: string, sessionId: string): void {
    const messages = this.copilotSessionManager.getMessageHistory(sessionId);

    this.sendToClient(clientId, {
      type: MessageType.COPILOT_HISTORY,
      sessionId,
      messages,
      timestamp: Date.now(),
    });
  }

  /**
   * Send Copilot session list to a specific client
   */
  private sendCopilotSessionList(clientId: string): void {
    const sessions = this.copilotSessionManager.getSessionInfoList();
    this.sendToClient(clientId, {
      type: MessageType.COPILOT_SESSION_LIST,
      sessions,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast Copilot session list to all clients
   */
  private broadcastCopilotSessionList(): void {
    const sessions = this.copilotSessionManager.getSessionInfoList();
    for (const clientId of this.clients.keys()) {
      this.sendToClient(clientId, {
        type: MessageType.COPILOT_SESSION_LIST,
        sessions,
        timestamp: Date.now(),
      });
    }
  }

  // ===========================================================================
  // Copilot Event Handlers (from CopilotSessionManager)
  // ===========================================================================

  /**
   * Handle Copilot message event
   */
  private handleCopilotMessage(sessionId: string, message: CopilotMessage): void {
    this.broadcastToCopilotSession(sessionId, {
      type: MessageType.COPILOT_MESSAGE,
      sessionId,
      message: {
        id: message.id,
        role: message.role,
        content: message.content,
        toolName: message.toolName,
        toolInput: message.toolInput,
        toolResult: message.toolResult,
        isCode: message.isCode,
        language: message.language,
        isError: message.isError,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Copilot thinking status
   */
  private handleCopilotThinking(sessionId: string, isThinking: boolean, content?: string): void {
    this.broadcastToCopilotSession(sessionId, {
      type: MessageType.COPILOT_THINKING,
      sessionId,
      isThinking,
      content,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Copilot tool use
   */
  private handleCopilotToolUse(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    toolUseId?: string
  ): void {
    this.broadcastToCopilotSession(sessionId, {
      type: MessageType.COPILOT_TOOL_USE,
      sessionId,
      toolName,
      toolInput,
      toolUseId,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Copilot tool result
   */
  private handleCopilotToolResult(
    sessionId: string,
    toolUseId: string,
    result: string,
    isError: boolean
  ): void {
    this.broadcastToCopilotSession(sessionId, {
      type: MessageType.COPILOT_TOOL_RESULT,
      sessionId,
      toolName: toolUseId,
      result,
      isError,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Copilot session start
   */
  private handleCopilotSessionStart(sessionId: string, copilotSessionId: string): void {
    this.broadcastToCopilotSession(sessionId, {
      type: MessageType.COPILOT_SESSION_STARTED,
      sessionId,
      copilotSessionId,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Copilot session end
   */
  private handleCopilotSessionEnd(
    sessionId: string,
    result: string,
    tokens: number,
    isError: boolean
  ): void {
    this.broadcastToCopilotSession(sessionId, {
      type: MessageType.COPILOT_SESSION_ENDED,
      sessionId,
      result,
      totalTokens: tokens,
      isError,
      timestamp: Date.now(),
    });

    // Also send a notification
    this.broadcastToAll({
      type: MessageType.NOTIFICATION,
      sessionId,
      title: isError ? `Copilot Error` : `Copilot Response Complete`,
      body: isError ? result.slice(0, 100) : `Response received${tokens ? ` (${tokens} tokens)` : ''}`,
      priority: isError ? 'high' : 'normal',
      notificationType: 'command_complete',
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Copilot error
   */
  private handleCopilotError(sessionId: string, error: Error): void {
    this.broadcastToCopilotSession(sessionId, {
      type: MessageType.COPILOT_ERROR,
      sessionId,
      error: error.message,
      timestamp: Date.now(),
    });
  }

  /**
   * Handle Copilot raw output (for debugging)
   */
  private handleCopilotRawOutput(sessionId: string, line: string): void {
    this.broadcastToCopilotSession(sessionId, {
      type: MessageType.COPILOT_RAW_OUTPUT,
      sessionId,
      line,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast message to all clients attached to a Copilot session
   */
  private broadcastToCopilotSession(sessionId: string, message: BaseMessage): void {
    for (const [clientId, client] of this.clients.entries()) {
      if (client.copilotSessionId === sessionId) {
        this.sendToClient(clientId, message);
      }
    }
  }

  /**
   * Get Copilot session manager for external access
   */
  getCopilotSessionManager(): CopilotSessionManager {
    return this.copilotSessionManager;
  }

  /**
   * Shutdown the server gracefully
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    console.log('Shutting down Agentum server...');

    // Clear intervals
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close all client connections
    for (const [clientId, client] of this.clients.entries()) {
      try {
        client.socket.close(1001, 'Server shutting down');
      } catch {
        // Ignore errors during shutdown
      }
      this.clients.delete(clientId);
    }

    // Shutdown all PTY sessions
    this.sessionManager.shutdown();

    // Shutdown all Claude sessions
    this.claudeSessionManager.shutdown();

    // Shutdown all Codex sessions
    this.codexSessionManager.shutdown();

    // Shutdown all Copilot sessions
    this.copilotSessionManager.shutdown();

    // Shutdown VNC server
    if (this.vncServer) {
      await this.vncServer.shutdown();
      this.vncServer = null;
    }

    // Close WebSocket server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => {
          resolve();
        });
      });
    }

    console.log('Agentum server shutdown complete');
  }
}

/**
 * Create and start a new server instance
 */
export async function createServer(
  config: Partial<ServerConfig> = {}
): Promise<AgentumServer> {
  const server = new AgentumServer(config);
  await server.start();
  return server;
}
