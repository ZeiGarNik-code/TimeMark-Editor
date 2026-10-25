import { neon } from '@neondatabase/serverless';
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = 'timemark_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

export function getSql() {
  const connectionString = process.env.DATABASE_URL
    || process.env.POSTGRES_URL
    || process.env.NEON_DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_NOT_CONFIGURED');
  return neon(connectionString);
}

export async function ensureSchema(sql) {
  await sql`CREATE TABLE IF NOT EXISTS timemark_app_state (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    initialized BOOLEAN NOT NULL DEFAULT FALSE
  )`;
  await sql`INSERT INTO timemark_app_state (id, initialized)
    VALUES (1, FALSE) ON CONFLICT (id) DO NOTHING`;
  await sql`CREATE TABLE IF NOT EXISTS timemark_users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    username_key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS timemark_single_admin_idx
    ON timemark_users (role) WHERE role = 'admin'`;
  await sql`CREATE TABLE IF NOT EXISTS timemark_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES timemark_users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS timemark_sessions_user_idx
    ON timemark_sessions (user_id)`;
  await sql`CREATE TABLE IF NOT EXISTS timemark_login_attempts (
    id BIGSERIAL PRIMARY KEY,
    bucket_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS timemark_login_attempts_bucket_idx
    ON timemark_login_attempts (bucket_hash, created_at)`;
}

export function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function isValidUsername(value) {
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalizeUsername(value));
}

export function isValidPassword(value) {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128;
}

export function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''), 'utf8');
  const rightBuffer = Buffer.from(String(right ?? ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${Buffer.from(key).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const [algorithm, cost, blockSize, parallelism, saltValue, keyValue] = encoded.split('$');
  if (algorithm !== 'scrypt' || cost !== '16384' || blockSize !== '8' || parallelism !== '1' || !saltValue || !keyValue) return false;
  try {
    const salt = Buffer.from(saltValue, 'base64url');
    const expected = Buffer.from(keyValue, 'base64url');
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = Buffer.from(await scrypt(password, salt, expected.length, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }));
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function hashToken(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function hashLoginBucket(ipAddress, usernameKey) {
  return createHash('sha256').update(`${ipAddress}|${usernameKey}`).digest('hex');
}

export function readClientIp(req) {
  const forwardedFor = req.headers?.['x-forwarded-for'];
  const firstForwardedIp = typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : '';
  return firstForwardedIp || String(req.headers?.['x-real-ip'] ?? 'unknown');
}

export function readCookie(req, name = SESSION_COOKIE) {
  const cookieHeader = req.headers?.cookie;
  if (typeof cookieHeader !== 'string') return '';
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}

export function setSessionCookie(res, token) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}

export function clearSessionCookie(res) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

export function sendJson(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(status).json(payload);
}

export function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    try {
      if (Buffer.byteLength(JSON.stringify(req.body), 'utf8') <= 8_192) return req.body;
    } catch { /* Fall through to invalid payload. */ }
    return null;
  }
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body ?? '');
  if (!raw || Buffer.byteLength(raw, 'utf8') > 8_192) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isSameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
  if (typeof host !== 'string' || !host) return false;
  const forwardedProtocol = req.headers?.['x-forwarded-proto'];
  const protocol = typeof forwardedProtocol === 'string' ? forwardedProtocol.split(',')[0].trim() : 'https';
  try {
    return new URL(origin).origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

export async function createSession(sql, userId, res) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  await sql`INSERT INTO timemark_sessions (token_hash, user_id, expires_at)
    VALUES (${tokenHash}, ${userId}, NOW() + (${SESSION_TTL_SECONDS} * INTERVAL '1 second'))`;
  setSessionCookie(res, token);
}

export async function getSessionUser(sql, req) {
  const token = readCookie(req);
  if (!token || token.length > 128) return null;
  const tokenHash = hashToken(token);
  const rows = await sql`SELECT u.id, u.username, u.display_name, u.role,
      u.must_change_password, s.expires_at
    FROM timemark_sessions s
    JOIN timemark_users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > NOW() AND u.is_active = TRUE
    LIMIT 1`;
  return rows[0] ?? null;
}

export async function requireAdmin(sql, req) {
  const user = await getSessionUser(sql, req);
  return user?.role === 'admin' ? user : null;
}

export function publicUser(user) {
  return {
    id: Number(user.id),
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    mustChangePassword: Boolean(user.must_change_password),
  };
}

export function makeTemporaryPassword() {
  return randomBytes(15).toString('base64url');
}

export function formatDatabaseError(error) {
  return error?.message === 'DATABASE_NOT_CONFIGURED'
    ? 'DATABASE_NOT_CONFIGURED'
    : 'DATABASE_UNAVAILABLE';
}
