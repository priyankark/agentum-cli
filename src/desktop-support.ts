import * as os from 'os';

export const WSL_DESKTOP_GUIDANCE = 'Agentum is running inside WSL. Desktop capture cannot show the Windows desktop from WSL/WSLg. Run Agentum in Windows PowerShell on the Windows computer or VM that owns the desktop. You can still run WSL commands in a terminal session started with wsl.exe.';

/** WSLg exports individual Linux app surfaces, not the host Windows desktop. */
export function desktopUnavailableReason(
  platform: NodeJS.Platform = process.platform,
  release: string = os.release(),
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (platform === 'linux' && (/microsoft|wsl/i.test(release) || !!environment.WSL_DISTRO_NAME || !!environment.WSL_INTEROP)) return WSL_DESKTOP_GUIDANCE;
  return undefined;
}
