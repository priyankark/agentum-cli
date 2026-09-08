/**
 * OpenAI Codex CLI Session Manager
 * Uses `codex exec "prompt" --json` for structured communication
 *
 * Codex CLI JSONL output format (--json flag):
 * Line 1: {"reasoning summaries":"auto","model":"gpt-5","provider":"openai",...}
 * Line 2: {"prompt":"..."}
 * Line 3+: {"id":"0","msg":{"type":"task_started"|"agent_message"|"token_count"|...}}
 *
 * Message types:
 * - task_started: Task started with model_context_window
 * - agent_message: Agent response with "message" field
 * - function_call: Tool call with function details
 * - function_call_output: Tool result
 * - token_count: Token usage stats
 * - error: Error event
 */

import { spawn, ChildProcess } from 'child_process';
import { randomUUID as uuidv4 } from 'crypto';
import * as readline from 'readline';

// Codex JSON streaming line types (JSONL format with --json flag)
export interface CodexJsonLine {
  // Config line (first line)
  model?: string;
  provider?: string;
  workdir?: string;
  sandbox?: string;
  approval?: string;
  // Prompt line (second line)
  prompt?: string;
  // Event line (id + msg)
  id?: string;
  msg?: CodexMessage_Internal;
}

// Internal message structure from Codex
export interface CodexMessage_Internal {
  type: 'task_started' | 'agent_message' | 'agent_reasoning' | 'agent_reasoning_section_break' | 'function_call' | 'function_call_output' | 'token_count' | 'error' | 'background_event';
  // task_started
  model_context_window?: number;
  // agent_message / agent_reasoning
  message?: string;
  text?: string;  // Used by agent_reasoning
  // function_call
  name?: string;
  call_id?: string;
  arguments?: string;
  // function_call_output
  output?: string;
  // token_count
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  // error
  error?: string;
  // Other fields
  [key: string]: unknown;
}

export interface CodexSessionConfig {
  id?: string;
  name?: string;
  workingDirectory?: string;
  model?: string;
  skipGitRepoCheck?: boolean;
  resumeSessionId?: string;  // Codex thread_id to resume
}

export interface CodexSession {
  id: string;
  name: string;
  codexThreadId?: string;  // Codex's internal thread ID for resume
  state: 'idle' | 'running' | 'completed' | 'error';
  createdAt: number;
  lastActivity: number;
  workingDirectory: string;
  messageHistory: CodexMessage[];
  process?: ChildProcess;
  connectedClients: Set<string>;
  config: CodexSessionConfig;
}

export interface CodexMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  isError?: boolean;
}

export interface CodexEventHandlers {
  onMessage: (sessionId: string, message: CodexMessage) => void;
  onToolUse: (sessionId: string, toolName: string, toolInput: Record<string, unknown>, toolUseId?: string) => void;
  onToolResult: (sessionId: string, toolUseId: string, result: string, isError: boolean) => void;
  onSessionStart: (sessionId: string, codexThreadId: string) => void;
  onSessionEnd: (sessionId: string, result: string, isError: boolean) => void;
  onError: (sessionId: string, error: Error) => void;
  onRawOutput: (sessionId: string, line: string) => void;
}

export class CodexSessionManager {
  private sessions: Map<string, CodexSession> = new Map();
  private eventHandlers: CodexEventHandlers;
  private codexBinaryPath: string;

  constructor(handlers: CodexEventHandlers, codexBinaryPath?: string) {
    this.eventHandlers = handlers;
    // Default to 'codex' in PATH
    this.codexBinaryPath = codexBinaryPath || 'codex';
  }

  /**
   * Create a new Codex session
   */
  createSession(config: CodexSessionConfig): CodexSession {
    const sessionId = config.id || uuidv4();

    const session: CodexSession = {
      id: sessionId,
      name: config.name || `Codex Session ${sessionId.slice(0, 8)}`,
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
    console.log(`[CODEX] Created session ${sessionId}: ${session.name}`);

    return session;
  }

  /**
   * Send a prompt to Codex and stream the response
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
    const userMessage: CodexMessage = {
      id: uuidv4(),
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    };
    session.messageHistory.push(userMessage);
    this.eventHandlers.onMessage(sessionId, userMessage);

    // Build codex command arguments
    const args = this.buildCodexArgs(session, prompt);

    console.log(`[CODEX] Running: ${this.codexBinaryPath} ${args.join(' ')}`);

    try {
      await this.executeCodexCommand(session, args);
    } catch (error) {
      session.state = 'error';
      this.eventHandlers.onError(sessionId, error as Error);
    }
  }

  /**
   * Build command line arguments for codex
   */
  private buildCodexArgs(session: CodexSession, prompt: string): string[] {
    const args: string[] = ['exec'];

    // Build the full prompt with conversation history for multi-turn support
    // Since codex exec doesn't support native multi-turn, we include history as context
    const fullPrompt = this.buildPromptWithHistory(session, prompt);

    // Add the prompt
    args.push(fullPrompt);

    // JSON output for structured streaming
    args.push('--json');

    // Skip permissions/sandbox for headless mode
    if (process.env.AGENTUM_ALLOW_UNSANDBOXED === '1') args.push('--dangerously-bypass-approvals-and-sandbox');
    else args.push('--sandbox', 'workspace-write');

    // Skip git repo check if configured
    if (session.config.skipGitRepoCheck) {
      args.push('--skip-git-repo-check');
    }

    // Add model if specified
    if (session.config.model) {
      args.push('--model', session.config.model);
    }

    return args;
  }

  /**
   * Build a prompt that includes conversation history for multi-turn context
   */
  private buildPromptWithHistory(session: CodexSession, newPrompt: string): string {
    // Get relevant history (user messages and assistant responses, skip tool details)
    // Exclude the last message since it's the current prompt we're about to send
    const allHistory = session.messageHistory.filter(
      msg => (msg.role === 'user' || msg.role === 'assistant') && msg.content
    );

    // Exclude the current user message (last one) since we'll append it separately
    const history = allHistory.slice(0, -1);

    // If no prior history, just return the prompt
    if (history.length === 0) {
      return newPrompt;
    }

    // Build conversation context (limit to last 20 messages to avoid token limits)
    const recentHistory = history.slice(-20);
    const contextParts: string[] = ['<conversation_history>'];

    for (const msg of recentHistory) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      // Truncate long messages in history
      const content = msg.content.length > 2000
        ? msg.content.slice(0, 2000) + '...[truncated]'
        : msg.content;
      contextParts.push(`${role}: ${content}`);
    }

    contextParts.push('</conversation_history>');
    contextParts.push('');
    contextParts.push('Continue the conversation. User\'s new message:');
    contextParts.push(newPrompt);

    return contextParts.join('\n');
  }

  /**
   * Execute codex command and stream output
   */
  private executeCodexCommand(session: CodexSession, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[CODEX] Spawning: ${this.codexBinaryPath}`);

      const proc = spawn(this.codexBinaryPath, args, {
        cwd: session.workingDirectory,
        env: process.env,  // Inherit full environment including PATH and OPENAI_API_KEY
        stdio: ['ignore', 'pipe', 'pipe'],  // Ignore stdin to prevent blocking
        detached: true,  // Detach to prevent inheriting parent's IO
      });

      session.process = proc;

      // Create readline interface for line-by-line JSONL parsing
      const rl = readline.createInterface({
        input: proc.stdout!,
        crlfDelay: Infinity,
      });

      let currentAssistantMessage = '';

      rl.on('line', (line) => {
        if (!line.trim()) return;

        // Send raw output for debugging
        this.eventHandlers.onRawOutput(session.id, line);

        try {
          const jsonLine = JSON.parse(line) as CodexJsonLine;
          this.processJsonLine(session, jsonLine, {
            currentAssistantMessage,
            updateAssistantMessage: (msg) => { currentAssistantMessage = msg; },
          });
        } catch (e) {
          // Not JSON, might be raw output - log it
        }
      });

      // Handle stderr
      proc.stderr?.on('data', (data) => {
        const errorText = data.toString();
        console.error(`[CODEX] stderr: ${errorText}`);
      });

      proc.on('close', (code) => {
        session.process = undefined;

        if (code === 0) {
          session.state = 'idle';
          this.eventHandlers.onSessionEnd(session.id, currentAssistantMessage, false);
          resolve();
        } else {
          session.state = 'error';
          const error = new Error(`Codex process exited with code ${code}`);
          this.eventHandlers.onSessionEnd(session.id, error.message, true);
          reject(error);
        }
      });

      proc.on('error', (error) => {
        console.error(`[CODEX] Process error:`, error);
        session.process = undefined;
        session.state = 'error';
        reject(error);
      });

      // Log process start
      if (proc.pid) {
        console.log(`[CODEX] Process started with PID: ${proc.pid}`);
      } else {
        console.error(`[CODEX] Failed to get process PID`);
      }
    });
  }

  /**
   * Process a JSONL line from Codex output
   * Handles config lines, prompt lines, and event lines
   */
  private processJsonLine(
    session: CodexSession,
    jsonLine: CodexJsonLine,
    state: {
      currentAssistantMessage: string;
      updateAssistantMessage: (msg: string) => void;
    }
  ): void {
    // Config line (first line) - contains model, provider, etc.
    if (jsonLine.model && jsonLine.provider) {
      console.log(`[CODEX] Config: model=${jsonLine.model}, provider=${jsonLine.provider}, workdir=${jsonLine.workdir}`);
      // Emit session start (Codex exec doesn't provide resumable thread IDs)
      this.eventHandlers.onSessionStart(session.id, session.id);
      return;
    }

    // Prompt line (second line)
    if (jsonLine.prompt !== undefined) {
      return;
    }

    // Event line (has id and msg)
    if (jsonLine.id !== undefined && jsonLine.msg) {
      this.processMessage(session, jsonLine.msg, state);
      return;
    }

    // Unknown line format
  }

  /**
   * Process an event message from Codex
   */
  private processMessage(
    session: CodexSession,
    msg: CodexMessage_Internal,
    state: {
      currentAssistantMessage: string;
      updateAssistantMessage: (msg: string) => void;
    }
  ): void {
    switch (msg.type) {
      case 'task_started':
        console.log(`[CODEX] Task started, context window: ${msg.model_context_window}`);
        break;

      case 'agent_message':
        // This is the main assistant response
        if (msg.message) {
          state.updateAssistantMessage(state.currentAssistantMessage + msg.message);

          const assistantMessage: CodexMessage = {
            id: uuidv4(),
            role: 'assistant',
            content: msg.message,
            timestamp: Date.now(),
          };
          session.messageHistory.push(assistantMessage);
          this.eventHandlers.onMessage(session.id, assistantMessage);
        }
        break;

      case 'function_call':
        // Tool/function call
        if (msg.name) {
          let args: Record<string, unknown> = {};
          try {
            if (msg.arguments) {
              args = JSON.parse(msg.arguments);
            }
          } catch (e) {
            args = { raw: msg.arguments };
          }

          this.eventHandlers.onToolUse(session.id, msg.name, args, msg.call_id);

          const toolMessage: CodexMessage = {
            id: uuidv4(),
            role: 'tool',
            content: `Calling: ${msg.name}`,
            timestamp: Date.now(),
            toolName: msg.name,
            toolInput: args,
          };
          session.messageHistory.push(toolMessage);
          this.eventHandlers.onMessage(session.id, toolMessage);
        }
        break;

      case 'function_call_output':
        // Tool/function result
        if (msg.output !== undefined) {
          this.eventHandlers.onToolResult(
            session.id,
            msg.call_id || 'unknown',
            msg.output,
            false  // We don't know if it's an error from this message type
          );

          const resultMessage: CodexMessage = {
            id: uuidv4(),
            role: 'tool',
            content: msg.output,
            timestamp: Date.now(),
            toolResult: msg.output,
          };
          session.messageHistory.push(resultMessage);
          this.eventHandlers.onMessage(session.id, resultMessage);
        }
        break;

      case 'token_count':
        console.log(`[CODEX] Tokens: input=${msg.input_tokens}, output=${msg.output_tokens}, total=${msg.total_tokens}`);
        break;

      case 'agent_reasoning':
        // Model's internal reasoning (shown before the final answer)
        if (msg.text) {
        }
        break;

      case 'agent_reasoning_section_break':
        // Section break in reasoning output (can be ignored)
        break;

      case 'background_event':
        // Background event (e.g., file watch, etc.)
        console.log(`[CODEX] Background event:`, msg);
        break;

      case 'error':
        console.error(`[CODEX] Error: ${msg.error}`);
        this.eventHandlers.onError(session.id, new Error(msg.error || 'Unknown error'));
        break;

      default:
        console.log(`[CODEX] Unknown message type: ${msg.type}`, msg);
    }
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): CodexSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions
   */
  getAllSessions(): CodexSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session info for serialization
   */
  getSessionInfoList(): Array<{
    id: string;
    name: string;
    codexThreadId?: string;
    state: string;
    createdAt: number;
    lastActivity: number;
    messageCount: number;
    connectedClients: number;
  }> {
    return this.getAllSessions().map((session) => ({
      id: session.id,
      name: session.name,
      codexThreadId: session.codexThreadId,
      state: session.state,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      messageCount: session.messageHistory.length,
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
  getMessageHistory(sessionId: string): CodexMessage[] {
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
