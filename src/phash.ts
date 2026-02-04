import { readFileSync } from 'fs';
import { PNG } from 'pngjs';

/**
 * Perceptual hash implementation using difference hash (dHash) algorithm.
 * This is faster than pHash while still being robust to minor changes.
 *
 * dHash works by:
 * 1. Converting image to grayscale
 * 2. Resizing to 9x8 (to get 8x8 gradient comparisons)
 * 3. Computing horizontal gradient (is left pixel brighter than right?)
 * 4. Producing a 64-bit hash
 */

const HASH_SIZE = 8;
const RESIZE_WIDTH = HASH_SIZE + 1;
const RESIZE_HEIGHT = HASH_SIZE;
const HASH_BITS = HASH_SIZE * HASH_SIZE;

function binaryToHex(binary: string): string {
  let hex = '';
  for (let i = 0; i < binary.length; i += 4) {
    const nibble = binary.slice(i, i + 4);
    hex += parseInt(nibble, 2).toString(16);
  }
  return hex;
}

/**
 * Simple bilinear resize of grayscale image data
 */
function resizeGrayscale(
  data: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): Uint8Array {
  const result = new Uint8Array(dstWidth * dstHeight);

  for (let y = 0; y < dstHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      const srcX = (x * (srcWidth - 1)) / (dstWidth - 1);
      const srcY = (y * (srcHeight - 1)) / (dstHeight - 1);

      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, srcWidth - 1);
      const y1 = Math.min(y0 + 1, srcHeight - 1);

      const xFrac = srcX - x0;
      const yFrac = srcY - y0;

      const v00 = data[y0 * srcWidth + x0];
      const v10 = data[y0 * srcWidth + x1];
      const v01 = data[y1 * srcWidth + x0];
      const v11 = data[y1 * srcWidth + x1];

      const value =
        v00 * (1 - xFrac) * (1 - yFrac) +
        v10 * xFrac * (1 - yFrac) +
        v01 * (1 - xFrac) * yFrac +
        v11 * xFrac * yFrac;

      result[y * dstWidth + x] = Math.round(value);
    }
  }

  return result;
}

/**
 * Convert RGBA image data to grayscale
 */
function toGrayscale(data: Buffer, width: number, height: number): Uint8Array {
  const result = new Uint8Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    // Standard grayscale conversion weights
    result[i] = Math.round(data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114);
  }

  return result;
}

/**
 * Compute difference hash (dHash) for an image
 * Returns a 64-character hex string
 */
export function computeDHash(imagePath: string): string {
  const pngData = readFileSync(imagePath);
  const png = PNG.sync.read(pngData);

  // Convert to grayscale
  const grayscale = toGrayscale(png.data, png.width, png.height);

  // Resize to 9x8
  const resized = resizeGrayscale(grayscale, png.width, png.height, RESIZE_WIDTH, RESIZE_HEIGHT);

  // Compute gradient hash
  let hash = '';
  for (let y = 0; y < RESIZE_HEIGHT; y++) {
    for (let x = 0; x < RESIZE_WIDTH - 1; x++) {
      const left = resized[y * RESIZE_WIDTH + x];
      const right = resized[y * RESIZE_WIDTH + x + 1];
      hash += left < right ? '1' : '0';
    }
  }

  // Convert binary to hex
  return binaryToHex(hash);
}

/**
 * Compute average hash (aHash) - even simpler but less robust
 * Returns a 64-character hex string
 */
export function computeAHash(imagePath: string): string {
  const pngData = readFileSync(imagePath);
  const png = PNG.sync.read(pngData);

  // Convert to grayscale
  const grayscale = toGrayscale(png.data, png.width, png.height);

  // Resize to 8x8
  const resized = resizeGrayscale(grayscale, png.width, png.height, HASH_SIZE, HASH_SIZE);

  // Compute average
  let sum = 0;
  for (const pixel of resized) {
    sum += pixel;
  }
  const avg = sum / resized.length;

  // Generate hash based on whether pixel is above/below average
  let hash = '';
  for (const pixel of resized) {
    hash += pixel >= avg ? '1' : '0';
  }

  // Convert binary to hex
  return binaryToHex(hash);
}

/**
 * Compute Hamming distance between two hex hashes
 * Returns number of differing bits (0 = identical, 64 = completely different)
 */
export function hammingDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) {
    throw new Error('Hashes must be the same length');
  }

  let distance = 0;

  for (let i = 0; i < hash1.length; i++) {
    const b1 = parseInt(hash1[i], 16);
    const b2 = parseInt(hash2[i], 16);
    const xor = b1 ^ b2;

    // Count bits in xor
    let bits = xor;
    while (bits > 0) {
      distance += bits & 1;
      bits >>= 1;
    }
  }

  return distance;
}

/**
 * Compute similarity between two images using dHash
 * Returns a value between 0 (completely different) and 1 (identical)
 */
export function computeHashSimilarity(
  imagePath1: string,
  imagePath2: string
): {
  hash1: string;
  hash2: string;
  hammingDistance: number;
  similarity: number;
} {
  const hash1 = computeDHash(imagePath1);
  const hash2 = computeDHash(imagePath2);
  const distance = hammingDistance(hash1, hash2);

  const similarity = 1 - distance / HASH_BITS;

  return {
    hash1,
    hash2,
    hammingDistance: distance,
    similarity,
  };
}

export interface PerceptualHashResult {
  baselineHash: string;
  testHash: string;
  hammingDistance: number;
  similarity: number;
}

/**
 * Compare two images using perceptual hashing
 * Returns similarity metrics
 */
export function comparePerceptualHash(
  baselinePath: string,
  testPath: string
): PerceptualHashResult {
  const result = computeHashSimilarity(baselinePath, testPath);

  return {
    baselineHash: result.hash1,
    testHash: result.hash2,
    hammingDistance: result.hammingDistance,
    similarity: result.similarity,
  };
}
