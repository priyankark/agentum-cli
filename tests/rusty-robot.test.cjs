const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createRustBackend } = require('../dist/vnc/rusty-robot');
function fixture() {
  const events = [];
  const addon = {
    getPermissions: () => ({ accessibility: true }),
    getScreenSize: () => ({ width: 1600, height: 1000 }),
    ...Object.fromEntries(['moveMouse', 'dragMouse', 'mouseToggle', 'scrollMouse', 'keyTap', 'keyToggle', 'typeString'].map(method => [method, (...args) => events.push([method, ...args])])),
  };
  return { addon, events, backend: createRustBackend(addon) };
}
test('Rust adapter preserves movement, drag, release, and native wheel units', () => {
  const { backend: b, events } = fixture();
  b.moveMouse(2, 3); b.mouseToggle('down', 'left'); b.moveMouse(4, 5);
  b.mouseToggle('up', 'left'); b.moveMouse(6, 7); b.scrollMouse(-12, 24);
  assert.deepEqual(events, [['moveMouse', 2, 3], ['mouseToggle', 'down', 'left'],
    ['dragMouse', 4, 5, 'left'], ['mouseToggle', 'up', 'left'], ['moveMouse', 6, 7], ['scrollMouse', -12, 24]]);
});
test('failed native press does not enter drag state; failed release retains state for retry', () => {
  const { addon, backend: b, events } = fixture();
  const toggle = addon.mouseToggle;
  addon.mouseToggle = () => { throw new Error('native failure'); };
  assert.throws(() => b.mouseToggle('down', 'right'), /native failure/);
  b.moveMouse(1, 2); assert.deepEqual(events.pop(), ['moveMouse', 1, 2]);
  addon.mouseToggle = toggle; b.mouseToggle('down', 'right');
  addon.mouseToggle = () => { throw new Error('release failure'); };
  assert.throws(() => b.mouseToggle('up', 'right'), /release failure/);
  b.moveMouse(3, 4); assert.deepEqual(events.pop(), ['dragMouse', 3, 4, 'right']);
  addon.mouseToggle = toggle; b.mouseToggle('up', 'right');
  b.moveMouse(5, 6); assert.deepEqual(events.pop(), ['moveMouse', 5, 6]);
});
test('shortcuts and Unicode forward without conversion or swallowed errors', () => {
  const { addon, backend: b, events } = fixture();
  b.keyTap('a', ['command']); b.keyToggle('shift', 'up'); b.typeString('Hello 🌍\nこんにちは');
  assert.deepEqual(events, [['keyTap', 'a', ['command']], ['keyToggle', 'shift', 'up', undefined], ['typeString', 'Hello 🌍\nこんにちは']]);
  addon.typeString = () => { throw new Error('delivery failed'); };
  assert.throws(() => b.typeString('x'), /delivery failed/);
});
test('permissions gate input while allowing setup and recover without restarting', () => {
  assert.throws(() => createRustBackend({}), /missing/);
  const { addon } = fixture();
  addon.getPermissions = () => ({ accessibility: false });
  const backend = createRustBackend(addon);
  assert.deepEqual(backend.getScreenSize(), { width:1600,height:1000 });
  assert.throws(() => backend.typeString('blocked'), /Accessibility/);
  addon.getPermissions = () => ({accessibility:true}); assert.doesNotThrow(() => backend.typeString('allowed'));
  addon.getPermissions = () => ({}); assert.doesNotThrow(() => backend.moveMouse(1,2));
});
test('explicit backend load failure does not fall back to RobotJS', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const assert=require('node:assert/strict'), Module=require('node:module');
    const original=Module._load;
    let fallback=0;
    Module._load=function(name,...args){if(name==='@hurdlegroup/robotjs'){fallback++;return {};}return original.call(this,name,...args)};
    const input=require('./dist/vnc/input-handler');
    assert.equal(input.initializeRobot(),false);assert.equal(fallback,0);
  `], { cwd: require('node:path').resolve(__dirname, '..'), env: { ...process.env, AGENTUM_INPUT_BACKEND: 'rusty-robot', AGENTUM_RUSTY_ROBOT_PATH: 'relative.node' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
