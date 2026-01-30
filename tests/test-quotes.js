#!/usr/bin/env node
/**
 * Comprehensive test for quote handling in PTY sessions
 */

const WebSocket = require('ws');

const HOST = process.argv[2] || 'localhost';
const PORT = process.argv[3] || 11042;
const URL = `ws://${HOST}:${PORT}`;

console.log(`Connecting to ${URL}...`);

const ws = new WebSocket(URL);
let sessionId = null;
let output = '';
let testsFailed = 0;
let testsRun = 0;

function send(obj) {
  ws.send(JSON.stringify({ ...obj, timestamp: Date.now() }));
}

function sendInput(data) {
  // Show the exact bytes being sent
  const hex = Array.from(data).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
  console.log(`[SEND] "${data.replace(/\r/g, '\\r')}" (${data.length} bytes)`);
  console.log(`[HEX]  ${hex}`);
  send({ type: 'input', sessionId, data });
}

function check(name, condition) {
  testsRun++;
  if (condition) {
    console.log(`✓ ${name}`);
  } else {
    console.log(`✗ ${name} FAILED`);
    testsFailed++;
  }
}

ws.on('open', async () => {
  console.log('Connected!\n');
  send({ type: 'create_session', name: 'quote-test', command: '' });
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'session_created') {
    sessionId = msg.sessionId;
    console.log(`Session created: ${sessionId}\n`);
    setTimeout(runTests, 500);
  }

  if (msg.type === 'output') {
    const text = msg.data || msg.output || '';
    output += text;
    process.stdout.write(text);
  }

  if (msg.type === 'error') {
    console.error(`\n[ERROR] ${msg.error}\n`);
  }
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message);
  process.exit(1);
});

async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('Quote Handling Tests');
  console.log('='.repeat(60) + '\n');

  // Test 1: Double quotes in echo
  console.log('\n--- Test 1: Double quotes in echo ---');
  output = '';
  sendInput('echo "hello world"\r');
  await sleep(1000);
  check('echo with double quotes produces output', output.includes('hello world'));

  // Test 2: Single quotes in echo
  console.log('\n--- Test 2: Single quotes in echo ---');
  output = '';
  sendInput("echo 'single quotes'\r");
  await sleep(1000);
  check('echo with single quotes produces output', output.includes('single quotes'));

  // Test 3: Mixed quotes
  console.log('\n--- Test 3: Mixed quotes ---');
  output = '';
  sendInput("echo \"nested 'single' quotes\"\r");
  await sleep(1000);
  check('mixed quotes work', output.includes("nested 'single' quotes"));

  // Test 4: Python with print
  console.log('\n--- Test 4: Python print statement ---');
  output = '';
  sendInput('python3 -c \'print("hello from python")\'\r');
  await sleep(1500);
  check('python -c with print works', output.includes('hello from python'));

  // Test 5: Interactive Python
  console.log('\n--- Test 5: Interactive Python ---');
  output = '';
  sendInput('python3\r');
  await sleep(1000);

  console.log('\n--- Test 5a: print with double quotes ---');
  sendInput('print("interactive test")\r');
  await sleep(1000);
  check('interactive python print works', output.includes('interactive test'));

  console.log('\n--- Test 5b: print with single quotes ---');
  sendInput("print('single quotes work')\r");
  await sleep(1000);
  check('python single quotes work', output.includes('single quotes work'));

  console.log('\n--- Test 5c: string with escaped quotes ---');
  sendInput('print("say \\"hello\\"")\r');
  await sleep(1000);
  check('escaped quotes work', output.includes('say "hello"'));

  // Exit Python
  sendInput('exit()\r');
  await sleep(500);

  // Test 6: Special characters
  console.log('\n--- Test 6: Special characters ---');
  output = '';
  sendInput('echo "special: $HOME ~user"\r');
  await sleep(1000);
  check('special chars in double quotes', output.length > 0);

  // Test 7: Raw quotes without command
  console.log('\n--- Test 7: Raw quote character ---');
  output = '';
  sendInput('echo \'"alone"\'\r');
  await sleep(1000);
  check('standalone quotes work', output.includes('"alone"'));

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`Tests complete: ${testsRun - testsFailed}/${testsRun} passed`);
  if (testsFailed > 0) {
    console.log(`FAILED: ${testsFailed} tests`);
  }
  console.log('='.repeat(60));

  ws.close();
  process.exit(testsFailed > 0 ? 1 : 0);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
