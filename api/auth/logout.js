import { clearSessionCookie, ensureSchema, getSql, hashToken, isSameOrigin, readCookie, sendJson } from '../../server/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  if (!isSameOrigin(req)) return sendJson(res, 403, { error: 'Cross-origin request blocked.' });
  try {
    const sql = getSql();
    await ensureSchema(sql);
    const token = readCookie(req);
    if (token && token.length <= 128) {
      await sql`DELETE FROM timemark_sessions WHERE token_hash = ${hashToken(token)}`;
    }
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  } catch {
    clearSessionCookie(res);
    return sendJson(res, 503, { error: 'Could not end the session.' });
  }
}
