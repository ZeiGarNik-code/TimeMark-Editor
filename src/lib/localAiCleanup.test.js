import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalAiMask } from './localAiCleanup.js';

function alphaAt(mask, index) {
  return mask.data[index * 4 + 3];
}

test('AI mask creates a small circular halo without changing the source glyph bits', () => {
  const source = new Uint8Array(25);
  source[12] = 255;

  const mask = createLocalAiMask(source, 5, 5, 1);

  assert.equal(alphaAt(mask, 12), 255);
  assert.equal(alphaAt(mask, 7), 255);
  assert.equal(alphaAt(mask, 11), 255);
  assert.equal(alphaAt(mask, 13), 255);
  assert.equal(alphaAt(mask, 17), 255);
  assert.equal(alphaAt(mask, 6), 0, 'diagonal pixels remain outside the circular halo');
  assert.equal(alphaAt(mask, 0), 0, 'unrelated pixels stay transparent');
  assert.equal(source[12], 255, 'the caller-owned mask is not mutated');
});

test('AI mask clips its halo at image boundaries', () => {
  const source = new Uint8Array(9);
  source[0] = 1;

  const mask = createLocalAiMask(source, 3, 3, 2);

  assert.equal(alphaAt(mask, 0), 255);
  assert.equal(alphaAt(mask, 1), 255);
  assert.equal(alphaAt(mask, 3), 255);
  assert.equal(alphaAt(mask, 8), 0, 'out-of-bounds dilation must not wrap to the opposite corner');
});

test('AI mask rejects inconsistent dimensions and invalid sizes', () => {
  assert.throws(() => createLocalAiMask(new Uint8Array(3), 2, 2), /match its dimensions/);
  assert.throws(() => createLocalAiMask(new Uint8Array(1), 0, 1), /positive integers/);
});
