/**
 * Session management for AirCodum-Agentum
 * Handles multiple PTY sessions with full terminal emulation
 */

import * as pty from 'node-pty';
import { randomUUID as uuidv4 } from 'crypto';
import { accessSync, constants, statSync } from 'fs';
import * as path from 'path';
import {
  Session,
  SessionConfig,
  SessionInfo,
  SessionState,
  SessionEventHandlers,
} from './types';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const MAX_OUTPUT_BUFFER_LINES = 1000;

/** Resolve the installed CLI without evaluating a command supplied by the phone. */
export function resolveCline(env: NodeJS.ProcessEnv = process.env): { file: string; args: string[] } {
  const searchPath = env.PATH || env.Path || '';
  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    for (const name of process.platform === 'win32' ? ['cline.exe', 'cline.cmd'] : ['cline']) {
      const candidate = path.resolve(directory, name);
      try {
        accessSync(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        if (!statSync(candidate).isFile()) continue;
        // npm's Windows shim is a batch file. Run its official JS entry with Node
        // directly so paths and arguments never go through cmd/PowerShell parsing.
        if (name.endsWith('.cmd')) {
          const script = path.join(directory, 'node_modules', 'cline', 'bin', 'cline');
          accessSync(script, constants.R_OK);
          return { file: process.execPath, args: [script, '--tui', '--auto-approve', 'false'] };
        }
        return { file: candidate, args: ['--tui', '--auto-approve', 'false'] };
      } catch { /* Try the next PATH entry. */ }
    }
  }
  throw new Error('Cline is not installed on this computer. Run npm install -g cline, then cline auth, and restart ag from that terminal.');
}

/**
 * SessionManager handles creation, management, and cleanup of PTY sessions
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private eventHandlers: SessionEventHandlers;

  constructor(handlers: SessionEventHandlers) {
    this.eventHandlers = handlers;
  }

  /**
   * Create a new PTY session
   */
  createSession(config: SessionConfig): Session {
    if (config.preset !== undefined && config.preset !== 'cline') throw new Error('Unsupported terminal preset');
    if (config.cwd !== undefined) {
      try {
        if (typeof config.cwd !== 'string' || !config.cwd.trim() || !path.isAbsolute(config.cwd) || !statSync(config.cwd).isDirectory()) throw new Error('Invalid folder');
      } catch { throw new Error('Choose an existing absolute project folder on this computer.'); }
    }
    const sessionId = config.id || uuidv4();
    const cols = config.cols || DEFAULT_COLS;
    const rows = config.rows || DEFAULT_ROWS;

    // Determine shell based on platform
    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';

    // Build the full command to execute
    // If a command is provided, pass it directly to shell -c without parsing
    // This preserves quotes and special characters correctly
    const command = config.preset === 'cline' ? 'cline' : config.command?.trim() || '';
    const launch = config.preset === 'cline' ? resolveCline({ ...process.env, ...config.env }) : {
      file: shell, args: command ? ['-c', command] : [],
    };

    console.log(`[SESSION] Creating session ${sessionId}`);

    // Create the PTY process
    const ptyProcess = pty.spawn(launch.file, launch.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: config.cwd || process.cwd(),
      env: {
        ...process.env,
        ...config.env,
        // Inherit TERM from parent - only fallback to xterm-256color if not set
        TERM: process.env.TERM || 'xterm-256color',
        // Only set COLORTERM if parent doesn't have it
        ...(process.env.COLORTERM ? {} : { COLORTERM: 'truecolor' }),
      } as Record<string, string>,
    });

    const session: Session = {
      id: sessionId,
      name: config.name || command || 'Shell',
      command,
      preset: config.preset,
      cwd: config.cwd || process.cwd(),
      args: launch.args,
      state: SessionState.RUNNING,
      createdAt: Date.now(),
      pty: ptyProcess,
      outputBuffer: [],
      connectedClients: new Set(),
      cols,
      rows,
    };

    // Set up event handlers
    this.setupPtyHandlers(session);

    // Store the session
    this.sessions.set(sessionId, session);

    return session;
  }

  /**
   * Set up PTY event handlers
   */
  private setupPtyHandlers(session: Session): void {
    const { pty: ptyProcess, id: sessionId } = session;
    console.log(`[PTY] Setting up handlers for session ${sessionId}`);

    // Handle data output from PTY
    ptyProcess.onData((data: string) => {
      console.log(`[PTY] Session ${sessionId} received ${data.length} bytes of output`);
      // Add to output buffer (circular buffer)
      session.outputBuffer.push(data);
      if (session.outputBuffer.length > MAX_OUTPUT_BUFFER_LINES) {
        session.outputBuffer.shift();
      }

      // Notify handlers
      this.eventHandlers.onOutput(sessionId, data);
    });

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode, signal }) => {
      session.state = SessionState.COMPLETED;
      session.exitCode = exitCode;
      session.exitSignal = signal !== undefined ? String(signal) : undefined;

      this.eventHandlers.onExit(sessionId, exitCode, session.exitSignal);
    });
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions
   */
  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session info for all sessions (safe for serialization)
   */
  getSessionInfoList(): SessionInfo[] {
    return this.getAllSessions().map((session) => ({
      id: session.id,
      name: session.name,
      command: session.command,
      preset: session.preset,
      cwd: session.cwd,
      state: session.state,
      createdAt: session.createdAt,
      pid: session.pty.pid,
      connectedClients: session.connectedClients.size,
      cols: session.cols,
      rows: session.rows,
    }));
  }

  /**
   * Write input to a session's PTY
   */
  writeToSession(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== SessionState.RUNNING) {
      return false;
    }

    try {
      session.pty.write(data);
      return true;
    } catch (error) {
      console.error(`Error writing to session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Resize a session's PTY
   */
  resizeSession(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== SessionState.RUNNING) {
      return false;
    }

    try {
      session.pty.resize(cols, rows);
      session.cols = cols;
      session.rows = rows;
      return true;
    } catch (error) {
      console.error(`Error resizing session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Kill a session
   */
  killSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    try {
      if (session.state === SessionState.RUNNING) {
        session.pty.kill();
      }
      session.state = SessionState.COMPLETED;
      return true;
    } catch (error) {
      console.error(`Error killing session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Remove a session from management
   */
  removeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Kill if still running
    if (session.state === SessionState.RUNNING) {
      this.killSession(sessionId);
    }

    return this.sessions.delete(sessionId);
  }

  /**
   * Add a client to a session
   */
  addClientToSession(sessionId: string, clientId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.connectedClients.add(clientId);
    return true;
  }

  /**
   * Remove a client from a session
   */
  removeClientFromSession(sessionId: string, clientId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

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
   * Get the output buffer for a session (for replay on attach)
   */
  getOutputBuffer(sessionId: string): string[] {
    const session = this.sessions.get(sessionId);
    return session ? [...session.outputBuffer] : [];
  }

  /**
   * Clean up completed sessions older than maxAge
   */
  cleanupOldSessions(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (
        session.state === SessionState.COMPLETED &&
        session.connectedClients.size === 0 &&
        now - session.createdAt > maxAgeMs
      ) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    return cleaned;
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
