/**
 * Test Copilot via the WebSocket server
 * Run with: npx ts-node test-server-copilot.ts
 */

import WebSocket from 'ws';

const SERVER_URL = 'ws://localhost:11042';

async function testServerCopilot() {
  console.log('=== Testing Copilot via WebSocket Server ===\n');

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    let sessionId: string | null = null;
    let messageCount = 0;

    ws.on('open', () => {
      console.log('Connected to server\n');

      // Create a Copilot session
      console.log('1. Creating Copilot session...');
      ws.send(JSON.stringify({
        type: 'copilot_create_session',
        name: 'Test Copilot Session',
      }));
    });

    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      console.log(`   [DEBUG] Received: ${msg.type}`, msg.error ? `error: ${msg.error}` : '');

      switch (msg.type) {
        case 'copilot_session_created':
          sessionId = msg.sessionId;
          console.log(`   Session created: ${sessionId}\n`);

          // Send a prompt
          console.log('2. Sending prompt...');
          ws.send(JSON.stringify({
            type: 'copilot_send_prompt',
            sessionId: sessionId,
            prompt: 'How do I list files in a directory?',
          }));
          break;

        case 'copilot_session_started':
          console.log('   Copilot session started');
          break;

        case 'copilot_message':
          messageCount++;
          console.log(`   Message [${msg.message.role}]: ${msg.message.content}`);
          break;

        case 'copilot_thinking':
          console.log(`   Thinking: ${msg.isThinking}`);
          break;

        case 'copilot_tool_use':
          console.log(`   Tool: ${msg.toolName}`);
          break;

        case 'copilot_tool_result':
          console.log(`   Tool result: ${msg.result?.slice(0, 50)}`);
          break;

        case 'copilot_session_ended':
          console.log(`\n3. Session ended (error: ${msg.isError})`);
          console.log(`   Messages received: ${messageCount}`);

          // Close and finish
          ws.close();
          resolve();
          break;

        case 'copilot_error':
          console.error(`   ERROR: ${msg.error}`);
          ws.close();
          reject(new Error(msg.error));
          break;

        case 'copilot_session_list':
          console.log(`   Sessions: ${msg.sessions?.length || 0}`);
          break;

        case 'copilot_raw_output':
          // Ignore raw output
          break;

        default:
          // Ignore other messages like session_list, heartbeat, etc.
          if (!msg.type.startsWith('session_list') &&
              !msg.type.startsWith('claude_') &&
              !msg.type.startsWith('codex_') &&
              msg.type !== 'heartbeat' &&
              msg.type !== 'pong') {
            console.log(`   [${msg.type}]`);
          }
          break;
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err.message);
      reject(err);
    });

    ws.on('close', () => {
      console.log('\nConnection closed');
    });

    // Timeout after 60 seconds
    setTimeout(() => {
      console.error('\nTest timed out');
      ws.close();
      reject(new Error('Timeout'));
    }, 60000);
  });
}

testServerCopilot()
  .then(() => {
    console.log('\n=== Test Passed ===');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n=== Test Failed ===', err.message);
    process.exit(1);
  });
