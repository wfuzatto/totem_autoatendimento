const crypto = require('crypto');
const { getSetting, verifyPassword } = require('./db');

const sessions = new Map();
const TTL_MS = 30 * 60 * 1000;

function createAdminSession(password) {
  if (!verifyPassword(password, getSetting('admin_password_hash'))) return null;
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + TTL_MS);
  return token;
}

function requireAdmin(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const expiry = sessions.get(token);
  if (!expiry || expiry < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: 'Sessão administrativa inválida ou expirada.' });
  }
  sessions.set(token, Date.now() + TTL_MS);
  req.adminToken = token;
  next();
}

function revoke(token) {
  sessions.delete(token);
}

module.exports = { createAdminSession, requireAdmin, revoke };
