/**
 * Test script for Codex CLI multi-turn conversations
 * Run with: npx ts-node test-codex-multiturn.ts
 */

import { CodexSessionManager, CodexMessage } from './src/codex-session';

async function testMultiTurn() {
  console.log('=== Testing Codex Multi-Turn Conversations ===\n');

  const sessionManager = new CodexSessionManager({
    onMessage: (_sessionId: string, message: CodexMessage) => {
      const prefix = message.role === 'user' ? 'USER' : 'CODEX';
      console.log(`${prefix}: ${message.content}`);
    },
    onToolUse: (_sessionId: string, toolName: string, _toolInput: Record<string, unknown>) => {
      console.log(`TOOL: ${toolName}`);
    },
    onToolResult: (_sessionId: string, _toolUseId: string, result: string, _isError: boolean) => {
      console.log(`RESULT: ${result.slice(0, 100)}${result.length > 100 ? '...' : ''}`);
    },
    onSessionStart: (_sessionId: string, _codexThreadId: string) => {
      console.log(`\n--- Session started ---\n`);
    },
    onSessionEnd: (_sessionId: string, _result: string, isError: boolean) => {
      console.log(`\n--- Turn complete (error: ${isError}) ---\n`);
    },
    onError: (_sessionId: string, error: Error) => {
      console.error(`ERROR: ${error.message}`);
    },
    onRawOutput: () => {},
  });

  // Create session
  const session = sessionManager.createSession({
    name: 'Multi-turn Test',
    skipGitRepoCheck: true,
  });
  console.log(`Session: ${session.id}\n`);

  // Turn 1
  console.log('=== TURN 1 ===');
  try {
    await sessionManager.sendPrompt(session.id, 'My name is Alice. What is your name? Keep your answer very short.');
  } catch (e) {
    console.error('Turn 1 failed:', e);
  }

  // Turn 2 - should remember Alice's name
  console.log('\n=== TURN 2 ===');
  try {
    await sessionManager.sendPrompt(session.id, 'What is MY name? Just say the name, nothing else.');
  } catch (e) {
    console.error('Turn 2 failed:', e);
  }

  // Turn 3 - another test
  console.log('\n=== TURN 3 ===');
  try {
    await sessionManager.sendPrompt(session.id, 'Say hello to me by name.');
  } catch (e) {
    console.error('Turn 3 failed:', e);
  }

  // Show full history
  console.log('\n=== FULL HISTORY ===');
  const history = sessionManager.getMessageHistory(session.id);
  history.forEach((msg, i) => {
    console.log(`[${i}] ${msg.role}: ${msg.content}`);
  });

  sessionManager.shutdown();
  console.log('\n=== Test Complete ===');
}

testMultiTurn().catch(console.error);
