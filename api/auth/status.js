import { ensureSchema, getSql, sendJson } from '../../server/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }
  try {
    const sql = getSql();
    await ensureSchema(sql);
    const rows = await sql`SELECT initialized FROM timemark_app_state WHERE id = 1`;
    return sendJson(res, 200, {
      databaseReady: true,
      setupRequired: !Boolean(rows[0]?.initialized),
      setupTokenConfigured: typeof process.env.TIMEMARK_ADMIN_SETUP_TOKEN === 'string'
        && process.env.TIMEMARK_ADMIN_SETUP_TOKEN.length >= 32,
    });
  } catch (error) {
    return sendJson(res, 503, {
      databaseReady: false,
      setupRequired: false,
      error: error?.message === 'DATABASE_NOT_CONFIGURED' ? 'Database is not connected to this deployment.' : 'Could not reach the account database.',
    });
  }
}
