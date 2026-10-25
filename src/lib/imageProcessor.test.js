import test from 'node:test';
import assert from 'node:assert/strict';
import { createInkMask, detectAccentDivider, drawTimestamp, estimateTextMetrics, expandDetectedStampRegion, fallbackForCorner, inpaintInk, parseHexColor, scanCornerText } from './imageProcessor.js';

function imageData(width, height, color = [35, 48, 58, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data.set(color, pixel * 4);
  }
  return { data, width, height };
}

test('corner fallback keeps the requested overlay box inside the image', () => {
  const box = fallbackForCorner('top-left', 0.4, 0.25);
  assert.equal(box.x, 0.045);
  assert.equal(box.y, 0.045);
  assert.ok(box.x + box.w < 1);
  assert.ok(box.y + box.h < 1);
});

test('narrow bottom-corner scan boxes expand to cover a multi-line stamp without spanning the full photo', () => {
  const scanned = { x: 0.0134, y: 0.8943, w: 0.4466, h: 0.1057, corner: 'bottom-left' };
  const expanded = expandDetectedStampRegion(scanned, 'bottom-left');
  assert.equal(expanded.x, 0);
  assert.equal(expanded.w, 0.76);
  assert.ok(expanded.y < 0.83);
  assert.ok(Math.abs(expanded.y + expanded.h - 1) < 0.001);
  assert.ok(expanded.x + expanded.w < 0.8);
  assert.equal(expandDetectedStampRegion(scanned, 'top-left'), scanned);
});

test('hex colors are parsed for ink sampling', () => {
  assert.deepEqual(parseHexColor('#fff'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseHexColor('#198d6b'), { r: 25, g: 141, b: 107 });
});

test('style estimation approximates size and alignment from repeated ink rows', () => {
  const source = imageData(120, 64);
  for (const yStart of [12, 27, 42]) {
    for (let y = yStart; y < yStart + 5; y += 1) {
      for (let x = 10; x < 72; x += 1) {
        source.data.set([250, 250, 250, 255], (y * source.width + x) * 4);
      }
    }
  }
  const metrics = estimateTextMetrics(source, { r: 255, g: 255, b: 255 });
  assert.ok(metrics);
  assert.equal(metrics.lineCount, 3);
  assert.equal(metrics.align, 'left');
  assert.ok(metrics.fontPixels > 0);
  assert.ok(metrics.lineHeight >= 1 && metrics.lineHeight <= 1.5);
});

test('corner scanner returns a normalized suggestion for valid image data', () => {
  const source = imageData(120, 90);
  // Add three compact, high-contrast text-like rows in the lower-right zone.
  for (let line = 0; line < 3; line += 1) {
    for (let y = 64 + line * 8; y < 68 + line * 8; y += 1) {
      for (let x = 75; x < 112; x += 1) {
        if (x % 6 < 4) source.data.set([245, 245, 245, 255], (y * source.width + x) * 4);
      }
    }
  }
  const result = scanCornerText(source);
  assert.ok(result.x >= 0 && result.y >= 0);
  assert.ok(result.w > 0 && result.h > 0);
  assert.ok(result.x + result.w <= 1.001);
  assert.ok(result.y + result.h <= 1.001);
  assert.ok(result.score > 0);
  assert.equal(result.corner, 'bottom-right');
});

test('ink mask isolates bright glyphs and a narrow saturated timestamp divider', () => {
  const source = imageData(60, 40);
  for (let y = 10; y < 18; y += 1) {
    for (let x = 10; x < 14; x += 1) source.data.set([250, 250, 250, 255], (y * source.width + x) * 4);
  }
  for (let y = 5; y < 28; y += 1) {
    for (let x = 25; x < 28; x += 1) source.data.set([245, 180, 50, 255], (y * source.width + x) * 4);
  }
  const mask = createInkMask(source, { r: 255, g: 255, b: 255 }, 74);
  const divider = detectAccentDivider(source);
  assert.equal(mask[11 * source.width + 11], 255);
  assert.equal(mask[12 * source.width + 26], 255);
  assert.equal(mask[2 * source.width + 2], 0);
  assert.deepEqual({ x: divider.x, y: divider.y, w: divider.w, h: divider.h }, { x: 25, y: 5, w: 3, h: 23 });
  assert.ok(divider.color.r > divider.color.g && divider.color.g > divider.color.b);
});

test('timestamp text stays aligned to the detected original divider', () => {
  const operations = [];
  const context = {
    font: '',
    save() {},
    restore() {},
    measureText(text) {
      const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 12);
      return { width: String(text).length * size * 0.52 };
    },
    fillText(text, x, y, maxWidth) { operations.push({ type: 'text', text, x, y, maxWidth }); },
    fillRect(x, y, width, height) { operations.push({ type: 'divider', x, y, width, height }); },
  };
  const region = { x: 0, y: 0.82, w: 0.76, h: 0.18 };
  const divider = { x: 224, y: 26, w: 8, h: 90, color: { r: 240, g: 180, b: 50 } };
  const result = drawTimestamp(context, region, {
    time: '08:35', date: '25 Tháng 10, 2026', weekday: 'Chủ Nhật', address: 'Chợ Bến Thành, Quận 1',
  }, {
    color: '#ffffff', fontScale: 0.028, lineHeight: 1.17, align: 'left', weight: 600, opacity: 0.98,
    shadow: true, fontFamily: 'Arial, sans-serif',
  }, 1000, 1000, divider);
  const marker = operations.find((operation) => operation.type === 'divider');
  const time = operations.find((operation) => operation.text === '08:35');
  const date = operations.find((operation) => operation.text === '25 Tháng 10, 2026');
  const weekday = operations.find((operation) => operation.text === 'Chủ Nhật');
  const address = operations.find((operation) => operation.type === 'text' && operation.text.startsWith('Chợ'));
  assert.equal(result.anchoredToDivider, true);
  assert.equal(marker.x, 224);
  assert.ok(time.x + time.maxWidth <= marker.x);
  assert.ok(date.x > marker.x + marker.width);
  assert.ok(weekday.x > marker.x + marker.width);
  assert.ok(address.y > marker.y + marker.height);
});

test('inpainting changes sampled ink near strokes but preserves remote pixels', () => {
  const source = imageData(32, 24);
  // A small bright mark on a flat dark background.
  for (let y = 9; y < 14; y += 1) {
    for (let x = 12; x < 16; x += 1) {
      source.data.set([250, 250, 250, 255], (y * source.width + x) * 4);
    }
  }
  const cleaned = inpaintInk(source, { r: 255, g: 255, b: 255 }, 30);
  const markOffset = (11 * source.width + 13) * 4;
  const remoteOffset = (1 * source.width + 1) * 4;
  assert.notEqual(cleaned.data[markOffset], 250);
  assert.deepEqual(Array.from(cleaned.data.slice(remoteOffset, remoteOffset + 4)), [35, 48, 58, 255]);
});

test('inpainting returns the image unchanged when the selected color is absent', () => {
  const source = imageData(12, 12);
  const cleaned = inpaintInk(source, { r: 255, g: 255, b: 255 }, 8);
  assert.deepEqual(Array.from(cleaned.data), Array.from(source.data));
});
