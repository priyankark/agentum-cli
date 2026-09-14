const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');
const token = 'd'.repeat(64);
process.env.AGENTUM_AUTH_TOKEN = token;
const inbox = fs.mkdtempSync(path.join(os.tmpdir(), 'agentum-security-test-'));
process.env.AGENTUM_TEMP_DIR = inbox;
const { AgentumServer } = require('../dist/server');
const { VNCServer } = require('../dist/vnc/vnc-server');
const connect = async port => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { Authorization: 'Bearer ' + token } });
  socket.received = []; socket.on('message', data => socket.received.push(JSON.parse(data)));
  await once(socket, 'open'); return socket;
};
const rejected = async port => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise(resolve => socket.on('error', resolve));
};
test('actual terminal and VNC listeners reject anonymous clients and shut down with clients connected', async () => {
  const server = new AgentumServer({ port: 0, enableVnc: false });
  const vnc = new VNCServer(0, '127.0.0.1');
  try {
    await server.start(); await vnc.start();
    await rejected(server.wss.address().port); await rejected(vnc.wss.address().port);
    assert.equal(server.clients.size, 0); assert.equal(vnc.getClientCount(), 0);
    const client = await connect(server.wss.address().port);
    const vncClient = await connect(vnc.wss.address().port);
    const capabilities = client.received.find(message => message.type === 'server_capabilities');
    assert.equal(capabilities.protocolVersion, 1);
    assert.equal(capabilities.features.vnc, false, 'disabled VNC must not be advertised');
    assert.equal(capabilities.features.pty, true);
    assert.deepEqual(capabilities.features.agents, ['claude', 'copilot', 'codex']);
    assert.equal(server.clients.size, 1); assert.equal(vnc.getClientCount(), 1);
    const invalid = once(client, 'message'); client.send('{broken');
    assert.equal(JSON.parse((await invalid)[0]).type, 'error');
    assert.equal(fs.readdirSync(inbox).length, 0, 'malformed text must not become an upload');
    const badKey = once(vncClient, 'message');
    vncClient.send(JSON.stringify({ type: 'vnc_keyboard_event', key: 'constructor' }));
    assert.equal(JSON.parse((await badKey)[0]).type, 'vnc_error');
    const disconnected = [once(client, 'close'), once(vncClient, 'close')];
    await Promise.all([server.shutdown(), vnc.shutdown()]);
    await Promise.all(disconnected);
  } finally { await server.shutdown(); await vnc.shutdown(); fs.rmSync(inbox, { recursive: true, force: true }); }
});

test('two terminal/VNC pairs advertise matching independent identities and answer heartbeats', { timeout: 5000 }, async () => {
  const one = new AgentumServer({ port: 0, vncPort: 0, host: '127.0.0.1', instanceName: 'Work' });
  const two = new AgentumServer({ port: 0, vncPort: 0, host: '127.0.0.1', instanceName: 'Personal' });
  try {
    await one.start(); await two.start();
    const first = one.getConnectionDetails(), second = two.getConnectionDetails();
    assert.notEqual(first.port, second.port); assert.notEqual(first.vncPort, second.vncPort);
    assert.notEqual(first.instance.id, second.instance.id);
    for (const details of [first, second]) {
      const main = await connect(details.port), desktop = await connect(details.vncPort);
      assert.equal(main.received[0].type, 'server_capabilities', 'identity hello must precede session data');
      for (const socket of [main, desktop]) {
        assert.equal(socket.received[0].channel, socket === main ? 'terminal' : 'desktop');
        assert.equal(socket.received[0].instanceId, details.instance.id);
        assert.equal(socket.received[0].instanceName, details.instance.name);
        assert.equal(socket.received[0].vncPort, details.vncPort);
        assert.equal(socket.received[0].features.vnc, true);
        const pong = new Promise(resolve => socket.on('message', data => { if (JSON.parse(data).type === 'pong') resolve(); }));
        socket.send(JSON.stringify({ type: 'ping' })); await pong;
      }
    }
    const third = new AgentumServer({ port: 12042, enableVnc: false });
    assert.equal(third.config.vncPort, 12043, 'default desktop port follows terminal port');
    assert.equal(third.config.host, '0.0.0.0', 'phone Wi-Fi must work without extra binding flags');
    await third.shutdown();
  } finally { await one.shutdown(); await two.shutdown(); }
});

test('occupied terminal or VNC ports reject startup promptly', { timeout: 5000 }, async () => {
  const one = new AgentumServer({ port: 0, host: '127.0.0.1', enableVnc: false });
  await one.start();
  const two = new AgentumServer({ port: one.getConnectionDetails().port, host: '127.0.0.1', enableVnc: false });
  const vnc = new VNCServer(one.getConnectionDetails().port, '127.0.0.1');
  try {
    await assert.rejects(two.start(), { code: 'EADDRINUSE' });
    await assert.rejects(vnc.start(), { code: 'EADDRINUSE' });
  } finally { await one.shutdown(); await two.shutdown(); await vnc.shutdown(); }
});

test('authenticated terminal session executes quoted input and reports its output and exit', { timeout: 5000 }, async () => {
  const server = new AgentumServer({ port: 0, host: '127.0.0.1', enableVnc: false });
  await server.start();
  try {
    const client = await connect(server.getConnectionDetails().port);
    const ended = new Promise((resolve, reject) => client.on('message', data => {
      const message = JSON.parse(data);
      if (message.type === 'error') reject(new Error(message.error));
      if (message.type === 'command_complete') resolve(message);
    }));
    client.send(JSON.stringify({ type: 'create_session', name: 'Socket regression', command: 'printf "agentum quoted output\\n"', cols: 80, rows: 24 }));
    await ended;
    const created = client.received.find(message => message.type === 'session_created');
    assert.ok(created?.sessionId);
    const output = client.received.filter(message => message.type === 'output').map(message => message.data).join('');
    assert.match(output, /agentum quoted output/);
  } finally { await server.shutdown(); }
});

test('terminal hello waits for desktop startup and reports final availability before sessions', { timeout: 5000 }, async () => {
  const vncModule = require('../dist/vnc/vnc-server');
  const original = vncModule.createVNCServer;
  let release;
  vncModule.createVNCServer = (...args) => new Promise((resolve, reject) => {
    release = () => original(...args).then(resolve, reject);
  });
  const server = new AgentumServer({ port: 0, vncPort: 0, host: '127.0.0.1' });
  try {
    const started = server.start();
    await once(server.wss, 'listening');
    const socket = await connect(server.getConnectionDetails().port);
    assert.deepEqual(socket.received, [], 'no premature false-VNC hello or session lists');
    const firstMessage = once(socket, 'message'); release(); await started;
    const hello = JSON.parse((await firstMessage)[0]);
    assert.equal(hello.type, 'server_capabilities');
    assert.equal(hello.channel, 'terminal');
    assert.equal(hello.features.vnc, true);
    assert.equal(hello.vncPort, server.getConnectionDetails().vncPort);
  } finally { vncModule.createVNCServer = original; await server.shutdown(); }
});
