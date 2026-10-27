#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { copyFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const root = resolve(__dirname, '..');
const directory = join(root, 'native/rusty-robot');
const result = spawnSync('cargo', ['build', '--release', '--locked', '--manifest-path', join(directory, 'Cargo.toml'), '--target-dir', join(directory, 'target')], { cwd: root, stdio: 'inherit', shell: false });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const library = process.platform === 'win32' ? 'agentum_rusty_robot.dll'
  : process.platform === 'darwin' ? 'libagentum_rusty_robot.dylib' : 'libagentum_rusty_robot.so';
copyFileSync(join(directory, 'target/release', library), join(directory, 'agentum-rusty-robot.node'));
console.log('Built native/rusty-robot/agentum-rusty-robot.node for this host');
