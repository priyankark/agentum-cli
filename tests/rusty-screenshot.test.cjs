const {test}=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const load=Module._load;const calls=[];let fail=false;
Module._load=function(name,...args){
 if(name==='../vnc/rusty-media')return {useRustMedia:()=>true,loadRustMedia:()=>({captureFrame:async(...args)=>{calls.push(args);if(fail)throw Error('native failure');return {data:Buffer.from(args[4]==='png'?'89504e470d0a1a0a':'ffd8','hex')};}})};
 if(name==='child_process')return {execFileSync(){throw Error('Legacy capture must not run');}};
 return load.call(this,name,...args);
};
const {captureScreenshot}=require('../dist/services/screenshot');Module._load=load;
test('screenshot service writes the selected Rust format and propagates native failure',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rusty-screenshot-contract-'));
 try{for(const format of ['jpg','png']){const result=await captureScreenshot({outputDir:dir,filename:'owned.'+format,format});assert.deepEqual(calls.at(-1),[null,85,null,true,format]);assert.equal(fs.readFileSync(result.filePath).toString('hex'),format==='png'?'89504e470d0a1a0a':'ffd8');}
 fail=true;await assert.rejects(captureScreenshot({outputDir:dir,filename:'failure.png',format:'png'}),/native failure/);assert.equal(fs.existsSync(path.join(dir,'failure.png')),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
