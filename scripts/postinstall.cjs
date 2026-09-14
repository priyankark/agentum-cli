'use strict';
const fs = require('node:fs');
const path = require('node:path');

// node-pty's Darwin helper needs its execute bit after some package installs.
// Do not invoke a Unix shell: npm runs lifecycle scripts through cmd.exe on Windows.
function ensureSpawnHelpers({ platform = process.platform, root = path.resolve(__dirname, '..'), filesystem = fs } = {}) {
  if (platform !== 'darwin') return;
  let manifest;
  try { manifest = require.resolve('node-pty/package.json', { paths: [root] }); }
  catch (error) { if (error.code === 'MODULE_NOT_FOUND') return; throw error; }
  const prebuilds = path.join(path.dirname(manifest), 'prebuilds');
  let entries;
  try { entries = filesystem.readdirSync(prebuilds, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('darwin-')) continue;
    const helper = path.join(prebuilds, entry.name, 'spawn-helper');
    try {
      const stat = filesystem.lstatSync(helper);
      if (!stat.isFile()) continue;
      filesystem.chmodSync(helper, stat.mode | 0o111);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
if (require.main === module) ensureSpawnHelpers();
module.exports = { ensureSpawnHelpers };
