const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ensureSpawnHelpers } = require('../scripts/postinstall.cjs');
const support = require('../dist/desktop-support');

test('Windows and Linux postinstall do not resolve Darwin packages or invoke a shell', () => {
  for (const platform of ['win32', 'linux']) ensureSpawnHelpers({ platform, root: '/missing', filesystem: new Proxy({}, { get() { throw new Error('Should not touch files'); } }) });
  const pkg = require('../package.json');
  assert.equal(pkg.scripts.postinstall, 'node scripts/postinstall.cjs');
  const executed = spawnSync(process.execPath, [path.resolve('scripts/postinstall.cjs')], { encoding: 'utf8' });
  assert.equal(executed.status, 0, executed.stderr);
});

test('Darwin helper repair preserves existing modes, ignores other platforms and tolerates absent helpers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentum-install-'));
  try {
    const pkg = path.join(root, 'node_modules/node-pty');
    fs.mkdirSync(pkg, { recursive: true }); fs.writeFileSync(path.join(pkg, 'package.json'), '{"name":"node-pty","version":"0.0.0"}');
    for (const arch of ['darwin-arm64', 'darwin-x64', 'linux-x64']) fs.mkdirSync(path.join(pkg, 'prebuilds', arch), { recursive: true });
    for (const arch of ['darwin-arm64', 'linux-x64']) fs.writeFileSync(path.join(pkg, 'prebuilds', arch, 'spawn-helper'), '#!/bin/sh\n', { mode: 0o640 });
    const changed = [];
    ensureSpawnHelpers({ platform: 'darwin', root, filesystem: { ...fs, chmodSync(file, mode) { changed.push({ file, mode }); } } });
    assert.equal(changed.length, 1); assert.match(changed[0].file, /darwin-arm64/);
    assert.equal(changed[0].mode & 0o111, 0o111);
  } finally { fs.rmSync(root, { force: true, recursive: true }); }
});

test('WSL1, WSL2 and WSLg get Windows-host guidance without disabling ordinary Linux or Windows', () => {
  for (const [release, env] of [['4.4.0-19041-Microsoft', {}], ['5.15.167.4-microsoft-standard-WSL2', {}], ['6.0', { WSL_DISTRO_NAME: 'Ubuntu' }], ['6.0', { WSL_INTEROP: '/run/WSL/10_interop' }]]) {
    assert.match(support.desktopUnavailableReason('linux', release, env), /Windows PowerShell/);
    assert.match(support.desktopUnavailableReason('linux', release, env), /wsl.exe/);
  }
  for (const [platform, release, env] of [['linux', '6.8.0-generic', { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }], ['darwin', '24.0', {}], ['win32', '10.0', { WSL_DISTRO_NAME: 'Ubuntu' }]]) assert.equal(support.desktopUnavailableReason(platform, release, env), undefined);
});

test('WSL keeps the existing terminal protocol working and prints actionable desktop guidance', { timeout: 5000 }, async () => {
  const { AgentumServer } = require('../dist/server');
  const { WebSocket } = require('ws');
  const original = support.desktopUnavailableReason; const warn = console.warn; const warnings = [];
  support.desktopUnavailableReason = () => support.WSL_DESKTOP_GUIDANCE; console.warn = message => warnings.push(message);
  const server = new AgentumServer({ port: 0, vncPort: 0, host: '127.0.0.1' });
  let socket;
  try {
    await server.start(); assert.equal(server.isVncEnabled(), false); assert.match(warnings.join(' '), /Windows PowerShell/);
    socket = new WebSocket(`ws://127.0.0.1:${server.wss.address().port}`);
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const pong = new Promise(resolve => socket.on('message', raw => { const data = JSON.parse(raw); if (data.type === 'pong') resolve(data); }));
    socket.send(JSON.stringify({ type: 'ping' })); assert.equal((await pong).type, 'pong');
    const created = new Promise(resolve => socket.on('message', raw => { const data = JSON.parse(raw); if (data.type === 'session_created') resolve(data); }));
    socket.send(JSON.stringify({ type: 'create_session', name: 'Platform validation', command: process.platform === 'win32' ? 'echo AGENTUM-PLATFORM' : "printf AGENTUM-PLATFORM" }));
    assert.ok((await created).sessionId);
  } finally { socket?.terminate(); await server.shutdown(); support.desktopUnavailableReason = original; console.warn = warn; }
});
