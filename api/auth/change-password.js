import {
  ensureSchema,
  getSessionUser,
  getSql,
  hashPassword,
  hashToken,
  isSameOrigin,
  isValidPassword,
  readCookie,
  readJsonBody,
  sendJson,
  publicUser,
} from '../../server/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (!isSameOrigin(req)) return sendJson(res, 403, { error: 'Cross-origin request blocked.' });
  const body = readJsonBody(req);
  if (!isValidPassword(body?.newPassword)) {
    return sendJson(res, 400, { error: 'Mật khẩu mới cần dài từ 12 đến 128 ký tự.' });
  }

  try {
    const sql = getSql();
    await ensureSchema(sql);
    const user = await getSessionUser(sql, req);
    if (!user) return sendJson(res, 401, { error: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.' });
    const passwordHash = await hashPassword(body.newPassword);
    await sql`UPDATE timemark_users SET password_hash = ${passwordHash},
      must_change_password = FALSE, updated_at = NOW() WHERE id = ${user.id}`;
    const token = readCookie(req);
    if (token) {
      await sql`DELETE FROM timemark_sessions
        WHERE user_id = ${user.id} AND token_hash <> ${hashToken(token)}`;
    }
    return sendJson(res, 200, {
      user: publicUser({ ...user, must_change_password: false }),
    });
  } catch (error) {
    return sendJson(res, 503, error?.message === 'DATABASE_NOT_CONFIGURED'
      ? { error: 'Database is not connected to this deployment.' }
      : { error: 'Could not change the password.' });
  }
}
