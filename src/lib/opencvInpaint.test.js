import test from 'node:test';
import assert from 'node:assert/strict';
import cvModule from '@techstark/opencv-js';
import { createInkMask, inpaintInkWithOpenCV, parseHexColor } from './imageProcessor.js';

const cv = await cvModule;

test('OpenCV Telea inpainting removes bright text and its gold divider while preserving remote pixels', () => {
  const width = 60;
  const height = 40;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) data.set([35, 48, 58, 255], pixel * 4);
  for (let y = 10; y < 18; y += 1) {
    for (let x = 10; x < 14; x += 1) data.set([250, 250, 250, 255], (y * width + x) * 4);
  }
  for (let y = 5; y < 28; y += 1) {
    for (let x = 25; x < 28; x += 1) data.set([245, 180, 50, 255], (y * width + x) * 4);
  }

  const result = inpaintInkWithOpenCV({ data, width, height }, parseHexColor('#ffffff'), 74, cv);
  const pixelAt = (x, y) => Array.from(result.data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
  const repairedTextPixel = pixelAt(11, 12);
  const repairedDividerPixel = pixelAt(26, 12);
  assert.ok(repairedTextPixel.slice(0, 3).every((channel, index) => Math.abs(channel - [35, 48, 58][index]) <= 2));
  assert.ok(repairedDividerPixel.slice(0, 3).every((channel, index) => Math.abs(channel - [35, 48, 58][index]) <= 2));
  assert.deepEqual(pixelAt(2, 2), [35, 48, 58, 255]);
});

test('OpenCV inpainting preserves textured source pixels exactly outside a tight two-pixel repair margin', () => {
  const width = 96;
  const height = 72;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const grain = (x * 13 + y * 17 + (x * y) % 19) % 27;
      data.set([42 + grain, 58 + ((grain * 3 + x) % 31), 73 + ((grain * 5 + y) % 37), 255], (y * width + x) * 4);
    }
  }
  for (let y = 24; y < 39; y += 1) {
    for (let x = 43; x < 49; x += 1) data.set([250, 250, 250, 255], (y * width + x) * 4);
  }

  const source = { data, width, height };
  const maskData = createInkMask(source, parseHexColor('#ffffff'), 74);
  const mask = new cv.Mat(height, width, cv.CV_8UC1);
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  const expanded = new cv.Mat();
  try {
    mask.data.set(maskData);
    cv.dilate(mask, expanded, kernel, new cv.Point(-1, -1), 1);
    const result = inpaintInkWithOpenCV(source, parseHexColor('#ffffff'), 74, cv);
    let untouched = 0;
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      if (expanded.data[index]) continue;
      assert.deepEqual(
        Array.from(result.data.subarray(offset, offset + 4)),
        Array.from(data.subarray(offset, offset + 4)),
        `pixel ${index % width},${Math.floor(index / width)} outside the repair mask should remain byte-identical`,
      );
      untouched += 1;
    }
    assert.ok(untouched > width * height * 0.97, 'the repair should remain local on a textured image');
    assert.notDeepEqual(
      Array.from(result.data.subarray((31 * width + 46) * 4, (31 * width + 46) * 4 + 3)),
      [250, 250, 250],
      'the timestamp stroke itself should be removed',
    );
  } finally {
    expanded.delete();
    kernel.delete();
    mask.delete();
  }
});
