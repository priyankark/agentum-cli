// Opt-in: captures the local desktop; reports timings without saving screen content.
const { performance } = require('node:perf_hooks');
const { capturePrimaryScreen, nativeResizeJpeg } = require('../dist/vnc/native-capture');
const screenshot = require('screenshot-desktop');
const { Jimp } = require('jimp');
if (process.platform !== 'darwin') throw Error('This comparison requires macOS');
(async () => {
  for (const native of [false, true]) {
    const samples = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const raw = native ? await capturePrimaryScreen() : await screenshot();
      const captured = performance.now();
      let jpeg;
      if (native) jpeg = await nativeResizeJpeg(raw, { width: 1440, height: 900 }, 85);
      else {
        const image = await Jimp.read(raw);
        image.resize({ w: 1440, h: 900 });
        jpeg = await image.getBuffer('image/jpeg', { quality: 85 });
      }
      samples.push({ captureMs: captured-start, totalMs: performance.now()-start, bytes: jpeg.length });
    }
    const sorted = samples.map(s => s.totalMs).sort((a,b) => a-b);
    console.log(JSON.stringify({ path: native ? 'macOS native' : 'screenshot-desktop + Jimp',
      dimensions: { width: 1440, height: 900 }, jpegQuality: 85, samples,
      medianMs: (sorted[4]+sorted[5])/2, maxMs: sorted[9] }));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
