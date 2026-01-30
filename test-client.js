#!/usr/bin/env node
/**
 * Simple WebSocket test client for debugging PTY input/output
 */

const WebSocket = require('ws');
const readline = require('readline');

const HOST = process.argv[2] || 'localhost';
const PORT = process.argv[3] || 11042;
const URL = `ws://${HOST}:${PORT}`;

console.log(`Connecting to ${URL}...`);

const ws = new WebSocket(URL);
let sessionId = null;
let connected = false;
let inputQueue = [];

ws.on('open', () => {
  console.log('Connected!\n');
  console.log('Commands:');
  console.log('  /create [name] - Create a new session');
  console.log('  /list          - List sessions');
  console.log('  /attach <id>   - Attach to session');
  console.log('  /raw <text>    - Send raw text (no newline)');
  console.log('  /hex <hex>     - Send hex bytes (e.g. /hex 1b 15)');
  console.log('  <anything>     - Send as input + CR');
  console.log('');
  connected = true;

  // Process queued input
  while (inputQueue.length > 0) {
    processLine(inputQueue.shift());
  }
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());

    switch (msg.type) {
      case 'session_list':
        console.log('\n=== Sessions ===');
        if (msg.sessions && msg.sessions.length > 0) {
          msg.sessions.forEach(s => {
            console.log(`  ${s.id} - ${s.name} (${s.status})`);
          });
        } else {
          console.log('  (no sessions)');
        }
        console.log('');
        break;

      case 'session_created':
        console.log(`\nSession created: ${msg.sessionId}`);
        sessionId = msg.sessionId;
        console.log(`Auto-attached to session ${sessionId}\n`);
        break;

      case 'session_attached':
        sessionId = msg.sessionId;
        console.log(`\nAttached to session ${sessionId}\n`);
        break;

      case 'output':
        // Print PTY output directly
        process.stdout.write(msg.data || msg.output || '');
        break;

      case 'error':
        console.error(`\nError: ${msg.error}\n`);
        break;

      case 'heartbeat':
      case 'pong':
        // Ignore heartbeats
        break;

      default:
        console.log(`\n[${msg.type}]`, JSON.stringify(msg).slice(0, 200));
    }
  } catch (e) {
    console.log('Raw:', data.toString().slice(0, 200));
  }
});

ws.on('close', () => {
  console.log('\nDisconnected');
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message);
  process.exit(1);
});

// Read input from stdin
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: ''
});

function processLine(line) {
  if (line.startsWith('/create')) {
    const name = line.slice(7).trim() || 'test-session';
    ws.send(JSON.stringify({
      type: 'create_session',
      name: name,
      command: '',
      timestamp: Date.now()
    }));
    console.log(`Creating session "${name}"...`);

  } else if (line === '/list') {
    ws.send(JSON.stringify({
      type: 'list_sessions',
      timestamp: Date.now()
    }));

  } else if (line.startsWith('/attach ')) {
    const id = line.slice(8).trim();
    ws.send(JSON.stringify({
      type: 'attach',
      sessionId: id,
      timestamp: Date.now()
    }));

  } else if (line.startsWith('/raw ')) {
    const text = line.slice(5);
    if (!sessionId) {
      console.log('Not attached to a session. Use /create or /attach first.');
      return;
    }
    console.log(`[SEND RAW] "${text}" (${text.length} chars)`);
    ws.send(JSON.stringify({
      type: 'input',
      sessionId: sessionId,
      data: text,
      timestamp: Date.now()
    }));

  } else if (line.startsWith('/hex ')) {
    const hexStr = line.slice(5).trim();
    const bytes = hexStr.split(/\s+/).map(h => parseInt(h, 16));
    const text = String.fromCharCode(...bytes);
    if (!sessionId) {
      console.log('Not attached to a session. Use /create or /attach first.');
      return;
    }
    console.log(`[SEND HEX] ${hexStr} -> "${text.replace(/[\x00-\x1f]/g, c => `\\x${c.charCodeAt(0).toString(16).padStart(2,'0')}`)}" (${text.length} chars)`);
    ws.send(JSON.stringify({
      type: 'input',
      sessionId: sessionId,
      data: text,
      timestamp: Date.now()
    }));

  } else {
    // Send as regular input with CR
    if (!sessionId) {
      console.log('Not attached to a session. Use /create or /attach first.');
      return;
    }
    const payload = line + '\r';
    console.log(`[SEND] "${line}" + CR (${payload.length} chars)`);
    ws.send(JSON.stringify({
      type: 'input',
      sessionId: sessionId,
      data: payload,
      timestamp: Date.now()
    }));
  }
}

rl.on('line', (line) => {
  if (!connected) {
    inputQueue.push(line);
    return;
  }
  processLine(line);
});

rl.on('close', () => {
  ws.close();
  process.exit(0);
});
