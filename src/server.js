const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const QRCode = require('qrcode');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, init, getSetting, getSettings, setSettings, audit } = require('./db');
const { createAdminSession, requireAdmin, revoke } = require('./auth');

init();
db.exec(`CREATE TABLE IF NOT EXISTS process_state (
  reservation_id INTEGER PRIMARY KEY REFERENCES reservations(id) ON DELETE CASCADE,
  govbr_verified INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

const app = express();
const PORT = Number(process.env.PORT || 3080);
const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/vendor/bootstrap', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap', 'dist')));
app.use('/vendor/bootstrap-icons', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap-icons', 'font')));
app.use(express.static(path.join(__dirname, '..', 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).slice(0, 12)}`)
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Formato não permitido. Use PDF, JPG, PNG ou WEBP.'), ok);
  }
});

const boolSetting = key => getSetting(key) === '1';
const money = cents => Number(cents || 0);

function normalizeReservation(row) {
  if (!row) return null;
  return {
    ...row,
    adults: Number(row.adults),
    children: Number(row.children),
    balance_cents: money(row.balance_cents),
    payment_pending: Boolean(row.payment_pending)
  };
}

function reservationBundle(id) {
  const reservation = normalizeReservation(db.prepare('SELECT * FROM reservations WHERE id = ?').get(id));
  if (!reservation) return null;
  const guests = db.prepare('SELECT * FROM guests WHERE reservation_id = ? ORDER BY adult DESC, id').all(id).map(g => ({ ...g, adult: Boolean(g.adult), face_verified: Boolean(g.face_verified) }));
  const documents = db.prepare('SELECT * FROM documents WHERE reservation_id = ? ORDER BY guest_id, type').all(id);
  const state = db.prepare('SELECT * FROM process_state WHERE reservation_id = ?').get(id) || { govbr_verified: 0 };
  return { reservation, guests, documents, state: { govbr_verified: Boolean(state.govbr_verified) } };
}

function buildStatement(id) {
  const bundle = reservationBundle(id);
  if (!bundle) return null;
  const items = db.prepare(`SELECT f.*, g.name AS guest_name FROM folio_items f
    LEFT JOIN guests g ON g.id = f.guest_id WHERE f.reservation_id = ? ORDER BY f.guest_id, f.occurred_at, f.id`).all(id);
  const groups = bundle.guests.map(guest => {
    const guestItems = items.filter(i => i.guest_id === guest.id);
    return {
      guest,
      items: guestItems.map(i => ({ ...i, contested: Boolean(i.contested) })),
      subtotal_cents: guestItems.reduce((sum, i) => sum + money(i.amount_cents), 0)
    };
  });
  const unassigned = items.filter(i => !i.guest_id);
  if (unassigned.length) groups.push({ guest: { id: null, name: 'Conta da reserva' }, items: unassigned, subtotal_cents: unassigned.reduce((s, i) => s + money(i.amount_cents), 0) });
  return { ...bundle, groups, total_cents: items.reduce((sum, i) => sum + money(i.amount_cents), 0), allow_item_contest: boolSetting('allow_item_contest') };
}

function findReservation(query) {
  const raw = String(query || '').trim();
  if (!raw) return null;
  let row = db.prepare('SELECT * FROM reservations WHERE reservation_number = ? COLLATE NOCASE OR room_number = ? COLLATE NOCASE LIMIT 1').get(raw, raw);
  if (!row) {
    const digits = raw.replace(/\D/g, '');
    if (digits) row = db.prepare("SELECT * FROM reservations WHERE REPLACE(REPLACE(REPLACE(responsible_cpf,'.',''),'-',''),' ','') = ? LIMIT 1").get(digits);
  }
  if (!row) {
    row = db.prepare(`SELECT r.* FROM guests g JOIN reservations r ON r.id=g.reservation_id WHERE g.wristband_code = ? COLLATE NOCASE LIMIT 1`).get(raw);
  }
  return row ? reservationBundle(row.id) : null;
}

function docsComplete(id) {
  const missing = db.prepare("SELECT COUNT(*) AS c FROM documents WHERE reservation_id=? AND status!='received'").get(id).c;
  return missing === 0;
}

function adultWristbandsEncoded(id) {
  const row = db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN wristband_code IS NOT NULL AND wristband_code != "" THEN 1 ELSE 0 END) AS encoded FROM guests WHERE reservation_id=? AND adult=1').get(id);
  return Number(row.total || 0) === Number(row.encoded || 0);
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'totem-autoatendimento', time: new Date().toISOString() }));

app.get('/api/config', (_req, res) => {
  const s = getSettings();
  res.json({
    hotel_name: s.hotel_name,
    theme_skin: s.theme_skin || 'vale_mantiqueira',
    allow_item_contest: s.allow_item_contest === '1',
    require_govbr: s.require_govbr === '1',
    require_face_match: s.require_face_match === '1',
    require_wristband_return: s.require_wristband_return === '1',
    enable_accessibility_toolbar: s.enable_accessibility_toolbar === '1',
    inactivity_seconds: Number(s.inactivity_seconds || 120)
  });
});

app.post('/api/admin/login', (req, res) => {
  const token = createAdminSession(String(req.body.password || ''));
  if (!token) return res.status(401).json({ error: 'Senha inválida.' });
  audit('admin.login');
  res.json({ token });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  revoke(req.adminToken);
  res.json({ ok: true });
});

app.get('/api/admin/settings', requireAdmin, (_req, res) => res.json(getSettings({ includeSecrets: false })));

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  setSettings(req.body || {});
  audit('admin.settings.updated', null, { keys: Object.keys(req.body || {}) });
  res.json(getSettings({ includeSecrets: false }));
});

app.post('/api/admin/prepare-exit', requireAdmin, (_req, res) => {
  audit('admin.kiosk.exit');
  res.json({ ok: true, exit_allowed: true });
});

app.get('/api/admin/hardware', requireAdmin, (_req, res) => res.json({
  nfc: { mode: getSetting('nfc_mode'), device: 'ACS ACR122U', status: getSetting('nfc_mode') === 'mock' ? 'simulado' : 'aguardando bridge PC/SC' },
  printer: { mode: getSetting('printer_mode'), device: 'POS 80 mm', status: 'adapter preparado' },
  payment: { provider: getSetting('payment_provider'), device: 'Gertec PPC930', sitef_server: getSetting('sitef_server') || '', status: getSetting('payment_provider') === 'mock' ? 'simulado' : 'aguardando homologação' },
  webcam: { mode: getSetting('webcam_mode'), status: 'browser/getUserMedia' },
  hotel_api: { provider: getSetting('api_provider'), base_url: getSetting('totvs_base_url') || '', status: getSetting('api_provider') === 'mock' ? 'simulado' : 'configurado para adapter externo' }
}));

app.post('/api/reservations/lookup', (req, res) => {
  if (getSetting('api_provider') !== 'mock') {
    return res.status(501).json({ error: 'Adapter TOTVS selecionado. Configure os endpoints específicos da Guest API antes de usar o modo live.' });
  }
  const bundle = findReservation(req.body.query);
  if (!bundle) return res.status(404).json({ error: 'Reserva, UH, CPF ou pulseira não encontrada.' });
  audit('reservation.lookup', bundle.reservation.id, { query_type: req.body.type || 'auto' });
  res.json(bundle);
});

app.get('/api/reservations/:id', (req, res) => {
  const bundle = reservationBundle(Number(req.params.id));
  if (!bundle) return res.status(404).json({ error: 'Reserva não encontrada.' });
  res.json(bundle);
});

app.get('/api/reservations/:id/statement', (req, res) => {
  const statement = buildStatement(Number(req.params.id));
  if (!statement) return res.status(404).json({ error: 'Reserva não encontrada.' });
  res.json(statement);
});

app.post('/api/reservations/:id/statement/:itemId/contest', (req, res) => {
  if (!boolSetting('allow_item_contest')) return res.status(403).json({ error: 'Contestação desativada.' });
  const id = Number(req.params.id);
  const info = db.prepare('UPDATE folio_items SET contested=1 WHERE id=? AND reservation_id=?').run(Number(req.params.itemId), id);
  if (!info.changes) return res.status(404).json({ error: 'Item não encontrado.' });
  audit('folio.item.contested', id, { item_id: Number(req.params.itemId) });
  res.json(buildStatement(id));
});

app.get('/api/reservations/:id/wristbands/returns', (req, res) => {
  const id = Number(req.params.id);
  const expected = db.prepare('SELECT adults FROM reservations WHERE id=?').get(id)?.adults;
  const returned = db.prepare('SELECT code, returned_at FROM wristband_returns WHERE reservation_id=? ORDER BY id').all(id);
  res.json({ expected: Number(expected || 0), returned_count: returned.length, returned, complete: returned.length >= Number(expected || 0) });
});

app.post('/api/reservations/:id/wristbands/return', (req, res) => {
  const id = Number(req.params.id);
  const code = String(req.body.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Leia ou informe a pulseira.' });
  const guest = db.prepare('SELECT * FROM guests WHERE reservation_id=? AND wristband_code=? AND adult=1').get(id, code);
  if (!guest) return res.status(400).json({ error: 'Essa pulseira não pertence a um hóspede adulto desta reserva.' });
  const exists = db.prepare('SELECT 1 FROM wristband_returns WHERE reservation_id=? AND code=?').get(id, code);
  if (!exists) db.prepare('INSERT INTO wristband_returns(reservation_id,code) VALUES(?,?)').run(id, code);
  audit('wristband.returned', id, { guest_id: guest.id });
  const expected = db.prepare('SELECT adults FROM reservations WHERE id=?').get(id).adults;
  const returned = db.prepare('SELECT code, returned_at FROM wristband_returns WHERE reservation_id=? ORDER BY id').all(id);
  res.json({ expected: Number(expected), returned_count: returned.length, returned, complete: returned.length >= Number(expected) });
});

app.post('/api/reservations/:id/upload-token', async (req, res) => {
  const id = Number(req.params.id);
  if (!reservationBundle(id)) return res.status(404).json({ error: 'Reserva não encontrada.' });
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM upload_tokens WHERE reservation_id=?').run(id);
  db.prepare('INSERT INTO upload_tokens(token,reservation_id,expires_at) VALUES(?,?,?)').run(token, id, expires);
  const origin = `${req.protocol}://${req.get('host')}`;
  const url = `${origin}/upload.html?token=${token}`;
  const qr_data_url = await QRCode.toDataURL(url, { width: 420, margin: 2 });
  res.json({ token, expires_at: expires, url, qr_data_url: qr_data_url });
});

function validUploadToken(token) {
  return db.prepare("SELECT * FROM upload_tokens WHERE token=? AND expires_at > datetime('now')").get(token);
}

app.get('/api/public/upload/:token', (req, res) => {
  const entry = validUploadToken(req.params.token);
  if (!entry) return res.status(410).json({ error: 'QR Code expirado. Gere um novo no totem.' });
  const bundle = reservationBundle(entry.reservation_id);
  res.json({ reservation: bundle.reservation, guests: bundle.guests, documents: bundle.documents });
});

app.post('/api/public/upload/:token/:documentId', upload.single('file'), (req, res) => {
  const entry = validUploadToken(req.params.token);
  if (!entry) return res.status(410).json({ error: 'QR Code expirado.' });
  if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
  const doc = db.prepare('SELECT * FROM documents WHERE id=? AND reservation_id=?').get(Number(req.params.documentId), entry.reservation_id);
  if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });
  db.prepare("UPDATE documents SET filename=?, status='received', uploaded_at=CURRENT_TIMESTAMP WHERE id=?").run(req.file.filename, doc.id);
  audit('document.uploaded', entry.reservation_id, { document_id: doc.id, type: doc.type });
  res.json({ ok: true });
});

app.post('/api/reservations/:id/govbr/verify', (req, res) => {
  const id = Number(req.params.id);
  if (!boolSetting('require_govbr')) return res.json({ ok: true, skipped: true });
  db.prepare(`INSERT INTO process_state(reservation_id,govbr_verified,updated_at) VALUES(?,1,CURRENT_TIMESTAMP)
    ON CONFLICT(reservation_id) DO UPDATE SET govbr_verified=1, updated_at=CURRENT_TIMESTAMP`).run(id);
  audit('govbr.mock.verified', id);
  res.json({ ok: true, mock: true, message: 'Autenticação gov.br simulada no MVP.' });
});

app.post('/api/reservations/:id/face/verify', (req, res) => {
  const id = Number(req.params.id);
  const guestId = Number(req.body.guest_id);
  if (!boolSetting('require_face_match')) return res.json({ ok: true, skipped: true });
  if (!req.body.capture) return res.status(400).json({ error: 'Capture o rosto pela webcam.' });
  const guest = db.prepare('SELECT * FROM guests WHERE id=? AND reservation_id=? AND adult=1').get(guestId, id);
  if (!guest) return res.status(404).json({ error: 'Hóspede não encontrado.' });
  db.prepare('UPDATE guests SET face_verified=1 WHERE id=?').run(guestId);
  audit('face.mock.verified', id, { guest_id: guestId, score: 0.98 });
  res.json({ ok: true, mock: true, matched: true, score: 0.98, warning: 'Comparação facial simulada. O motor biométrico real ainda deve ser homologado.' });
});

app.post('/api/reservations/:id/wristbands/encode', (req, res) => {
  const id = Number(req.params.id);
  const guestId = Number(req.body.guest_id);
  const guest = db.prepare('SELECT * FROM guests WHERE id=? AND reservation_id=? AND adult=1').get(guestId, id);
  if (!guest) return res.status(404).json({ error: 'Hóspede adulto não encontrado.' });
  const code = String(req.body.code || `TOTEM-${id}-${guestId}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`).trim();
  db.prepare('UPDATE guests SET wristband_code=? WHERE id=?').run(code, guestId);
  audit('wristband.encoded', id, { guest_id: guestId, mode: getSetting('nfc_mode') });
  res.json({ ok: true, code, mode: getSetting('nfc_mode'), mock: getSetting('nfc_mode') === 'mock' });
});

app.post('/api/reservations/:id/payment', (req, res) => {
  const id = Number(req.params.id);
  const method = String(req.body.method || 'pix');
  if (!['pix','debit','credit'].includes(method)) return res.status(400).json({ error: 'Forma de pagamento inválida.' });
  const reservation = db.prepare('SELECT * FROM reservations WHERE id=?').get(id);
  if (!reservation) return res.status(404).json({ error: 'Reserva não encontrada.' });
  const amount = Number(req.body.amount_cents ?? reservation.balance_cents ?? 0);
  const provider = getSetting('payment_provider');
  const ref = `MOCK-${Date.now()}`;
  db.prepare('INSERT INTO payments(reservation_id,method,amount_cents,status,external_reference) VALUES(?,?,?,?,?)').run(id, method, amount, 'approved', ref);
  db.prepare('UPDATE reservations SET payment_pending=0, balance_cents=0 WHERE id=?').run(id);
  audit('payment.approved', id, { method, provider, amount_cents: amount, reference: ref });
  res.json({ ok: true, approved: true, provider, mock: provider === 'mock', reference: ref });
});

app.post('/api/reservations/:id/checkin', (req, res) => {
  const id = Number(req.params.id);
  const bundle = reservationBundle(id);
  if (!bundle) return res.status(404).json({ error: 'Reserva não encontrada.' });
  if (!docsComplete(id)) return res.status(409).json({ error: 'Ainda existem documentos pendentes.' });
  if (boolSetting('require_govbr') && !bundle.state.govbr_verified) return res.status(409).json({ error: 'Autenticação gov.br ainda não concluída.' });
  if (boolSetting('require_face_match') && bundle.guests.filter(g => g.adult).some(g => !g.face_verified)) return res.status(409).json({ error: 'Validação facial pendente.' });
  if (!adultWristbandsEncoded(id)) return res.status(409).json({ error: 'Grave todas as pulseiras dos hóspedes adultos.' });
  if (bundle.reservation.payment_pending) return res.status(409).json({ error: 'Existe pagamento pendente.' });
  const room = bundle.reservation.room_number || String(100 + id);
  db.prepare("UPDATE reservations SET status='checked_in', room_number=? WHERE id=?").run(room, id);
  audit('checkin.completed', id, { room });
  res.json({ ok: true, room_number: room, reservation: reservationBundle(id).reservation });
});

app.post('/api/reservations/:id/checkout', (req, res) => {
  const id = Number(req.params.id);
  const bundle = reservationBundle(id);
  if (!bundle) return res.status(404).json({ error: 'Reserva não encontrada.' });
  if (boolSetting('require_wristband_return')) {
    const returned = db.prepare('SELECT COUNT(*) AS c FROM wristband_returns WHERE reservation_id=?').get(id).c;
    if (Number(returned) < bundle.reservation.adults) return res.status(409).json({ error: `Devolva ${bundle.reservation.adults} pulseira(s) de adulto antes do checkout.` });
  }
  if (bundle.reservation.payment_pending) return res.status(409).json({ error: 'Existe pagamento pendente.' });
  db.prepare("UPDATE reservations SET status='checked_out' WHERE id=?").run(id);
  audit('checkout.completed', id);
  res.json({ ok: true, reservation: reservationBundle(id).reservation });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Erro inesperado.' });
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log(`Totem API/UI em http://0.0.0.0:${PORT}`));
}

module.exports = app;
