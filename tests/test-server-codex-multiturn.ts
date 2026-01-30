/**
 * Test Codex multi-turn via the WebSocket server
 */

import WebSocket from 'ws';

const SERVER_URL = 'ws://localhost:11042';

async function testMultiTurn() {
  console.log('=== Testing Codex Multi-Turn via Server ===\n');

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    let sessionId: string | null = null;
    let turnCount = 0;
    const maxTurns = 3;
    const prompts = [
      'My name is Bob. Remember it. Reply with just "OK".',
      'What is my name? Just say the name.',
      'Say goodbye to me using my name.',
    ];

    ws.on('open', () => {
      console.log('Connected to server\n');
      console.log('Creating session...');
      ws.send(JSON.stringify({
        type: 'codex_create_session',
        name: 'Multi-turn Test',
        skipGitRepoCheck: true,
      }));
    });

    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'codex_session_created':
          sessionId = msg.sessionId;
          console.log(`Session: ${sessionId}\n`);

          // Send first prompt
          console.log(`--- TURN 1 ---`);
          console.log(`USER: ${prompts[0]}`);
          ws.send(JSON.stringify({
            type: 'codex_send_prompt',
            sessionId,
            prompt: prompts[0],
          }));
          break;

        case 'codex_message':
          if (msg.message.role === 'assistant') {
            console.log(`CODEX: ${msg.message.content}\n`);
          }
          break;

        case 'codex_session_ended':
          turnCount++;

          if (turnCount < maxTurns) {
            // Send next prompt
            console.log(`--- TURN ${turnCount + 1} ---`);
            console.log(`USER: ${prompts[turnCount]}`);
            ws.send(JSON.stringify({
              type: 'codex_send_prompt',
              sessionId,
              prompt: prompts[turnCount],
            }));
          } else {
            // All turns complete
            console.log('=== All turns complete ===');
            ws.close();
            resolve();
          }
          break;

        case 'codex_error':
          console.error(`ERROR: ${msg.error}`);
          ws.close();
          reject(new Error(msg.error));
          break;
      }
    });

    ws.on('error', (err) => {
      reject(err);
    });

    setTimeout(() => {
      console.error('Test timed out');
      ws.close();
      reject(new Error('Timeout'));
    }, 180000);
  });
}

testMultiTurn()
  .then(() => {
    console.log('\n=== Test Passed ===');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n=== Test Failed ===', err.message);
    process.exit(1);
  });
