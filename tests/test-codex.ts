/**
 * Test script for Codex CLI integration
 * Run with: npx ts-node test-codex.ts
 */

import { CodexSessionManager, CodexMessage } from './src/codex-session';

async function testCodexSessionManager() {
  console.log('=== Testing CodexSessionManager ===\n');

  // Create session manager with event handlers
  const sessionManager = new CodexSessionManager({
    onMessage: (sessionId: string, message: CodexMessage) => {
      console.log(`[onMessage] Session ${sessionId}:`);
      console.log(`  Role: ${message.role}`);
      console.log(`  Content: ${message.content.slice(0, 100)}${message.content.length > 100 ? '...' : ''}`);
      if (message.toolName) {
        console.log(`  Tool: ${message.toolName}`);
      }
    },
    onToolUse: (sessionId: string, toolName: string, toolInput: Record<string, unknown>, toolUseId?: string) => {
      console.log(`[onToolUse] Session ${sessionId}:`);
      console.log(`  Tool: ${toolName} (${toolUseId || 'no-id'})`);
      console.log(`  Input: ${JSON.stringify(toolInput).slice(0, 100)}`);
    },
    onToolResult: (sessionId: string, toolUseId: string, result: string, isError: boolean) => {
      console.log(`[onToolResult] Session ${sessionId}:`);
      console.log(`  Tool: ${toolUseId}, Error: ${isError}`);
      console.log(`  Result: ${result.slice(0, 100)}${result.length > 100 ? '...' : ''}`);
    },
    onSessionStart: (sessionId: string, codexThreadId: string) => {
      console.log(`[onSessionStart] Session ${sessionId} started with thread: ${codexThreadId}`);
    },
    onSessionEnd: (sessionId: string, result: string, isError: boolean) => {
      console.log(`[onSessionEnd] Session ${sessionId} ended. Error: ${isError}`);
      if (result) {
        console.log(`  Result: ${result.slice(0, 100)}`);
      }
    },
    onError: (sessionId: string, error: Error) => {
      console.error(`[onError] Session ${sessionId}: ${error.message}`);
    },
    onRawOutput: (_sessionId: string, _line: string) => {
      // console.log(`[RAW] ${_line}`);  // Uncomment to see raw JSONL
    },
  });

  // Create a new session
  console.log('1. Creating session...');
  const session = sessionManager.createSession({
    name: 'Test Session',
    skipGitRepoCheck: true,
  });
  console.log(`   Session created: ${session.id} (${session.name})\n`);

  // Send a simple prompt
  console.log('2. Sending prompt: "What is 2+2? Reply with just the number."');
  console.log('   ---');

  try {
    await sessionManager.sendPrompt(session.id, 'What is 2+2? Reply with just the number.');
    console.log('   ---');
    console.log('   Prompt completed successfully.\n');
  } catch (error) {
    console.error('   Prompt failed:', error);
  }

  // Check message history
  console.log('3. Message history:');
  const history = sessionManager.getMessageHistory(session.id);
  history.forEach((msg, i) => {
    console.log(`   [${i}] ${msg.role}: ${msg.content.slice(0, 50)}${msg.content.length > 50 ? '...' : ''}`);
  });

  // Cleanup
  console.log('\n4. Cleaning up...');
  sessionManager.shutdown();
  console.log('   Done.\n');

  console.log('=== Test Complete ===');
}

// Run test
testCodexSessionManager().catch(console.error);
