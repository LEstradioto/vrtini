/**
 * Image utilities for AI provider adapters.
 */

import { readFile } from 'fs/promises';
import { PNG } from 'pngjs';

const MAX_IMAGE_DIMENSION = 7500;

/**
 * Resize PNG image if it exceeds max dimensions.
 * Uses bilinear interpolation.
 */
export function resizeImageIfNeeded(buffer: Buffer): Buffer {
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;

  if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
    return buffer;
  }

  const scale = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);

  const newWidth = Math.floor(width * scale);
  const newHeight = Math.floor(height * scale);

  const resized = new PNG({ width: newWidth, height: newHeight });

  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const srcX = (x / newWidth) * width;
      const srcY = (y / newHeight) * height;

      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, width - 1);
      const y1 = Math.min(y0 + 1, height - 1);

      const xFrac = srcX - x0;
      const yFrac = srcY - y0;

      const dstIdx = (newWidth * y + x) << 2;

      for (let c = 0; c < 4; c++) {
        const v00 = data[((width * y0 + x0) << 2) + c];
        const v10 = data[((width * y0 + x1) << 2) + c];
        const v01 = data[((width * y1 + x0) << 2) + c];
        const v11 = data[((width * y1 + x1) << 2) + c];

        const value =
          v00 * (1 - xFrac) * (1 - yFrac) +
          v10 * xFrac * (1 - yFrac) +
          v01 * (1 - xFrac) * yFrac +
          v11 * xFrac * yFrac;

        resized.data[dstIdx + c] = Math.round(value);
      }
    }
  }

  return PNG.sync.write(resized);
}

export async function imageToBase64(imagePath: string): Promise<string> {
  const buffer = await readFile(imagePath);
  const resizedBuffer = resizeImageIfNeeded(buffer);
  return resizedBuffer.toString('base64');
}
