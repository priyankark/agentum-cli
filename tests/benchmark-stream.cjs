// Real VNC server and capture, using the same authenticated protocol as the CLI.
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { writeFileSync } = require('node:fs');
const { WebSocket } = require('ws');
const { Jimp } = require('jimp');
process.env.AGENTUM_AUTH_TOKEN = randomBytes(32).toString('hex');
const { VNCServer } = require('../dist/vnc/vnc-server');
(async()=>{
  const server = new VNCServer(0,'127.0.0.1',{id:'rusty-benchmark',name:'Owned frame benchmark'});let socket;
  try {
    await server.start();
    socket = new WebSocket(`ws://127.0.0.1:${server.getPort()}`,{headers:{Authorization:`Bearer ${process.env.AGENTUM_AUTH_TOKEN}`,Origin:'aircodum://native'}});
    await once(socket,'open');
    const video=await require('./frame-benchmark/frames.cjs').run(socket,Jimp);
    writeFileSync(process.argv[2],JSON.stringify({backend:process.env.AGENTUM_INPUT_BACKEND,node:process.version,video},null,2));
  } finally {socket?.terminate();await server.shutdown();}
})().catch(error=>{console.error(error);process.exitCode=1});
