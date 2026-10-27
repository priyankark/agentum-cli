import { loadRustMedia, useRustMedia } from '../vnc/rusty-media';
/**
 * Platform-agnostic screenshot service
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface ScreenshotOptions {
  outputDir?: string;
  format?: 'jpg' | 'png';
  filename?: string;
}

export interface ScreenshotResult {
  filePath: string;
  timestamp: number;
}

/**
 * Capture a screenshot using platform-specific methods
 */
export async function captureScreenshot(options?: ScreenshotOptions): Promise<ScreenshotResult> {
  const platform = process.platform;
  const outputDir = options?.outputDir || '/tmp';
  const format = options?.format || 'jpg';
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..+/, '');
  const filename = options?.filename || `screenshot_${timestamp}.${format}`;
  if (path.basename(filename) !== filename || !['jpg', 'png'].includes(format)) throw new Error('Invalid screenshot filename or format');
  const filePath = path.resolve(outputDir, filename);

  // Ensure output directory exists
  try {
    fs.mkdirSync(outputDir, { recursive: true });
  } catch {
    // Directory may already exist
  }

  if (useRustMedia()) {
    const frame = await loadRustMedia().captureFrame(null, 85, null, true, format);
    if (!frame.data) throw new Error('Rust capture returned no screenshot');
    await fs.promises.writeFile(filePath, frame.data, { mode: 0o600 });
  } else if (platform === 'darwin') {
    // macOS: use screencapture (no permission prompts after initial grant)
    execFileSync('screencapture', ['-x', '-t', format, filePath], { stdio: 'ignore' });
  } else if (platform === 'linux') {
    // Linux: try scrot first, fall back to import (ImageMagick)
    try {
      execFileSync('scrot', [filePath], { stdio: 'ignore' });
    } catch {
      execFileSync('import', ['-window', 'root', filePath], { stdio: 'ignore' });
    }
  } else if (platform === 'win32') {
    // Windows: use screenshot-desktop package
    const screenshot = require('screenshot-desktop');
    const buffer = await screenshot();
    fs.writeFileSync(filePath, buffer);
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  return { filePath, timestamp: Date.now() };
}
