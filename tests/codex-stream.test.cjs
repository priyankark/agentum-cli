const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CodexSessionManager } = require('../dist/codex-session');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const modern = text => [
  { type: 'thread.started', thread_id: 'owned-test-thread' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text } },
  { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } },
];
function fixture(t, lines, code = 0) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentum-codex-stream-'));
  // Node runs a file called "exec" as a deterministic CLI, with real pipes and
  // exit events. Splitting bytes and omitting the final newline exercise readline.
  const wire = lines.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n');
  fs.writeFileSync(path.join(root, 'exec'), `const b=Buffer.from(${JSON.stringify(wire)});process.stdout.write(b.subarray(0,17));setTimeout(()=>{process.stdout.write(b.subarray(17));process.exitCode=${code}},5);`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return root;
}
function manager(t, root) {
  const events = [];
  const handlers = Object.fromEntries(['Message','ToolUse','ToolResult','SessionStart','SessionEnd','Error','RawOutput'].map(name => ['on'+name, (...args) => events.push({ name, args })]));
  const instance = new CodexSessionManager(handlers, process.execPath);
  t.after(() => instance.shutdown());
  const session = instance.createSession({ workingDirectory: root, skipGitRepoCheck: true });
  return { instance, session, events };
}
test('current Codex JSONL produces a visible answer before completion and preserves follow-up history', async t => {
  const root = fixture(t, modern('Chat answer 🌍\nSecond line'));
  const { instance, session, events } = manager(t, root);
  await instance.sendPrompt(session.id, 'First question');
  assert.equal(session.codexThreadId, 'owned-test-thread');
  assert.deepEqual(instance.getMessageHistory(session.id).map(m => [m.role,m.content]), [
    ['user','First question'], ['assistant','Chat answer 🌍\nSecond line'],
  ]);
  const answer = events.findIndex(e => e.name === 'Message' && e.args[1].role === 'assistant');
  const ended = events.findIndex(e => e.name === 'SessionEnd');
  assert(answer >= 0 && answer < ended);
  assert.equal(events[ended].args[1], 'Chat answer 🌍\nSecond line');
  assert.equal(events[ended].args[2], false);
  assert.equal(session.state, 'idle');
  await instance.sendPrompt(session.id, 'Follow-up');
  const assistants = instance.getMessageHistory(session.id).filter(m => m.role === 'assistant');
  assert.equal(assistants.length, 2, 'item_0 IDs can repeat in the next process');
  assert.notEqual(assistants[0].id, assistants[1].id, 'mobile deduplication must not hide the next answer');
});
test('partial updates and repeated item completion never duplicate an answer', async t => {
  const completed = modern('Complete answer')[2];
  const root = fixture(t, [
    ...modern('Complete answer').slice(0,2),
    { type:'item.updated', item:{id:'item_0',type:'agent_message',text:'Complete'} },
    completed, completed, modern('Complete answer')[3],
  ]);
  const { instance, session } = manager(t, root);
  await instance.sendPrompt(session.id, 'Question');
  assert.deepEqual(instance.getMessageHistory(session.id).filter(m => m.role === 'assistant').map(m => m.content), ['Complete answer']);
});
test('legacy JSONL remains compatible', async t => {
  const root = fixture(t, [{ model:'old',provider:'openai' }, {id:'0',msg:{type:'agent_message',message:'Legacy answer'}}]);
  const { instance, session, events } = manager(t, root);
  await instance.sendPrompt(session.id, 'Question');
  assert.equal(instance.getMessageHistory(session.id)[1].content, 'Legacy answer');
  assert.equal(events.find(e => e.name === 'SessionEnd').args[2], false);
});
test('failed turns and empty successful exits never announce a successful response', async t => {
  for (const [name, lines, expected] of [
    ['failed turn', [{type:'turn.failed',error:{message:'Provider unavailable'}}], /Provider unavailable/],
    ['empty output', [{type:'thread.started',thread_id:'t'},{type:'turn.completed'}], /without an assistant/i],
    ['stream error', [{type:'error',message:'Authentication required'}], /Authentication required/],
  ]) await t.test(name, async t => {
    const root = fixture(t, lines);
    const { instance, session, events } = manager(t, root);
    await instance.sendPrompt(session.id, 'Question');
    assert.equal(session.state, 'error');
    const ended = events.filter(e => e.name === 'SessionEnd');
    assert.equal(ended.length, 1);
    assert.equal(ended[0].args[2], true);
    assert.match(ended[0].args[1], expected);
    assert.equal(events.filter(e => e.name === 'Error').length, 1);
  });
});
test('current command execution events preserve tool output and failure status', async t => {
  const item = {id:'tool_0',type:'command_execution',command:'owned-command',status:'in_progress'};
  const root = fixture(t, [modern('Answer')[0], {type:'item.started',item},
    {type:'item.completed',item:{...item,status:'failed',aggregated_output:'Owned tool error',exit_code:2}},
    ...modern('The command failed; here is why.').slice(2)]);
  const { instance, session, events } = manager(t, root);
  await instance.sendPrompt(session.id, 'Question');
  assert.equal(events.filter(e => e.name === 'ToolUse').length, 1);
  assert.equal(events.filter(e => e.name === 'ToolResult').length, 1);
  assert.equal(events.find(e => e.name === 'ToolResult').args[3], true);
  assert(instance.getMessageHistory(session.id).some(m => m.toolResult === 'Owned tool error' && m.isError));
});
test('authenticated phone protocol receives answer text and history, not just a completion notification', { timeout:10000 }, async t => {
  const root = fixture(t, modern('Visible on the phone ✅'));
  const token = require('node:crypto').randomBytes(32).toString('hex');
  const previous = process.env.AGENTUM_AUTH_TOKEN;
  process.env.AGENTUM_AUTH_TOKEN = token;
  t.after(() => { if (previous === undefined) delete process.env.AGENTUM_AUTH_TOKEN; else process.env.AGENTUM_AUTH_TOKEN = previous; });
  const { AgentumServer } = require('../dist/server');
  const server = new AgentumServer({port:0,host:'127.0.0.1',enableVnc:false});
  server.getCodexSessionManager().codexBinaryPath = process.execPath;
  t.after(() => server.shutdown());
  await server.start();
  const socket = new WebSocket(`ws://127.0.0.1:${server.getConnectionDetails().port}`, {headers:{Authorization:'Bearer '+token}});
  t.after(() => socket.terminate());
  const messages = [];
  socket.on('message', raw => messages.push(JSON.parse(raw)));
  await once(socket,'open');
  const until = async predicate => {
    const end = Date.now()+5000;
    while (!predicate()) { if (Date.now()>end) throw Error('Socket assertion timed out'); await new Promise(r=>setTimeout(r,10)); }
  };
  socket.send(JSON.stringify({type:'codex_create_session',name:'Owned test',workingDirectory:root,skipGitRepoCheck:true}));
  await until(()=>messages.some(m=>m.type==='codex_session_created'));
  const sessionId=messages.find(m=>m.type==='codex_session_created').sessionId;
  socket.send(JSON.stringify({type:'codex_send_prompt',sessionId,prompt:'Question'}));
  await until(()=>messages.some(m=>m.type==='codex_session_ended'));
  const answer=messages.findIndex(m=>m.type==='codex_message'&&m.message.role==='assistant');
  assert(answer>=0,'Completion without a chat answer is the reported regression');
  assert.equal(messages[answer].message.content,'Visible on the phone ✅');
  assert(answer<messages.findIndex(m=>m.type==='notification'));
  socket.send(JSON.stringify({type:'codex_get_history',sessionId}));
  await until(()=>messages.some(m=>m.type==='codex_history'));
  assert(messages.find(m=>m.type==='codex_history').messages.some(m=>m.content==='Visible on the phone ✅'));
});
