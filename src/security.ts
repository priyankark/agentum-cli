import { timingSafeEqual } from 'crypto';
import type { IncomingMessage } from 'http';

export const MAX_PAYLOAD = 8 * 1024 * 1024;

/** Authenticate before registering handlers, exposing sessions or capturing the screen. */
export function authorized(request: IncomingMessage, token: string): boolean {
  // Android adds Origin automatically; the app supplies an explicit native marker.
  // This is not a credential: every accepted client must also present the token.
  const origin = request.headers.origin;
  if ((origin !== undefined && origin !== 'aircodum://native') || token.length < 32) return false;
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Bound work per client, including binary uploads. */
export function messageBudget() {
  let start = Date.now(), count = 0, bytes = 0;
  return (size: number) => {
    const now = Date.now();
    if (now - start >= 1000) { start = now; count = 0; bytes = 0; }
    return ++count <= 240 && (bytes += size) <= MAX_PAYLOAD;
  };
}

export function validMouse(data: any): boolean {
  return data && ['down', 'up', 'move'].includes(data.eventType) &&
    (data.button === undefined || ['left', 'right', 'middle'].includes(data.button)) &&
    [data.x, data.y, data.screenWidth, data.screenHeight].every(Number.isFinite) &&
    data.screenWidth > 0 && data.screenHeight > 0 && data.x >= 0 && data.y >= 0 &&
    data.x <= data.screenWidth && data.y <= data.screenHeight;
}

export function validScroll(data: any): boolean {
  return validMouse({ ...data, eventType: 'move' }) &&
    [data.deltaX, data.deltaY].every(value => Number.isInteger(value) && Math.abs(value) <= 120) &&
    (data.deltaX !== 0 || data.deltaY !== 0);
}

export function validKey(data: any): boolean {
  const keys = /^(?:[a-z0-9]|f[1-9]|f1[0-2]|backspace|delete|enter|return|tab|escape|space|left|right|up|down|home|end|pageup|pagedown|insert)$/;
  const modifiers = data?.modifier === undefined ? [] :
    Array.isArray(data.modifier) ? data.modifier : [data.modifier];
  return typeof data?.key === 'string' && keys.test(data.key) && modifiers.length <= 4 &&
    modifiers.every((m: unknown) => typeof m === 'string' && ['command', 'control', 'alt', 'shift'].includes(m));
}

/** Bind only local/private interfaces. Remote Internet access uses a TLS proxy. */
export function protectedBind(host: string): boolean {
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0' || host === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(host) && require('net').isIP(host) === 6) return true;
  const octets = host.split('.').map(Number);
  return require('net').isIP(host) === 4 && (octets[0] === 127 || octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127));
}
