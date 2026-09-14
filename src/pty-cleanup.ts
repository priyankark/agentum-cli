import type { IPty } from 'node-pty';

/**
 * node-pty 1.1 closes ConPTY output after natural exit but retains its reader
 * worker and input pipe. Release only those resources after onExit has fired.
 * Calling kill() here could target an exited/reused PID via its console helper.
 */
export function releaseExitedPty(terminal: IPty, platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'win32') return;
  const agent = (terminal as unknown as { _agent?: {
    inSocket?: { destroy(): void };
    _conoutSocketWorker?: { dispose(): void };
  } })._agent;
  // Cleanup must not suppress session completion or prevent the other resource
  // from being released if one operation fails during concurrent shutdown.
  try { agent?._conoutSocketWorker?.dispose(); } catch {}
  try { agent?.inSocket?.destroy(); } catch {}
}
