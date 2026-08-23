const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const baseApp = require('./server');
const { db, audit, getSetting, getSettings } = require('./db');
const { requireAdmin } = require('./auth');
const { validateIdentityDocument } = require('./document-validator');

const app = express();
const PORT = Number(process.env.PORT || 3080);
const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
const brandingDir = process.env.BRANDING_DIR || path.join(__dirname, '..', 'data', 'branding');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(brandingDir, { recursive: true });

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/vendor/jsqr', express.static(path.join(__dirname, '..', 'node_modules', 'jsqr', 'dist')));

db.exec(`CREATE TABLE IF NOT EXISTS runtime_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
const runtimeInsert = db.prepare('INSERT OR IGNORE INTO runtime_settings(key,value) VALUES(?,?)');
runtimeInsert.run('public_qr_base_url', '');
runtimeInsert.run('logo_filename', '');

function getRuntimeSetting(key) {
  return db.prepare('SELECT value FROM runtime_settings WHERE key=?').get(key)?.value || '';
}

function setRuntimeSetting(key, value) {
  db.prepare(`INSERT INTO runtime_settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`).run(key, String(value || ''));
}

function currentLogo() {
  const filename = path.basename(getRuntimeSetting('logo_filename'));
  if (!filename) return null;
  const full = path.join(brandingDir, filename);
  if (!fs.existsSync(full)) return null;
  const stat = fs.statSync(full);
  return { filename, full, url: `/api/branding/logo?v=${Math.floor(stat.mtimeMs)}` };
}

function normalizePublicBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let parsed;
  try { parsed = new URL(raw); } catch (_) { throw new Error('URL pública inválida. Informe uma URL completa, por exemplo https://checkin.seuhotel.com.br'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('A URL pública deve começar com http:// ou https://.');
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/, '');
}

function cpfIsValid(value) {
  const cpf = String(value || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = length => {
    let sum = 0;
    for (let i = 0; i < length; i += 1) sum += Number(cpf[i]) * (length + 1 - i);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

function bundleByRow(row) {
  if (!row) return null;
  const reservation = {
    ...row,
    adults: Number(row.adults),
    children: Number(row.children),
    balance_cents: Number(row.balance_cents || 0),
    payment_pending: Boolean(row.payment_pending)
  };
  const guests = db.prepare('SELECT * FROM guests WHERE reservation_id=? ORDER BY adult DESC,id').all(row.id)
    .map(g => ({ ...g, adult: Boolean(g.adult), face_verified: Boolean(g.face_verified) }));
  const documents = db.prepare('SELECT * FROM documents WHERE reservation_id=? ORDER BY guest_id,type').all(row.id);
  const state = db.prepare('SELECT * FROM process_state WHERE reservation_id=?').get(row.id) || { govbr_verified: 0 };
  return { reservation, guests, documents, state: { govbr_verified: Boolean(state.govbr_verified) } };
}

function extractQrCandidates(payload) {
  const raw = String(payload || '').trim();
  if (!raw) return [];
  const values = [];
  const add = value => {
    const candidate = String(value || '').trim();
    if (candidate && candidate.length <= 120 && !values.includes(candidate)) values.push(candidate);
  };

  try {
    const parsed = JSON.parse(raw);
    ['reservation_number', 'reservation', 'reserva', 'booking', 'booking_id', 'codigo_reserva'].forEach(key => add(parsed?.[key]));
  } catch (_) {}

  try {
    const parsed = new URL(raw);
    ['reservation_number', 'reservation', 'reserva', 'booking', 'booking_id', 'codigo_reserva'].forEach(key => add(parsed.searchParams.get(key)));
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length) add(segments[segments.length - 1]);
  } catch (_) {}

  if (/^[A-Za-z0-9][A-Za-z0-9._\/-]{2,80}$/.test(raw)) add(raw);
  return values;
}

function findReservation(query, type = 'auto') {
  const raw = String(query || '').trim();
  if (!raw) return null;
  let row = null;

  if (type === 'reservation') {
    row = db.prepare('SELECT * FROM reservations WHERE reservation_number=? COLLATE NOCASE LIMIT 1').get(raw);
  } else if (type === 'cpf') {
    const digits = raw.replace(/\D/g, '');
    if (!cpfIsValid(digits)) return null;
    row = db.prepare("SELECT * FROM reservations WHERE REPLACE(REPLACE(REPLACE(responsible_cpf,'.',''),'-',''),' ','')=? LIMIT 1").get(digits);
  } else if (type === 'qr') {
    for (const candidate of extractQrCandidates(raw)) {
      row = db.prepare('SELECT * FROM reservations WHERE reservation_number=? COLLATE NOCASE LIMIT 1').get(candidate);
      if (row) break;
    }
  } else {
    row = db.prepare('SELECT * FROM reservations WHERE reservation_number=? COLLATE NOCASE OR room_number=? COLLATE NOCASE LIMIT 1').get(raw, raw);
    if (!row) {
      const digits = raw.replace(/\D/g, '');
      if (digits) row = db.prepare("SELECT * FROM reservations WHERE REPLACE(REPLACE(REPLACE(responsible_cpf,'.',''),'-',''),' ','')=? LIMIT 1").get(digits);
    }
    if (!row) row = db.prepare('SELECT r.* FROM guests g JOIN reservations r ON r.id=g.reservation_id WHERE g.wristband_code=? COLLATE NOCASE LIMIT 1').get(raw);
  }
  return bundleByRow(row);
}

const allowedMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).slice(0, 12).toLowerCase()}`)
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = allowedMimeTypes.has(file.mimetype);
    cb(ok ? null : new Error('Formato não permitido. Use PDF, JPG, PNG ou WEBP.'), ok);
  }
});

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Logomarca inválida. Use JPG, PNG ou WEBP.'), ok);
  }
});

function validUploadToken(token) {
  const entry = db.prepare('SELECT * FROM upload_tokens WHERE token=?').get(token);
  if (!entry) return null;
  const expiresAt = Date.parse(entry.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return entry;
}

function removeUploadedFile(file) {
  if (!file?.path) return;
  try { fs.unlinkSync(file.path); } catch (_) {}
}

function removeStoredFilename(filename) {
  if (!filename) return;
  const safeName = path.basename(String(filename));
  try { fs.unlinkSync(path.join(uploadsDir, safeName)); } catch (_) {}
}

app.get('/api/config', (_req, res) => {
  const s = getSettings();
  const logo = currentLogo();
  res.json({
    hotel_name: s.hotel_name,
    theme_skin: s.theme_skin || 'vale_mantiqueira',
    logo_url: logo?.url || '/assets/skins/vale-mantiqueira/logo.jpg',
    logo_custom: Boolean(logo),
    public_qr_base_url: getRuntimeSetting('public_qr_base_url'),
    allow_item_contest: s.allow_item_contest === '1',
    require_govbr: s.require_govbr === '1',
    require_face_match: s.require_face_match === '1',
    require_wristband_return: s.require_wristband_return === '1',
    enable_accessibility_toolbar: s.enable_accessibility_toolbar === '1',
    inactivity_seconds: Number(s.inactivity_seconds || 120)
  });
});

app.get('/api/admin/runtime-settings', requireAdmin, (_req, res) => {
  const logo = currentLogo();
  res.json({
    public_qr_base_url: getRuntimeSetting('public_qr_base_url'),
    logo_url: logo?.url || '/assets/skins/vale-mantiqueira/logo.jpg',
    logo_custom: Boolean(logo)
  });
});

app.put('/api/admin/runtime-settings', requireAdmin, (req, res) => {
  try {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'public_qr_base_url')) {
      setRuntimeSetting('public_qr_base_url', normalizePublicBaseUrl(req.body.public_qr_base_url));
    }
    audit('admin.runtime_settings.updated', null, { keys: Object.keys(req.body || {}) });
    res.json({ ok: true, public_qr_base_url: getRuntimeSetting('public_qr_base_url') });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/branding/logo', (_req, res) => {
  const logo = currentLogo();
  if (!logo) return res.status(404).end();
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(logo.full);
});

app.post('/api/admin/branding/logo', requireAdmin, logoUpload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Selecione uma logomarca.' });
  const extension = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' })[req.file.mimetype];
  for (const file of fs.readdirSync(brandingDir)) {
    if (/^logo\.(jpg|png|webp)$/i.test(file)) {
      try { fs.unlinkSync(path.join(brandingDir, file)); } catch (_) {}
    }
  }
  const filename = `logo${extension}`;
  fs.writeFileSync(path.join(brandingDir, filename), req.file.buffer);
  setRuntimeSetting('logo_filename', filename);
  audit('admin.branding.logo.updated', null, { mimetype: req.file.mimetype, bytes: req.file.size });
  const logo = currentLogo();
  return res.json({ ok: true, logo_url: logo.url });
});

app.post('/api/reservations/lookup', (req, res) => {
  if (getSetting('api_provider') !== 'mock') {
    return res.status(501).json({ error: 'Adapter TOTVS selecionado. Configure os endpoints específicos da Guest API antes de usar o modo live.' });
  }
  const type = ['reservation', 'cpf', 'qr', 'auto'].includes(req.body?.type) ? req.body.type : 'auto';
  if (type === 'cpf' && !cpfIsValid(req.body?.query)) return res.status(400).json({ error: 'CPF inválido.' });
  const bundle = findReservation(req.body?.query, type);
  if (!bundle) {
    const message = type === 'qr' ? 'QR Code inválido.' : type === 'cpf' ? 'CPF inválido.' : type === 'reservation' ? 'Número da reserva inválido.' : 'Reserva, UH, CPF ou pulseira não encontrada.';
    return res.status(404).json({ error: message });
  }
  audit('reservation.lookup', bundle.reservation.id, { query_type: type });
  return res.json(bundle);
});

app.post('/api/reservations/:id/upload-token', async (req, res) => {
  const id = Number(req.params.id);
  const reservation = db.prepare('SELECT id FROM reservations WHERE id=?').get(id);
  if (!reservation) return res.status(404).json({ error: 'Reserva não encontrada.' });
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM upload_tokens WHERE reservation_id=?').run(id);
  db.prepare('INSERT INTO upload_tokens(token,reservation_id,expires_at) VALUES(?,?,?)').run(token, id, expires);
  const configured = getRuntimeSetting('public_qr_base_url');
  const origin = configured || `${req.protocol}://${req.get('host')}`;
  const url = `${origin}/upload.html?token=${encodeURIComponent(token)}`;
  const qrDataUrl = await QRCode.toDataURL(url, { width: 420, margin: 2 });
  return res.json({ token, expires_at: expires, url, qr_data_url: qrDataUrl, public_base_url: configured || null });
});

app.get('/api/public/upload/:token', (req, res) => {
  const entry = validUploadToken(req.params.token);
  if (!entry) return res.status(410).json({ error: 'QR Code expirado. Gere um novo no totem.' });
  const reservation = db.prepare('SELECT * FROM reservations WHERE id=?').get(entry.reservation_id);
  if (!reservation) return res.status(404).json({ error: 'Reserva não encontrada.' });
  const guests = db.prepare('SELECT * FROM guests WHERE reservation_id=? ORDER BY adult DESC, id').all(entry.reservation_id);
  const documents = db.prepare('SELECT * FROM documents WHERE reservation_id=? ORDER BY guest_id, type').all(entry.reservation_id);
  return res.json({ reservation, guests, documents });
});

app.post('/api/public/upload/:token/:documentId', upload.single('file'), async (req, res, next) => {
  let activeDoc = null;
  try {
    const entry = validUploadToken(req.params.token);
    if (!entry) {
      removeUploadedFile(req.file);
      return res.status(410).json({ error: 'QR Code expirado. Gere um novo no totem.' });
    }
    if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });

    const documentId = Number(req.params.documentId);
    const doc = db.prepare('SELECT * FROM documents WHERE id=? AND reservation_id=?').get(documentId, entry.reservation_id);
    activeDoc = doc;
    if (!doc) {
      removeUploadedFile(req.file);
      return res.status(404).json({ error: 'Documento não encontrado.' });
    }

    removeStoredFilename(doc.filename);
    db.prepare("UPDATE documents SET filename=?, status='validating', uploaded_at=NULL WHERE id=?").run(req.file.filename, doc.id);

    if (doc.type !== 'identity') {
      db.prepare("UPDATE documents SET status='received', uploaded_at=CURRENT_TIMESTAMP WHERE id=?").run(doc.id);
      audit('document.uploaded', entry.reservation_id, { document_id: doc.id, type: doc.type, validated: false });
      return res.json({ ok: true, accepted: true, status: 'received', detected_type: doc.type, message: 'Arquivo recebido com sucesso.' });
    }

    const validation = await validateIdentityDocument(req.file.path, req.file.mimetype);
    if (validation.accepted) {
      db.prepare("UPDATE documents SET status='received', uploaded_at=CURRENT_TIMESTAMP WHERE id=?").run(doc.id);
      audit('document.identity.validated', entry.reservation_id, { document_id: doc.id, detected_type: validation.detectedType, cpf_detected: validation.cpfDetected });
      return res.json({ ok: true, accepted: true, status: 'received', detected_type: validation.detectedType, message: validation.message });
    }

    removeUploadedFile(req.file);
    const rejectedStatus = validation.systemError ? 'validation_error' : 'invalid';
    db.prepare('UPDATE documents SET filename=NULL, status=?, uploaded_at=NULL WHERE id=?').run(rejectedStatus, doc.id);
    audit(validation.systemError ? 'document.identity.validation_error' : 'document.identity.rejected', entry.reservation_id, { document_id: doc.id, detected_type: validation.detectedType, cpf_detected: validation.cpfDetected });
    return res.json({ ok: true, accepted: false, status: rejectedStatus, detected_type: validation.detectedType, message: validation.message });
  } catch (error) {
    removeUploadedFile(req.file);
    if (activeDoc?.id) {
      try { db.prepare("UPDATE documents SET filename=NULL, status='validation_error', uploaded_at=NULL WHERE id=?").run(activeDoc.id); } catch (_) {}
    }
    return next(error);
  }
});

app.use((err, _req, res, next) => {
  if (!err) return next();
  console.error(err);
  return res.status(400).json({ error: err.message || 'Erro ao processar o arquivo.' });
});

app.use(baseApp);

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Totem API/UI em http://0.0.0.0:${PORT}`);
    console.log('Validação de identidade: OCR local (Tesseract + regras CNH/RG/CIN + CPF).');
  });
}

module.exports = app;
