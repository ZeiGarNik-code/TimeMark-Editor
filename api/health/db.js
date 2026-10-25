import { getSql, sendJson } from '../../server/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const sql = getSql();
    const rows = await sql`SELECT 1 AS connected`;
    return sendJson(res, 200, { ok: rows[0]?.connected === 1, service: 'account database' });
  } catch (error) {
    return sendJson(res, 503, {
      ok: false,
      error: error?.message === 'DATABASE_NOT_CONFIGURED' ? 'Database environment variable is missing.' : 'Database connection failed.',
    });
  }
}
