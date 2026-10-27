const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function check(environment, expectations) {
  const env = { ...process.env };
  for (const key of ['AGENTUM_INPUT_BACKEND', 'AGENTUM_MEDIA_BACKEND', 'AGENTUM_RUSTY_ROBOT_PATH']) delete env[key];
  const script = `
    const assert=require('node:assert/strict'), Module=require('node:module');
    const counts={rust:0,legacy:0};const load=Module._load;
    const addon={getPermissions:()=>({accessibility:true}), getScreenSize:()=>({width:800,height:600}), moveMouse(){},dragMouse(){},mouseToggle(){},scrollMouse(){},keyTap(){},keyToggle(){},typeString(){},captureFrame(){},resizeImage(){}};
    Module._load=function(name,...args){
      if(name==='@priyankark/rusty-robot'){counts.rust++;if(process.env.TEST_BROKEN_RUST)throw Error('native package unavailable');return addon;}
      if(name==='@hurdlegroup/robotjs'){counts.legacy++;return addon;}
      return load.call(this,name,...args);
    };
    const input=require('./dist/vnc/input-handler');
    const media=require('./dist/vnc/rusty-media');
    const expected=${JSON.stringify(expectations)};
    assert.equal(input.initializeRobot(),expected.ready);
    assert.equal(media.useRustMedia(),expected.rustMedia);
    if(expected.ready && expected.rustMedia)assert.equal(media.loadRustMedia(),addon);
    assert.equal(counts.legacy,expected.legacy);
    assert.equal(counts.rust>0,expected.rustLoaded);
  `;
  const result = spawnSync(process.execPath, ['-e', script], { cwd:path.resolve(__dirname,'..'), env:{...env,...environment}, encoding:'utf8' });
  assert.equal(result.status,0,result.stderr || result.stdout);
}
test('a clean environment uses packaged Rust for both input and media', () => check({}, {ready:true,rustMedia:true,legacy:0,rustLoaded:true}));
test('the original backend requires explicit opt-in and remains selectable independently', () => {
  check({AGENTUM_INPUT_BACKEND:'robotjs'}, {ready:true,rustMedia:false,legacy:1,rustLoaded:false});
  check({AGENTUM_MEDIA_BACKEND:'robotjs'}, {ready:true,rustMedia:false,legacy:0,rustLoaded:true});
  check({AGENTUM_INPUT_BACKEND:'robotjs',AGENTUM_MEDIA_BACKEND:'rusty-robot'}, {ready:true,rustMedia:true,legacy:1,rustLoaded:true});
});
test('a missing default native package never silently loads the legacy backend', () => check({TEST_BROKEN_RUST:'1'}, {ready:false,rustMedia:true,legacy:0,rustLoaded:true}));
