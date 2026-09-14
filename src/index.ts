#!/usr/bin/env node

/**
 * AirCodum-Agentum CLI
 * Mirror terminal sessions to mobile over WebSocket
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { WebSocket } from 'ws';
import { createServer, AgentumServer } from './server';
import { MessageType, SessionInfo, SessionState } from './types';
import { captureScreenshot, sendNotification } from './services';

const VERSION: string = require('../package.json').version;
const DEFAULT_PORT = 11042;
const DEFAULT_VNC_PORT = 11043;

const program = new Command();

/**
 * Format session state with color
 */
function formatState(state: SessionState): string {
  switch (state) {
    case SessionState.RUNNING:
      return chalk.green('running');
    case SessionState.COMPLETED:
      return chalk.gray('completed');
    case SessionState.PAUSED:
      return chalk.yellow('paused');
    case SessionState.ERROR:
      return chalk.red('error');
    default:
      return state;
  }
}

/**
 * Format timestamp
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

/**
 * Format duration
 */
function formatDuration(startTime: number): string {
  const duration = Date.now() - startTime;
  const seconds = Math.floor(duration / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Server command - Start the WebSocket server
 */
async function serverCommand(options: { port: number; host?: string; vncPort?: number; noVnc?: boolean }): Promise<void> {
  console.log(chalk.blue.bold('AirCodum-Agentum Server'));
  console.log(chalk.gray('─'.repeat(40)));

  let server: AgentumServer | null = null;

  try {
    server = await createServer({
      port: options.port,
      host: options.host || '0.0.0.0',
      vncPort: options.vncPort || DEFAULT_VNC_PORT,
      enableVnc: !options.noVnc,
    });

    console.log(chalk.green(`Terminal server started on port ${options.port}`));
    console.log(chalk.gray(`Connect from mobile: ws://<your-ip>:${options.port}`));
    if (!options.noVnc) {
      console.log(chalk.green(`VNC server started on port ${options.vncPort || DEFAULT_VNC_PORT}`));
      console.log(chalk.gray(`VNC connection: ws://<your-ip>:${options.vncPort || DEFAULT_VNC_PORT}`));
    }
    console.log(chalk.gray('Press Ctrl+C to stop'));
    console.log();

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log(chalk.yellow('\nShutting down...'));
      if (server) {
        await server.shutdown();
      }
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep the process running
    await new Promise(() => {});
  } catch (error) {
    console.error(chalk.red(`Failed to start server: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * Run command - Run a command and mirror to mobile
 */
async function runCommand(
  command: string,
  options: { name?: string; port: number; detach?: boolean }
): Promise<void> {
  console.log(chalk.blue.bold('AirCodum-Agentum'));
  console.log(chalk.gray('─'.repeat(40)));

  let server: AgentumServer | null = null;

  try {
    // Start or connect to server
    server = await createServer({ port: options.port });

    const sessionName = options.name || command.split(' ')[0];
    const sessionId = server.createSession(
      command,
      sessionName,
      process.stdout.columns || 80,
      process.stdout.rows || 24
    );

    console.log(chalk.green(`Session created: ${sessionId}`));
    console.log(chalk.gray(`Command: ${command}`));
    console.log(chalk.gray(`Name: ${sessionName}`));
    console.log(chalk.gray(`Port: ${options.port}`));
    console.log();

    const sessionManager = server.getSessionManager();
    const session = sessionManager.getSession(sessionId);

    if (!session) {
      throw new Error('Failed to create session');
    }

    // If not detaching, attach to the session locally
    if (!options.detach) {
      console.log(chalk.yellow('Attached to session. Press Ctrl+C to detach.'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log();

      // Set raw mode for input
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      // Forward stdin to PTY
      process.stdin.on('data', (data: Buffer) => {
        // Check for Ctrl+C (detach)
        if (data.length === 1 && data[0] === 3) {
          console.log(chalk.yellow('\nDetaching from session...'));
          console.log(chalk.gray(`Session ${sessionId} continues running in background.`));

          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
          }
          process.stdin.pause();

          // Don't exit if there are mobile clients
          if (server!.getClientCount() > 0) {
            console.log(chalk.gray(`${server!.getClientCount()} mobile client(s) still connected.`));
          }
          return;
        }

        sessionManager.writeToSession(sessionId, data.toString());
      });

      // Forward PTY output to stdout
      const pty = session.pty;
      pty.onData((data: string) => {
        process.stdout.write(data);
      });

      // Handle resize
      process.stdout.on('resize', () => {
        sessionManager.resizeSession(
          sessionId,
          process.stdout.columns || 80,
          process.stdout.rows || 24
        );
      });

      // Handle session exit
      pty.onExit(({ exitCode }) => {
        console.log();
        console.log(chalk.gray('─'.repeat(40)));
        console.log(chalk.yellow(`Session ended with exit code: ${exitCode}`));

        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }

        // Shutdown server if no mobile clients
        if (server!.getClientCount() === 0) {
          server!.shutdown().then(() => process.exit(exitCode));
        } else {
          console.log(chalk.gray(`${server!.getClientCount()} mobile client(s) still connected.`));
          console.log(chalk.gray('Server will continue running.'));
        }
      });
    } else {
      console.log(chalk.gray('Session running in background.'));
      console.log(chalk.gray(`Use 'ag attach ${sessionId}' to attach.`));
    }

    // Handle shutdown
    const shutdown = async () => {
      console.log(chalk.yellow('\nShutting down...'));
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      if (server) {
        await server.shutdown();
      }
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(
        chalk.red(`Port ${options.port} is already in use.`)
      );
      console.error(
        chalk.gray(`Try connecting to existing server or use a different port.`)
      );
    } else {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
    }
    process.exit(1);
  }
}

/**
 * List command - List active sessions
 */
async function listCommand(options: { port: number }): Promise<void> {
  console.log(chalk.blue.bold('AirCodum-Agentum Sessions'));
  console.log(chalk.gray('─'.repeat(60)));

  const ws = new WebSocket(`ws://127.0.0.1:${options.port}`);

  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: MessageType.LIST_SESSIONS,
      timestamp: Date.now(),
    }));
  });

  ws.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === MessageType.SESSION_LIST) {
        const sessions: SessionInfo[] = message.sessions;

        if (sessions.length === 0) {
          console.log(chalk.gray('No active sessions.'));
        } else {
          console.log();
          for (const session of sessions) {
            console.log(chalk.white.bold(`  ${session.name}`));
            console.log(chalk.gray(`    ID:       ${session.id}`));
            console.log(chalk.gray(`    Command:  ${session.command}`));
            console.log(`    State:    ${formatState(session.state)}`);
            console.log(chalk.gray(`    Created:  ${formatTime(session.createdAt)}`));
            console.log(chalk.gray(`    Duration: ${formatDuration(session.createdAt)}`));
            console.log(chalk.gray(`    Clients:  ${session.connectedClients}`));
            console.log(chalk.gray(`    Size:     ${session.cols}x${session.rows}`));
            if (session.pid) {
              console.log(chalk.gray(`    PID:      ${session.pid}`));
            }
            console.log();
          }
        }

        ws.close();
        process.exit(0);
      } else if (message.type === MessageType.ERROR) {
        console.error(chalk.red(`Error: ${message.error}`));
        ws.close();
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`Failed to parse response: ${error}`));
      ws.close();
      process.exit(1);
    }
  });

  ws.on('error', (error: Error) => {
    if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      console.error(chalk.red(`Cannot connect to server on port ${options.port}.`));
      console.error(chalk.gray(`Start the server with: ag start --port ${options.port}`));
    } else {
      console.error(chalk.red(`Connection error: ${error.message}`));
    }
    process.exit(1);
  });
}

/**
 * Attach command - Attach to a session locally
 */
async function attachCommand(
  sessionId: string,
  options: { port: number }
): Promise<void> {
  console.log(chalk.blue.bold('AirCodum-Agentum'));
  console.log(chalk.gray('─'.repeat(40)));
  console.log(chalk.gray(`Attaching to session: ${sessionId}`));
  console.log();

  const ws = new WebSocket(`ws://127.0.0.1:${options.port}`);
  let attached = false;

  ws.on('open', () => {
    // Attach to session
    ws.send(JSON.stringify({
      type: MessageType.ATTACH,
      sessionId,
      timestamp: Date.now(),
    }));

    // Set terminal size
    ws.send(JSON.stringify({
      type: MessageType.RESIZE,
      sessionId,
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      timestamp: Date.now(),
    }));
  });

  ws.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case MessageType.SESSION_ATTACHED:
          attached = true;
          console.log(chalk.green('Attached to session.'));
          console.log(chalk.yellow('Press Ctrl+] to detach.'));
          console.log(chalk.gray('─'.repeat(40)));
          console.log();

          // Set raw mode
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
          }
          process.stdin.resume();

          // Forward stdin
          process.stdin.on('data', (inputData: Buffer) => {
            // Check for Ctrl+] (detach)
            if (inputData.length === 1 && inputData[0] === 29) {
              console.log(chalk.yellow('\nDetaching...'));
              ws.send(JSON.stringify({
                type: MessageType.DETACH,
                timestamp: Date.now(),
              }));
              return;
            }

            ws.send(JSON.stringify({
              type: MessageType.INPUT,
              sessionId,
              data: inputData.toString(),
              timestamp: Date.now(),
            }));
          });

          // Handle resize
          process.stdout.on('resize', () => {
            ws.send(JSON.stringify({
              type: MessageType.RESIZE,
              sessionId,
              cols: process.stdout.columns || 80,
              rows: process.stdout.rows || 24,
              timestamp: Date.now(),
            }));
          });
          break;

        case MessageType.OUTPUT:
          process.stdout.write(message.data);
          break;

        case MessageType.SESSION_DETACHED:
          console.log(chalk.yellow('Detached from session.'));
          cleanup();
          break;

        case MessageType.COMMAND_COMPLETE:
          console.log();
          console.log(chalk.gray('─'.repeat(40)));
          console.log(chalk.yellow(`Command completed with exit code: ${message.exitCode}`));
          cleanup();
          break;

        case MessageType.SESSION_ENDED:
          console.log(chalk.yellow('\nSession ended.'));
          cleanup();
          break;

        case MessageType.ERROR:
          console.error(chalk.red(`\nError: ${message.error}`));
          cleanup();
          break;
      }
    } catch (error) {
      console.error(chalk.red(`Failed to parse message: ${error}`));
    }
  });

  ws.on('error', (error: Error) => {
    if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      console.error(chalk.red(`Cannot connect to server on port ${options.port}.`));
    } else {
      console.error(chalk.red(`Connection error: ${error.message}`));
    }
    process.exit(1);
  });

  ws.on('close', () => {
    if (attached) {
      console.log(chalk.gray('Connection closed.'));
    }
    cleanup();
  });

  function cleanup(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    ws.close();
    process.exit(0);
  }

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\nDetaching...'));
    ws.send(JSON.stringify({
      type: MessageType.DETACH,
      timestamp: Date.now(),
    }));
  });
}

/**
 * Kill command - Kill a session
 */
async function killCommand(
  sessionId: string,
  options: { port: number }
): Promise<void> {
  const ws = new WebSocket(`ws://127.0.0.1:${options.port}`);

  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: MessageType.KILL_SESSION,
      sessionId,
      timestamp: Date.now(),
    }));
  });

  ws.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === MessageType.SESSION_KILLED) {
        console.log(chalk.green(`Session ${sessionId} killed.`));
        ws.close();
        process.exit(0);
      } else if (message.type === MessageType.ERROR) {
        console.error(chalk.red(`Error: ${message.error}`));
        ws.close();
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`Failed to parse response: ${error}`));
      ws.close();
      process.exit(1);
    }
  });

  ws.on('error', (error: Error) => {
    if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      console.error(chalk.red(`Cannot connect to server on port ${options.port}.`));
    } else {
      console.error(chalk.red(`Connection error: ${error.message}`));
    }
    process.exit(1);
  });
}

// Configure CLI
program
  .name('ag')
  .description('AirCodum-Agentum CLI - Mirror terminal sessions to mobile over WebSocket')
  .version(VERSION);

program
  .command('start')
  .description('Start the Agentum server')
  .option('-p, --port <port>', 'WebSocket server port', String(DEFAULT_PORT))
  .option('--vnc-port <port>', 'VNC server port', String(DEFAULT_VNC_PORT))
  .option('-h, --host <host>', 'Host to bind to', '0.0.0.0')
  .option('--no-vnc', 'Disable VNC server')
  .action(async (options) => {
    await serverCommand({
      port: parseInt(options.port, 10),
      host: options.host,
      vncPort: options.vncPort ? parseInt(options.vncPort, 10) : DEFAULT_VNC_PORT,
      noVnc: options.vnc === false,
    });
  });

program
  .command('server')
  .description('Start the WebSocket server for mobile connections')
  .option('-p, --port <port>', 'Port to listen on for terminal sessions', String(DEFAULT_PORT))
  .option('-h, --host <host>', 'Host to bind to', '0.0.0.0')
  .option('--vnc-port <port>', 'Port to listen on for VNC screen sharing', String(DEFAULT_VNC_PORT))
  .option('--no-vnc', 'Disable VNC server')
  .action(async (options) => {
    await serverCommand({
      port: parseInt(options.port, 10),
      host: options.host,
      vncPort: options.vncPort ? parseInt(options.vncPort, 10) : DEFAULT_VNC_PORT,
      noVnc: options.vnc === false,
    });
  });

program
  .command('run <command>')
  .description('Run a command and mirror to mobile')
  .option('-n, --name <name>', 'Session name')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .option('-d, --detach', 'Run in background')
  .action((command, options) => {
    runCommand(command, {
      name: options.name,
      port: parseInt(options.port, 10),
      detach: options.detach,
    });
  });

program
  .command('list')
  .description('List active sessions')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .action((options) => {
    listCommand({
      port: parseInt(options.port, 10),
    });
  });

program
  .command('attach <session-id>')
  .description('Attach to a session locally')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .action((sessionId, options) => {
    attachCommand(sessionId, {
      port: parseInt(options.port, 10),
    });
  });

program
  .command('kill <session-id>')
  .description('Kill a session')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .action((sessionId, options) => {
    killCommand(sessionId, {
      port: parseInt(options.port, 10),
    });
  });

// Utility: capture a screenshot to disk
program
  .command('screenshot')
  .description('Capture a screenshot to disk')
  .option('-o, --output <dir>', 'Output directory (defaults to /tmp)')
  .action(async (options) => {
    try {
      const result = await captureScreenshot({
        outputDir: options.output,
      });
      console.log(result.filePath);
    } catch (e) {
      console.error(chalk.red(`Failed to capture screenshot: ${(e as Error).message}`));
      process.exit(1);
    }
  });

// Utility: trigger a phone notification to connected mobile clients via server
program
  .command('notify')
  .description('Send a phone notification to connected clients via the Agentum server')
  .option('-t, --title <title>', 'Notification title', 'Agentum')
  .option('-b, --body <body>', 'Notification body', '')
  .option('-P, --priority <priority>', 'Priority (low|normal|high|urgent)', 'normal')
  .option('-y, --notification-type <type>', 'Notification type (info|warning|error|command_complete|session_ended)', 'info')
  .option('-p, --port <port>', 'Server port', String(DEFAULT_PORT))
  .option('-h, --host <host>', 'Server host', '127.0.0.1')
  .action(async (options) => {
    try {
      await sendNotification(
        {
          title: options.title,
          body: options.body,
          priority: options.priority as 'low' | 'normal' | 'high' | 'urgent',
          type: options.notificationType as 'info' | 'warning' | 'error' | 'command_complete',
        },
        {
          host: options.host,
          port: parseInt(options.port, 10),
        }
      );
    } catch (err) {
      console.error(chalk.red(`Failed to connect to server: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// Parse arguments (use parseAsync for async actions)
program.parseAsync();
