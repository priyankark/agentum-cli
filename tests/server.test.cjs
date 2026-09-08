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
