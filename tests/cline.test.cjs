const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { SessionManager, resolveCline } = require('../dist/session');
const waitFor = async predicate => {
  const until = Date.now() + 8000;
  while (!predicate()) { if (Date.now() > until) throw Error('Timed out waiting for PTY output'); await new Promise(r => setTimeout(r, 20)); }
};
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentum-cline-'));
  const project = path.join(dir, 'project with spaces; literal'); fs.mkdirSync(project);
  fs.writeFileSync(path.join(dir, 'cline'), `#!${process.execPath}\nprocess.stdout.write('READY '+JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()})+'\\n'); process.stdin.on('data', d => process.stdout.write('REPLY '+d));`, { mode: 0o700 });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, project };
}
test('Cline preset uses fixed arguments, literal project paths and retained isolated PTYs', { timeout: 12000 }, async t => {
  const { dir, project } = fixture(t);
  const output = new Map();
  const manager = new SessionManager({ onOutput(id, data) { output.set(id, (output.get(id) || '') + data); }, onExit() {} });
  t.after(() => manager.shutdown());
  const make = name => manager.createSession({ name, command: 'touch should-not-execute', preset: 'cline', cwd: project, env: { PATH: dir } });
  const a = make('A'), b = make('B');
  await waitFor(() => output.get(a.id)?.includes('READY') && output.get(b.id)?.includes('READY'));
  assert.match(output.get(a.id), /"args":\["--tui","--auto-approve","false"\]/);
  assert.ok(output.get(a.id).includes(project)); assert.equal(fs.existsSync(path.join(project, 'should-not-execute')), false);
  assert.equal(manager.getSessionInfoList()[0].preset, 'cline');
  manager.addClientToSession(a.id, 'phone'); manager.removeClientFromAllSessions('phone');
  assert.equal(manager.getSession(a.id).state, 'running', 'disconnect keeps Cline alive');
  manager.addClientToSession(a.id, 'phone-reconnected');
  assert.ok(manager.getOutputBuffer(a.id).join('').includes('READY'), 'reattach can replay terminal state');
  manager.writeToSession(a.id, 'only-alpha\r');
  await waitFor(() => output.get(a.id)?.includes('REPLY only-alpha'));
  assert.ok(!output.get(b.id).includes('only-alpha'), 'input must never cross conversations');
  assert.equal(manager.resizeSession(a.id, 100, 30), true);
  assert.equal(manager.getSessionInfoList()[0].cols, 100);
});
test('missing CLI, unknown presets and invalid project folders produce useful errors before spawning', t => {
  const { dir } = fixture(t);
  assert.throws(() => resolveCline({ PATH: '' }), /npm install -g cline.*cline auth/);
  const manager = new SessionManager({ onOutput() {}, onExit() {} }); t.after(() => manager.shutdown());
  assert.throws(() => manager.createSession({ name: 'bad', command: '', preset: 'not-cline' }), /Unsupported/);
  assert.throws(() => manager.createSession({ name: 'bad', command: '', preset: 'cline', cwd: '../relative', env: { PATH: dir } }), /absolute project folder/);
  assert.equal(manager.getAllSessions().length, 0);
});
test('actual authenticated socket creates Cline metadata and resumes output after phone reconnect', { timeout: 12000 }, async t => {
  const { dir } = fixture(t); const oldPath = process.env.PATH, oldToken = process.env.AGENTUM_AUTH_TOKEN;
  process.env.PATH = dir; process.env.AGENTUM_AUTH_TOKEN = 'c'.repeat(64);
  t.after(() => { process.env.PATH = oldPath; if (oldToken === undefined) delete process.env.AGENTUM_AUTH_TOKEN; else process.env.AGENTUM_AUTH_TOKEN = oldToken; });
  const { AgentumServer } = require('../dist/server');
  const server = new AgentumServer({ port: 0, host: '127.0.0.1', enableVnc: false });
  await server.start(); t.after(() => server.shutdown());
  const connect = async () => { const ws = new WebSocket(`ws://127.0.0.1:${server.getConnectionDetails().port}`, { headers: { Authorization: 'Bearer ' + process.env.AGENTUM_AUTH_TOKEN } }); ws.messages = []; ws.on('message', data => ws.messages.push(JSON.parse(data))); await once(ws, 'open'); return ws; };
  const one = await connect();
  assert.equal(one.messages[0].features.clinePty, true);
  one.send(JSON.stringify({ type: 'create_session', preset: 'cline', name: 'Cline project', cwd: dir }));
  await waitFor(() => one.messages.some(m => m.type === 'output' && m.data.includes('READY')));
  const id = one.messages.find(m => m.type === 'session_created').sessionId;
  assert.equal(one.messages.find(m => m.type === 'session_created').preset, 'cline');
  assert.equal(one.messages.filter(m => m.type === 'session_list').at(-1).sessions[0].preset, 'cline');
  const closed = once(one, 'close'); one.close(); await closed;
  const two = await connect(); two.send(JSON.stringify({ type: 'attach', sessionId: id }));
  await waitFor(() => two.messages.some(m => m.type === 'output' && m.isReplay && m.data.includes('READY')));
  two.send(JSON.stringify({ type: 'input', sessionId: id, data: 'resumed-input\r' }));
  await waitFor(() => two.messages.some(m => m.type === 'output' && m.data.includes('REPLY resumed-input')));
});
test('installed official Cline opens an interactive login screen without submitting a model task', { skip: !process.env.AGENTUM_TEST_CLINE_BIN, timeout: 30000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentum-real-cline-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin); fs.symlinkSync(process.env.AGENTUM_TEST_CLINE_BIN, path.join(bin, 'cline'));
  let output = '';
  const manager = new SessionManager({ onOutput(_, data) { output += data; }, onExit() {} });
  t.after(() => manager.shutdown());
  const session = manager.createSession({ name: 'Official Cline smoke', command: '', preset: 'cline', cwd: dir, env: {
    PATH: bin + path.delimiter + path.dirname(process.execPath) + path.delimiter + '/usr/bin:/bin', HOME: dir,
    CLINE_DATA_DIR: path.join(dir, 'data'), CLINE_CONFIG_DIR: path.join(dir, 'config'),
    CLINE_API_KEY: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', OPENROUTER_API_KEY: '', GEMINI_API_KEY: '', GOOGLE_API_KEY: '',
  } });
  await waitFor(() => /sign in|log in|authenticate|provider|welcome|API key/i.test(output));
  assert.equal(session.state, 'running');
  console.log('Official Cline interactive startup detected; no prompt or authentication submitted.');
  manager.writeToSession(session.id, '\x03'); manager.killSession(session.id);
});
