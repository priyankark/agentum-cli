#!/usr/bin/env node
/**
 * Automated test for WebSocket PTY
 */

const WebSocket = require('ws');

const HOST = process.argv[2] || 'localhost';
const PORT = process.argv[3] || 11042;
const URL = `ws://${HOST}:${PORT}`;

console.log(`Connecting to ${URL}...`);

const ws = new WebSocket(URL);
let sessionId = null;
let output = '';

function send(obj) {
  ws.send(JSON.stringify({ ...obj, timestamp: Date.now() }));
}

function sendInput(data) {
  console.log(`[SEND] "${data.replace(/\r/g, '\\r')}" (${data.length} bytes)`);
  send({ type: 'input', sessionId, data });
}

ws.on('open', async () => {
  console.log('Connected!\n');

  // Create session
  console.log('=== Creating session ===');
  send({ type: 'create_session', name: 'test', command: '' });
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'session_created') {
    sessionId = msg.sessionId;
    console.log(`Session created: ${sessionId}\n`);

    // Wait a bit then run tests
    setTimeout(runTests, 500);
  }

  if (msg.type === 'output') {
    const text = msg.data || msg.output || '';
    output += text;
    process.stdout.write(text);
  }

  if (msg.type === 'error') {
    console.error(`Error: ${msg.error}`);
  }
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message);
  process.exit(1);
});

async function runTests() {
  console.log('\n=== Test 1: Simple echo ===');
  sendInput('echo hello\r');

  await sleep(1000);

  console.log('\n=== Test 2: Python3 ===');
  sendInput('python3\r');

  await sleep(1000);

  console.log('\n=== Test 3: Print in Python ===');
  sendInput('print("hello world")\r');

  await sleep(1000);

  console.log('\n=== Test 4: Exit Python ===');
  sendInput('exit()\r');

  await sleep(1000);

  console.log('\n=== Test 5: Check output ===');
  sendInput('echo "test complete"\r');

  await sleep(1000);

  console.log('\n\n=== DONE ===');
  console.log('Output received:', output.length, 'bytes');

  ws.close();
  process.exit(0);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
