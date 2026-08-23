const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { db, audit } = require('./db');
const { requireAdmin } = require('./auth');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const uploadsDir = process.env.UPLOAD_DIR || path.join(dataDir, 'uploads');
const brandingDir = process.env.BRANDING_DIR || path.join(dataDir, 'branding');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(brandingDir, { recursive: true });

function runtimeSetting(key) {
  return db.prepare('SELECT value FROM runtime_settings WHERE key=?').get(key)?.value || '';
}

function setRuntimeSetting(key, value) {
  db.prepare(`INSERT INTO runtime_settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).run(key, String(value || ''));
}

function ensureRuntimeSetting(key, value = '') {
  db.prepare('INSERT OR IGNORE INTO runtime_settings(key,value) VALUES(?,?)').run(key, value);
}

function normalizeGovbrUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let parsed;
  try { parsed = new URL(raw); } catch (_) { throw new Error('Informe uma URL válida para o fluxo gov.br do hotel.'); }
  if (parsed.protocol !== 'https:') throw new Error('O link gov.br do hotel deve usar HTTPS.');
  parsed.hash = '';
  return parsed.toString();
}

function removeStoredFilename(filename) {
  if (!filename) return;
  const safeName = path.basename(String(filename));
  try { fs.unlinkSync(path.join(uploadsDir, safeName)); } catch (_) {}
}

function validUploadToken(token) {
  const entry = db.prepare('SELECT * FROM upload_tokens WHERE token=?').get(token);
  if (!entry) return null;
  const expiresAt = Date.parse(entry.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return entry;
}

function currentGovbrQr() {
  const filename = path.basename(runtimeSetting('govbr_qr_filename'));
  if (!filename) return null;
  const full = path.join(brandingDir, filename);
  if (!fs.existsSync(full)) return null;
  const stat = fs.statSync(full);
  return { filename, full, url: `/api/branding/govbr-qr?v=${Math.floor(stat.mtimeMs)}` };
}

const govbrQrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('QR Code gov.br inválido. Use PNG, JPG ou WEBP.'), ok);
  }
});

function removeDocument({ reservationId, documentId }) {
  const reservation = db.prepare('SELECT * FROM reservations WHERE id=?').get(reservationId);
  if (!reservation) return { error: 'Reserva não encontrada.', status: 404 };
  if (reservation.status === 'checked_in') return { error: 'O check-in já foi concluído. Procure a recepção para alterar documentos.', status: 409 };

  const doc = db.prepare('SELECT * FROM documents WHERE id=? AND reservation_id=?').get(documentId, reservationId);
  if (!doc) return { error: 'Documento não encontrado.', status: 404 };

  removeStoredFilename(doc.filename);
  db.prepare("UPDATE documents SET filename=NULL,status='pending',uploaded_at=NULL WHERE id=?").run(doc.id);
  audit('document.removed', reservationId, { document_id: doc.id, type: doc.type });
  return { ok: true, status: 'pending', document_id: doc.id, message: 'Documento removido. Envie novamente o arquivo correto.' };
}

function govbrConfig() {
  const qr = currentGovbrQr();
  const url = runtimeSetting('govbr_hotel_url');
  return {
    govbr_qr_url: qr?.url || null,
    govbr_qr_configured: Boolean(qr),
    govbr_hotel_url: url || null,
    govbr_iframe_configured: Boolean(url)
  };
}

function installV2Runtime(app) {
  ensureRuntimeSetting('govbr_qr_filename', '');
  ensureRuntimeSetting('govbr_hotel_url', '');

  app.get('/api/v2/govbr-config', (_req, res) => {
    res.json(govbrConfig());
  });

  app.get('/api/branding/govbr-qr', (_req, res) => {
    const qr = currentGovbrQr();
    if (!qr) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(qr.full);
  });

  app.get('/api/admin/v2/govbr-qr', requireAdmin, (_req, res) => {
    res.json(govbrConfig());
  });

  app.put('/api/admin/v2/govbr-settings', requireAdmin, (req, res) => {
    try {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'govbr_hotel_url')) {
        setRuntimeSetting('govbr_hotel_url', normalizeGovbrUrl(req.body.govbr_hotel_url));
      }
      audit('admin.govbr_settings.updated', null, { keys: Object.keys(req.body || {}) });
      return res.json({ ok: true, ...govbrConfig() });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/admin/v2/govbr-qr', requireAdmin, govbrQrUpload.single('qr'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Selecione a imagem do QR Code gov.br.' });
    const extension = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' })[req.file.mimetype];
    for (const file of fs.readdirSync(brandingDir)) {
      if (/^govbr-checkin-qr\.(png|jpg|webp)$/i.test(file)) {
        try { fs.unlinkSync(path.join(brandingDir, file)); } catch (_) {}
      }
    }
    const filename = `govbr-checkin-qr${extension}`;
    fs.writeFileSync(path.join(brandingDir, filename), req.file.buffer);
    setRuntimeSetting('govbr_qr_filename', filename);
    audit('admin.govbr_qr.updated', null, { mimetype: req.file.mimetype, bytes: req.file.size });
    return res.json({ ok: true, ...govbrConfig() });
  });

  app.delete('/api/admin/v2/govbr-qr', requireAdmin, (_req, res) => {
    const qr = currentGovbrQr();
    if (qr) { try { fs.unlinkSync(qr.full); } catch (_) {} }
    setRuntimeSetting('govbr_qr_filename', '');
    audit('admin.govbr_qr.removed');
    return res.json({ ok: true, ...govbrConfig() });
  });

  app.delete('/api/public/upload/:token/:documentId', (req, res) => {
    const entry = validUploadToken(req.params.token);
    if (!entry) return res.status(410).json({ error: 'QR Code expirado. Gere um novo no totem.' });
    const result = removeDocument({ reservationId: entry.reservation_id, documentId: Number(req.params.documentId) });
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });

  app.delete('/api/reservations/:id/documents/:documentId', (req, res) => {
    const result = removeDocument({ reservationId: Number(req.params.id), documentId: Number(req.params.documentId) });
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  });
}

module.exports = { installV2Runtime, normalizeGovbrUrl };
