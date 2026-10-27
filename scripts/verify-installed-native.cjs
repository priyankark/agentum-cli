'use strict';
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const { deflateSync } = require('node:zlib');
const installed = path.resolve(process.argv[2]);
const requireInstalled=createRequire(path.join(installed,'package.json'));
const native=requireInstalled('@priyankark/rusty-robot');
assert.equal(requireInstalled('./dist/vnc/input-handler').initializeRobot(),true);
assert.equal(requireInstalled('./dist/vnc/rusty-media').useRustMedia(),true);
assert.equal(requireInstalled('./dist/vnc/rusty-media').loadRustMedia(),native);
function crc32(bytes){let v=0xffffffff;for(const b of bytes){v^=b;for(let i=0;i<8;i++)v=(v>>>1)^((v&1)?0xedb88320:0);}return(v^0xffffffff)>>>0;}
function chunk(name,bytes){const t=Buffer.from(name),o=Buffer.alloc(bytes.length+12);o.writeUInt32BE(bytes.length);t.copy(o,4);bytes.copy(o,8);o.writeUInt32BE(crc32(Buffer.concat([t,bytes])),o.length-4);return o;}
const h=Buffer.alloc(13);h.writeUInt32BE(1);h.writeUInt32BE(1,4);h[8]=8;h[9]=2;
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.from([0,255,0,0]))),chunk('IEND',Buffer.alloc(0))]);
(async()=>{
  const frame=await native.resizeImage(png,1,null,85,'jpeg');assert.equal(frame.data.subarray(0,2).toString('hex'),'ffd8');
  const pty=requireInstalled('node-pty');
  const fs = require('node:fs');
  const ptyRoot = path.dirname(requireInstalled.resolve('node-pty/package.json'));
  for (const target of ['darwin-x64','darwin-arm64','linux-x64','linux-arm64','win32-x64','win32-arm64']) {
    const binary = path.join(ptyRoot,'prebuilds',target,target.startsWith('win32')?'conpty.node':'pty.node');
    assert.ok(fs.statSync(binary).size > 10000, `Missing terminal binary: ${target}`);
  }
  await new Promise((resolve,reject)=>{
    let output='';const windows=process.platform==='win32';
    const terminal=pty.spawn(windows?'cmd.exe':'/bin/sh',windows?['/d','/s','/c','echo AGENTUM_PREBUILT_READY']:['-c','printf AGENTUM_PREBUILT_READY'],{name:'xterm-256color',cols:80,rows:24,cwd:installed,env:process.env});
    const timer=setTimeout(()=>{terminal.kill();reject(Error('Packaged terminal timed out'));},10000);
    terminal.onData(data=>{output+=data;});
    terminal.onExit(({exitCode})=>{setTimeout(()=>{clearTimeout(timer);try{assert.equal(exitCode,0);assert.match(output,/AGENTUM_PREBUILT_READY/);resolve();}catch(e){reject(e);}},200);});
  });
  console.log(`Packaged default Rust media and terminal work on ${process.platform}/${process.arch} without install scripts`);
})().catch(error=>{console.error(error);process.exitCode=1;});
