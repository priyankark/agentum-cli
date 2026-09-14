/**
 * TypeScript interfaces for AirCodum-Agentum CLI
 */

import type { IPty } from 'node-pty';
import type WebSocket from 'ws';

/**
 * Session states
 */
export enum SessionState {
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  ERROR = 'error',
}

/**
 * WebSocket message types for communication protocol
 */
export enum MessageType {
  // Client -> Server (Legacy PTY)
  INPUT = 'input',
  RESIZE = 'resize',
  ATTACH = 'attach',
  DETACH = 'detach',
  LIST_SESSIONS = 'list_sessions',
  KILL_SESSION = 'kill_session',
  CREATE_SESSION = 'create_session',
  PING = 'ping',

  // Client -> Server (Claude Headless)
  CLAUDE_SEND_PROMPT = 'claude_send_prompt',
  CLAUDE_CREATE_SESSION = 'claude_create_session',
  CLAUDE_LIST_SESSIONS = 'claude_list_sessions',
  CLAUDE_ATTACH_SESSION = 'claude_attach_session',
  CLAUDE_DETACH_SESSION = 'claude_detach_session',
  CLAUDE_KILL_SESSION = 'claude_kill_session',
  CLAUDE_GET_HISTORY = 'claude_get_history',

  // Client -> Server (GitHub Copilot)
  COPILOT_SEND_PROMPT = 'copilot_send_prompt',
  COPILOT_CREATE_SESSION = 'copilot_create_session',
  COPILOT_LIST_SESSIONS = 'copilot_list_sessions',
  COPILOT_ATTACH_SESSION = 'copilot_attach_session',
  COPILOT_DETACH_SESSION = 'copilot_detach_session',
  COPILOT_KILL_SESSION = 'copilot_kill_session',
  COPILOT_GET_HISTORY = 'copilot_get_history',

  // Client -> Server (OpenAI Codex)
  CODEX_SEND_PROMPT = 'codex_send_prompt',
  CODEX_CREATE_SESSION = 'codex_create_session',
  CODEX_LIST_SESSIONS = 'codex_list_sessions',
  CODEX_ATTACH_SESSION = 'codex_attach_session',
  CODEX_DETACH_SESSION = 'codex_detach_session',
  CODEX_KILL_SESSION = 'codex_kill_session',
  CODEX_GET_HISTORY = 'codex_get_history',

  // Server -> Client (Legacy PTY)
  OUTPUT = 'output',
  SESSION_CREATED = 'session_created',
  SESSION_LIST = 'session_list',
  SESSION_ATTACHED = 'session_attached',
  SESSION_DETACHED = 'session_detached',
  SESSION_ENDED = 'session_ended',
  SESSION_KILLED = 'session_killed',
  COMMAND_COMPLETE = 'command_complete',
  ERROR = 'error',
  PONG = 'pong',
  HEARTBEAT = 'heartbeat',
  NOTIFICATION = 'notification',
  // Client -> Server (Utility trigger)
  TRIGGER_NOTIFICATION = 'trigger_notification',
  SCREENSHOT_BROADCAST = 'screenshot_broadcast',

  // Server -> Client (Claude Headless)
  CLAUDE_MESSAGE = 'claude_message',
  CLAUDE_THINKING = 'claude_thinking',
  CLAUDE_TOOL_USE = 'claude_tool_use',
  CLAUDE_TOOL_RESULT = 'claude_tool_result',
  CLAUDE_SESSION_STARTED = 'claude_session_started',
  CLAUDE_SESSION_ENDED = 'claude_session_ended',
  CLAUDE_SESSION_LIST = 'claude_session_list',
  CLAUDE_SESSION_CREATED = 'claude_session_created',
  CLAUDE_SESSION_ATTACHED = 'claude_session_attached',
  CLAUDE_SESSION_DETACHED = 'claude_session_detached',
  CLAUDE_HISTORY = 'claude_history',
  CLAUDE_RAW_OUTPUT = 'claude_raw_output',
  CLAUDE_ERROR = 'claude_error',
  CLAUDE_MEDIA = 'claude_media',

  // Server -> Client (GitHub Copilot)
  COPILOT_MESSAGE = 'copilot_message',
  COPILOT_THINKING = 'copilot_thinking',
  COPILOT_TOOL_USE = 'copilot_tool_use',
  COPILOT_TOOL_RESULT = 'copilot_tool_result',
  COPILOT_SESSION_STARTED = 'copilot_session_started',
  COPILOT_SESSION_ENDED = 'copilot_session_ended',
  COPILOT_SESSION_LIST = 'copilot_session_list',
  COPILOT_SESSION_CREATED = 'copilot_session_created',
  COPILOT_SESSION_ATTACHED = 'copilot_session_attached',
  COPILOT_SESSION_DETACHED = 'copilot_session_detached',
  COPILOT_HISTORY = 'copilot_history',
  COPILOT_RAW_OUTPUT = 'copilot_raw_output',
  COPILOT_ERROR = 'copilot_error',

  // Server -> Client (OpenAI Codex)
  CODEX_MESSAGE = 'codex_message',
  CODEX_TOOL_USE = 'codex_tool_use',
  CODEX_TOOL_RESULT = 'codex_tool_result',
  CODEX_SESSION_STARTED = 'codex_session_started',
  CODEX_SESSION_ENDED = 'codex_session_ended',
  CODEX_SESSION_LIST = 'codex_session_list',
  CODEX_SESSION_CREATED = 'codex_session_created',
  CODEX_SESSION_ATTACHED = 'codex_session_attached',
  CODEX_SESSION_DETACHED = 'codex_session_detached',
  CODEX_HISTORY = 'codex_history',
  CODEX_RAW_OUTPUT = 'codex_raw_output',
  CODEX_ERROR = 'codex_error',

  // VNC Messages (Client -> Server)
  VNC_MOUSE_EVENT = 'vnc_mouse_event',
  VNC_KEYBOARD_EVENT = 'vnc_keyboard_event',
  VNC_QUALITY_UPDATE = 'vnc_quality_update',
  VNC_START = 'vnc_start',
  VNC_STOP = 'vnc_stop',

  // VNC Messages (Server -> Client)
  VNC_SCREEN_UPDATE = 'vnc_screen_update',
  VNC_STARTED = 'vnc_started',
  VNC_STOPPED = 'vnc_stopped',
  VNC_ERROR = 'vnc_error',
}

/**
 * Base message structure - allows additional properties for flexibility
 */
export interface BaseMessage {
  type: MessageType;
  timestamp: number;
  sessionId?: string;
  [key: string]: unknown;
}

/**
 * Input message from mobile client
 */
export interface InputMessage extends BaseMessage {
  type: MessageType.INPUT;
  data: string;
}

/**
 * Resize message from mobile client
 */
export interface ResizeMessage extends BaseMessage {
  type: MessageType.RESIZE;
  cols: number;
  rows: number;
}

/**
 * Attach message from mobile client
 */
export interface AttachMessage extends BaseMessage {
  type: MessageType.ATTACH;
  sessionId: string;
}

/**
 * Create session message from mobile client
 */
export interface CreateSessionMessage extends BaseMessage {
  type: MessageType.CREATE_SESSION;
  command: string;
  name?: string;
  cols?: number;
  rows?: number;
}

/**
 * Output message to mobile client
 */
export interface OutputMessage extends BaseMessage {
  type: MessageType.OUTPUT;
  data: string;
}

/**
 * Session list message
 */
export interface SessionListMessage extends BaseMessage {
  type: MessageType.SESSION_LIST;
  sessions: SessionInfo[];
}

/**
 * Command complete notification
 */
export interface CommandCompleteMessage extends BaseMessage {
  type: MessageType.COMMAND_COMPLETE;
  exitCode: number;
  signal?: string;
}

/**
 * Error message
 */
export interface ErrorMessage extends BaseMessage {
  type: MessageType.ERROR;
  error: string;
  code?: string;
}

/**
 * Notification message to mobile client
 */
export interface NotificationMessage extends BaseMessage {
  type: MessageType.NOTIFICATION;
  title: string;
  body: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  notificationType?: 'command_complete' | 'error' | 'info' | 'warning' | 'session_ended';
  exitCode?: number;
}

/**
 * Claude media message to clients
 */
export interface ClaudeMediaMessage extends BaseMessage {
  type: MessageType.CLAUDE_MEDIA;
  sessionId: string;
  mediaType: 'image';
  mimeType: string;
  dataUrl: string;
  filePath?: string;
  source?: 'screenshot';
}

/**
 * Trigger notification (client -> server)
 */
export interface TriggerNotificationMessage extends BaseMessage {
  type: MessageType.TRIGGER_NOTIFICATION;
  title: string;
  body: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  notificationType?: 'command_complete' | 'error' | 'info' | 'warning' | 'session_ended';
}

/**
 * Session information
 */
export interface SessionInfo {
  id: string;
  name: string;
  command: string;
  state: SessionState;
  createdAt: number;
  pid?: number;
  connectedClients: number;
  cols: number;
  rows: number;
}

/**
 * Session configuration
 */
export interface SessionConfig {
  id?: string;
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

/**
 * Connected client information
 */
export interface ConnectedClient {
  id: string;
  socket: WebSocket;
  sessionId?: string;           // Legacy PTY session ID
  claudeSessionId?: string;     // Claude headless session ID
  copilotSessionId?: string;    // GitHub Copilot session ID
  codexSessionId?: string;      // OpenAI Codex session ID
  connectedAt: number;
  lastPing: number;
  // Recent media uploads from this client (absolute paths)
  recentUploads?: string[];
}

/**
 * Session instance
 */
export interface Session {
  id: string;
  name: string;
  command: string;
  args: string[];
  state: SessionState;
  createdAt: number;
  pty: IPty;
  outputBuffer: string[];
  connectedClients: Set<string>;
  cols: number;
  rows: number;
  exitCode?: number;
  exitSignal?: string;
}

/**
 * Server configuration
 */
export interface ServerConfig {
  instanceName?: string;
  port: number;
  host?: string;
  heartbeatInterval?: number;
  maxOutputBuffer?: number;
  allowRemoteConnections?: boolean;
  vncPort?: number;
  enableVnc?: boolean;
}

/**
 * Union type for all messages
 */
export type WebSocketMessage =
  | InputMessage
  | ResizeMessage
  | AttachMessage
  | CreateSessionMessage
  | OutputMessage
  | SessionListMessage
  | CommandCompleteMessage
  | ErrorMessage
  | NotificationMessage
  | BaseMessage;

/**
 * Event handlers for session
 */
export interface SessionEventHandlers {
  onOutput: (sessionId: string, data: string) => void;
  onExit: (sessionId: string, exitCode: number, signal?: string) => void;
  onError: (sessionId: string, error: Error) => void;
}

/**
 * CLI options
 */
export interface ServerOptions {
  port: number;
  host?: string;
}

export interface RunOptions {
  name?: string;
  port?: number;
  detach?: boolean;
}

export interface AttachOptions {
  port?: number;
}

// ============================================================================
// Claude Headless Mode Message Types
// ============================================================================

/**
 * Claude send prompt message (client -> server)
 */
export interface ClaudeSendPromptMessage extends BaseMessage {
  type: MessageType.CLAUDE_SEND_PROMPT;
  sessionId: string;
  prompt: string;
}

/**
 * Claude create session message (client -> server)
 */
export interface ClaudeCreateSessionMessage extends BaseMessage {
  type: MessageType.CLAUDE_CREATE_SESSION;
  name?: string;
  workingDirectory?: string;
  allowedTools?: string[];
  model?: string;
  systemPrompt?: string;
  resumeSessionId?: string;  // Claude's session ID to resume
}

/**
 * Claude message (server -> client)
 */
export interface ClaudeMessagePayload extends BaseMessage {
  type: MessageType.CLAUDE_MESSAGE;
  sessionId: string;
  message: {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolResult?: string;
    isThinking?: boolean;
    isError?: boolean;
  };
}

/**
 * Claude thinking status (server -> client)
 */
export interface ClaudeThinkingMessage extends BaseMessage {
  type: MessageType.CLAUDE_THINKING;
  sessionId: string;
  isThinking: boolean;
  content?: string;
}

/**
 * Claude tool use (server -> client)
 */
export interface ClaudeToolUseMessage extends BaseMessage {
  type: MessageType.CLAUDE_TOOL_USE;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

/**
 * Claude tool result (server -> client)
 */
export interface ClaudeToolResultMessage extends BaseMessage {
  type: MessageType.CLAUDE_TOOL_RESULT;
  sessionId: string;
  toolName: string;
  result: string;
  isError: boolean;
}

/**
 * Claude session started (server -> client)
 */
export interface ClaudeSessionStartedMessage extends BaseMessage {
  type: MessageType.CLAUDE_SESSION_STARTED;
  sessionId: string;
  claudeSessionId: string;  // Claude's internal session ID for --resume
}

/**
 * Claude session ended (server -> client)
 */
export interface ClaudeSessionEndedMessage extends BaseMessage {
  type: MessageType.CLAUDE_SESSION_ENDED;
  sessionId: string;
  result: string;
  totalCost: number;
  isError: boolean;
}

/**
 * Claude session list (server -> client)
 */
export interface ClaudeSessionListMessage extends BaseMessage {
  type: MessageType.CLAUDE_SESSION_LIST;
  sessions: Array<{
    id: string;
    name: string;
    claudeSessionId?: string;
    state: string;
    createdAt: number;
    lastActivity: number;
    messageCount: number;
    totalCost?: number;
    connectedClients: number;
  }>;
}

/**
 * Claude session created (server -> client)
 */
export interface ClaudeSessionCreatedMessage extends BaseMessage {
  type: MessageType.CLAUDE_SESSION_CREATED;
  sessionId: string;
  name: string;
}

/**
 * Claude message history (server -> client)
 */
export interface ClaudeHistoryMessage extends BaseMessage {
  type: MessageType.CLAUDE_HISTORY;
  sessionId: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: number;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolResult?: string;
    isThinking?: boolean;
    isError?: boolean;
  }>;
}

/**
 * Claude raw output for debugging (server -> client)
 */
export interface ClaudeRawOutputMessage extends BaseMessage {
  type: MessageType.CLAUDE_RAW_OUTPUT;
  sessionId: string;
  line: string;
}

/**
 * Claude-specific error (server -> client)
 */
export interface ClaudeErrorMessage extends BaseMessage {
  type: MessageType.CLAUDE_ERROR;
  sessionId: string;
  error: string;
}

// ============================================================================
// VNC Message Types
// ============================================================================

/**
 * VNC mouse event types
 */
export type VNCMouseEventType = 'down' | 'up' | 'move';

/**
 * VNC screen dimensions
 */
export interface VNCScreenDimensions {
  width: number;
  height: number;
}

/**
 * VNC mouse event (client -> server)
 */
export interface VNCMouseEventMessage extends BaseMessage {
  type: MessageType.VNC_MOUSE_EVENT;
  x: number;
  y: number;
  eventType: VNCMouseEventType;
  screenWidth: number;
  screenHeight: number;
}

/**
 * VNC keyboard event (client -> server)
 */
export interface VNCKeyboardEventMessage extends BaseMessage {
  type: MessageType.VNC_KEYBOARD_EVENT;
  key: string;
  modifier?: string | string[];
}

/**
 * VNC quality update (client -> server)
 */
export interface VNCQualityUpdateMessage extends BaseMessage {
  type: MessageType.VNC_QUALITY_UPDATE;
  width?: number;
  jpegQuality?: number;
  fps?: number;
}

/**
 * VNC start streaming (client -> server)
 */
export interface VNCStartMessage extends BaseMessage {
  type: MessageType.VNC_START;
}

/**
 * VNC stop streaming (client -> server)
 */
export interface VNCStopMessage extends BaseMessage {
  type: MessageType.VNC_STOP;
}

/**
 * VNC screen update (server -> client)
 */
export interface VNCScreenUpdateMessage extends BaseMessage {
  type: MessageType.VNC_SCREEN_UPDATE;
  image: string;  // Base64-encoded JPEG
  dimensions: VNCScreenDimensions;
}

/**
 * VNC started confirmation (server -> client)
 */
export interface VNCStartedMessage extends BaseMessage {
  type: MessageType.VNC_STARTED;
  dimensions: VNCScreenDimensions;
}

/**
 * VNC stopped confirmation (server -> client)
 */
export interface VNCStoppedMessage extends BaseMessage {
  type: MessageType.VNC_STOPPED;
}

/**
 * VNC error message (server -> client)
 */
export interface VNCErrorMessage extends BaseMessage {
  type: MessageType.VNC_ERROR;
  error: string;
}

// ============================================================================
// GitHub Copilot Message Types
// ============================================================================

/**
 * Copilot send prompt message (client -> server)
 */
export interface CopilotSendPromptMessage extends BaseMessage {
  type: MessageType.COPILOT_SEND_PROMPT;
  sessionId: string;
  prompt: string;
}

/**
 * Copilot create session message (client -> server)
 */
export interface CopilotCreateSessionMessage extends BaseMessage {
  type: MessageType.COPILOT_CREATE_SESSION;
  name?: string;
  workingDirectory?: string;
  model?: string;
  systemPrompt?: string;
  githubToken?: string;
}

/**
 * Copilot message (server -> client)
 */
export interface CopilotMessagePayload extends BaseMessage {
  type: MessageType.COPILOT_MESSAGE;
  sessionId: string;
  message: {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolResult?: string;
    isCode?: boolean;
    language?: string;
    isError?: boolean;
  };
}

/**
 * Copilot thinking status (server -> client)
 */
export interface CopilotThinkingMessage extends BaseMessage {
  type: MessageType.COPILOT_THINKING;
  sessionId: string;
  isThinking: boolean;
  content?: string;
}

/**
 * Copilot tool use (server -> client)
 */
export interface CopilotToolUseMessage extends BaseMessage {
  type: MessageType.COPILOT_TOOL_USE;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

/**
 * Copilot tool result (server -> client)
 */
export interface CopilotToolResultMessage extends BaseMessage {
  type: MessageType.COPILOT_TOOL_RESULT;
  sessionId: string;
  toolName: string;
  result: string;
  isError: boolean;
}

/**
 * Copilot session started (server -> client)
 */
export interface CopilotSessionStartedMessage extends BaseMessage {
  type: MessageType.COPILOT_SESSION_STARTED;
  sessionId: string;
  copilotSessionId: string;
}

/**
 * Copilot session ended (server -> client)
 */
export interface CopilotSessionEndedMessage extends BaseMessage {
  type: MessageType.COPILOT_SESSION_ENDED;
  sessionId: string;
  result: string;
  totalTokens: number;
  isError: boolean;
}

/**
 * Copilot session list (server -> client)
 */
export interface CopilotSessionListMessage extends BaseMessage {
  type: MessageType.COPILOT_SESSION_LIST;
  sessions: Array<{
    id: string;
    name: string;
    copilotSessionId?: string;
    state: string;
    createdAt: number;
    lastActivity: number;
    messageCount: number;
    totalTokens?: number;
    connectedClients: number;
  }>;
}

/**
 * Copilot session created (server -> client)
 */
export interface CopilotSessionCreatedMessage extends BaseMessage {
  type: MessageType.COPILOT_SESSION_CREATED;
  sessionId: string;
  name: string;
}

/**
 * Copilot message history (server -> client)
 */
export interface CopilotHistoryMessage extends BaseMessage {
  type: MessageType.COPILOT_HISTORY;
  sessionId: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: number;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolResult?: string;
    isCode?: boolean;
    language?: string;
    isError?: boolean;
  }>;
}

/**
 * Copilot raw output for debugging (server -> client)
 */
export interface CopilotRawOutputMessage extends BaseMessage {
  type: MessageType.COPILOT_RAW_OUTPUT;
  sessionId: string;
  line: string;
}

/**
 * Copilot-specific error (server -> client)
 */
export interface CopilotErrorMessage extends BaseMessage {
  type: MessageType.COPILOT_ERROR;
  sessionId: string;
  error: string;
}

// ============================================================================
// OpenAI Codex Message Types
// ============================================================================

/**
 * Codex send prompt message (client -> server)
 */
export interface CodexSendPromptMessage extends BaseMessage {
  type: MessageType.CODEX_SEND_PROMPT;
  sessionId: string;
  prompt: string;
}

/**
 * Codex create session message (client -> server)
 */
export interface CodexCreateSessionMessage extends BaseMessage {
  type: MessageType.CODEX_CREATE_SESSION;
  name?: string;
  workingDirectory?: string;
  model?: string;
  skipGitRepoCheck?: boolean;
  resumeSessionId?: string;  // Codex thread_id to resume
}

/**
 * Codex message (server -> client)
 */
export interface CodexMessagePayload extends BaseMessage {
  type: MessageType.CODEX_MESSAGE;
  sessionId: string;
  message: {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolResult?: string;
    isError?: boolean;
  };
}

/**
 * Codex tool use (server -> client)
 */
export interface CodexToolUseMessage extends BaseMessage {
  type: MessageType.CODEX_TOOL_USE;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

/**
 * Codex tool result (server -> client)
 */
export interface CodexToolResultMessage extends BaseMessage {
  type: MessageType.CODEX_TOOL_RESULT;
  sessionId: string;
  toolName: string;
  result: string;
  isError: boolean;
}

/**
 * Codex session started (server -> client)
 */
export interface CodexSessionStartedMessage extends BaseMessage {
  type: MessageType.CODEX_SESSION_STARTED;
  sessionId: string;
  codexThreadId: string;  // Codex's internal thread_id for resume
}

/**
 * Codex session ended (server -> client)
 */
export interface CodexSessionEndedMessage extends BaseMessage {
  type: MessageType.CODEX_SESSION_ENDED;
  sessionId: string;
  result: string;
  isError: boolean;
}

/**
 * Codex session list (server -> client)
 */
export interface CodexSessionListMessage extends BaseMessage {
  type: MessageType.CODEX_SESSION_LIST;
  sessions: Array<{
    id: string;
    name: string;
    codexThreadId?: string;
    state: string;
    createdAt: number;
    lastActivity: number;
    messageCount: number;
    connectedClients: number;
  }>;
}

/**
 * Codex session created (server -> client)
 */
export interface CodexSessionCreatedMessage extends BaseMessage {
  type: MessageType.CODEX_SESSION_CREATED;
  sessionId: string;
  name: string;
}

/**
 * Codex message history (server -> client)
 */
export interface CodexHistoryMessage extends BaseMessage {
  type: MessageType.CODEX_HISTORY;
  sessionId: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: number;
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolResult?: string;
    isError?: boolean;
  }>;
}

/**
 * Codex raw output for debugging (server -> client)
 */
export interface CodexRawOutputMessage extends BaseMessage {
  type: MessageType.CODEX_RAW_OUTPUT;
  sessionId: string;
  line: string;
}

/**
 * Codex-specific error (server -> client)
 */
export interface CodexErrorMessage extends BaseMessage {
  type: MessageType.CODEX_ERROR;
  sessionId: string;
  error: string;
}
