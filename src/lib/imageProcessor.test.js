import test from 'node:test';
import assert from 'node:assert/strict';
import { createInkMask, detectAccentDivider, drawTimestamp, estimateTextMetrics, expandDetectedStampRegion, fallbackForCorner, inferStampTypography, inpaintInk, parseHexColor, scanCornerText } from './imageProcessor.js';

function imageData(width, height, color = [35, 48, 58, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data.set(color, pixel * 4);
  }
  return { data, width, height };
}

function resizeImageData(image, maxDimension) {
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  if (scale === 1) return image;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor(x / scale));
      const sourceY = Math.min(image.height - 1, Math.floor(y / scale));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      data.set(image.data.subarray(sourceOffset, sourceOffset + 4), (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

function paintTimemarkLines(width, height, glyphScale) {
  const image = imageData(width, height);
  const paint = (x, y, boxWidth, boxHeight, color = [245, 245, 245, 255]) => {
    const left = Math.max(0, Math.round(x));
    const top = Math.max(0, Math.round(y));
    const right = Math.min(width, left + Math.max(1, Math.round(boxWidth)));
    const bottom = Math.min(height, top + Math.max(1, Math.round(boxHeight)));
    for (let row = top; row < bottom; row += 1) {
      for (let column = left; column < right; column += 1) {
        image.data.set(color, (row * width + column) * 4);
      }
    }
  };
  const glyphHeight = Math.max(2, Math.round(height * glyphScale));
  const paintLine = (xRatio, yRatio, widthRatio) => {
    const x = width * xRatio;
    const y = height * yRatio;
    const step = Math.max(2, Math.round(glyphHeight * 0.6));
    const count = Math.max(1, Math.floor((width * widthRatio) / step));
    for (let index = 0; index < count; index += 1) {
      const glyphX = x + index * step;
      paint(glyphX, y, Math.max(1, glyphHeight * 0.22), glyphHeight);
      if (index % 2 === 0) {
        paint(glyphX, y + glyphHeight * 0.55, Math.max(2, glyphHeight * 0.48), Math.max(1, glyphHeight * 0.14));
      }
    }
  };

  // Time, date, weekday, address, plus the narrow orange divider between the first two fields.
  paintLine(0.06, 0.74, 0.09);
  paint(width * 0.16, height * 0.735, width * 0.004, height * 0.08, [227, 179, 78, 255]);
  paintLine(0.18, 0.74, 0.25);
  paintLine(0.18, 0.775, 0.13);
  paintLine(0.06, 0.83, 0.36);
  return image;
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

test('corner scanner returns a normalized suggestion from the lower-left zone only', () => {
  const source = imageData(120, 90);
  // Add three compact, high-contrast text-like rows in the lower-left zone.
  for (let line = 0; line < 3; line += 1) {
    for (let y = 64 + line * 8; y < 68 + line * 8; y += 1) {
      for (let x = 8; x < 50; x += 1) {
        if (x % 6 < 4) source.data.set([245, 245, 245, 255], (y * source.width + x) * 4);
      }
    }
  }
  // Stronger text in the lower-right must not pull the scan away from the requested corner.
  for (let y = 61; y < 86; y += 1) {
    for (let x = 102; x < 119; x += 1) source.data.set([255, 255, 255, 255], (y * source.width + x) * 4);
  }
  const result = scanCornerText(source);
  assert.ok(result.x >= 0 && result.y >= 0);
  assert.ok(result.w > 0 && result.h > 0);
  assert.ok(result.x + result.w <= 1.001);
  assert.ok(result.y + result.h <= 1.001);
  assert.ok(result.score > 0);
  assert.ok(result.confidence >= 0.35 && result.confidence <= 0.92);
  assert.equal(result.corner, 'bottom-left');
  assert.ok(result.x < 0.1, 'the detected box should remain anchored to the lower-left');
});

test('an empty lower-left scan does not fall back to text in another corner', () => {
  const source = imageData(320, 180);
  for (let y = 130; y < 166; y += 1) {
    for (let x = 270; x < 315; x += 1) source.data.set([250, 250, 250, 255], (y * source.width + x) * 4);
  }
  const result = scanCornerText(source);
  assert.equal(result.corner, 'bottom-left');
  assert.equal(result.score, 0);
  assert.equal(result.confidence, 0);
  assert.equal(result.x, 0.045);
});

test('automatic timestamp framing covers all four fields in the lower-left across small, panoramic, portrait and high-resolution photos', () => {
  const fixtures = [
    { width: 320, height: 180, glyphScale: 0.012 },
    { width: 600, height: 120, glyphScale: 0.012 },
    { width: 900, height: 1600, glyphScale: 0.008 },
    { width: 1920, height: 1080, glyphScale: 0.012 },
    { width: 4000, height: 3000, glyphScale: 0.008 },
  ];

  for (const fixture of fixtures) {
    const resized = resizeImageData(
      paintTimemarkLines(fixture.width, fixture.height, fixture.glyphScale),
      1400,
    );
    const scanned = scanCornerText(resized);
    const frame = expandDetectedStampRegion(scanned, scanned.corner);

    assert.equal(scanned.corner, 'bottom-left', `${fixture.width}×${fixture.height} should only find the lower-left overlay`);
    assert.ok(scanned.confidence >= 0.5, `${fixture.width}×${fixture.height} should have a confident detection`);
    assert.ok(frame.x <= 0.06, `${fixture.width}×${fixture.height} frame should include the time field`);
    assert.ok(frame.x + frame.w >= 0.42, `${fixture.width}×${fixture.height} frame should include the date and weekday fields`);
    assert.ok(frame.y <= 0.74, `${fixture.width}×${fixture.height} frame should include the first line`);
    assert.ok(frame.y + frame.h >= 0.83 + fixture.glyphScale, `${fixture.width}×${fixture.height} frame should include the address line`);
  }
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

test('ink mask keeps color-matched marks inside detected timestamp lines, protecting nearby texture', () => {
  const source = imageData(400, 180);
  const paintRect = (x, y, width, height, color = [245, 245, 245, 255]) => {
    for (let row = y; row < y + height; row += 1) {
      for (let column = x; column < x + width; column += 1) {
        source.data.set(color, (row * source.width + column) * 4);
      }
    }
  };
  paintRect(100, 20, 4, 60, [227, 179, 78, 255]);
  paintRect(10, 22, 70, 56);
  paintRect(112, 23, 138, 22);
  paintRect(112, 46, 148, 9);
  paintRect(112, 58, 78, 20);
  paintRect(10, 96, 200, 22);
  // A small bright surface detail is not part of any timestamp line.
  paintRect(300, 130, 10, 8);

  const mask = createInkMask(source, { r: 255, g: 255, b: 255 }, 74);
  assert.equal(mask[30 * source.width + 20], 255, 'the time glyph should still be removed');
  assert.equal(mask[30 * source.width + 101], 255, 'the narrow orange divider should still be removed');
  assert.equal(mask[133 * source.width + 303], 0, 'unrelated textured highlights should not be added to the inpaint mask');
});

test('automatic typography inference uses divider-relative bands for date and weekday', () => {
  const source = imageData(400, 180);
  const paintRect = (x, y, width, height, color = [245, 245, 245, 255]) => {
    for (let row = y; row < y + height; row += 1) {
      for (let column = x; column < x + width; column += 1) {
        source.data.set(color, (row * source.width + column) * 4);
      }
    }
  };
  paintRect(100, 20, 4, 60, [227, 179, 78, 255]);
  paintRect(10, 22, 70, 56);
  paintRect(112, 23, 138, 22);
  // A bright texture bridge in the gap should not merge these two detail rows.
  paintRect(112, 46, 148, 9);
  paintRect(112, 58, 78, 20);
  paintRect(10, 96, 340, 22);
  paintRect(10, 126, 100, 19);

  const inferred = inferStampTypography(source);
  assert.ok(inferred);
  assert.equal(inferred.fontFamily.includes('Roboto Condensed'), true);
  assert.equal(inferred.weight, 700);
  assert.ok(Math.abs(inferred.timeGlyphScale - 56 / 60) < 0.03);
  assert.ok(Math.abs(inferred.detailGlyphScale - 25 / 60) < 0.03);
  assert.ok(Math.abs(inferred.detailPitchScale - 35 / 60) < 0.03);
  assert.ok(Math.abs(inferred.detailGapRatio - 0.02) < 0.01);
  assert.equal(inferred.opacity, 1);
  assert.deepEqual(inferred.sourcePositions, { timeX: 10 });
  assert.equal(inferred.metrics.address.length, 2);
  assert.ok(inferred.detailLineHeight >= 1 && inferred.detailLineHeight <= 1.8);
});

test('light timestamp strokes use regular 400 weight to match the supplied photo more closely', () => {
  const source = imageData(400, 180);
  const paintRect = (x, y, width, height, color = [245, 245, 245, 255]) => {
    for (let row = y; row < y + height; row += 1) {
      for (let column = x; column < x + width; column += 1) {
        source.data.set(color, (row * source.width + column) * 4);
      }
    }
  };
  const paintGlyphs = (x, y, width, height, count) => {
    const glyphWidth = width / count;
    for (let index = 0; index < count; index += 1) {
      const glyphX = Math.round(x + index * glyphWidth + 1);
      const glyphY = y + 1;
      paintRect(glyphX, glyphY, 1, height - 2);
      if (index % 2 === 0) {
        const verticalStart = index % 3 === 0 ? glyphY : glyphY + Math.round(height * 0.35);
        const verticalHeight = index % 3 === 0 ? height - 2 : Math.round(height * 0.65);
        paintRect(glyphX + Math.max(2, Math.round(glyphWidth * 0.45)), verticalStart, 1, verticalHeight);
      }
      if (index % 3 === 0) paintRect(glyphX, glyphY + Math.round(height * 0.45), Math.max(2, Math.round(glyphWidth * 0.4)), 1);
    }
  };

  paintRect(100, 20, 4, 60, [227, 179, 78, 255]);
  paintGlyphs(10, 22, 70, 56, 5);
  paintGlyphs(112, 23, 138, 22, 18);
  paintGlyphs(112, 58, 78, 20, 8);
  paintGlyphs(10, 96, 340, 22, 35);
  paintGlyphs(10, 126, 100, 19, 12);

  const inferred = inferStampTypography(source);
  assert.ok(inferred);
  assert.ok(inferred.metrics.inkCoverage > 0.15 && inferred.metrics.inkCoverage < 0.21);
  assert.equal(inferred.weight, 400);
  assert.equal(inferred.timeWeight, 500);
});

test('automatic typography inference declines to guess without the orange divider', () => {
  assert.equal(inferStampTypography(imageData(180, 100)), null);
});

test('matched time uses the source glyph width and ink left edge for replacement digits', () => {
  const operations = [];
  const context = {
    font: '',
    save() {},
    restore() {},
    measureText(text) {
      const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 12);
      return {
        width: String(text).length * size * 0.43,
        actualBoundingBoxAscent: size * 0.74,
        actualBoundingBoxDescent: size * 0.01,
        actualBoundingBoxLeft: -size * 0.08,
        actualBoundingBoxRight: size * 2.1,
      };
    },
    translate(x, y) { operations.push({ type: 'translate', x, y }); },
    scale(x, y) { operations.push({ type: 'scale', x, y }); },
    fillText(text, x, y, maxWidth) { operations.push({ type: 'text', text, x, y, maxWidth, font: this.font }); },
    fillRect(x, y, width, height) { operations.push({ type: 'divider', x, y, width, height }); },
  };
  const sourceInkWidth = 173;
  const sourceTimeX = 32;
  const result = drawTimestamp(context, { x: 0, y: 0, w: 1, h: 1 }, {
    time: '10:42', date: '', weekday: '', address: '',
  }, {
    color: '#ffffff', fontScale: 0.028, timeGlyphScale: 86 / 90,
    align: 'left', weight: 400, timeWeight: 500, opacity: 1, shadow: false,
    fontFamily: 'Roboto Condensed, sans-serif',
    sourceWidths: { time: sourceInkWidth },
    sourcePositions: { timeX: sourceTimeX },
  }, 825, 259, { x: 224, y: 23, w: 8, h: 90 });
  const scale = operations.find((operation) => operation.type === 'scale');
  const translation = operations.find((operation) => operation.type === 'translate');
  const expectedInkWidth = result.fontSize * (2.1 - 0.08);
  assert.ok(scale);
  assert.ok(Math.abs(scale.x - sourceInkWidth / expectedInkWidth) < 0.001);
  assert.ok(Math.abs(translation.x - (sourceTimeX - result.fontSize * 0.08 * scale.x)) < 0.001);
  const renderedTime = operations.find((operation) => operation.type === 'text');
  assert.equal(renderedTime.text, '10:42');
  assert.match(renderedTime.font, /^500 /);
});

test('time-only size scale changes the clock without scaling date, weekday or address settings', () => {
  const context = {
    font: '',
    save() {},
    restore() {},
    measureText(text) {
      const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 12);
      return {
        width: String(text).length * size * 0.5,
        actualBoundingBoxAscent: size * 0.72,
        actualBoundingBoxDescent: size * 0.02,
      };
    },
    fillText() {},
    fillRect() {},
  };
  const args = [
    context,
    { x: 0, y: 0, w: 1, h: 1 },
    { time: '08:35', date: '25 Tháng 10, 2026', weekday: 'Chủ Nhật', address: 'Chợ Bến Thành' },
  ];
  const style = {
    color: '#ffffff', fontScale: 0.028, timeGlyphScale: 0.9, timeSizeScale: 1,
    detailGlyphScale: 0.36, addressGlyphScale: 0.34, weight: 400, timeWeight: 500,
    fontFamily: 'Arial, sans-serif', shadow: false,
  };
  const normal = drawTimestamp(...args, style, 1000, 1000, { x: 220, y: 20, w: 6, h: 90 });
  const larger = drawTimestamp(...args, { ...style, timeSizeScale: 1.25 }, 1000, 1000, { x: 220, y: 20, w: 6, h: 90 });
  assert.ok(Math.abs(larger.fontSize / normal.fontSize - 1.25) < 0.001);

  const widthScales = [];
  const matchedContext = {
    ...context,
    translate() {},
    scale(x) { widthScales.push(x); },
  };
  const matchedStyle = { ...style, sourceWidths: { time: 120 } };
  const matchedNormal = drawTimestamp(matchedContext, args[1], args[2], matchedStyle, 1000, 1000, { x: 220, y: 20, w: 6, h: 90 });
  const matchedLarger = drawTimestamp(matchedContext, args[1], args[2], { ...matchedStyle, timeSizeScale: 1.25 }, 1000, 1000, { x: 220, y: 20, w: 6, h: 90 });
  assert.ok(Math.abs((matchedLarger.fontSize * widthScales[1]) / (matchedNormal.fontSize * widthScales[0]) - 1.25) < 0.001);

  const fallbackFonts = [];
  const fallbackContext = {
    font: '',
    save() {},
    restore() {},
    measureText(text) {
      const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 12);
      return { width: String(text).length * size * 0.5 };
    },
    fillText(text) { fallbackFonts.push({ text, font: this.font }); },
  };
  drawTimestamp(fallbackContext, { x: 0, y: 0, w: 1, h: 1 }, args[2], {
    ...style, timeSizeScale: 1.25,
  }, 1000, 1000);
  const fontSize = (text) => Number(fallbackFonts.find((line) => line.text === text)?.font.match(/([\d.]+)px/)?.[1]);
  assert.ok(Math.abs(fontSize('08:35') / fontSize('25 Tháng 10, 2026') - 1.25) < 0.001);
});

test('timestamp text stays aligned to the detected original divider and drops seconds', () => {
  const operations = [];
  const context = {
    font: '',
    save() {},
    restore() {},
    measureText(text) {
      const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 12);
      return { width: String(text).length * size * 0.52 };
    },
    fillText(text, x, y, maxWidth) { operations.push({ type: 'text', text, x, y, maxWidth, font: this.font }); },
    fillRect(x, y, width, height) { operations.push({ type: 'divider', x, y, width, height }); },
  };
  const region = { x: 0, y: 0.82, w: 0.76, h: 0.18 };
  const divider = { x: 224, y: 26, w: 8, h: 90, color: { r: 240, g: 180, b: 50 } };
  const result = drawTimestamp(context, region, {
    time: '08:35:12', date: '25 Tháng 10, 2026', weekday: 'Chủ Nhật', address: 'Chợ Bến Thành, Quận 1',
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
  assert.ok(time);
  assert.match(time.font, /^700 /);
  assert.match(date.font, /^600 /);
  assert.match(address.font, /^600 /);
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
