const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { Jimp } = require('jimp');
const decodeQr = require('jsqr');
const { createPairingImage, openPairingImage } = require('../dist/pairing-qr');

test('saved QR images are square, private and decode to the complete pairing details', async () => {
  for (const tokenLength of [64, 256]) {
    const payload = JSON.stringify({
      type: 'agentum-pairing', version: 1, host: '192.168.1.10', port: 11042,
      vncPort: 11043, tls: false, token: 'q'.repeat(tokenLength),
      instanceId: '7e4b63a1-fcf6-4b8a-9a92-d4962d2e3f2b', instanceName: 'Work computer · 开发',
    });
    const file = await createPairingImage(payload);
    try {
      const { bitmap } = await Jimp.read(file);
      assert.equal(bitmap.width, bitmap.height);
      // An independent QR decoder verifies the image rather than the generator's matrix.
      assert.equal(decodeQr(new Uint8ClampedArray(bitmap.data), bitmap.width, bitmap.height)?.data, payload);
      assert.deepEqual([...bitmap.data.subarray(0, 4)], [255, 255, 255, 255]);
      if (process.platform !== 'win32') {
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
      }
    } finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
  }
});

test('viewer launch passes paths as arguments on each platform and propagates failures', async t => {
  const calls = [];
  t.mock.method(childProcess, 'execFile', (command, args, options, callback) => {
    calls.push({ command, args, options }); callback(null);
  });
  const file = '/a path/with spaces & symbols/pairing.png';
  for (const platform of ['darwin', 'linux', 'win32']) await openPairingImage(file, platform);
  assert.deepEqual(calls.map(({ command, args }) => ({ command, args })), [
    { command: 'open', args: [file] },
    { command: 'xdg-open', args: [file] },
    { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', file] },
  ]);
  assert.ok(calls.every(({ options }) => options.timeout === 10000 && !options.shell));
  childProcess.execFile.mock.mockImplementation((_command, _args, _options, callback) => callback(new Error('No viewer')));
  await assert.rejects(openPairingImage(file), /No viewer/);
});

function runPair(t, args, extraEnv = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentum-pair-cli-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const preload = path.join(directory, 'isolate.cjs');
  fs.writeFileSync(preload, `
    const os = require('node:os');
    os.homedir = () => process.env.AGENTUM_TEST_DIRECTORY;
    os.tmpdir = () => process.env.AGENTUM_TEST_DIRECTORY;
    Object.defineProperty(process.stdout, 'columns', { value: 40 });
    require('node:child_process').execFile = (_command, _args, _options, callback) => callback(new Error('No viewer'));
    if (process.env.AGENTUM_TEST_IMAGE_FAILURE) {
      require(${JSON.stringify(require.resolve('qrcode'))}).toBuffer = async () => { throw new Error('No image'); };
    }
  `);
  const result = childProcess.spawnSync(process.execPath, ['--require', preload, path.resolve('dist/index.js'), 'pair', '--host', '192.168.1.10', ...args], {
    encoding: 'utf8', timeout: 15000,
    env: { ...process.env, AGENTUM_AUTH_TOKEN: 'q'.repeat(64), AGENTUM_TEST_DIRECTORY: directory, ...extraEnv },
  });
  return { ...result, directory };
}

test('narrow terminals get an image fallback instead of a wrapped QR code', t => {
  const result = runPair(t, []);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /terminal is too narrow/);
  assert.doesNotMatch(result.stdout, /[▄▀█]/);
  assert.match(result.stdout, /QR image: .*pairing\.png/);
  assert.match(result.stdout, /rerun this command with --open/);
  const file = result.stdout.match(/QR image: (.+)/)[1].trim();
  assert.ok(fs.existsSync(file));
});

test('--open retains the image and manual details when no viewer is available', t => {
  const result = runPair(t, ['--open']);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /[▄▀█]/);
  assert.match(result.stdout, /Could not open an image viewer/);
  assert.match(result.stdout, /Host: 192\.168\.1\.10/);
  assert.match(result.stdout, /Pairing key: q{64}/);
  assert.ok(fs.existsSync(result.stdout.match(/QR image: (.+)/)[1].trim()));
});

test('image generation failure still leaves usable manual pairing details', t => {
  const result = runPair(t, ['--open'], { AGENTUM_TEST_IMAGE_FAILURE: '1' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Could not save the QR image/);
  assert.match(result.stdout, /Pairing key: q{64}/);
});

test('--json stays machine-readable without creating an image or launching a viewer', t => {
  const result = runPair(t, ['--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).type, 'agentum-pairing');
  assert.ok(!fs.readdirSync(result.directory).some(name => name.startsWith('agentum-pairing-')));
});

test('--json and --open are rejected before creating pairing files', t => {
  const result = runPair(t, ['--json', '--open']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Use --open or --json, not both/);
  assert.deepEqual(fs.readdirSync(result.directory), ['isolate.cjs']);
});
