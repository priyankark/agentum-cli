/**
 * GitHub Copilot Session Manager
 * Provides structured communication with GitHub Copilot SDK
 *
 * This module supports two modes:
 * 1. Direct SDK integration via @github/copilot-sdk
 * 2. CLI-based integration via the copilot CLI
 */

import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

// Copilot streaming message types
export interface CopilotStreamMessage {
  type: 'system' | 'assistant' | 'user' | 'result' | 'error';
  subtype?: 'init' | 'tool_use' | 'tool_result' | 'text' | 'thinking' | 'code';
  session_id?: string;
  message?: {
    role?: string;
    content?: string | CopilotContentBlock[];
    model?: string;
  };
  result?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  is_error?: boolean;
  duration_ms?: number;
}

export interface CopilotContentBlock {
  type: 'text' | 'code' | 'tool_use' | 'tool_result';
  text?: string;
  code?: string;
  language?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

export interface CopilotSessionConfig {
  id?: string;
  name?: string;
  workingDirectory?: string;
  model?: string;
  systemPrompt?: string;
  // GitHub authentication token (optional - uses gh auth if not provided)
  githubToken?: string;
}

export interface CopilotSession {
  id: string;
  name: string;
  copilotSessionId?: string;
  state: 'idle' | 'running' | 'completed' | 'error';
  createdAt: number;
  lastActivity: number;
  workingDirectory: string;
  messageHistory: CopilotMessage[];
  process?: ChildProcess;
  connectedClients: Set<string>;
  config: CopilotSessionConfig;
  totalTokens?: number;
}

export interface CopilotMessage {
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
}

export interface CopilotEventHandlers {
  onMessage: (sessionId: string, message: CopilotMessage) => void;
  onThinking: (sessionId: string, isThinking: boolean, content?: string) => void;
  onToolUse: (sessionId: string, toolName: string, toolInput: Record<string, unknown>, toolUseId?: string) => void;
  onToolResult: (sessionId: string, toolUseId: string, result: string, isError: boolean) => void;
  onSessionStart: (sessionId: string, copilotSessionId: string) => void;
  onSessionEnd: (sessionId: string, result: string, tokens: number, isError: boolean) => void;
  onError: (sessionId: string, error: Error) => void;
  onRawOutput: (sessionId: string, line: string) => void;
}

export class CopilotSessionManager {
  private sessions: Map<string, CopilotSession> = new Map();
  private eventHandlers: CopilotEventHandlers;
  private copilotBinaryPath: string;

  constructor(handlers: CopilotEventHandlers, copilotBinaryPath?: string) {
    this.eventHandlers = handlers;
    // Try to find copilot CLI or use gh copilot
    this.copilotBinaryPath = copilotBinaryPath || 'gh';
  }

  /**
   * Create a new Copilot session
   */
  createSession(config: CopilotSessionConfig): CopilotSession {
    const sessionId = config.id || uuidv4();

    const session: CopilotSession = {
      id: sessionId,
      name: config.name || `Copilot Session ${sessionId.slice(0, 8)}`,
      state: 'idle',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      workingDirectory: config.workingDirectory || process.cwd(),
      messageHistory: [],
      connectedClients: new Set(),
      config: {
        ...config,
      },
    };

    this.sessions.set(sessionId, session);
    console.log(`[COPILOT] Created session ${sessionId}: ${session.name}`);

    return session;
  }

  /**
   * Send a prompt to Copilot and stream the response
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
    const userMessage: CopilotMessage = {
      id: uuidv4(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };
    session.messageHistory.push(userMessage);
    this.eventHandlers.onMessage(sessionId, userMessage);

    // Build copilot command arguments
    const args = this.buildCopilotArgs(session, prompt);

    console.log(`[COPILOT] Running: ${this.copilotBinaryPath} ${args.join(' ')}`);

    try {
      await this.executeCopilotCommand(session, args);
    } catch (error) {
      session.state = 'error';
      this.eventHandlers.onError(sessionId, error as Error);
    }
  }

  /**
   * Build command line arguments for copilot
   * Uses the new gh copilot CLI (agentic interface)
   */
  private buildCopilotArgs(_session: CopilotSession, prompt: string): string[] {
    // Using the new gh copilot CLI
    // Format: gh copilot -- -p "prompt" --allow-all-tools
    const args: string[] = [
      'copilot',
      '--',
      '-p', prompt,
      '--allow-all-tools',
    ];

    return args;
  }

  /**
   * Execute copilot command and stream output
   */
  private executeCopilotCommand(session: CopilotSession, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[COPILOT] Spawning: ${this.copilotBinaryPath}`);
      console.log(`[COPILOT] Args: ${JSON.stringify(args)}`);

      // Set up environment with GitHub token if available
      const env = { ...process.env };
      if (session.config.githubToken) {
        env.GITHUB_TOKEN = session.config.githubToken;
      }

      const proc = spawn(this.copilotBinaryPath, args, {
        cwd: session.workingDirectory,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      session.process = proc;

      let outputBuffer = '';
      let isThinking = false;

      // Generate a session ID for this interaction
      const copilotSessionId = uuidv4();
      session.copilotSessionId = copilotSessionId;
      this.eventHandlers.onSessionStart(session.id, copilotSessionId);

      // Handle stdout
      proc.stdout?.on('data', (data) => {
        const text = data.toString();
        outputBuffer += text;

        // Send raw output for debugging
        this.eventHandlers.onRawOutput(session.id, text);

        // Check if we're in thinking/processing mode
        if (!isThinking && text.includes('Thinking') || text.includes('...')) {
          isThinking = true;
          this.eventHandlers.onThinking(session.id, true, 'Processing...');
        }

        // Process line by line for structured output
        const lines = outputBuffer.split('\n');
        outputBuffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            this.processOutputLine(session, line);
          }
        }
      });

      // Handle stderr
      proc.stderr?.on('data', (data) => {
        const errorText = data.toString();
        console.error(`[COPILOT] stderr: ${errorText}`);

        // Some informational output goes to stderr
        if (errorText.includes('Suggestion') || errorText.includes('Thinking')) {
          this.eventHandlers.onRawOutput(session.id, errorText);
        }
      });

      proc.on('close', (code) => {
        session.process = undefined;

        // Process any remaining buffer
        if (outputBuffer.trim()) {
          this.processOutputLine(session, outputBuffer);
        }

        // End thinking state
        if (isThinking) {
          this.eventHandlers.onThinking(session.id, false);
        }

        if (code === 0) {
          session.state = 'idle';
          this.eventHandlers.onSessionEnd(
            session.id,
            'Completed',
            session.totalTokens || 0,
            false
          );
          resolve();
        } else {
          session.state = 'error';
          const error = new Error(`Copilot process exited with code ${code}`);
          this.eventHandlers.onSessionEnd(
            session.id,
            error.message,
            session.totalTokens || 0,
            true
          );
          reject(error);
        }
      });

      proc.on('error', (error) => {
        console.error(`[COPILOT] Process error:`, error);
        session.process = undefined;
        session.state = 'error';
        reject(error);
      });

      // Log process start
      if (proc.pid) {
        console.log(`[COPILOT] Process started with PID: ${proc.pid}`);
      } else {
        console.error(`[COPILOT] Failed to get process PID`);
      }
    });
  }

  /**
   * Process a line of output from Copilot
   */
  private processOutputLine(session: CopilotSession, line: string): void {
    // Try to parse as JSON first (for structured SDK output)
    try {
      const parsed = JSON.parse(line);
      this.processStructuredMessage(session, parsed);
      return;
    } catch {
      // Not JSON, process as plain text
    }

    // Handle plain text output (from gh copilot CLI)
    const trimmed = line.trim();
    if (!trimmed) return;

    // Detect code blocks
    const codeBlockMatch = trimmed.match(/^```(\w+)?$/);
    if (codeBlockMatch) {
      // Toggle code block mode
      return;
    }

    // Check for suggestion output
    if (trimmed.startsWith('Suggestion:') || trimmed.includes('?')) {
      // This is a suggestion or question from copilot
      const message: CopilotMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: trimmed,
        timestamp: Date.now(),
      };
      session.messageHistory.push(message);
      this.eventHandlers.onMessage(session.id, message);
      return;
    }

    // Check for code suggestions
    if (trimmed.startsWith('$') || trimmed.startsWith('git ') || trimmed.startsWith('gh ')) {
      const message: CopilotMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: trimmed,
        timestamp: Date.now(),
        isCode: true,
        language: 'shell',
      };
      session.messageHistory.push(message);
      this.eventHandlers.onMessage(session.id, message);
      return;
    }

    // Default: treat as assistant text message
    const message: CopilotMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: trimmed,
      timestamp: Date.now(),
    };
    session.messageHistory.push(message);
    this.eventHandlers.onMessage(session.id, message);
  }

  /**
   * Process structured JSON message from Copilot SDK
   */
  private processStructuredMessage(session: CopilotSession, message: CopilotStreamMessage): void {
    const { type, subtype } = message;

    switch (type) {
      case 'system':
        if (subtype === 'init' && message.session_id) {
          session.copilotSessionId = message.session_id;
          this.eventHandlers.onSessionStart(session.id, message.session_id);
        }
        break;

      case 'assistant':
        if (message.message?.content) {
          const content = message.message.content;

          if (typeof content === 'string') {
            this.emitAssistantMessage(session, content);
          } else if (Array.isArray(content)) {
            for (const block of content) {
              this.processContentBlock(session, block);
            }
          }
        }
        break;

      case 'result':
        const resultMessage: CopilotMessage = {
          id: uuidv4(),
          role: 'assistant',
          content: message.result || '',
          timestamp: Date.now(),
        };

        session.messageHistory.push(resultMessage);
        if (message.usage?.total_tokens) {
          session.totalTokens = message.usage.total_tokens;
        }
        session.lastActivity = Date.now();

        this.eventHandlers.onSessionEnd(
          session.id,
          message.result || '',
          message.usage?.total_tokens || 0,
          message.is_error || false
        );
        break;

      case 'error':
        this.eventHandlers.onError(
          session.id,
          new Error(message.result || 'Unknown Copilot error')
        );
        break;
    }
  }

  /**
   * Process a content block from Copilot's response
   */
  private processContentBlock(session: CopilotSession, block: CopilotContentBlock): void {
    switch (block.type) {
      case 'text':
        if (block.text) {
          this.emitAssistantMessage(session, block.text);
        }
        break;

      case 'code':
        if (block.code) {
          const message: CopilotMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: block.code,
            timestamp: Date.now(),
            isCode: true,
            language: block.language,
          };
          session.messageHistory.push(message);
          this.eventHandlers.onMessage(session.id, message);
        }
        break;

      case 'tool_use':
        if (block.name && block.input) {
          this.eventHandlers.onToolUse(session.id, block.name, block.input, block.id);

          const toolMessage: CopilotMessage = {
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

          const resultMessage: CopilotMessage = {
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
  private emitAssistantMessage(session: CopilotSession, content: string): void {
    const message: CopilotMessage = {
      id: uuidv4(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
    };
    session.messageHistory.push(message);
    this.eventHandlers.onMessage(session.id, message);
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): CopilotSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions
   */
  getAllSessions(): CopilotSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session info for serialization
   */
  getSessionInfoList(): Array<{
    id: string;
    name: string;
    copilotSessionId?: string;
    state: string;
    createdAt: number;
    lastActivity: number;
    messageCount: number;
    totalTokens?: number;
    connectedClients: number;
  }> {
    return this.getAllSessions().map((session) => ({
      id: session.id,
      name: session.name,
      copilotSessionId: session.copilotSessionId,
      state: session.state,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      messageCount: session.messageHistory.length,
      totalTokens: session.totalTokens,
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
  getMessageHistory(sessionId: string): CopilotMessage[] {
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
