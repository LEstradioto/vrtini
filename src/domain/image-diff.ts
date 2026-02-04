/**
 * Pure image comparison functions (no I/O).
 */

export type RGBA = [number, number, number, number];

export const GRAY_FILL: RGBA = [128, 128, 128, 255];

/**
 * Parse hex color string to RGB tuple.
 * @example parseHexColor('#ff00ff') // [255, 0, 255]
 */
export function parseHexColor(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

/**
 * Calculate diff percentage from pixel counts.
 */
export function calculateDiffPercentage(diffPixels: number, totalPixels: number): number {
  if (totalPixels === 0) return 0;
  return (diffPixels / totalPixels) * 100;
}

/**
 * Compute target dimensions for comparing images of different sizes.
 */
export function computeTargetDimensions(
  img1Width: number,
  img1Height: number,
  img2Width: number,
  img2Height: number
): { width: number; height: number; sizeMismatch: boolean } {
  const sizeMismatch = img1Width !== img2Width || img1Height !== img2Height;
  return {
    width: Math.max(img1Width, img2Width),
    height: Math.max(img1Height, img2Height),
    sizeMismatch,
  };
}

/**
 * Pad RGBA image data to target size.
 * Works with raw Buffer where each pixel is 4 consecutive bytes (RGBA).
 */
export function padImageData(
  srcData: Buffer,
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number,
  fillColor: RGBA = GRAY_FILL
): Buffer {
  if (srcWidth === targetWidth && srcHeight === targetHeight) {
    return srcData;
  }

  const result = Buffer.alloc(targetWidth * targetHeight * 4);
  const [fillR, fillG, fillB, fillA] = fillColor;

  // Fill with background color
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const idx = (targetWidth * y + x) << 2;
      result[idx] = fillR;
      result[idx + 1] = fillG;
      result[idx + 2] = fillB;
      result[idx + 3] = fillA;
    }
  }

  // Copy source data
  for (let y = 0; y < srcHeight; y++) {
    for (let x = 0; x < srcWidth; x++) {
      const srcIdx = (srcWidth * y + x) << 2;
      const dstIdx = (targetWidth * y + x) << 2;
      result[dstIdx] = srcData[srcIdx];
      result[dstIdx + 1] = srcData[srcIdx + 1];
      result[dstIdx + 2] = srcData[srcIdx + 2];
      result[dstIdx + 3] = srcData[srcIdx + 3];
    }
  }

  return result;
}

/**
 * Crop RGBA image data to target size (top-left).
 */
export function cropImageData(
  srcData: Buffer,
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number
): Buffer {
  if (srcWidth === targetWidth && srcHeight === targetHeight) {
    return srcData;
  }

  const result = Buffer.alloc(targetWidth * targetHeight * 4);

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const srcIdx = (srcWidth * y + x) << 2;
      const dstIdx = (targetWidth * y + x) << 2;
      result[dstIdx] = srcData[srcIdx];
      result[dstIdx + 1] = srcData[srcIdx + 1];
      result[dstIdx + 2] = srcData[srcIdx + 2];
      result[dstIdx + 3] = srcData[srcIdx + 3];
    }
  }

  return result;
}

/**
 * Resize RGBA image data to target size (nearest-neighbor).
 */
export function resizeImageData(
  srcData: Buffer,
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number
): Buffer {
  if (srcWidth === targetWidth && srcHeight === targetHeight) {
    return srcData;
  }

  const result = Buffer.alloc(targetWidth * targetHeight * 4);
  const xRatio = srcWidth / targetWidth;
  const yRatio = srcHeight / targetHeight;

  for (let y = 0; y < targetHeight; y++) {
    const srcY = Math.min(srcHeight - 1, Math.floor(y * yRatio));
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.min(srcWidth - 1, Math.floor(x * xRatio));
      const srcIdx = (srcWidth * srcY + srcX) << 2;
      const dstIdx = (targetWidth * y + x) << 2;
      result[dstIdx] = srcData[srcIdx];
      result[dstIdx + 1] = srcData[srcIdx + 1];
      result[dstIdx + 2] = srcData[srcIdx + 2];
      result[dstIdx + 3] = srcData[srcIdx + 3];
    }
  }

  return result;
}

/**
 * Determine if images match based on diff result.
 */
export function determineMatch(diffPixels: number, sizeMismatch: boolean): boolean {
  return diffPixels === 0 && !sizeMismatch;
}

/**
 * Build size mismatch error message.
 */
export function buildSizeMismatchError(
  img1Width: number,
  img1Height: number,
  img2Width: number,
  img2Height: number
): string {
  return `Size mismatch: ${img1Width}x${img1Height} vs ${img2Width}x${img2Height}`;
}
