import {
  ensureSchema,
  getSql,
  hashPassword,
  isSameOrigin,
  isValidPassword,
  isValidUsername,
  makeTemporaryPassword,
  normalizeUsername,
  readJsonBody,
  safeEqual,
  sendJson,
  setSessionCookie,
  hashToken,
} from '../../server/auth.js';
import { randomBytes } from 'node:crypto';

const SEEDED_ACCOUNT_SPECS = [
  ...Array.from({ length: 10 }, (_, index) => {
    const suffix = String(index + 1).padStart(2, '0');
    return { username: `hocvien${suffix}`, displayName: `Tài khoản con ${suffix}` };
  }),
  { username: 'giaovien', displayName: 'Tài khoản giáo viên thử' },
];
const SEEDED_USERNAME_KEYS = new Set(SEEDED_ACCOUNT_SPECS.map(({ username }) => username));

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (!isSameOrigin(req)) return sendJson(res, 403, { error: 'Cross-origin request blocked.' });

  const body = readJsonBody(req);
  const setupToken = process.env.TIMEMARK_ADMIN_SETUP_TOKEN;
  if (!setupToken || setupToken.length < 32) {
    return sendJson(res, 503, { error: 'Initial admin setup is not configured.' });
  }
  if (!body || typeof body.token !== 'string' || !safeEqual(body.token, setupToken)) {
    return sendJson(res, 403, { error: 'Setup code is not valid.' });
  }

  const username = String(body.username ?? '').trim();
  const usernameKey = normalizeUsername(username);
  const displayName = String(body.displayName ?? '').trim().slice(0, 80);
  const password = body.password;
  if (!isValidUsername(username) || SEEDED_USERNAME_KEYS.has(usernameKey)) {
    return sendJson(res, 400, { error: 'Admin username must be 3–32 characters and cannot use a reserved account name.' });
  }
  if (!isValidPassword(password)) {
    return sendJson(res, 400, { error: 'Admin password must be 12–128 characters.' });
  }
  if (!displayName) return sendJson(res, 400, { error: 'Enter a display name for the admin account.' });

  try {
    const sql = getSql();
    await ensureSchema(sql);
    const state = await sql`SELECT initialized FROM timemark_app_state WHERE id = 1`;
    if (state[0]?.initialized) return sendJson(res, 409, { error: 'Initial setup has already been completed. Sign in with the admin account.' });
    const usernameExists = await sql`SELECT id FROM timemark_users WHERE username_key = ${usernameKey} LIMIT 1`;
    if (usernameExists[0]) return sendJson(res, 409, { error: 'Admin username already exists; choose another one.' });

    const adminHash = await hashPassword(password);
    const accountSpecs = SEEDED_ACCOUNT_SPECS;
    const children = [];
    for (const spec of accountSpecs) {
      const temporaryPassword = makeTemporaryPassword();
      children.push({
        ...spec,
        usernameKey: spec.username,
        passwordHash: await hashPassword(temporaryPassword),
        temporaryPassword,
      });
    }

    const token = randomBytes(32).toString('base64url');
    const sessionHash = hashToken(token);
    const childRows = children.map(({ username: childUsername, usernameKey: childKey, displayName: childName, passwordHash }) => ({
      username: childUsername,
      username_key: childKey,
      display_name: childName,
      password_hash: passwordHash,
    }));

    const results = await sql.transaction([
      sql`SELECT initialized FROM timemark_app_state WHERE id = 1 FOR UPDATE`,
      sql`INSERT INTO timemark_users (username, username_key, display_name, role, password_hash)
        SELECT ${username}, ${usernameKey}, ${displayName}, 'admin', ${adminHash}
        WHERE (SELECT initialized FROM timemark_app_state WHERE id = 1) = FALSE
        RETURNING id`,
      sql`INSERT INTO timemark_users (username, username_key, display_name, role, password_hash, must_change_password)
        SELECT child.username, child.username_key, child.display_name, 'member', child.password_hash, TRUE
        FROM json_to_recordset(${JSON.stringify(childRows)}::json) AS child(
          username TEXT, username_key TEXT, display_name TEXT, password_hash TEXT
        )
        WHERE (SELECT initialized FROM timemark_app_state WHERE id = 1) = FALSE
        RETURNING id`,
      sql`INSERT INTO timemark_sessions (token_hash, user_id, expires_at)
        SELECT ${sessionHash}, id, NOW() + INTERVAL '14 days'
        FROM timemark_users
        WHERE username_key = ${usernameKey} AND role = 'admin'
          AND (SELECT initialized FROM timemark_app_state WHERE id = 1) = FALSE`,
      sql`UPDATE timemark_app_state SET initialized = TRUE
        WHERE id = 1 AND initialized = FALSE RETURNING id`,
    ]);

    const adminRows = results[1] ?? [];
    const insertedChildren = results[2] ?? [];
    if (adminRows.length !== 1 || insertedChildren.length !== accountSpecs.length || (results[4] ?? []).length !== 1) {
      return sendJson(res, 409, { error: 'Initial setup has already been completed. Sign in with the admin account.' });
    }

    setSessionCookie(res, token);
    return sendJson(res, 201, {
      user: { id: Number(adminRows[0].id), username, displayName, role: 'admin', mustChangePassword: false },
      childAccounts: children.map(({ username: childUsername, displayName: childName, temporaryPassword }) => ({
        username: childUsername,
        displayName: childName,
        temporaryPassword,
      })),
      note: 'Child-account passwords are shown once. Save them before leaving this page.',
    });
  } catch {
    return sendJson(res, 503, { error: 'Could not complete account setup. Check the database connection and try again.' });
  }
}
