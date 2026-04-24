/**
 * Bilinear RGBA image resize used by SSIM preprocessing and AI-provider downscaling.
 * Pure — no I/O. Operates on raw RGBA buffers so callers can wrap in PNG or
 * other containers as needed.
 */

export function resizeRGBABilinear(
  srcData: Buffer,
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number
): Buffer {
  if (srcWidth === targetWidth && srcHeight === targetHeight) return srcData;

  const out = Buffer.alloc(targetWidth * targetHeight * 4);

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const srcX = (x / targetWidth) * srcWidth;
      const srcY = (y / targetHeight) * srcHeight;

      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, srcWidth - 1);
      const y1 = Math.min(y0 + 1, srcHeight - 1);

      const xFrac = srcX - x0;
      const yFrac = srcY - y0;

      const dstIdx = (targetWidth * y + x) << 2;

      for (let c = 0; c < 4; c++) {
        const v00 = srcData[((srcWidth * y0 + x0) << 2) + c];
        const v10 = srcData[((srcWidth * y0 + x1) << 2) + c];
        const v01 = srcData[((srcWidth * y1 + x0) << 2) + c];
        const v11 = srcData[((srcWidth * y1 + x1) << 2) + c];

        out[dstIdx + c] = Math.round(
          v00 * (1 - xFrac) * (1 - yFrac) +
            v10 * xFrac * (1 - yFrac) +
            v01 * (1 - xFrac) * yFrac +
            v11 * xFrac * yFrac
        );
      }
    }
  }

  return out;
}
