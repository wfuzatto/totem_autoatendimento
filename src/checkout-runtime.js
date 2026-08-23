const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const QRCode = require('qrcode');
const { db, audit, getSetting, getSettings } = require('./db');
const { requireAdmin } = require('./auth');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const brandingDir = process.env.BRANDING_DIR || path.join(dataDir, 'branding');
const printDir = process.env.PRINT_JOB_DIR || path.join(dataDir, 'print-jobs');
fs.mkdirSync(brandingDir, { recursive: true });
fs.mkdirSync(printDir, { recursive: true });

function ensureRuntimeSetting(key, value) {
  db.prepare('INSERT OR IGNORE INTO runtime_settings(key,value) VALUES(?,?)').run(key, value);
}

function runtimeSetting(key) {
  return db.prepare('SELECT value FROM runtime_settings WHERE key=?').get(key)?.value || '';
}

function setRuntimeSetting(key, value) {
  db.prepare(`INSERT INTO runtime_settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).run(key, String(value || ''));
}

function initCheckoutRuntime() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS exit_authorizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id TEXT NOT NULL UNIQUE,
      reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      receipt_number TEXT NOT NULL UNIQUE,
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      consumed_at TEXT,
      qr_url TEXT,
      print_status TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  ensureRuntimeSetting('checkout_ad_filename', '');
  ensureRuntimeSetting('exit_qr_secret', crypto.randomBytes(32).toString('hex'));
}

function formatDateBR(value, withTime = false) {
  if (!value) return '—';
  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return text;
  const date = `${match[3]}/${match[2]}/${match[1]}`;
  return withTime && match[4] ? `${date} ${match[4]}:${match[5]}` : date;
}

function moneyBR(cents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents || 0) / 100);
}

function publicBase(req) {
  const configured = runtimeSetting('public_qr_base_url').replace(/\/$/, '');
  if (configured) return configured;
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwarded || req.protocol || 'http';
  return `${protocol}://${req.get('host')}`;
}

function signToken(tokenId, expiresEpoch) {
  const payload = `${tokenId}.${expiresEpoch}`;
  const signature = crypto.createHmac('sha256', runtimeSetting('exit_qr_secret')).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function parseSignedToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [tokenId, expiresText, signature] = parts;
  if (!/^[a-f0-9]{32}$/i.test(tokenId) || !/^\d+$/.test(expiresText)) return null;
  const payload = `${tokenId}.${expiresText}`;
  const expected = crypto.createHmac('sha256', runtimeSetting('exit_qr_secret')).update(payload).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const expiresEpoch = Number(expiresText);
  if (!Number.isFinite(expiresEpoch)) return null;
  return { tokenId, expiresEpoch };
}

function authorizationData(token) {
  const parsed = parseSignedToken(token);
  if (!parsed) return { status: 'invalid' };
  const row = db.prepare(`SELECT a.*, r.reservation_number, r.room_number, r.responsible_name,
      r.checkin_date, r.checkout_date
    FROM exit_authorizations a
    JOIN reservations r ON r.id=a.reservation_id
    WHERE a.token_id=?`).get(parsed.tokenId);
  if (!row) return { status: 'invalid' };
  if (Date.now() > parsed.expiresEpoch || Date.parse(row.expires_at) <= Date.now()) return { status: 'expired', row };
  return { status: row.status, row };
}

function ascii(text) {
  return String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E\n]/g, '');
}

function escposQr(data) {
  const qr = Buffer.from(data, 'utf8');
  const storeLength = qr.length + 3;
  const pL = storeLength & 0xff;
  const pH = (storeLength >> 8) & 0xff;
  return Buffer.concat([
    Buffer.from([0x1d,0x28,0x6b,0x04,0x00,0x31,0x41,0x32,0x00]),
    Buffer.from([0x1d,0x28,0x6b,0x03,0x00,0x31,0x43,0x06]),
    Buffer.from([0x1d,0x28,0x6b,0x03,0x00,0x31,0x45,0x31]),
    Buffer.from([0x1d,0x28,0x6b,pL,pH,0x31,0x50,0x30]),
    qr,
    Buffer.from([0x1d,0x28,0x6b,0x03,0x00,0x31,0x51,0x30])
  ]);
}

function receiptText(info) {
  return [
    info.hotelName,
    'FECHAMENTO DE CONTA',
    'AUTORIZACAO DE SAIDA',
    '------------------------------------------',
    `Comprovante: ${info.receiptNumber}`,
    `Reserva: ${info.reservationNumber}`,
    `UH: ${info.roomNumber || '-'}`,
    `Titular: ${info.responsibleName}`,
    `Check-in: ${formatDateBR(info.checkinDate)}`,
    `Check-out: ${formatDateBR(info.checkoutDate)}`,
    `Emitido: ${formatDateBR(info.issuedAt, true)}`,
    '------------------------------------------',
    `Total da conta: ${moneyBR(info.totalCents)}`,
    `Pagamento: ${info.paymentMethod || 'Quitado'}`,
    '------------------------------------------',
    'SAIDA AUTORIZADA',
    'Apresente este QR Code na portaria.',
    'A validacao e feita online e possui',
    'assinatura digital contra falsificacao.',
    '',
    info.validationUrl,
    '',
    'Obrigado pela estadia!',
    ''
  ].join('\n');
}

function buildEscposReceipt(info) {
  const init = Buffer.from([0x1b,0x40]);
  const center = Buffer.from([0x1b,0x61,0x01]);
  const left = Buffer.from([0x1b,0x61,0x00]);
  const boldOn = Buffer.from([0x1b,0x45,0x01]);
  const boldOff = Buffer.from([0x1b,0x45,0x00]);
  const cut = Buffer.from([0x1d,0x56,0x41,0x10]);
  const top = ascii(`${info.hotelName}\nFECHAMENTO DE CONTA\nAUTORIZACAO DE SAIDA\n\n`);
  const body = ascii([
    `Comprovante: ${info.receiptNumber}`,
    `Reserva: ${info.reservationNumber}`,
    `UH: ${info.roomNumber || '-'}`,
    `Titular: ${info.responsibleName}`,
    `Check-in: ${formatDateBR(info.checkinDate)}`,
    `Check-out: ${formatDateBR(info.checkoutDate)}`,
    `Emitido: ${formatDateBR(info.issuedAt, true)}`,
    '------------------------------------------',
    `Total da conta: ${moneyBR(info.totalCents)}`,
    `Pagamento: ${info.paymentMethod || 'Quitado'}`,
    '------------------------------------------',
    ''
  ].join('\n'));
  const footer = ascii('\nSAIDA AUTORIZADA\nValide este QR Code na portaria.\n\nObrigado pela estadia!\n\n\n');
  return Buffer.concat([init, center, boldOn, Buffer.from(top), boldOff, left, Buffer.from(body), center, escposQr(info.validationUrl), Buffer.from(footer), cut]);
}

function printReceipt(info) {
  const mode = getSetting('printer_mode') || 'mock';
  const safeName = info.receiptNumber.replace(/[^A-Za-z0-9_-]/g, '_');
  const previewFile = path.join(printDir, `${safeName}.txt`);
  fs.writeFileSync(previewFile, receiptText(info), 'utf8');

  if (mode !== 'escpos') return { ok: true, mode: 'mock', status: 'simulado', preview_file: previewFile };
  const device = process.env.PRINTER_DEVICE || '/dev/usb/lp0';
  try {
    fs.writeFileSync(device, buildEscposReceipt(info));
    return { ok: true, mode: 'escpos', status: 'impresso', device };
  } catch (error) {
    return { ok: false, mode: 'escpos', status: 'erro', device, error: error.message, preview_file: previewFile };
  }
}

function currentAd() {
  const filename = path.basename(runtimeSetting('checkout_ad_filename'));
  if (!filename) return null;
  const full = path.join(brandingDir, filename);
  if (!fs.existsSync(full)) return null;
  const stat = fs.statSync(full);
  return { filename, full, url: `/api/branding/checkout-ad?v=${Math.floor(stat.mtimeMs)}` };
}

const adUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(file.mimetype === 'image/png' ? null : new Error('A propaganda deve ser uma imagem PNG.'), file.mimetype === 'image/png')
});

function installCheckoutRuntime(app) {
  initCheckoutRuntime();
  app.set('trust proxy', 1);

  app.get('/api/checkout/config', (_req, res) => {
    const ad = currentAd();
    res.json({ ad_url: ad?.url || null, ad_duration_seconds: 30 });
  });

  app.get('/api/admin/checkout-settings', requireAdmin, (_req, res) => {
    const ad = currentAd();
    res.json({ ad_url: ad?.url || null, ad_configured: Boolean(ad), ad_duration_seconds: 30 });
  });

  app.get('/api/branding/checkout-ad', (_req, res) => {
    const ad = currentAd();
    if (!ad) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(ad.full);
  });

  app.post('/api/admin/branding/checkout-ad', requireAdmin, adUpload.single('ad'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Selecione uma propaganda PNG.' });
    const filename = 'checkout-ad.png';
    fs.writeFileSync(path.join(brandingDir, filename), req.file.buffer);
    setRuntimeSetting('checkout_ad_filename', filename);
    audit('admin.branding.checkout_ad.updated', null, { bytes: req.file.size });
    return res.json({ ok: true, ad_url: currentAd().url });
  });

  app.delete('/api/admin/branding/checkout-ad', requireAdmin, (_req, res) => {
    const ad = currentAd();
    if (ad) { try { fs.unlinkSync(ad.full); } catch (_) {} }
    setRuntimeSetting('checkout_ad_filename', '');
    audit('admin.branding.checkout_ad.removed');
    return res.json({ ok: true });
  });

  app.post('/api/checkout/:id/finalize', async (req, res) => {
    const id = Number(req.params.id);
    const reservation = db.prepare('SELECT * FROM reservations WHERE id=?').get(id);
    if (!reservation) return res.status(404).json({ error: 'Reserva não encontrada.' });
    if (reservation.status !== 'checked_out') return res.status(409).json({ error: 'O checkout ainda não foi concluído.' });

    let auth = db.prepare("SELECT * FROM exit_authorizations WHERE reservation_id=? AND status='active' AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1").get(id);
    let token;
    if (!auth) {
      const tokenId = crypto.randomBytes(16).toString('hex');
      const issuedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
      const expiresEpoch = Date.parse(expiresAt);
      token = signToken(tokenId, expiresEpoch);
      const receiptNumber = `SAI-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(id).padStart(6,'0')}-${tokenId.slice(0,6).toUpperCase()}`;
      db.prepare(`INSERT INTO exit_authorizations(token_id,reservation_id,receipt_number,issued_at,expires_at,status)
        VALUES(?,?,?,?,?,'active')`).run(tokenId, id, receiptNumber, issuedAt, expiresAt);
      auth = db.prepare('SELECT * FROM exit_authorizations WHERE token_id=?').get(tokenId);
    } else {
      token = signToken(auth.token_id, Date.parse(auth.expires_at));
    }

    const validationUrl = `${publicBase(req)}/portaria.html?token=${encodeURIComponent(token)}`;
    const totalCents = db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS total FROM folio_items WHERE reservation_id=?').get(id).total;
    const payment = db.prepare("SELECT method, amount_cents, external_reference, created_at FROM payments WHERE reservation_id=? AND status='approved' ORDER BY id DESC LIMIT 1").get(id);
    const hotelName = getSettings().hotel_name || 'Hotel';
    const info = {
      hotelName,
      receiptNumber: auth.receipt_number,
      reservationNumber: reservation.reservation_number,
      roomNumber: reservation.room_number,
      responsibleName: reservation.responsible_name,
      checkinDate: reservation.checkin_date,
      checkoutDate: reservation.checkout_date,
      issuedAt: auth.issued_at,
      totalCents: Number(totalCents || 0),
      paymentMethod: payment?.method || 'Quitado',
      validationUrl
    };

    const print = printReceipt(info);
    db.prepare('UPDATE exit_authorizations SET qr_url=?, print_status=? WHERE id=?').run(validationUrl, print.status, auth.id);
    const qrDataUrl = await QRCode.toDataURL(validationUrl, { width: 440, margin: 2, errorCorrectionLevel: 'H' });
    audit('checkout.exit_authorization.issued', id, { receipt_number: auth.receipt_number, print_status: print.status });
    return res.json({
      ok: true,
      authorization: {
        receipt_number: auth.receipt_number,
        issued_at: auth.issued_at,
        expires_at: auth.expires_at,
        validation_url: validationUrl,
        qr_data_url: qrDataUrl,
        print
      },
      advertisement: { url: currentAd()?.url || null, duration_seconds: 30 }
    });
  });

  app.get('/api/public/exit/:token', (req, res) => {
    const result = authorizationData(req.params.token);
    if (result.status === 'invalid') return res.status(404).json({ status: 'invalid', error: 'Autorização inválida.' });
    const row = result.row;
    const payload = {
      status: result.status,
      valid: result.status === 'active',
      receipt_number: row.receipt_number,
      reservation_number: row.reservation_number,
      room_number: row.room_number,
      responsible_name: row.responsible_name,
      checkin_date: row.checkin_date,
      checkout_date: row.checkout_date,
      issued_at: row.issued_at,
      expires_at: row.expires_at,
      consumed_at: row.consumed_at
    };
    return res.status(result.status === 'expired' ? 410 : 200).json(payload);
  });

  app.post('/api/public/exit/:token/consume', (req, res) => {
    const result = authorizationData(req.params.token);
    if (result.status === 'invalid') return res.status(404).json({ status: 'invalid', error: 'Autorização inválida.' });
    if (result.status === 'expired') return res.status(410).json({ status: 'expired', error: 'Autorização expirada.' });
    if (result.status === 'used') return res.status(409).json({ status: 'used', error: 'Autorização já utilizada.', consumed_at: result.row.consumed_at });
    const now = new Date().toISOString();
    db.prepare("UPDATE exit_authorizations SET status='used', consumed_at=? WHERE id=? AND status='active'").run(now, result.row.id);
    audit('checkout.exit_authorization.consumed', result.row.reservation_id, { receipt_number: result.row.receipt_number });
    return res.json({ ok: true, status: 'used', consumed_at: now, receipt_number: result.row.receipt_number });
  });
}

module.exports = { installCheckoutRuntime, formatDateBR, parseSignedToken };
