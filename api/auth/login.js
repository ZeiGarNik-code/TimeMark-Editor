import {
  createSession,
  ensureSchema,
  formatDatabaseError,
  getSql,
  hashLoginBucket,
  hashPassword,
  isSameOrigin,
  normalizeUsername,
  publicUser,
  readClientIp,
  readJsonBody,
  sendJson,
  verifyPassword,
} from '../../server/auth.js';

let dummyHashPromise;
function getDummyPasswordHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword('not-a-real-timemark-account-password');
  return dummyHashPromise;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (!isSameOrigin(req)) return sendJson(res, 403, { error: 'Cross-origin request blocked.' });
  const body = readJsonBody(req);
  const usernameKey = normalizeUsername(body?.username);
  const password = body?.password;
  if (!usernameKey || typeof password !== 'string' || password.length > 128) {
    return sendJson(res, 400, { error: 'Enter a valid username and password.' });
  }

  try {
    const sql = getSql();
    await ensureSchema(sql);
    const bucket = hashLoginBucket(readClientIp(req), usernameKey);
    const attempts = await sql`SELECT COUNT(*)::int AS count FROM timemark_login_attempts
      WHERE bucket_hash = ${bucket} AND created_at > NOW() - INTERVAL '15 minutes'`;
    if (Number(attempts[0]?.count ?? 0) >= 8) {
      return sendJson(res, 429, { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' });
    }

    const users = await sql`SELECT id, username, display_name, role, password_hash,
        must_change_password, is_active
      FROM timemark_users WHERE username_key = ${usernameKey} LIMIT 1`;
    const user = users[0];
    const passwordMatches = await verifyPassword(password, user?.password_hash ?? await getDummyPasswordHash());
    if (!user || !user.is_active || !passwordMatches) {
      await sql`INSERT INTO timemark_login_attempts (bucket_hash) VALUES (${bucket})`;
      await sql`DELETE FROM timemark_login_attempts WHERE created_at < NOW() - INTERVAL '24 hours'`;
      return sendJson(res, 401, { error: 'Tên tài khoản hoặc mật khẩu chưa đúng.' });
    }

    await sql`DELETE FROM timemark_login_attempts WHERE bucket_hash = ${bucket}`;
    await createSession(sql, user.id, res);
    return sendJson(res, 200, { user: publicUser(user) });
  } catch (error) {
    return sendJson(res, 503, { error: formatDatabaseError(error) === 'DATABASE_NOT_CONFIGURED' ? 'Database is not connected to this deployment.' : 'Sign-in is temporarily unavailable.' });
  }
}
