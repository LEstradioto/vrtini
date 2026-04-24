/**
 * Image utilities for AI provider adapters.
 */

import { readFile } from 'fs/promises';
import { PNG } from 'pngjs';
import { resizeRGBABilinear } from '../core/image-resize.js';

const MAX_IMAGE_DIMENSION = 7500;

/**
 * Resize PNG image if it exceeds max dimensions (bilinear).
 */
function resizeImageIfNeeded(buffer: Buffer): Buffer {
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;

  if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
    return buffer;
  }

  const scale = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
  const newWidth = Math.floor(width * scale);
  const newHeight = Math.floor(height * scale);

  const resized = new PNG({ width: newWidth, height: newHeight });
  resized.data = resizeRGBABilinear(data, width, height, newWidth, newHeight);

  return PNG.sync.write(resized);
}

export async function imageToBase64(imagePath: string): Promise<string> {
  const buffer = await readFile(imagePath);
  const resizedBuffer = resizeImageIfNeeded(buffer);
  return resizedBuffer.toString('base64');
}
