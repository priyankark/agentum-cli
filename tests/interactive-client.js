#!/usr/bin/env node
/**
 * Interactive Mobile Client Simulator
 *
 * This provides a terminal-based UI that mimics the mobile app experience.
 * Use it to manually test the CLI server with the same behavior as the mobile app.
 *
 * Features:
 * - Terminal emulation (same as mobile)
 * - Smart quote normalization
 * - Session management
 * - Rendered output display
 *
 * Usage:
 *   node interactive-client.js [host] [port]
 *   node interactive-client.js localhost 11042
 */

const WebSocket = require('ws');
const readline = require('readline');

// Import the mobile client simulator components
const { MobileClientSimulator, normalizeQuotes, stripAnsiCodes } = require('./test-mobile-client.js');

// ============================================================================
// INTERACTIVE CLIENT
// ============================================================================

class InteractiveClient {
  constructor(host, port) {
    this.client = new MobileClientSimulator(host, port);
    this.rl = null;
    this.displayMode = 'rendered'; // 'raw', 'rendered', 'both'
  }

  async start() {
    console.log('\n┌─────────────────────────────────────────────────────────────────────┐');
    console.log('│           AGENTUM INTERACTIVE MOBILE CLIENT SIMULATOR              │');
    console.log('└─────────────────────────────────────────────────────────────────────┘\n');

    try {
      await this.client.connect();
      console.log('✓ Connected to server\n');

      // Wait for session list
      await this.sleep(500);

      this.setupInputHandling();
      this.showHelp();
      this.prompt();
    } catch (err) {
      console.error(`✗ Failed to connect: ${err.message}`);
      process.exit(1);
    }
  }

  setupInputHandling() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: ''
    });

    // Override message handler to display output
    const originalHandler = this.client.handleMessage.bind(this.client);
    this.client.handleMessage = (rawData) => {
      originalHandler(rawData);

      try {
        const msg = JSON.parse(rawData.toString());

        if (msg.type === 'output') {
          this.displayOutput(msg.data || msg.output || '');
        } else if (msg.type === 'session_created') {
          console.log(`\n[Session Created] ${msg.sessionId}\n`);
          this.prompt();
        } else if (msg.type === 'session_attached') {
          console.log(`\n[Attached to session] ${msg.sessionId}\n`);
          this.prompt();
        } else if (msg.type === 'error') {
          console.log(`\n[Error] ${msg.error}\n`);
          this.prompt();
        } else if (msg.type === 'session_list') {
          this.displaySessionList(msg.sessions);
        } else if (msg.type === 'command_complete') {
          console.log(`\n[Command complete] Exit code: ${msg.exitCode}\n`);
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    this.rl.on('line', (line) => {
      this.handleInput(line);
    });

    this.rl.on('close', () => {
      console.log('\nGoodbye!');
      this.client.close();
      process.exit(0);
    });
  }

  displayOutput(text) {
    if (this.displayMode === 'raw') {
      // Show raw output with escape sequences visible
      const escaped = text.replace(/\x1b/g, '\\e');
      process.stdout.write(escaped);
    } else if (this.displayMode === 'rendered') {
      // Show rendered terminal screen (like mobile app)
      process.stdout.write(stripAnsiCodes(text));
    } else {
      // Both modes
      console.log('\n--- RAW ---');
      console.log(text.replace(/\x1b/g, '\\e'));
      console.log('\n--- RENDERED ---');
      process.stdout.write(stripAnsiCodes(text));
    }
  }

  displaySessionList(sessions) {
    console.log('\n┌─────────────────────────────────────────────────────────────────────┐');
    console.log('│                           SESSIONS                                  │');
    console.log('├─────────────────────────────────────────────────────────────────────┤');

    if (!sessions || sessions.length === 0) {
      console.log('│  (no sessions)                                                      │');
    } else {
      sessions.forEach(s => {
        const status = s.state || s.status || 'unknown';
        const line = `  ${s.id.substring(0, 8)}... | ${s.name.padEnd(20)} | ${status}`;
        console.log(`│${line.padEnd(69)}│`);
      });
    }

    console.log('└─────────────────────────────────────────────────────────────────────┘\n');
    this.prompt();
  }

  handleInput(line) {
    const trimmed = line.trim();

    // Handle commands
    if (trimmed.startsWith('/')) {
      this.handleCommand(trimmed);
      return;
    }

    // Send as terminal input (with quote normalization like mobile)
    if (this.client.sessionId) {
      this.client.sendInput(trimmed);
    } else {
      console.log('Not attached to a session. Use /create or /attach first.');
      this.prompt();
    }
  }

  handleCommand(cmd) {
    const parts = cmd.slice(1).split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case 'help':
      case 'h':
        this.showHelp();
        break;

      case 'create':
      case 'new':
        const name = args[0] || 'session';
        const shellCmd = args.slice(1).join(' ');
        console.log(`Creating session "${name}"${shellCmd ? ` with command: ${shellCmd}` : ''}...`);
        this.client.createSession(name, shellCmd);
        break;

      case 'list':
      case 'ls':
        this.client.send({ type: 'list_sessions' });
        break;

      case 'attach':
        if (args[0]) {
          this.client.attachSession(args[0]);
        } else {
          console.log('Usage: /attach <session-id>');
          this.prompt();
        }
        break;

      case 'resize':
        const cols = parseInt(args[0]) || 80;
        const rows = parseInt(args[1]) || 24;
        this.client.resize(cols, rows);
        console.log(`Resized terminal to ${cols}x${rows}`);
        this.prompt();
        break;

      case 'mode':
        if (args[0]) {
          if (['raw', 'rendered', 'both'].includes(args[0])) {
            this.displayMode = args[0];
            console.log(`Display mode: ${this.displayMode}`);
          } else {
            console.log('Valid modes: raw, rendered, both');
          }
        } else {
          console.log(`Current display mode: ${this.displayMode}`);
        }
        this.prompt();
        break;

      case 'screen':
        console.log('\n--- TERMINAL SCREEN ---');
        const screen = this.client.getRenderedScreen();
        screen.forEach((line, i) => {
          const lineNum = String(i + 1).padStart(2, '0');
          console.log(`${lineNum}│${line}│`);
        });
        console.log('--- END SCREEN ---\n');
        this.prompt();
        break;

      case 'raw':
        // Send raw text without newline (for special characters)
        if (args.length > 0) {
          const text = args.join(' ');
          console.log(`[SEND RAW] "${text}"`);
          this.client.sendRawInput(text);
        }
        this.prompt();
        break;

      case 'ctrl':
        // Send control character
        const ctrlChar = args[0]?.toUpperCase();
        if (ctrlChar && ctrlChar.length === 1) {
          const code = ctrlChar.charCodeAt(0) - 64;
          if (code >= 1 && code <= 26) {
            const char = String.fromCharCode(code);
            console.log(`[SEND CTRL+${ctrlChar}] (code: ${code})`);
            this.client.sendRawInput(char);
          } else {
            console.log('Invalid control character');
          }
        } else {
          console.log('Usage: /ctrl <letter> (e.g., /ctrl c for Ctrl+C)');
        }
        this.prompt();
        break;

      case 'quote':
        // Test quote normalization
        const testStr = args.join(' ') || '"test" 'quotes'';
        console.log(`Original: ${testStr}`);
        console.log(`Normalized: ${normalizeQuotes(testStr)}`);
        this.prompt();
        break;

      case 'quit':
      case 'exit':
        this.rl.close();
        break;

      default:
        console.log(`Unknown command: ${command}. Type /help for commands.`);
        this.prompt();
    }
  }

  showHelp() {
    console.log(`
┌─────────────────────────────────────────────────────────────────────┐
│                            COMMANDS                                 │
├─────────────────────────────────────────────────────────────────────┤
│  /help, /h          Show this help                                  │
│  /create [name] [cmd]  Create new session (optional command)        │
│  /list, /ls         List all sessions                               │
│  /attach <id>       Attach to a session                             │
│  /resize <c> <r>    Resize terminal (cols rows)                     │
│  /mode <m>          Display mode: raw, rendered, both               │
│  /screen            Show current terminal screen buffer             │
│  /raw <text>        Send raw text (no Enter)                        │
│  /ctrl <letter>     Send control character (e.g., /ctrl c)          │
│  /quote <text>      Test quote normalization                        │
│  /quit, /exit       Exit the client                                 │
├─────────────────────────────────────────────────────────────────────┤
│  Any other input is sent to the terminal (with Enter)               │
│  Smart quotes (iOS-style) are automatically normalized              │
└─────────────────────────────────────────────────────────────────────┘
`);
    this.prompt();
  }

  prompt() {
    const sessionInfo = this.client.sessionId
      ? `[${this.client.sessionId.substring(0, 8)}...] `
      : '[no session] ';
    process.stdout.write(`\n${sessionInfo}> `);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// MAIN
// ============================================================================

const HOST = process.argv[2] || 'localhost';
const PORT = process.argv[3] || 11042;

const client = new InteractiveClient(HOST, PORT);
client.start();
