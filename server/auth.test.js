import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  hashToken,
  isSameOrigin,
  isValidPassword,
  isValidUsername,
  normalizeUsername,
  readCookie,
  readJsonBody,
  safeEqual,
  verifyPassword,
} from './auth.js';

function mockReq({ headers = {}, body } = {}) {
  return { headers, body };
}

test('account names are normalized and restricted to safe characters', () => {
  assert.equal(normalizeUsername('  Teacher_01  '), 'teacher_01');
  assert.equal(isValidUsername('teacher_01'), true);
  assert.equal(isValidUsername('a'), false);
  assert.equal(isValidUsername('bad name'), false);
  assert.equal(isValidUsername('x'.repeat(33)), false);
});

test('password policy requires a reasonable length', () => {
  assert.equal(isValidPassword('long-enough-password'), true);
  assert.equal(isValidPassword('short'), false);
  assert.equal(isValidPassword('x'.repeat(129)), false);
});

test('password hashes verify without storing plaintext', async () => {
  const password = 'correct horse battery staple';
  const encoded = await hashPassword(password);
  assert.notEqual(encoded, password);
  assert.match(encoded, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword('wrong password', encoded), false);
  assert.equal(await verifyPassword(password, 'invalid'), false);
});

test('session token hashes and constant-time string comparisons behave as expected', () => {
  assert.match(hashToken('session-token'), /^[a-f0-9]{64}$/);
  assert.equal(safeEqual('token', 'token'), true);
  assert.equal(safeEqual('token', 'other'), false);
  assert.equal(safeEqual('short', 'longer'), false);
});

test('cookies and JSON bodies are parsed defensively', () => {
  assert.equal(readCookie(mockReq({ headers: { cookie: 'other=x; timemark_session=abc%2D123' } })), 'abc-123');
  assert.equal(readCookie(mockReq({ headers: { cookie: 'timemark_session=%invalid' } })), '');
  assert.deepEqual(readJsonBody(mockReq({ body: { username: 'one' } })), { username: 'one' });
  assert.deepEqual(readJsonBody(mockReq({ body: '{"ok":true}' })), { ok: true });
  assert.equal(readJsonBody(mockReq({ body: '{bad json}' })), null);
  assert.equal(readJsonBody(mockReq({ body: 'x'.repeat(9_000) })), null);
});

test('state-changing API requests reject a mismatched browser origin', () => {
  assert.equal(isSameOrigin(mockReq({ headers: { origin: 'https://timemark-studio.vercel.app', host: 'timemark-studio.vercel.app' } })), true);
  assert.equal(isSameOrigin(mockReq({ headers: { origin: 'https://evil.example', host: 'timemark-studio.vercel.app' } })), false);
  assert.equal(isSameOrigin(mockReq({ headers: {} })), true);
});
