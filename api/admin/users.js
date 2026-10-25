import {
  ensureSchema,
  getSql,
  hashPassword,
  isSameOrigin,
  isValidUsername,
  makeTemporaryPassword,
  normalizeUsername,
  publicUser,
  readJsonBody,
  requireAdmin,
  sendJson,
} from '../../server/auth.js';

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PATCH'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST, PATCH');
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (req.method !== 'GET' && !isSameOrigin(req)) return sendJson(res, 403, { error: 'Cross-origin request blocked.' });

  try {
    const sql = getSql();
    await ensureSchema(sql);
    const admin = await requireAdmin(sql, req);
    if (!admin) return sendJson(res, 403, { error: 'Admin sign-in required.' });

    if (req.method === 'GET') {
      const users = await sql`SELECT id, username, display_name, role, must_change_password,
          is_active, created_at
        FROM timemark_users WHERE role = 'member' ORDER BY username_key`;
      return sendJson(res, 200, { users: users.map((user) => ({
        ...publicUser(user),
        isActive: Boolean(user.is_active),
        createdAt: user.created_at,
      })) });
    }

    const body = readJsonBody(req);
    const username = String(body?.username ?? '').trim();
    const usernameKey = normalizeUsername(username);
    if (!isValidUsername(username)) return sendJson(res, 400, { error: 'Tên tài khoản cần có 3–32 ký tự: chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang.' });

    if (req.method === 'POST') {
      const displayName = String(body?.displayName ?? username).trim().slice(0, 80) || username;
      const temporaryPassword = makeTemporaryPassword();
      const passwordHash = await hashPassword(temporaryPassword);
      const created = await sql`INSERT INTO timemark_users
        (username, username_key, display_name, role, password_hash, must_change_password)
        VALUES (${username}, ${usernameKey}, ${displayName}, 'member', ${passwordHash}, TRUE)
        RETURNING id, username, display_name, role, must_change_password`;
      return sendJson(res, 201, {
        user: publicUser(created[0]),
        temporaryPassword,
        note: 'Mật khẩu tạm chỉ được hiển thị lần này; người dùng cần đổi ngay sau khi đăng nhập.',
      });
    }

    const action = String(body?.action ?? '');
    if (!['reset-password', 'disable', 'enable'].includes(action)) {
      return sendJson(res, 400, { error: 'Action must be reset-password, disable, or enable.' });
    }
    const existing = await sql`SELECT id FROM timemark_users
      WHERE username_key = ${usernameKey} AND role = 'member' LIMIT 1`;
    if (!existing[0]) return sendJson(res, 404, { error: 'Child account not found.' });
    const userId = existing[0].id;

    if (action === 'reset-password') {
      const temporaryPassword = makeTemporaryPassword();
      const passwordHash = await hashPassword(temporaryPassword);
      await sql`UPDATE timemark_users SET password_hash = ${passwordHash},
        must_change_password = TRUE, updated_at = NOW() WHERE id = ${userId}`;
      await sql`DELETE FROM timemark_sessions WHERE user_id = ${userId}`;
      return sendJson(res, 200, {
        temporaryPassword,
        note: 'Mật khẩu tạm chỉ được hiển thị lần này; người dùng cần đổi sau khi đăng nhập.',
      });
    }

    const active = action === 'enable';
    await sql`UPDATE timemark_users SET is_active = ${active}, updated_at = NOW() WHERE id = ${userId}`;
    if (!active) await sql`DELETE FROM timemark_sessions WHERE user_id = ${userId}`;
    return sendJson(res, 200, { ok: true, isActive: active });
  } catch (error) {
    const duplicate = error?.code === '23505';
    if (duplicate) return sendJson(res, 409, { error: 'Tên tài khoản đã tồn tại.' });
    return sendJson(res, 503, error?.message === 'DATABASE_NOT_CONFIGURED'
      ? { error: 'Database is not connected to this deployment.' }
      : { error: 'Account management is temporarily unavailable.' });
  }
}
