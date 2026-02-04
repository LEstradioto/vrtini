#!/usr/bin/env npx tsx
/**
 * Generate realistic web page test fixtures for compare tests.
 * Run: npx tsx test/generate-test-fixtures.ts
 *
 * Creates desktop-sized pages that simulate real web content:
 * - baseline.png: Clean web page with header, content, footer
 * - modified.png: Subtle changes (text typo, icon color change)
 * - identical.png: Exact copy of baseline
 */

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'test', 'fixtures');
const ENGINE_FIXTURES_DIR = join(FIXTURES_DIR, 'engines');

// Desktop-sized page
const WIDTH = 1280;
const HEIGHT = 2000; // Tall page like a real website

// Engine fixture size (small + deterministic)
const ENGINE_WIDTH = 80;
const ENGINE_HEIGHT = 60;

// Colors
const COLORS = {
  white: [255, 255, 255],
  lightGray: [245, 245, 245],
  darkGray: [51, 51, 51],
  mediumGray: [128, 128, 128],
  headerBg: [30, 41, 59], // Dark slate
  footerBg: [15, 23, 42], // Darker slate
  primary: [99, 102, 241], // Indigo
  primaryAlt: [129, 140, 248], // Lighter indigo (for modified)
  accent: [34, 197, 94], // Green
  accentAlt: [239, 68, 68], // Red (for modified - simulates icon change)
  cardBg: [255, 255, 255],
  cardBorder: [229, 231, 235],
} as const;

function setPixel(png: PNG, x: number, y: number, color: readonly number[]): void {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return;
  const [r, g, b] = color;
  const idx = (png.width * y + x) << 2;
  png.data[idx] = r;
  png.data[idx + 1] = g;
  png.data[idx + 2] = b;
  png.data[idx + 3] = 255;
}

function fillRect(
  png: PNG,
  x: number,
  y: number,
  w: number,
  h: number,
  color: readonly number[]
): void {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      setPixel(png, px, py, color);
    }
  }
}

function drawRoundedRect(
  png: PNG,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  fillColor: readonly number[],
  borderColor?: readonly number[]
): void {
  // Fill main rect
  fillRect(png, x + radius, y, w - 2 * radius, h, fillColor);
  fillRect(png, x, y + radius, w, h - 2 * radius, fillColor);

  // Fill corners (simplified - just fill squares for now)
  fillRect(png, x, y, radius, radius, fillColor);
  fillRect(png, x + w - radius, y, radius, radius, fillColor);
  fillRect(png, x, y + h - radius, radius, radius, fillColor);
  fillRect(png, x + w - radius, y + h - radius, radius, radius, fillColor);

  // Border (top, bottom, left, right lines)
  if (borderColor) {
    for (let px = x; px < x + w; px++) {
      setPixel(png, px, y, borderColor);
      setPixel(png, px, y + h - 1, borderColor);
    }
    for (let py = y; py < y + h; py++) {
      setPixel(png, x, py, borderColor);
      setPixel(png, x + w - 1, py, borderColor);
    }
  }
}

// Simple 5x7 pixel font for uppercase letters and numbers
const FONT: Record<string, number[][]> = {
  A: [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
  ],
  B: [
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 0],
  ],
  C: [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  D: [
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 0],
  ],
  E: [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 1, 1, 1, 1],
  ],
  F: [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
  ],
  G: [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 0],
    [1, 0, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  H: [
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
  ],
  I: [
    [1, 1, 1, 1, 1],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [1, 1, 1, 1, 1],
  ],
  L: [
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 1, 1, 1, 1],
  ],
  M: [
    [1, 0, 0, 0, 1],
    [1, 1, 0, 1, 1],
    [1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
  ],
  N: [
    [1, 0, 0, 0, 1],
    [1, 1, 0, 0, 1],
    [1, 0, 1, 0, 1],
    [1, 0, 0, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
  ],
  O: [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  P: [
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
  ],
  R: [
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 0],
    [1, 0, 1, 0, 0],
    [1, 0, 0, 1, 0],
    [1, 0, 0, 0, 1],
  ],
  S: [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 0],
    [0, 1, 1, 1, 0],
    [0, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  T: [
    [1, 1, 1, 1, 1],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
  ],
  U: [
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  V: [
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 0, 1, 0],
    [0, 1, 0, 1, 0],
    [0, 0, 1, 0, 0],
  ],
  W: [
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 1, 0, 1],
    [1, 0, 1, 0, 1],
    [1, 1, 0, 1, 1],
    [1, 0, 0, 0, 1],
  ],
  X: [
    [1, 0, 0, 0, 1],
    [0, 1, 0, 1, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 1, 0, 1, 0],
    [1, 0, 0, 0, 1],
  ],
  Y: [
    [1, 0, 0, 0, 1],
    [0, 1, 0, 1, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 1, 0, 0],
  ],
  ' ': [
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ],
};

function drawText(
  png: PNG,
  text: string,
  x: number,
  y: number,
  color: readonly number[],
  scale = 2
): void {
  const charWidth = 5 * scale;
  const spacing = 1 * scale;

  let offsetX = 0;
  for (const char of text.toUpperCase()) {
    const glyph = FONT[char];
    if (glyph) {
      for (let gy = 0; gy < 7; gy++) {
        for (let gx = 0; gx < 5; gx++) {
          if (glyph[gy][gx]) {
            // Draw scaled pixel
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                setPixel(png, x + offsetX + gx * scale + sx, y + gy * scale + sy, color);
              }
            }
          }
        }
      }
    }
    offsetX += charWidth + spacing;
  }
}

function drawCircle(
  png: PNG,
  cx: number,
  cy: number,
  radius: number,
  color: readonly number[]
): void {
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if (x * x + y * y <= radius * radius) {
        setPixel(png, cx + x, cy + y, color);
      }
    }
  }
}

function drawIcon(png: PNG, x: number, y: number, size: number, color: readonly number[]): void {
  // Draw a simple "check" icon
  drawCircle(png, x + size / 2, y + size / 2, size / 2, color);
  // Inner check mark (simplified)
  const cx = x + size / 2;
  const cy = y + size / 2;
  for (let i = 0; i < size / 3; i++) {
    setPixel(png, cx - size / 4 + i, cy + i, COLORS.white);
    setPixel(png, cx - size / 4 + i + 1, cy + i, COLORS.white);
  }
  for (let i = 0; i < size / 2; i++) {
    setPixel(png, cx + i, cy + size / 3 - 1 - i, COLORS.white);
    setPixel(png, cx + i + 1, cy + size / 3 - 1 - i, COLORS.white);
  }
}

interface PageOptions {
  headerText?: string;
  heroTitle?: string;
  iconColor?: readonly number[];
  cardTitle?: string;
}

function createWebPage(options: PageOptions = {}): PNG {
  const {
    headerText = 'ACME CORP',
    heroTitle = 'WELCOME TO OUR SITE',
    iconColor = COLORS.accent,
    cardTitle = 'FEATURES',
  } = options;

  const png = new PNG({ width: WIDTH, height: HEIGHT });

  // Background
  fillRect(png, 0, 0, WIDTH, HEIGHT, COLORS.lightGray);

  // Header (64px tall)
  const headerHeight = 64;
  fillRect(png, 0, 0, WIDTH, headerHeight, COLORS.headerBg);
  drawText(png, headerText, 40, 20, COLORS.white, 3);

  // Nav items
  drawText(png, 'HOME', WIDTH - 400, 24, COLORS.white, 2);
  drawText(png, 'ABOUT', WIDTH - 300, 24, COLORS.white, 2);
  drawText(png, 'CONTACT', WIDTH - 180, 24, COLORS.white, 2);

  // Hero section (400px)
  const heroY = headerHeight;
  const heroHeight = 400;
  fillRect(png, 0, heroY, WIDTH, heroHeight, COLORS.primary);
  drawText(png, heroTitle, 100, heroY + 150, COLORS.white, 4);
  drawText(png, 'BUILD SOMETHING AMAZING TODAY', 100, heroY + 220, COLORS.white, 2);

  // CTA Button
  const btnX = 100;
  const btnY = heroY + 280;
  drawRoundedRect(png, btnX, btnY, 200, 50, 8, COLORS.white);
  drawText(png, 'GET STARTED', btnX + 30, btnY + 15, COLORS.primary, 2);

  // Features section
  const featuresY = heroY + heroHeight + 60;
  drawText(png, cardTitle, WIDTH / 2 - 60, featuresY, COLORS.darkGray, 3);

  // Feature cards (3 cards)
  const cardWidth = 350;
  const cardHeight = 250;
  const cardGap = 40;
  const cardsStartX = (WIDTH - 3 * cardWidth - 2 * cardGap) / 2;
  const cardsY = featuresY + 80;

  for (let i = 0; i < 3; i++) {
    const cardX = cardsStartX + i * (cardWidth + cardGap);

    // Card background with border
    drawRoundedRect(png, cardX, cardsY, cardWidth, cardHeight, 8, COLORS.cardBg, COLORS.cardBorder);

    // Icon
    drawIcon(png, cardX + cardWidth / 2 - 25, cardsY + 30, 50, iconColor);

    // Card title
    const titles = ['FAST', 'SECURE', 'RELIABLE'];
    drawText(png, titles[i], cardX + cardWidth / 2 - 30, cardsY + 110, COLORS.darkGray, 2);

    // Card description (gray bars to simulate text)
    for (let line = 0; line < 3; line++) {
      const lineWidth = 200 + (line % 2) * 50;
      fillRect(
        png,
        cardX + (cardWidth - lineWidth) / 2,
        cardsY + 150 + line * 20,
        lineWidth,
        10,
        COLORS.mediumGray
      );
    }
  }

  // Content section
  const contentY = cardsY + cardHeight + 100;
  drawText(png, 'ABOUT US', 100, contentY, COLORS.darkGray, 3);

  // Paragraph lines (simulated with gray bars)
  for (let line = 0; line < 8; line++) {
    const lineWidth = 800 + (line % 3) * 100;
    fillRect(png, 100, contentY + 60 + line * 25, lineWidth, 12, COLORS.mediumGray);
  }

  // Second content block
  const content2Y = contentY + 320;
  drawText(png, 'OUR MISSION', 100, content2Y, COLORS.darkGray, 3);

  for (let line = 0; line < 6; line++) {
    const lineWidth = 750 + (line % 4) * 80;
    fillRect(png, 100, content2Y + 60 + line * 25, lineWidth, 12, COLORS.mediumGray);
  }

  // Footer (100px tall)
  const footerY = HEIGHT - 100;
  fillRect(png, 0, footerY, WIDTH, 100, COLORS.footerBg);
  drawText(png, 'COPYRIGHT ACME CORP', WIDTH / 2 - 120, footerY + 40, COLORS.mediumGray, 2);

  return png;
}

type EngineVariant = 'baseline' | 'modified';

function createEngineFixture(variant: EngineVariant): PNG {
  const png = new PNG({ width: ENGINE_WIDTH, height: ENGINE_HEIGHT });

  fillRect(png, 0, 0, ENGINE_WIDTH, ENGINE_HEIGHT, COLORS.white);

  const squareX = variant === 'modified' ? 36 : 10;
  const squareColor = variant === 'modified' ? COLORS.primaryAlt : COLORS.primary;
  const dotColor = variant === 'modified' ? COLORS.accentAlt : COLORS.accent;
  const barColor = variant === 'modified' ? COLORS.darkGray : COLORS.mediumGray;

  fillRect(png, squareX, 10, 18, 18, squareColor);
  drawCircle(png, 62, 18, 6, dotColor);
  fillRect(png, 10, 42, 50, 10, barColor);

  return png;
}

function main() {
  const baselinePath = join(FIXTURES_DIR, 'baseline.png');
  const modifiedPath = join(FIXTURES_DIR, 'modified.png');
  const identicalPath = join(FIXTURES_DIR, 'identical.png');

  console.log('Generating realistic web page test fixtures...\n');
  console.log(`Image size: ${WIDTH}x${HEIGHT} (desktop web page)\n`);

  // Step 1: Create baseline image
  console.log('Step 1: Creating baseline image...');
  const baseline = createWebPage();
  writeFileSync(baselinePath, PNG.sync.write(baseline));
  console.log(`Created: ${baselinePath}`);

  // Step 2: Create modified version with subtle changes
  console.log('\nStep 2: Creating modified version with subtle changes...');
  console.log('  - Changed header text: "ACME CORP" -> "ACME CDRP" (typo)');
  console.log('  - Changed icon color: green -> red');
  console.log('  - Changed card title: "FEATURES" -> "FEATVRES" (typo)');

  const modified = createWebPage({
    headerText: 'ACME CDRP', // Typo: O -> D
    iconColor: COLORS.accentAlt, // Green -> Red
    cardTitle: 'FEATVRES', // Typo: U -> V
  });
  writeFileSync(modifiedPath, PNG.sync.write(modified));
  console.log(`Created: ${modifiedPath}`);

  // Step 3: Copy baseline as identical
  console.log('\nStep 3: Creating identical copy...');
  copyFileSync(baselinePath, identicalPath);
  console.log(`Created: ${identicalPath}`);

  // Step 4: Create small engine fixtures
  console.log('\nStep 4: Creating engine fixtures...');
  mkdirSync(ENGINE_FIXTURES_DIR, { recursive: true });
  const engineBaselinePath = join(ENGINE_FIXTURES_DIR, 'baseline.png');
  const engineModifiedPath = join(ENGINE_FIXTURES_DIR, 'modified.png');
  const engineIdenticalPath = join(ENGINE_FIXTURES_DIR, 'identical.png');

  const engineBaseline = createEngineFixture('baseline');
  writeFileSync(engineBaselinePath, PNG.sync.write(engineBaseline));
  console.log(`Created: ${engineBaselinePath}`);

  const engineModified = createEngineFixture('modified');
  writeFileSync(engineModifiedPath, PNG.sync.write(engineModified));
  console.log(`Created: ${engineModifiedPath}`);

  copyFileSync(engineBaselinePath, engineIdenticalPath);
  console.log(`Created: ${engineIdenticalPath}`);

  console.log('\n' + '='.repeat(60));
  console.log('Done! Test fixtures generated in test/fixtures/');
  console.log('='.repeat(60));
  console.log(`\n  baseline.png  - Clean web page (${WIDTH}x${HEIGHT})`);
  console.log(`  modified.png  - Subtle text typos + icon color change`);
  console.log(`  identical.png - Exact copy of baseline\n`);
  console.log(`  engines/baseline.png  - Small engine baseline (${ENGINE_WIDTH}x${ENGINE_HEIGHT})`);
  console.log('  engines/modified.png  - Position + color changes');
  console.log('  engines/identical.png - Exact copy of engine baseline\n');
}

main();
