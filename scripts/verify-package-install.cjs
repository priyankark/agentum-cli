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
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.error?.message || result.signal || result.status}): ${result.stderr || result.stdout}`);
  return result.stdout;
}
try {
  const external = process.argv[2] && path.resolve(process.argv[2]);
  const packed = external ? [{ filename: external, files: [] }] : JSON.parse(run(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', root]));
  const files = packed[0].files.map(file => file.path);
  if (!external && (!files.includes('scripts/postinstall.cjs') || !files.includes('dist/desktop-support.js') || !files.includes('dist/pairing-qr.js'))) throw new Error('Published package omits a required runtime file');
  for (const required of ['scripts/build-rusty-robot.cjs', 'native/rusty-robot/source.json', 'RUSTY_ROBOT.md']) {
    if (!external && !files.includes(required)) throw new Error(`Published package omits ${required}`);
  }
  if (files.filter(file => !file.startsWith('node_modules/')).some(file => /(^|\/)(benchmark-artifacts|benchmarks|target|source|tests|\.git)(\/|$)/.test(file) || file.endsWith('.node') || file.endsWith('.tsbuildinfo') || file.endsWith('.map') || /pairing|session/.test(file) && !file.startsWith('dist/'))) {
    throw new Error('Published package contains private, development, or host-specific artifacts');
  }
  const installRoot = path.join(root, 'installed');
  run(process.execPath, [npm, 'install', '--prefix', installRoot, external || path.join(root, packed[0].filename), '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund', '--foreground-scripts']);
  const installed = path.join(installRoot, 'node_modules/agentum');
  function audit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
      if (entry.name === 'node_modules') continue;
      const relative = prefix + entry.name;
      if (/^(benchmark-artifacts|benchmarks|target|tests|\.git)(\/|$)/.test(relative) || /\.(node|map|tsbuildinfo)$/.test(relative)) {
        throw new Error(`Installed archive contains unexpected development data: ${relative}`);
      }
      if (entry.isDirectory()) audit(path.join(directory,entry.name),relative+'/');
    }
  }
  audit(installed);
  for (const file of ['dist/index.js','scripts/postinstall.cjs','scripts/build-rusty-robot.cjs','native/rusty-robot/source.json','RUSTY_ROBOT.md','LICENSE']) {
    if (!fs.existsSync(path.join(installed,file))) throw new Error(`Installed archive omits ${file}`);
  }
  const packageJson = JSON.parse(fs.readFileSync(path.join(installed, 'package.json')));
  const result = run(process.execPath, [path.join(installed, 'dist/index.js'), '--version']);
  if (!result.includes(packageJson.version)) throw new Error('Installed CLI did not report its package version');
  const help = run(process.execPath, [path.join(installed, 'dist/index.js'), 'pair', '--help']);
  if (!help.includes('--open')) throw new Error('Installed CLI omits the QR image option');
  const env={...process.env};for(const key of ['AGENTUM_INPUT_BACKEND','AGENTUM_MEDIA_BACKEND','AGENTUM_RUSTY_ROBOT_PATH'])delete env[key];
  console.log(run(process.execPath,[path.join(__dirname,'verify-installed-native.cjs'),installed],{env}));
  console.log(`Packaged Agentum ${packageJson.version} installs normally and starts on ${process.platform}/${process.arch}.`);
} finally { fs.rmSync(root, { force: true, recursive: true }); }
