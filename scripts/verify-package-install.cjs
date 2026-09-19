'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentum-package-install-'));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this check through npm run test:package');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 240000, ...options });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed: ${result.stderr || result.stdout || result.error}`);
  return result.stdout;
}
try {
  const packed = JSON.parse(run(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', root]));
  const files = packed[0].files.map(file => file.path);
  if (!files.includes('scripts/postinstall.cjs') || !files.includes('dist/desktop-support.js') || !files.includes('dist/pairing-qr.js')) throw new Error('Published package omits a required runtime file');
  const installRoot = path.join(root, 'installed');
  run(process.execPath, [npm, 'install', '--prefix', installRoot, path.join(root, packed[0].filename), '--no-audit', '--no-fund', '--foreground-scripts']);
  const installed = path.join(installRoot, 'node_modules/agentum');
  const packageJson = JSON.parse(fs.readFileSync(path.join(installed, 'package.json')));
  const result = run(process.execPath, [path.join(installed, 'dist/index.js'), '--version']);
  if (!result.includes(packageJson.version)) throw new Error('Installed CLI did not report its package version');
  const help = run(process.execPath, [path.join(installed, 'dist/index.js'), 'pair', '--help']);
  if (!help.includes('--open')) throw new Error('Installed CLI omits the QR image option');
  console.log(`Packaged Agentum ${packageJson.version} installs normally and starts on ${process.platform}/${process.arch}.`);
} finally { fs.rmSync(root, { force: true, recursive: true }); }
