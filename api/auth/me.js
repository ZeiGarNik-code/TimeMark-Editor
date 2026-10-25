import { ensureSchema, getSessionUser, getSql, publicUser, sendJson } from '../../server/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const sql = getSql();
    await ensureSchema(sql);
    const user = await getSessionUser(sql, req);
    if (!user) return sendJson(res, 401, { user: null });
    return sendJson(res, 200, { user: publicUser(user) });
  } catch (error) {
    const message = error?.message === 'DATABASE_NOT_CONFIGURED'
      ? 'Database is not connected to this deployment.'
      : 'Could not check the sign-in session.';
    return sendJson(res, 503, { error: message });
  }
}
