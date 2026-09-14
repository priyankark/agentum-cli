const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
const events = [];
let modifiers = [];
const robot = {
  keyTap(key, held = []) {
    if (key === 'return') throw new Error('Invalid key code specified');
    modifiers = held;
    events.push(['tap', key, held]);
  },
  keyToggle(key, state) {
    assert.equal(state, 'up');
    modifiers = modifiers.filter(modifier => modifier !== key);
    events.push(['release', key]);
  },
  typeString(text) { if (modifiers.length === 0) events.push(['text', text]); },
};
Module._load = function(name, ...args) {
  if (name === '@hurdlegroup/robotjs') return robot;
  return originalLoad.call(this, name, ...args);
};
const input = require('../dist/vnc/input-handler');
input.initializeRobot();
Module._load = originalLoad;

test('native Enter aliases and modifier release preserve text after shortcuts', () => {
  input.handleKeyboardEvent({ key: 'a', modifier: ['command'] });
  input.typeString('after shortcut');
  input.handleKeyboardEvent({ key: 'enter' });
  input.handleKeyboardEvent({ key: 'return' });
  assert.deepEqual(events, [
    ['tap', 'a', ['command']], ['release', 'command'], ['text', 'after shortcut'],
    ['tap', 'enter', []], ['tap', 'enter', []],
  ]);
});
