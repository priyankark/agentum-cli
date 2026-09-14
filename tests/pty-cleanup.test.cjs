const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { releaseExitedPty } = require('../dist/pty-cleanup');

test('exited Windows PTY cleanup releases worker and pipe without killing a reused PID', () => {
  const calls = [];
  const terminal = { kill() { throw Error('Must not kill after exit'); }, _agent: {
    inSocket: { destroy() { calls.push('pipe'); } },
    _conoutSocketWorker: { dispose() { calls.push('worker'); } },
  } };
  releaseExitedPty(terminal, 'darwin'); assert.deepEqual(calls, []);
  releaseExitedPty(terminal, 'win32'); assert.deepEqual(calls, ['worker', 'pipe']);
  assert.doesNotThrow(() => releaseExitedPty({}, 'win32'), 'other node-pty implementations need no adapter');
  calls.length = 0;
  terminal._agent._conoutSocketWorker.dispose = () => { throw Error('Already closed'); };
  assert.doesNotThrow(() => releaseExitedPty(terminal, 'win32'));
  assert.deepEqual(calls, ['pipe'], 'a failed worker disposal cannot retain the input pipe');
  terminal._agent.inSocket.destroy = () => { throw Error('Already closed'); };
  assert.doesNotThrow(() => releaseExitedPty(terminal, 'win32'), 'cleanup failures cannot suppress onExit delivery');
});

test('a naturally completed Windows terminal allows the owning Node process to exit', { skip: process.platform !== 'win32', timeout: 25000 }, () => {
  const script = `const {SessionManager}=require(${JSON.stringify(path.resolve('dist/session.js'))});
    const manager=new SessionManager({onOutput(){},onExit(id,code){ console.log('EXIT '+code); manager.shutdown(); }});
    manager.createSession({name:'Natural exit',command:'exit 0'});`;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.error, undefined, 'completed PTY must not retain native workers: ' + result.stdout);
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /EXIT 0/);
});
