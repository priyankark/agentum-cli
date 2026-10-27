// Owned observation window. No JavaScript synthesizes mouse or keyboard input.
const { app, BrowserWindow } = require('electron');
const { createConnection } = require('node:net');
const { createInterface } = require('node:readline');
const { join } = require('node:path');
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ x: 100, y: 100, width: 700, height: 500,
    frame: false, alwaysOnTop: true, webPreferences: { backgroundThrottling: false } });
  await window.loadFile(join(__dirname, 'target.html'));
  window.show(); window.focus(); window.webContents.focus();
  const bounds = window.getContentBounds();
  const elements = await window.webContents.executeJavaScript(`Object.fromEntries(['editor','button'].map(id => {const r=document.getElementById(id).getBoundingClientRect();return [id,{x:r.x,y:r.y,width:r.width,height:r.height}]}))`);
  for (const rect of Object.values(elements)) { rect.x += bounds.x; rect.y += bounds.y; }
  send({ ready: true, window: bounds, ...elements });
  const connection = createConnection({ host: '127.0.0.1', port: Number(process.env.AGENTUM_FIXTURE_PORT) });
  connection.on('end', () => app.quit());
  connection.on('error', error => { send({ error: String(error) }); app.quit(); });
  createInterface({ input: connection }).on('line', async () => {
    const state = await window.webContents.executeJavaScript(`({text:editor.value,clicks:window.clicks,selectionLength:editor.selectionEnd-editor.selectionStart})`);
    send({ ...state, active: window.isFocused() });
  });
});
app.on('window-all-closed', () => app.quit());
