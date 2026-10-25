import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTimeToMinutes } from './timeFormat.js';

test('time formatting keeps only hours and minutes', () => {
  assert.equal(formatTimeToMinutes('08:35:12'), '08:35');
  assert.equal(formatTimeToMinutes('14.04.59'), '14:04');
  assert.equal(formatTimeToMinutes('14 04 21'), '14:04');
});

test('time formatting normalizes AM/PM input to 24-hour HH:MM', () => {
  assert.equal(formatTimeToMinutes('8:05 AM'), '08:05');
  assert.equal(formatTimeToMinutes('12:30 a.m.'), '00:30');
  assert.equal(formatTimeToMinutes('8:05 PM'), '20:05');
  assert.equal(formatTimeToMinutes('12:30 PM'), '12:30');
});

test('time formatting rejects invalid values rather than drawing malformed text', () => {
  assert.equal(formatTimeToMinutes('25:71:12'), '');
  assert.equal(formatTimeToMinutes('not a time'), '');
  assert.equal(formatTimeToMinutes(''), '');
});
