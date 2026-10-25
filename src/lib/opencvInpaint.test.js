import test from 'node:test';
import assert from 'node:assert/strict';
import cvModule from '@techstark/opencv-js';
import { inpaintInkWithOpenCV, parseHexColor } from './imageProcessor.js';

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
  assert.deepEqual(pixelAt(11, 12), [35, 48, 58, 255]);
  assert.deepEqual(pixelAt(26, 12), [35, 48, 58, 255]);
  assert.deepEqual(pixelAt(2, 2), [35, 48, 58, 255]);
});
