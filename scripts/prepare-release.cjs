#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const manifest = require.resolve('node-pty/package.json', { paths: [root] });
if (require(manifest).version !== '1.1.0') throw new Error('Revalidate PTY prebuilds before changing node-pty version');
const pty = path.dirname(manifest);
for (const target of ['linux-x64', 'linux-arm64']) {
  const from = path.join(root, 'native/pty/prebuilds', target, 'pty.node');
  const to = path.join(pty, 'prebuilds', target, 'pty.node');
  if (fs.statSync(from).size < 10000) throw new Error(`Invalid ${target} PTY binary`);
  fs.mkdirSync(path.dirname(to), {recursive:true}); fs.copyFileSync(from,to);
}
for (const target of ['darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']) {
  const file = path.join(pty, 'prebuilds', target, target.startsWith('win32') ? 'conpty.node' : 'pty.node');
  if (fs.statSync(file).size < 10000) throw new Error(`Missing ${target} terminal binary`);
  if (target.startsWith('darwin')) {
    const helper=path.join(pty,'prebuilds',target,'spawn-helper');fs.chmodSync(helper,fs.statSync(helper).mode | 0o111);
  }
}
console.log('Prepared terminal prebuilds for six 64-bit desktop targets');
