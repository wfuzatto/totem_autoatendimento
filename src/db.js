const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'totem.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_number TEXT NOT NULL UNIQUE,
      room_number TEXT,
      responsible_name TEXT NOT NULL,
      responsible_cpf TEXT,
      checkin_date TEXT,
      checkout_date TEXT,
      status TEXT NOT NULL DEFAULT 'reserved',
      adults INTEGER NOT NULL DEFAULT 1,
      children INTEGER NOT NULL DEFAULT 0,
      balance_cents INTEGER NOT NULL DEFAULT 0,
      payment_pending INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS guests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      document TEXT,
      adult INTEGER NOT NULL DEFAULT 1,
      wristband_code TEXT,
      face_verified INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS folio_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,
      contested INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      filename TEXT,
      status TEXT NOT NULL DEFAULT 'missing',
      uploaded_at TEXT,
      UNIQUE(reservation_id, guest_id, type)
    );

    CREATE TABLE IF NOT EXISTS upload_tokens (
      token TEXT PRIMARY KEY,
      reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wristband_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      returned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      method TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL,
      external_reference TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      reservation_id INTEGER,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const defaults = {
    admin_password_hash: hashPassword(process.env.ADMIN_PASSWORD || '251933'),
    hotel_name: 'Hotel Fazenda Vale da Mantiqueira',
    theme_skin: 'vale_mantiqueira',
    allow_item_contest: '1',
    require_govbr: '1',
    require_face_match: '1',
    require_wristband_return: '1',
    enable_accessibility_toolbar: '1',
    api_provider: 'mock',
    totvs_base_url: '',
    totvs_token: '',
    payment_provider: 'mock',
    sitef_server: '',
    nfc_mode: 'mock',
    printer_mode: 'mock',
    webcam_mode: 'browser',
    inactivity_seconds: '120'
  };

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
  const tx = db.transaction(() => Object.entries(defaults).forEach(([k, v]) => insertSetting.run(k, v)));
  tx();

  // Migration for installations created before the hotel skin became the default.
  db.prepare(`
    UPDATE settings
       SET value = 'Hotel Fazenda Vale da Mantiqueira', updated_at = CURRENT_TIMESTAMP
     WHERE key = 'hotel_name' AND value = 'Hotel Demonstração'
  `).run();

  seedDemo();
}

function seedDemo() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM reservations').get().c;
  if (count > 0) return;

  const insertReservation = db.prepare(`
    INSERT INTO reservations(reservation_number, room_number, responsible_name, responsible_cpf, checkin_date, checkout_date, status, adults, children, balance_cents, payment_pending)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertGuest = db.prepare('INSERT INTO guests(reservation_id, name, document, adult, wristband_code, face_verified) VALUES (?, ?, ?, ?, ?, ?)');
  const insertItem = db.prepare('INSERT INTO folio_items(reservation_id, guest_id, description, amount_cents, occurred_at) VALUES (?, ?, ?, ?, ?)');
  const insertDoc = db.prepare('INSERT INTO documents(reservation_id, guest_id, type, filename, status, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)');

  db.transaction(() => {
    const checkoutId = Number(insertReservation.run('RES-10025', '204', 'Carlos Henrique Souza', '12345678909', '2026-08-20', '2026-08-23', 'checked_in', 2, 1, 42870, 1).lastInsertRowid);
    const g1 = Number(insertGuest.run(checkoutId, 'Carlos Henrique Souza', 'RG 12.345.678-9', 1, 'SAGA-204-CARLOS', 1).lastInsertRowid);
    const g2 = Number(insertGuest.run(checkoutId, 'Mariana Souza', 'RG 45.678.901-2', 1, 'SAGA-204-MARIANA', 1).lastInsertRowid);
    const g3 = Number(insertGuest.run(checkoutId, 'Pedro Souza', null, 0, null, 0).lastInsertRowid);
    insertItem.run(checkoutId, g1, 'Restaurante - Jantar', 14990, '2026-08-21 20:35');
    insertItem.run(checkoutId, g1, 'Frigobar - Água mineral', 1200, '2026-08-22 09:12');
    insertItem.run(checkoutId, g2, 'Spa - Massagem', 22000, '2026-08-22 15:00');
    insertItem.run(checkoutId, g2, 'Frigobar - Refrigerante', 1680, '2026-08-22 19:44');
    insertItem.run(checkoutId, g3, 'Loja - Souvenir', 3000, '2026-08-22 17:10');
    insertDoc.run(checkoutId, g1, 'identity', 'carlos-rg.pdf', 'received', '2026-08-20 10:00');
    insertDoc.run(checkoutId, g2, 'identity', 'mariana-rg.pdf', 'received', '2026-08-20 10:01');

    const checkinId = Number(insertReservation.run('RES-20080', null, 'Fernanda Almeida', '98765432100', '2026-08-23', '2026-08-26', 'reserved', 2, 0, 85000, 1).lastInsertRowid);
    const c1 = Number(insertGuest.run(checkinId, 'Fernanda Almeida', 'CPF 987.654.321-00', 1, null, 0).lastInsertRowid);
    const c2 = Number(insertGuest.run(checkinId, 'Rafael Almeida', 'CPF 111.222.333-44', 1, null, 0).lastInsertRowid);
    insertDoc.run(checkinId, c1, 'identity', 'fernanda-identidade.pdf', 'received', '2026-08-22 18:00');
    insertDoc.run(checkinId, c2, 'identity', null, 'missing', null);
    insertDoc.run(checkinId, null, 'payment_proof', null, 'missing', null);
  })();
}

function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
}

function getSettings({ includeSecrets = false } = {}) {
  const rows = db.prepare('SELECT key, value FROM settings ORDER BY key').all();
  const obj = Object.fromEntries(rows.map(r => [r.key, r.value]));
  if (!includeSecrets) {
    delete obj.admin_password_hash;
    if (obj.totvs_token) obj.totvs_token = '********';
  }
  return obj;
}

function setSettings(values) {
  const allowed = new Set([
    'hotel_name','theme_skin','allow_item_contest','require_govbr','require_face_match','require_wristband_return',
    'enable_accessibility_toolbar','api_provider','totvs_base_url','totvs_token','payment_provider','sitef_server',
    'nfc_mode','printer_mode','webcam_mode','inactivity_seconds'
  ]);
  const stmt = db.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`);
  db.transaction(() => {
    for (const [key, value] of Object.entries(values || {})) {
      if (allowed.has(key) && value !== '********') stmt.run(key, String(value));
    }
  })();
}

function audit(event, reservationId = null, metadata = {}) {
  db.prepare('INSERT INTO audit_log(event,reservation_id,metadata) VALUES(?,?,?)')
    .run(event, reservationId, JSON.stringify(metadata));
}

module.exports = { db, init, getSetting, getSettings, setSettings, verifyPassword, audit };
