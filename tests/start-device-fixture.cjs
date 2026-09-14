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
async function shutdown() { await Promise.all(servers.map(server => server.shutdown())); }
(async () => {
  try {
    for (const [port, name] of [[11142, 'Agentum test Work'], [11144, 'Agentum test Personal']]) {
      const server = await createServer({ port, vncPort: port + 1, host: '0.0.0.0', instanceName: name });
      servers.push(server);
    }
    const profiles = servers.map(server => { const details = server.getConnectionDetails();
      return pairingPayload(host, details.port, details.vncPort, details.instance); });
    fs.writeFileSync(destination, JSON.stringify({ pid: process.pid, profiles }, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(`Device fixture ready. Private pairing profiles: ${destination}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { shutdown().then(() => process.exit(0)); });
  } catch (error) { await shutdown(); console.error(error.message); process.exitCode = 1; }
})();
