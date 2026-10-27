#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { mkdirSync,readFileSync,writeFileSync } = require('node:fs');
const { resolve,join } = require('node:path');
const os = require('node:os');
const root=resolve(__dirname,'..'),output=join(root,'benchmarks/2026-10-27-stream');mkdirSync(output,{recursive:true});
const logs=join(root,'benchmark-artifacts');mkdirSync(logs,{recursive:true});
const runs=[];
for(let round=1;round<=3;round++)for(const backend of round%2?['robotjs','rusty-robot']:['rusty-robot','robotjs']){
  const file=join(output,`${round}-${backend}.json`);
  const result=spawnSync(process.execPath,['tests/benchmark-stream.cjs',file],{cwd:root,env:{...process.env,AGENTUM_INPUT_BACKEND:backend,AGENTUM_MEDIA_BACKEND:backend,AGENTUM_CAPTURE_ADAPTIVE:'0'},encoding:'utf8',timeout:90000});
  writeFileSync(join(logs,`stream-${round}-${backend}.log`),result.stdout+result.stderr);
  if(result.error||result.status!==0)throw Error(result.stderr||String(result.error));
  runs.push({round,...JSON.parse(readFileSync(file))});console.log(`Round ${round}: ${backend} stream passed`);
}
writeFileSync(join(output,'raw.json'),JSON.stringify({measured_at:new Date().toISOString(),platform:os.platform(),release:os.release(),cpu:os.cpus()[0].model,runs},null,2));
