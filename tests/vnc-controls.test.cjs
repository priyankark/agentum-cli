const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const Module = require('node:module');
const { WebSocket } = require('ws');
process.env.AGENTUM_AUTH_TOKEN = 'e'.repeat(64);
const events = [], subscribers = new Set();
const manager = { subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); }, updateQualitySettings() {} };
const originalLoad = Module._load;
const robot = { getScreenSize: () => ({ width: 1600, height: 1000 }),
  moveMouse: (...args) => events.push(['move', ...args]), mouseToggle: (...args) => events.push(['button', ...args]),
  scrollMouse: (...args) => events.push(['scroll', ...args]), keyTap: (...args) => events.push(['key', ...args]),
  keyToggle() {}, typeString: (...args) => events.push(['text', ...args]) };
Module._load = function(name, ...args) {
  if (name === '@hurdlegroup/robotjs') return robot;
  if (name === './screen-capture') return { ScreenCaptureManager: { getInstance: () => manager } };
  return originalLoad.call(this, name, ...args);
};
const input = require('../dist/vnc/input-handler'); input.initializeRobot();
const { VNCServer } = require('../dist/vnc/vnc-server');
Module._load = originalLoad;
const pointer = { type: 'vnc_mouse_event', eventType: 'move', x: 400, y: 250, screenWidth: 800, screenHeight: 500 };
const connect = async server => {
  const socket = new WebSocket(`ws://127.0.0.1:${server.getPort()}`, { headers: { Authorization: 'Bearer ' + process.env.AGENTUM_AUTH_TOKEN, Origin: 'aircodum://native' } });
  socket.messages = []; socket.on('message', data => socket.messages.push(JSON.parse(data)));
  await once(socket, 'open'); return socket;
};
const barrier = async (socket, messages = []) => {
  const pong = new Promise(resolve => { const on = data => { if (JSON.parse(data).type === 'pong') { socket.off('message', on); resolve(); } }; socket.on('message', on); });
  for (const message of messages) socket.send(JSON.stringify(message));
  socket.send(JSON.stringify({ type: 'ping' })); await pong;
};
const start = async socket => barrier(socket, [{ type: 'vnc_start' }]);
test('actual VNC socket controls scale points, scroll, right-click and cancel safely across clients/reconnect', { timeout: 5000 }, async () => {
  const server = new VNCServer(0, '127.0.0.1', { id: 'computer-a', name: 'Work computer' });
  await server.start();
  try {
    const a = await connect(server), b = await connect(server);
    const hello = a.messages[0];
    assert.equal(hello.channel, 'desktop'); assert.equal(hello.instanceId, 'computer-a'); assert.equal(hello.vncPort, server.getPort());
    assert.equal(hello.features.vncScroll, true); assert.equal(hello.features.vncRightClick, true);
    assert.equal(hello.features.vncInputReset, true);
    await barrier(a, [pointer]); assert.equal(events.length, 0, 'input before desktop starts must not reach the OS');
    await start(a); await start(b); assert.equal(subscribers.size, 2);
    await barrier(a, [{ ...pointer, eventType: 'down', button: 'right' }, { ...pointer, eventType: 'up', button: 'right' },
      { ...pointer, type: 'vnc_scroll', deltaX: 2, deltaY: -3 }]);
    assert.deepEqual(events.splice(0), [ ['move', 800, 500], ['button', 'down', 'right'], ['move', 800, 500], ['button', 'up', 'right'], ['move', 800, 500], ['scroll', input.nativeScrollDelta(2), input.nativeScrollDelta(-3)] ]);
    await barrier(a, [{ ...pointer, eventType: 'down' }, { ...pointer, x: 600 }]);
    const before = events.length;
    await barrier(b, [{ ...pointer, eventType: 'up' }, { type: 'vnc_input_reset' }]);
    assert.equal(events.length, before, 'another client cannot release or move the active drag');
    await barrier(a, [{ type: 'vnc_input_reset' }]);
    assert.deepEqual(events.at(-1), ['button', 'up', 'left']);
    assert.equal(events.length, before + 1, 'reset releases without jumping pointer back');
    await barrier(a, [{ ...pointer, eventType: 'down' }, { type: 'vnc_stop' }, pointer]);
    assert.deepEqual(events.at(-1), ['button', 'up', 'left']); assert.equal(subscribers.size, 1);
    await start(a); await barrier(a, [{ ...pointer, eventType: 'down', button: 'middle' }]);
    const closed = once(a, 'close'), remoteClosed = once([...server.wss.clients][0], 'close');
    a.terminate(); await Promise.all([closed, remoteClosed]);
    assert.deepEqual(events.at(-1), ['button', 'up', 'middle']);
    const c = await connect(server); await start(c);
    await barrier(c, [{ ...pointer, eventType: 'down' }, { ...pointer, eventType: 'up' }]);
    assert.deepEqual(events.at(-1), ['button', 'up', 'left']);
    const count = events.length;
    await barrier(c, [{ ...pointer, type: 'vnc_scroll', deltaX: 999, deltaY: 0 }, { ...pointer, button: 'invalid' }, { ...pointer, screenWidth: 0 }]);
    assert.equal(events.length, count, 'invalid controls must not reach native driver');
  } finally { await server.shutdown(); }
  assert.equal(subscribers.size, 0);
});
test('wheel units match AirCodum across desktop platforms', () => {
  assert.equal(input.nativeScrollDelta(-2, 'darwin'), -24);
  assert.equal(input.nativeScrollDelta(2, 'win32'), 240);
  assert.equal(input.nativeScrollDelta(2, 'linux'), 2);
});


test('VNC heartbeat independently disconnects a silent client and releases its drag', { timeout: 5000 }, async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const server = new VNCServer(0, '127.0.0.1', { id: 'heartbeat-test', name: 'Heartbeat' });
  await server.start();
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${server.getPort()}`, { autoPong: false, headers: { Authorization: 'Bearer ' + process.env.AGENTUM_AUTH_TOKEN } });
    await once(socket, 'open');
    await start(socket); await barrier(socket, [{ ...pointer, eventType: 'down' }]);
    assert.deepEqual(events.at(-1), ['button', 'down', 'left']);
    const ping = once(socket, 'ping'); t.mock.timers.tick(15000); await ping;
    const closed = once(socket, 'close'); t.mock.timers.tick(15000); await closed;
    assert.deepEqual(events.at(-1), ['button', 'up', 'left']);
    assert.equal(server.getClientCount(), 0);
  } finally { await server.shutdown(); }
});
