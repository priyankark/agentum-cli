import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
export const privateDir = path.join(os.homedir(), '.agentum');
export function getAuthToken(): string {
  const configured = process.env.AGENTUM_AUTH_TOKEN;
  if (configured !== undefined) {
    if (!/^[a-zA-Z0-9_-]{32,256}$/.test(configured)) throw new Error('AGENTUM_AUTH_TOKEN must contain 32–256 letters, digits, underscores or hyphens.');
    return configured;
  }
  fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  const file = path.join(privateDir, 'pairing-token');
  try { fs.writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('Pairing token must be a regular file accessible only to its owner (chmod 600).');
  const token = fs.readFileSync(file, 'utf8').trim();
  if (!/^[a-zA-Z0-9_-]{32,256}$/.test(token)) throw new Error('Invalid pairing token file.');
  return token;
}
export function authHeaders() { return { Authorization: `Bearer ${getAuthToken()}` }; }
