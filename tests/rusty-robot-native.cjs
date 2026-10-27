#!/usr/bin/env node
// Read-only smoke by default. --gui explicitly injects input into an owned macOS fixture.
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { randomBytes } = require('node:crypto');
const { createServer } = require('node:net');
const { setTimeout: pause } = require('node:timers/promises');
const addon = require('../native/rusty-robot/agentum-rusty-robot.node');
const original = addon.getMousePos();
const size = addon.getScreenSize();
const permissions = addon.getPermissions();
assert(size.width > 0 && size.height > 0);
for (const value of [NaN, Infinity, -Infinity, 0.5, 2 ** 31, -(2 ** 31) - 1]) {
  assert.throws(() => addon.moveMouse(value, 0), /finite signed 32-bit integer/);
  assert.throws(() => addon.scrollMouse(0, value), /finite signed 32-bit integer/);
}
assert.throws(() => addon.keyTap('not-a-native-key'), /Invalid|Unknown|Unsupported/i);
assert.throws(() => addon.mouseToggle('invalid-state', 'left'), /Invalid/i);
console.log(JSON.stringify({ stage: 'native-query-and-error-smoke', size, permissions, passed: true }));
if (!process.argv.includes('--gui')) process.exit(0);
assert.notEqual(permissions.accessibility, false, 'Grant Accessibility to the host before native input');
process.env.AGENTUM_INPUT_BACKEND ||= 'rusty-robot';
process.env.AGENTUM_AUTH_TOKEN = randomBytes(32).toString('hex');
const Module = require('node:module');
const originalLoad = Module._load;
// Input is real. Stub only the unrelated continuous screen streaming service.
Module._load = function(name, ...args) {
  if (name === './screen-capture') return { ScreenCaptureManager: { getInstance: () => ({ subscribe: () => () => {}, updateQualitySettings() {} }) } };
  return originalLoad.call(this, name, ...args);
};
const { VNCServer } = require('../dist/vnc/vnc-server');
Module._load = originalLoad;
const { WebSocket } = require('ws');
async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'agentum-rusty-dogfood-'));
  let child, server, socket, control, fixtureServer;
  const benchmarkPath = process.argv.find(arg => arg.startsWith('--benchmark='))?.slice('--benchmark='.length);
  const watchdog = setTimeout(() => { console.error('Native dogfood timed out'); child?.kill(); socket?.terminate(); process.exit(1); }, benchmarkPath ? 120000 : 30000);
  try {
    let controlReady;
    if (process.platform === 'darwin') {
      const compile = spawnSync('swiftc', [join(__dirname, 'fixtures/rusty-robot-macos.swift'), '-o', join(directory, 'target')], { encoding: 'utf8' });
      assert.equal(compile.status, 0, compile.stderr);
      child = spawn(join(directory, 'target'), [], { stdio: ['pipe', 'pipe', 'inherit'] });
      control = child.stdin;
    } else {
      fixtureServer = createServer();
      fixtureServer.listen(0, '127.0.0.1'); await once(fixtureServer, 'listening');
      controlReady = once(fixtureServer, 'connection').then(([stream]) => { control = stream; });
      const electron = require('./fixtures/rusty-robot-electron/node_modules/electron');
      child = spawn(electron, [...(process.platform === 'linux' ? ['--no-sandbox'] : []), join(__dirname, 'fixtures/rusty-robot-electron/main.cjs')], {
        env: { ...process.env, AGENTUM_FIXTURE_PORT: String(fixtureServer.address().port) }, stdio: ['ignore', 'pipe', 'inherit'],
      });
    }
    const lines = createInterface({ input: child.stdout });
    const queue = [], waiting = [];
    lines.on('line', line => { const value = JSON.parse(line); if (waiting.length) waiting.shift()(value); else queue.push(value); });
    const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiting.push(resolve));
    const geometry = await next(); assert.equal(geometry.ready, true);
    await controlReady;
    const state = async (delay = 150) => { if (delay) await pause(delay); control.write('{}\n'); const value = await next(); assert.equal(value.active, true, 'Owned fixture must retain focus'); return value; };
    server = new VNCServer(0, '127.0.0.1', { id: 'rusty-robot-dogfood', name: 'Owned Rusty Robot fixture' });
    await server.start();
    socket = new WebSocket(`ws://127.0.0.1:${server.getPort()}`, { headers: { Authorization: `Bearer ${process.env.AGENTUM_AUTH_TOKEN}`, Origin: 'aircodum://native' } });
    await once(socket, 'open');
    const send = async (messages, checkFocus = true) => {
      if (checkFocus) await state();
      const pong = new Promise(resolve => { const listener = data => { if (JSON.parse(data).type === 'pong') { socket.off('message', listener); resolve(); } }; socket.on('message', listener); });
      for (const message of messages) socket.send(JSON.stringify(message));
      socket.send(JSON.stringify({ type: 'ping' })); await pong;
    };
    const point = rect => ({ type: 'vnc_mouse_event', x: rect.x + Math.floor(rect.width / 2), y: rect.y + Math.floor(rect.height / 2), screenWidth: size.width, screenHeight: size.height, timestamp: Date.now() });
    const click = async rect => { const p = point(rect); await send([{ ...p, eventType: 'down', button: 'left' }, { ...p, eventType: 'up', button: 'left' }]); };
    await send([{ type: 'vnc_start' }]);
    if (benchmarkPath) {
      const { performance } = require('node:perf_hooks');
      const modifier = process.platform === 'darwin' ? 'command' : 'control';
      const tap = key => ({ type: 'vnc_keyboard_event', key });
      const selectAll = { ...tap('a'), modifier: [modifier] };
      const type = text => ({ type: 'vnc_type', text });
      const clickMessages = rect => { const p = point(rect); return [{ ...p, eventType: 'down', button: 'left' }, { ...p, eventType: 'up', button: 'left' }]; };
      const waitFor = async (predicate, timeout = 2000) => {
        const began = performance.now(); let observed;
        do { observed = await state(0); if (predicate(observed)) return { passed: true, observed }; await pause(2); }
        while (performance.now() - began < timeout);
        return { passed: false, observed };
      };
      const cases = [
        { name: 'click_button', prepare: '', messages: () => clickMessages(geometry.button), verify: (s, before) => s.clicks === before.clicks + 1 },
        { name: 'type_ascii_31', prepare: '', messages: () => [type('Agentum benchmark: hello world.')], verify: s => s.text === 'Agentum benchmark: hello world.' },
        { name: 'type_unicode', prepare: '', messages: () => [type('Rust 🌍 中文 café')], verify: s => s.text === 'Rust 🌍 中文 café' },
        { name: 'type_multiline', prepare: '', messages: () => [type('First line\nSecond line')], verify: s => s.text === 'First line\nSecond line' },
        { name: 'shortcut_replace', prepare: 'replace me', messages: () => [selectAll, type('Replacement complete')], verify: s => s.text === 'Replacement complete' },
        { name: 'edit_then_click', prepare: 'old text', messages: () => [selectAll, type('Ready 🌍'), ...clickMessages(geometry.button)], verify: (s, before) => s.text === 'Ready 🌍' && s.clicks === before.clicks + 1 },
      ];
      const results = [];
      // One untimed warmup plus five recorded repetitions. Focus/reset and
      // observation setup happen outside timing; native delivery is verified.
      for (let repetition = -1; repetition < 5; repetition++) {
        const rotated = [...cases.slice((repetition + 1) % cases.length), ...cases.slice(0, (repetition + 1) % cases.length)];
        for (const spec of rotated) {
          await send([...clickMessages(geometry.editor), selectAll, tap('backspace')]);
          assert((await waitFor(s => s.text === '')).passed, 'Native reset must succeed');
          if (spec.prepare) { await send([type(spec.prepare)]); assert((await waitFor(s => s.text === spec.prepare)).passed, 'Native setup must succeed'); }
          const before = await state();
          const started = performance.now();
          await send(spec.messages(), false);
          const dispatched = performance.now();
          const observation = await waitFor(s => spec.verify(s, before));
          const completed = performance.now();
          if (repetition >= 0) results.push({ case: spec.name, repetition, dispatch_ms: dispatched - started,
            delivered_ms: observation.passed ? completed - started : null, passed: observation.passed,
            observed_text: observation.observed.text, observed_clicks: observation.observed.clicks });
        }
      }
      writeFileSync(benchmarkPath, JSON.stringify({ backend: process.env.AGENTUM_INPUT_BACKEND, platform: process.platform,
        node: process.version, robotjs: require('@hurdlegroup/robotjs/package.json').version,
        size, repetitions: 5, warmups: 1, observation_poll_ms: 2,
        transport: 'Authenticated loopback VNC socket, same-process client/server; native AppKit target; capture stream stubbed',
        results }, null, 2));
      console.log(JSON.stringify({ benchmark: benchmarkPath, passed: results.filter(r => r.passed).length, total: results.length }));
      return;
    }
    await click(geometry.button); assert.equal((await state()).clicks, 1);
    await click(geometry.editor);
    const text = 'AirCodum + Rusty Robot 🌍\nこんにちは';
    await send([{ type: 'vnc_type', text }]); assert.equal((await state()).text, text);
    await send([{ type: 'vnc_keyboard_event', key: 'a', modifier: [process.platform === 'darwin' ? 'command' : 'control'] }, { type: 'vnc_type', text: 'After shortcut' }]);
    assert.equal((await state()).text, 'After shortcut');
    await send([{ type: 'vnc_keyboard_event', key: 'return' }, { type: 'vnc_type', text: 'Second line' }]);
    assert.equal((await state()).text, 'After shortcut\nSecond line');
    // Exercise held movement through the socket and require native text selection.
    await send([{ type: 'vnc_keyboard_event', key: 'a', modifier: [process.platform === 'darwin' ? 'command' : 'control'] }, { type: 'vnc_type', text: 'Drag selection works' }]);
    const drag = { ...point(geometry.editor), x: geometry.editor.x + 8, y: geometry.editor.y + 12 };
    await send([{ ...drag, eventType: 'down', button: 'left' }, { ...drag, x: drag.x + 125, eventType: 'move' }, { type: 'vnc_input_reset' }]);
    const selected = await state(); assert(selected.selectionLength > 0, JSON.stringify(selected));
    await send([{ type: 'vnc_keyboard_event', key: 'a', modifier: [process.platform === 'darwin' ? 'command' : 'control'] }, { type: 'vnc_type', text: 'Rusty Robot dogfood passed ✅' }]);
    const final = await state(); assert.equal(final.text, 'Rusty Robot dogfood passed ✅');
    if (process.env.AGENTUM_RUSTY_EVIDENCE && process.platform === 'darwin') {
      const destination = resolve(process.env.AGENTUM_RUSTY_EVIDENCE);
      const { x, y, width, height } = geometry.window;
      const screenshot = spawnSync('/usr/sbin/screencapture', ['-x', '-R', `${x},${y},${width},${height}`, destination + '.png']);
      assert.equal(screenshot.status, 0);
      writeFileSync(destination + '.json', JSON.stringify({ platform: process.platform, size, final, passed: true }, null, 2));
    }
    console.log(JSON.stringify({ stage: 'authenticated-socket-to-native-window', platform: process.platform, button: true, unicode: true, multiline: true, shortcutCleanup: true, dragSelection: true, passed: true }));
  } finally {
    socket?.terminate();
    await server?.shutdown();
    if (child) { const exited = once(child, 'exit'); control?.end(); if (!control) child.kill(); await exited; }
    for (const key of ['shift', 'control', 'alt', 'command']) { try { addon.keyToggle(key, 'up'); } catch {} }
    try { addon.mouseToggle('up', 'left'); addon.moveMouse(original.x, original.y); } catch {}
    fixtureServer?.close();
    clearTimeout(watchdog); rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
