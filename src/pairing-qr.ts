import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Save a font-independent QR image without exposing the pairing key to other users. */
export async function createPairingImage(payload: string): Promise<string> {
  const qr = require('qrcode');
  const png: Buffer = await qr.toBuffer(payload, {
    type: 'png', scale: 12, margin: 4,
    color: { dark: '#000000', light: '#ffffff' },
  });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentum-pairing-'));
  try {
    fs.chmodSync(directory, 0o700);
    const file = path.join(directory, 'pairing.png');
    fs.writeFileSync(file, png, { mode: 0o600, flag: 'wx' });
    return file;
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function openPairingImage(file: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', file] : [file];
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 10000 }, error => error ? reject(error) : resolve());
  });
}
