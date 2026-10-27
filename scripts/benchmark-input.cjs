#!/usr/bin/env node
// Sequential process-isolated runs; only owned fixture input is sent.
const { spawnSync } = require('node:child_process');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const os = require('node:os');
const root = resolve(__dirname, '..');
if (process.platform !== 'darwin') throw new Error('This recorded comparison uses the macOS AppKit target');
const output = join(root, 'benchmarks/2026-10-27-batched-input'); mkdirSync(output, { recursive: true });
const runs = [];
for (let round = 1; round <= 3; round++) {
  for (const backend of round % 2 ? ['robotjs', 'rusty-robot'] : ['rusty-robot', 'robotjs']) {
    const file = join(output, `${round}-${backend}.json`);
    const result = spawnSync(process.execPath, ['tests/rusty-robot-native.cjs', '--gui', `--benchmark=${file}`], {
      cwd: root, env: { ...process.env, AGENTUM_INPUT_BACKEND: backend, AGENTUM_MEDIA_BACKEND: backend }, encoding: 'utf8', timeout: 120000,
    });
    writeFileSync(join(output, `${round}-${backend}.log`), result.stdout + result.stderr);
    if (result.error || result.status !== 0) throw new Error(`${backend} round ${round} failed: ${result.error || result.stderr}`);
    runs.push({ round, ...JSON.parse(readFileSync(file, 'utf8')) });
    console.log(`Round ${round}: ${backend}, ${runs.at(-1).results.filter(r=>r.passed).length}/30 correct`);
  }
}
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
writeFileSync(join(output, 'raw.json'), JSON.stringify({ measured_at: new Date().toISOString(), platform: os.platform(), release: os.release(), cpu: os.cpus()[0].model,
  agentum_commit: git, harness_note: 'Benchmark harness changes are committed alongside this recorded snapshot', runs }, null, 2));
console.log(output);
