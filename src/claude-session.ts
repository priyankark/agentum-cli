/**
 * Claude Code Headless Session Manager
 * Uses `claude -p --output-format stream-json` for structured communication
 */

import { spawn, ChildProcess } from 'child_process';
import { randomUUID as uuidv4 } from 'crypto';
import * as readline from 'readline';

// Claude streaming JSON message types
export interface ClaudeStreamMessage {
  type: 'system' | 'assistant' | 'user' | 'result';
  subtype?: 'init' | 'tool_use' | 'tool_result' | 'text' | 'thinking';
  session_id?: string;
  message?: {
    role?: string;
    content?: string | ClaudeContentBlock[];
    model?: string;
  };
  result?: string;
  cost_usd?: number;
  is_error?: boolean;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
}

export interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface ClaudeSessionConfig {
  id?: string;
  name?: string;
  workingDirectory?: string;
  allowedTools?: string[];
  model?: string;
  systemPrompt?: string;
  resumeSessionId?: string;
}

export interface ClaudeSession {
  id: string;
  name: string;
  claudeSessionId?: string; // Claude's internal session ID
  state: 'idle' | 'running' | 'completed' | 'error';
  createdAt: number;
  lastActivity: number;
  workingDirectory: string;
  messageHistory: ClaudeMessage[];
  process?: ChildProcess;
  connectedClients: Set<string>;
  config: ClaudeSessionConfig;
  totalCost?: number;
  pendingInput?: {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  };
}

export interface ClaudeMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  isThinking?: boolean;
  isError?: boolean;
}

export interface ClaudeEventHandlers {
  onMessage: (sessionId: string, message: ClaudeMessage) => void;
  onThinking: (sessionId: string, isThinking: boolean, content?: string) => void;
  onToolUse: (sessionId: string, toolName: string, toolInput: Record<string, unknown>, toolUseId?: string) => void;
  onToolResult: (sessionId: string, toolUseId: string, result: string, isError: boolean) => void;
  onSessionStart: (sessionId: string, claudeSessionId: string) => void;
  onSessionEnd: (sessionId: string, result: string, cost: number, isError: boolean) => void;
  onError: (sessionId: string, error: Error) => void;
  onRawOutput: (sessionId: string, line: string) => void;
}

const DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'LS',
  'Task',
  'WebFetch',
  'WebSearch'
];

export class ClaudeSessionManager {
  private sessions: Map<string, ClaudeSession> = new Map();
  private eventHandlers: ClaudeEventHandlers;
  private claudeBinaryPath: string;

  constructor(handlers: ClaudeEventHandlers, claudeBinaryPath?: string) {
    this.eventHandlers = handlers;
    // Default to 'claude' in PATH, can be overridden
    this.claudeBinaryPath = claudeBinaryPath || 'claude';
  }

  /**
   * Create a new Claude session
   */
  createSession(config: ClaudeSessionConfig): ClaudeSession {
    const sessionId = config.id || uuidv4();

    const session: ClaudeSession = {
      id: sessionId,
      name: config.name || `Claude Session ${sessionId.slice(0, 8)}`,
      state: 'idle',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      workingDirectory: config.workingDirectory || process.cwd(),
      messageHistory: [],
      connectedClients: new Set(),
      config: {
        ...config,
        allowedTools: config.allowedTools || DEFAULT_ALLOWED_TOOLS,
      },
    };

    this.sessions.set(sessionId, session);
    console.log(`[CLAUDE] Created session ${sessionId}: ${session.name}`);

    return session;
  }

  /**
   * Send a prompt to Claude and stream the response
   */
  async sendPrompt(sessionId: string, prompt: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.state === 'running') {
      throw new Error('Session is already processing a prompt');
    }

    session.state = 'running';
    session.lastActivity = Date.now();

    // Add user message to history
    const userMessage: ClaudeMessage = {
      id: uuidv4(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };
    session.messageHistory.push(userMessage);
    this.eventHandlers.onMessage(sessionId, userMessage);

    // Build claude command arguments
    const args = this.buildClaudeArgs(session, prompt);

    console.log(`[CLAUDE] Running: ${this.claudeBinaryPath} ${args.join(' ')}`);

    try {
      await this.executeClaudeCommand(session, args);
    } catch (error) {
      session.state = 'error';
      this.eventHandlers.onError(sessionId, error as Error);
    }
  }

  /**
   * Build command line arguments for claude
   */
  private buildClaudeArgs(session: ClaudeSession, prompt: string): string[] {
    const args: string[] = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',  // Required for stream-json
    ];

    if (process.env.AGENTUM_ALLOW_UNSANDBOXED === '1') args.push('--dangerously-skip-permissions');

    // Resume existing Claude session if available
    if (session.claudeSessionId) {
      args.push('--resume', session.claudeSessionId);
    } else if (session.config.resumeSessionId) {
      args.push('--resume', session.config.resumeSessionId);
    }

    // Add model if specified
    if (session.config.model) {
      args.push('--model', session.config.model);
    }

    // Add system prompt if specified
    if (session.config.systemPrompt) {
      args.push('--append-system-prompt', session.config.systemPrompt);
    }

    return args;
  }

  /**
   * Execute claude command and stream output
   */
  private executeClaudeCommand(session: ClaudeSession, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[CLAUDE] Spawning: ${this.claudeBinaryPath}`);

      const proc = spawn(this.claudeBinaryPath, args, {
        cwd: session.workingDirectory,
        env: process.env,  // Inherit full environment including PATH
        stdio: ['ignore', 'pipe', 'pipe'],  // Ignore stdin to prevent blocking
        detached: true,  // Detach to prevent inheriting parent's IO
      });

      session.process = proc;

      // Create readline interface for line-by-line JSON parsing
      const rl = readline.createInterface({
        input: proc.stdout!,
        crlfDelay: Infinity,
      });

      let currentAssistantMessage = '';
      let currentThinking = '';

      rl.on('line', (line) => {
        if (!line.trim()) return;

        // Send raw output for debugging
        this.eventHandlers.onRawOutput(session.id, line);

        try {
          const message = JSON.parse(line) as ClaudeStreamMessage;
          this.processStreamMessage(session, message, {
            currentAssistantMessage,
            currentThinking,
            updateAssistantMessage: (msg) => { currentAssistantMessage = msg; },
            updateThinking: (t) => { currentThinking = t; },
          });
        } catch (e) {
          // Not JSON, might be raw output - log it
        }
      });

      // Handle stderr
      proc.stderr?.on('data', (data) => {
        const errorText = data.toString();
        console.error(`[CLAUDE] stderr: ${errorText}`);

        // Check for permission prompts (when tools aren't pre-approved)
        if (errorText.includes('Allow') || errorText.includes('permission')) {
          // This would be a tool permission request
          // In headless mode with --allowedTools, this shouldn't happen
          console.log('[CLAUDE] Permission request detected (should be auto-approved)');
        }
      });

      proc.on('close', (code) => {
        session.process = undefined;

        if (code === 0) {
          session.state = 'idle';
          resolve();
        } else {
          session.state = 'error';
          reject(new Error(`Claude process exited with code ${code}`));
        }
      });

      proc.on('error', (error) => {
        console.error(`[CLAUDE] Process error:`, error);
        session.process = undefined;
        session.state = 'error';
        reject(error);
      });

      // Log process start
      if (proc.pid) {
        console.log(`[CLAUDE] Process started with PID: ${proc.pid}`);
      } else {
        console.error(`[CLAUDE] Failed to get process PID`);
      }
    });
  }

  /**
   * Process a streaming JSON message from Claude
   */
  private processStreamMessage(
    session: ClaudeSession,
    message: ClaudeStreamMessage,
    state: {
      currentAssistantMessage: string;
      currentThinking: string;
      updateAssistantMessage: (msg: string) => void;
      updateThinking: (t: string) => void;
    }
  ): void {
    const { type, subtype } = message;

    switch (type) {
      case 'system':
        if (subtype === 'init' && message.session_id) {
          // Capture Claude's session ID for future --resume
          session.claudeSessionId = message.session_id;
          this.eventHandlers.onSessionStart(session.id, message.session_id);
          console.log(`[CLAUDE] Session started: ${message.session_id}`);
        }
        break;

      case 'assistant':
        if (message.message?.content) {
          const content = message.message.content;

          if (typeof content === 'string') {
            // Simple text response
            state.updateAssistantMessage(state.currentAssistantMessage + content);
            this.emitAssistantMessage(session, content);
          } else if (Array.isArray(content)) {
            // Content blocks (text, tool_use, thinking, etc.)
            for (const block of content) {
              this.processContentBlock(session, block, state);
            }
          }
        }
        break;

      case 'result':
        // Final result
        const resultMessage: ClaudeMessage = {
          id: uuidv4(),
          role: 'assistant',
          content: message.result || state.currentAssistantMessage,
          timestamp: Date.now(),
        };

        session.messageHistory.push(resultMessage);
        session.totalCost = message.total_cost_usd;
        session.lastActivity = Date.now();

        this.eventHandlers.onSessionEnd(
          session.id,
          message.result || '',
          message.total_cost_usd || 0,
          message.is_error || false
        );

        // Reset state
        state.updateAssistantMessage('');
        state.updateThinking('');
        break;
    }
  }

  /**
   * Process a content block from Claude's response
   */
  private processContentBlock(
    session: ClaudeSession,
    block: ClaudeContentBlock,
    state: {
      currentAssistantMessage: string;
      currentThinking: string;
      updateAssistantMessage: (msg: string) => void;
      updateThinking: (t: string) => void;
    }
  ): void {
    switch (block.type) {
      case 'text':
        if (block.text) {
          state.updateAssistantMessage(state.currentAssistantMessage + block.text);
          this.emitAssistantMessage(session, block.text);
        }
        break;

      case 'thinking':
        if (block.thinking) {
          state.updateThinking(block.thinking);
          this.eventHandlers.onThinking(session.id, true, block.thinking);
        }
        break;

      case 'tool_use':
        if (block.name && block.input) {
          this.eventHandlers.onToolUse(session.id, block.name, block.input, block.id);

          const toolMessage: ClaudeMessage = {
            id: block.id || uuidv4(),
            role: 'tool',
            content: `Using tool: ${block.name}`,
            timestamp: Date.now(),
            toolName: block.name,
            toolInput: block.input,
          };
          session.messageHistory.push(toolMessage);
          this.eventHandlers.onMessage(session.id, toolMessage);
        }
        break;

      case 'tool_result':
        if (block.tool_use_id) {
          const result = typeof block.content === 'string'
            ? block.content
            : JSON.stringify(block.content);

          this.eventHandlers.onToolResult(
            session.id,
            block.tool_use_id,
            result,
            block.is_error || false
          );

          const resultMessage: ClaudeMessage = {
            id: uuidv4(),
            role: 'tool',
            content: result,
            timestamp: Date.now(),
            toolResult: result,
            isError: block.is_error,
          };
          session.messageHistory.push(resultMessage);
          this.eventHandlers.onMessage(session.id, resultMessage);
        }
        break;
    }
  }

  /**
   * Emit assistant message to handlers
   */
  private emitAssistantMessage(session: ClaudeSession, content: string): void {
    const message: ClaudeMessage = {
      id: uuidv4(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
    };
    this.eventHandlers.onMessage(session.id, message);
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): ClaudeSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions
   */
  getAllSessions(): ClaudeSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session info for serialization
   */
  getSessionInfoList(): Array<{
    id: string;
    name: string;
    claudeSessionId?: string;
    state: string;
    createdAt: number;
    lastActivity: number;
    messageCount: number;
    totalCost?: number;
    connectedClients: number;
  }> {
    return this.getAllSessions().map((session) => ({
      id: session.id,
      name: session.name,
      claudeSessionId: session.claudeSessionId,
      state: session.state,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      messageCount: session.messageHistory.length,
      totalCost: session.totalCost,
      connectedClients: session.connectedClients.size,
    }));
  }

  /**
   * Add a client to a session
   */
  addClientToSession(sessionId: string, clientId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.connectedClients.add(clientId);
    return true;
  }

  /**
   * Remove a client from a session
   */
  removeClientFromSession(sessionId: string, clientId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return session.connectedClients.delete(clientId);
  }

  /**
   * Remove a client from all sessions
   */
  removeClientFromAllSessions(clientId: string): void {
    for (const session of this.sessions.values()) {
      session.connectedClients.delete(clientId);
    }
  }

  /**
   * Kill a session
   */
  killSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.process) {
      session.process.kill('SIGTERM');
      session.process = undefined;
    }

    session.state = 'completed';
    return true;
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.killSession(sessionId);
    return this.sessions.delete(sessionId);
  }

  /**
   * Get message history for a session
   */
  getMessageHistory(sessionId: string): ClaudeMessage[] {
    const session = this.sessions.get(sessionId);
    return session ? [...session.messageHistory] : [];
  }

  /**
   * Shutdown all sessions
   */
  shutdown(): void {
    for (const sessionId of this.sessions.keys()) {
      this.killSession(sessionId);
    }
    this.sessions.clear();
  }
}
