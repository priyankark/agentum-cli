const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getInstanceIdentity, pairingPayload } = require('../dist/instance');
const { protectedBind } = require('../dist/security');
process.env.AGENTUM_AUTH_TOKEN = 'e'.repeat(64);
test('instance identity persists across names/restarts and separates terminal ports', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentum-identity-'));
  try {
    const one = getInstanceIdentity(11042, 'Work', dir);
    const two = getInstanceIdentity(12042, 'Personal', dir);
    assert.notEqual(one.id, two.id);
    assert.deepEqual(getInstanceIdentity(11042, undefined, dir), one);
    assert.equal(getInstanceIdentity(11042, 'Renamed', dir).id, one.id);
    assert.equal(getInstanceIdentity(11042, undefined, dir).name, 'Renamed');
    assert.throws(() => getInstanceIdentity(11042, '\u001b[31m', dir));
    assert.throws(() => getInstanceIdentity(65536, undefined, dir));
    const qr = pairingPayload('192.168.1.10', 11042, 11043, one);
    assert.deepEqual(qr, { type: 'agentum-pairing', version: 1, host: '192.168.1.10', port: 11042, vncPort: 11043, tls: false, token: 'e'.repeat(64), instanceId: one.id, instanceName: 'Work' });
    for (const host of ['0.0.0.0', '127.0.0.1', 'localhost', '::1', 'evil/?token=x']) assert.throws(() => pairingPayload(host, 11042, 11043, one));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('LAN, Tailscale, loopback and explicit all-interface binding work; public IP bind does not', () => {
  for (const host of ['0.0.0.0', '::', '127.0.0.1', '192.168.1.5', '10.0.0.4', '172.16.0.4', '100.89.59.102', 'fd7a:115c:a1e0::1']) assert.equal(protectedBind(host), true, host);
  for (const host of ['8.8.8.8', '172.32.0.1', '100.128.0.1', 'garbage']) assert.equal(protectedBind(host), false, host);
});
