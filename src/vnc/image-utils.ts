/**
 * Image processing utilities for VNC screen capture
 * Uses Jimp for JPEG encoding and image manipulation
 */

import { Jimp } from 'jimp';

/**
 * Create a Jimp instance from a buffer
 */
export async function createImage(input: Buffer): Promise<ReturnType<typeof Jimp.read>> {
  return await Jimp.read(input);
}

/**
 * Resize an image and return as JPEG buffer
 * Preserves aspect ratio if no height is provided
 */
export async function resizeImage(
  input: Buffer,
  width: number,
  height?: number
): Promise<Buffer> {
  const image = await createImage(input);

  if (!height) {
    image.resize({ w: width });
  } else {
    image.resize({ w: width, h: height });
  }

  return await image.getBuffer('image/jpeg');
}

/**
 * Encode image as JPEG with configurable quality settings
 */
export async function encodeJpeg(
  image: Awaited<ReturnType<typeof Jimp.read>>,
  quality: number
): Promise<Buffer> {
  return await image.getBuffer('image/jpeg', {
    quality,
  });
}

export default {
  createImage,
  resizeImage,
  encodeJpeg,
};
