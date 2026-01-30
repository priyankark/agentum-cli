#!/usr/bin/env node
/**
 * Test session creation with commands containing quotes
 */

const WebSocket = require('ws');

const HOST = process.argv[2] || 'localhost';
const PORT = process.argv[3] || 11042;
const URL = `ws://${HOST}:${PORT}`;

console.log(`Connecting to ${URL}...`);

const ws = new WebSocket(URL);
let output = '';
let testsFailed = 0;
let testsRun = 0;

function send(obj) {
  ws.send(JSON.stringify({ ...obj, timestamp: Date.now() }));
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
  runTests();
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'output') {
    const text = msg.data || msg.output || '';
    output += text;
    process.stdout.write(text);
  }

  if (msg.type === 'session_created') {
    console.log(`[SESSION CREATED] ${msg.sessionId}`);
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
  console.log('Session Creation with Quoted Commands');
  console.log('='.repeat(60) + '\n');

  // Test 1: Create session with Python -c command using single quotes
  console.log('\n--- Test 1: Python -c with single quotes around double-quoted string ---');
  output = '';
  send({
    type: 'create_session',
    name: 'python-single',
    command: 'python3 -c \'print("hello from test 1")\''
  });
  await sleep(2000);
  check('python -c with single quotes works', output.includes('hello from test 1'));

  // Test 2: Create session with Python -c command using double quotes
  console.log('\n--- Test 2: Python -c with escaped double quotes ---');
  output = '';
  send({
    type: 'create_session',
    name: 'python-escaped',
    command: 'python3 -c "print(\\"hello from test 2\\")"'
  });
  await sleep(2000);
  check('python -c with escaped quotes works', output.includes('hello from test 2'));

  // Test 3: Echo with quoted argument
  console.log('\n--- Test 3: Echo with quoted arguments ---');
  output = '';
  send({
    type: 'create_session',
    name: 'echo-test',
    command: 'echo "quoted argument with spaces"'
  });
  await sleep(1500);
  check('echo with quotes works', output.includes('quoted argument with spaces'));

  // Test 4: Multi-argument with quotes
  console.log('\n--- Test 4: Complex command with multiple quoted args ---');
  output = '';
  send({
    type: 'create_session',
    name: 'complex-test',
    command: 'python3 -c \'import sys; print("args:", sys.argv)\' arg1 "arg 2"'
  });
  await sleep(2000);
  check('complex command with quotes works', output.includes('args:'));

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
