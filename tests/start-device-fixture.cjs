#!/usr/bin/env node
// Actual Agentum listeners and PTYs; desktop capture/input is real only when the app starts VNC.
// Run after npm run build. The output file contains credentials: keep it private.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
process.env.AGENTUM_AUTH_TOKEN ||= randomBytes(32).toString('hex');
const { createServer } = require('../dist/server');
const { pairingPayload, connectionAddresses } = require('../dist/instance');
const destination = process.argv[2] || path.join(os.tmpdir(), `agentum-device-${process.pid}.json`);
const host = process.env.AGENTUM_TEST_HOST || connectionAddresses('0.0.0.0')[0];
if (!host) throw new Error('Set AGENTUM_TEST_HOST to a reachable Wi-Fi/Tailscale address');
const servers = [];
// A private shim adds official Cline isolation flags without changing HOME or user configuration.
if (process.env.AGENTUM_TEST_CLINE_BINARY) {
  const fixtureDir = path.dirname(destination);
  const bin = path.join(fixtureDir, 'bin'); fs.mkdirSync(bin, { recursive: true, mode: 0o700 });
  const wrapper = path.join(bin, 'cline');
  const real = process.env.AGENTUM_TEST_CLINE_BINARY;
  const args = ['--config', path.join(fixtureDir, 'cline-config'), '--data-dir', path.join(fixtureDir, 'cline-data')];
  fs.writeFileSync(wrapper, '#!/usr/bin/env node\n' +
    `const child = require('node:child_process').spawn(${JSON.stringify(real)}, ${JSON.stringify(args)}.concat(process.argv.slice(2)), {stdio:'inherit'});\n` +
    `child.on('exit', code => process.exit(code ?? 1)); child.on('error', () => process.exit(1));\n`, { mode: 0o700 });
  process.env.PATH = bin + path.delimiter + process.env.PATH;
}
const configs = [[11142, 'Agentum test Work'], [11144, 'Agentum test Personal']];
const directory = path.dirname(destination);
const requestFile = path.join(directory, 'request.json');
const responseFile = path.join(directory, 'response.json');
let activeIndex = -1, events = [], lastRequest, servicing = false;
const nativeInput = require('../dist/vnc/input-handler');
for (const name of ['handleMouseEvent', 'handleScrollEvent', 'handleKeyboardEvent', 'typeString', 'releaseMouseButton']) {
  const original = nativeInput[name];
  nativeInput[name] = (...args) => {
    const result = original(...args);
    events.push({ index: activeIndex, native: name, time: Date.now(),
      args: name === 'typeString' ? [{ length: args[0].length }] : args });
    if (events.length > 3000) events.shift();
    return result;
  };
}
async function launch(index) {
  const [port, name] = configs[index];
  const server = await createServer({ port, vncPort: port + 1, host: '0.0.0.0', instanceName: name });
  server.wss.on('connection', socket => {
    socket.on('message', raw => {
      try {
        const message = JSON.parse(raw.toString());
        const keys = { '\x1b[A': 'up', '\x1b[B': 'down', '\t': 'tab', '\x1b': 'escape', '\x03': 'interrupt', '\r': 'enter' };
        if (message.type === 'input' && Object.hasOwn(keys, message.data)) {
          events.push({ index, native: 'terminalInput', time: Date.now(), args: [{ key: keys[message.data], sessionId: message.sessionId }] });
        }
      } catch { /* Observe only bounded special-key packets, never terminal text. */ }
    });
  });
  server.vncServer.wss.on('connection', socket => {
    socket.prependListener('message', () => { activeIndex = index; });
  });
  servers[index] = server;
  return server;
}
async function serviceRequest() {
  if (servicing) return;
  let request;
  try { request = JSON.parse(fs.readFileSync(requestFile, 'utf8')); } catch { return; }
  if (!request.id || request.id === lastRequest) return;
  servicing = true; lastRequest = request.id;
  try {
    if (request.action === 'reset') events = [];
    else if (request.action === 'restart') {
      if (![0, 1].includes(request.index)) throw new Error('Unknown fixture instance');
      await servers[request.index].shutdown(); await launch(request.index);
    } else if (request.action !== 'metrics') throw new Error('Unknown fixture action');
    const result = { id: request.id, pass: true, events,
      instances: servers.map(server => ({ ...server.getConnectionDetails(), clients: server.getClientCount(),
        vncClients: server.vncServer.getClientCount(), streamingClients: server.vncServer.getStreamingClientCount(),
        sessions: server.getSessionManager().getSessionInfoList() })) };
    fs.writeFileSync(responseFile, JSON.stringify(result), { mode: 0o600 });
  } catch (error) { fs.writeFileSync(responseFile, JSON.stringify({ id: request.id, pass: false, error: error.message }), { mode: 0o600 }); }
  finally { servicing = false; }
}

async function shutdown() { await Promise.all(servers.map(server => server.shutdown())); }
(async () => {
  try {
    for (const index of [0, 1]) await launch(index);
    const profiles = servers.map(server => { const details = server.getConnectionDetails();
      return pairingPayload(host, details.port, details.vncPort, details.instance); });
    fs.writeFileSync(destination, JSON.stringify({ pid: process.pid, profiles }, null, 2), { flag: 'wx', mode: 0o600 });
    const observer = setInterval(() => { void serviceRequest(); }, 100); observer.unref();
    console.log(`Device fixture ready. Private pairing profiles: ${destination}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { shutdown().then(() => process.exit(0)); });
  } catch (error) { await shutdown(); console.error(error.message); process.exitCode = 1; }
})();
