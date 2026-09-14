import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { privateDir, getAuthToken } from './auth';

export interface InstanceIdentity { id: string; name: string }
export function getInstanceIdentity(port: number, name?: string, directory = privateDir): InstanceIdentity {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid instance port');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `instance-${port}`);
  try { fs.writeFileSync(file, randomUUID(), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('Instance identity must be an owner-only regular file');
  const id = fs.readFileSync(file, 'utf8').trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid saved instance identity');
  const nameFile = path.join(directory, `instance-${port}-name`);
  let savedName: string | undefined;
  try {
    if (!fs.lstatSync(nameFile).isFile()) throw new Error('Instance name must be a regular file');
    savedName = fs.readFileSync(nameFile, 'utf8');
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const displayName = (name ?? savedName ?? `${os.hostname()} · ${port}`).trim();
  if (!displayName || displayName.length > 80 || /[\u0000-\u001f\u007f]/.test(displayName)) throw new Error('Instance name must contain 1–80 printable characters');
  if (name !== undefined) fs.writeFileSync(nameFile, displayName, { mode: 0o600 });
  return { id, name: displayName };
}

export function connectionAddresses(bindHost: string): string[] {
  if (!['0.0.0.0', '::'].includes(bindHost)) return [bindHost];
  return Object.values(os.networkInterfaces()).flatMap(list => list ?? [])
    .filter(item => !item.internal && item.family === 'IPv4')
    .map(item => item.address)
    .filter(host => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(host));
}

export function pairingPayload(host: string, port: number, vncPort: number | undefined, instance: InstanceIdentity, tls = false) {
  if (!host || /[\s/?#@]/.test(host) || ['0.0.0.0', '::', 'localhost', '::1'].includes(host) || host.startsWith('127.')) throw new Error('Use this computer’s Wi-Fi or Tailscale address for phone pairing');
  if (!Number.isInteger(port) || port < 1 || port > 65535 || (vncPort !== undefined && (!Number.isInteger(vncPort) || vncPort < 1 || vncPort > 65535))) throw new Error('Pairing ports must be between 1 and 65535');
  return { type: 'agentum-pairing', version: 1, host, port, ...(vncPort === undefined ? {} : { vncPort }), tls,
    token: getAuthToken(), instanceId: instance.id, instanceName: instance.name };
}

export function capabilities(instance: InstanceIdentity, vncPort?: number) {
  return { type: 'server_capabilities', protocolVersion: 1, instanceId: instance.id, instanceName: instance.name, vncPort,
    features: { agents: ['claude', 'copilot', 'codex'], pty: true, vnc: vncPort !== undefined,
      vncSharedPort: false, vncPort, vncStreamControl: true, vncTextInput: true,
      vncScroll: true, vncRightClick: true, vncMouseButtons: true, vncInputReset: true } };
}
