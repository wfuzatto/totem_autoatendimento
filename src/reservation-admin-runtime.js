const crypto = require('crypto');
const { db, audit } = require('./db');
const { requireAdmin } = require('./auth');

function tableExists(name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function cleanText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function int(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

function initReservationAdminRuntime() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reservation_admin_meta (
      reservation_id INTEGER PRIMARY KEY REFERENCES reservations(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'integration',
      external_id TEXT,
      responsible_email TEXT,
      responsible_phone TEXT,
      notes TEXT,
      last_sync_at TEXT,
      initial_balance_cents INTEGER NOT NULL DEFAULT 0,
      initial_payment_pending INTEGER NOT NULL DEFAULT 0,
      initial_room_number TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_reservation_admin_meta_source
      ON reservation_admin_meta(source);
  `);

  const existing = db.prepare(`
    SELECT r.id, r.reservation_number, r.balance_cents, r.payment_pending, r.room_number
      FROM reservations r
      LEFT JOIN reservation_admin_meta m ON m.reservation_id=r.id
     WHERE m.reservation_id IS NULL
  `).all();

  const insert = db.prepare(`
    INSERT INTO reservation_admin_meta(
      reservation_id,source,initial_balance_cents,initial_payment_pending,initial_room_number,last_sync_at
    ) VALUES(?,?,?,?,?,?)
  `);
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const row of existing) {
      const source = ['RES-10025', 'RES-20080'].includes(row.reservation_number) ? 'demo' : 'integration';
      insert.run(row.id, source, Number(row.balance_cents || 0), Number(row.payment_pending || 0), row.room_number || null, source === 'integration' ? now : null);
    }
  })();
}

function metaFor(id) {
  return db.prepare('SELECT * FROM reservation_admin_meta WHERE reservation_id=?').get(id) || {
    reservation_id: id,
    source: 'integration',
    external_id: null,
    responsible_email: null,
    responsible_phone: null,
    notes: null,
    last_sync_at: null,
    initial_balance_cents: 0,
    initial_payment_pending: 0,
    initial_room_number: null
  };
}

function adminBundle(id) {
  const reservation = db.prepare('SELECT * FROM reservations WHERE id=?').get(id);
  if (!reservation) return null;
  const guests = db.prepare('SELECT * FROM guests WHERE reservation_id=? ORDER BY adult DESC,id').all(id);
  const documents = db.prepare(`
    SELECT d.*, g.name AS guest_name
      FROM documents d
      LEFT JOIN guests g ON g.id=d.guest_id
     WHERE d.reservation_id=?
     ORDER BY d.guest_id,d.type,d.id
  `).all(id);
  const payments = db.prepare('SELECT * FROM payments WHERE reservation_id=? ORDER BY id DESC').all(id);
  const folio = db.prepare(`
    SELECT f.*, g.name AS guest_name
      FROM folio_items f
      LEFT JOIN guests g ON g.id=f.guest_id
     WHERE f.reservation_id=? ORDER BY f.occurred_at DESC,f.id DESC
  `).all(id);
  const wristbandReturns = db.prepare('SELECT * FROM wristband_returns WHERE reservation_id=? ORDER BY id DESC').all(id);
  const processState = tableExists('process_state')
    ? db.prepare('SELECT * FROM process_state WHERE reservation_id=?').get(id) || { govbr_verified: 0 }
    : { govbr_verified: 0 };
  const audits = db.prepare('SELECT * FROM audit_log WHERE reservation_id=? ORDER BY id DESC LIMIT 80').all(id)
    .map(row => {
      let metadata = {};
      try { metadata = JSON.parse(row.metadata || '{}'); } catch (_) {}
      return { ...row, metadata };
    });

  return {
    reservation: {
      ...reservation,
      adults: Number(reservation.adults || 0),
      children: Number(reservation.children || 0),
      balance_cents: Number(reservation.balance_cents || 0),
      payment_pending: Boolean(reservation.payment_pending)
    },
    meta: metaFor(id),
    guests: guests.map(g => ({ ...g, adult: Boolean(g.adult), face_verified: Boolean(g.face_verified) })),
    documents,
    payments,
    folio,
    wristband_returns: wristbandReturns,
    state: { govbr_verified: Boolean(processState.govbr_verified) },
    audit: audits
  };
}

function generateReservationNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const number = `MAN-${stamp}-${suffix}`;
    if (!db.prepare('SELECT 1 FROM reservations WHERE reservation_number=?').get(number)) return number;
  }
  return `MAN-${stamp}-${Date.now().toString(36).toUpperCase()}`;
}

function validateDates(checkin, checkout) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkin) || !/^\d{4}-\d{2}-\d{2}$/.test(checkout)) {
    throw new Error('Informe datas válidas de check-in e check-out.');
  }
  if (checkout < checkin) throw new Error('O check-out não pode ser anterior ao check-in.');
}

function normalizeGuests(payload, responsibleName) {
  const input = Array.isArray(payload) ? payload : [];
  const guests = input
    .map(item => ({
      name: cleanText(item?.name, 160),
      document: cleanText(item?.document, 100) || null,
      adult: item?.adult !== false && item?.adult !== 0 && item?.adult !== '0'
    }))
    .filter(item => item.name);

  if (!guests.length) guests.push({ name: responsibleName, document: null, adult: true });
  if (!guests.some(item => item.adult)) throw new Error('A reserva precisa ter pelo menos um hóspede adulto.');
  return guests;
}

function createManualReservation(payload) {
  const responsibleName = cleanText(payload.responsible_name, 160);
  if (!responsibleName) throw new Error('Informe o nome do responsável.');

  const cpf = digits(payload.responsible_cpf);
  if (cpf && cpf.length !== 11) throw new Error('O CPF do responsável deve ter 11 dígitos.');

  const checkinDate = cleanText(payload.checkin_date, 10);
  const checkoutDate = cleanText(payload.checkout_date, 10);
  validateDates(checkinDate, checkoutDate);

  const guests = normalizeGuests(payload.guests, responsibleName);
  const adults = guests.filter(g => g.adult).length;
  const children = guests.length - adults;
  const balanceCents = int(payload.balance_cents, 0);
  const paymentPending = bool(payload.payment_pending) && balanceCents > 0 ? 1 : 0;
  const roomNumber = cleanText(payload.room_number, 30) || null;
  const reservationNumber = cleanText(payload.reservation_number, 80) || generateReservationNumber();
  const requirePaymentProof = payload.require_payment_proof !== false && payload.require_payment_proof !== 0 && payload.require_payment_proof !== '0';

  if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]{2,80}$/.test(reservationNumber)) throw new Error('Número de reserva inválido.');
  if (db.prepare('SELECT 1 FROM reservations WHERE reservation_number=? COLLATE NOCASE').get(reservationNumber)) {
    throw new Error('Já existe uma reserva com esse número.');
  }

  const insertReservation = db.prepare(`
    INSERT INTO reservations(
      reservation_number,room_number,responsible_name,responsible_cpf,checkin_date,checkout_date,
      status,adults,children,balance_cents,payment_pending
    ) VALUES(?,?,?,?,?,?,'reserved',?,?,?,?)
  `);
  const insertGuest = db.prepare('INSERT INTO guests(reservation_id,name,document,adult,wristband_code,face_verified) VALUES(?,?,?,?,NULL,0)');
  const insertDocument = db.prepare(`
    INSERT INTO documents(reservation_id,guest_id,type,filename,status,uploaded_at)
    VALUES(?,?,?,NULL,'missing',NULL)
  `);

  let id;
  db.transaction(() => {
    id = Number(insertReservation.run(
      reservationNumber, roomNumber, responsibleName, cpf || null, checkinDate, checkoutDate,
      adults, children, balanceCents, paymentPending
    ).lastInsertRowid);

    for (const guest of guests) {
      const guestId = Number(insertGuest.run(id, guest.name, guest.document, guest.adult ? 1 : 0).lastInsertRowid);
      if (guest.adult) insertDocument.run(id, guestId, 'identity');
    }
    if (requirePaymentProof) insertDocument.run(id, null, 'payment_proof');

    db.prepare(`
      INSERT INTO reservation_admin_meta(
        reservation_id,source,external_id,responsible_email,responsible_phone,notes,last_sync_at,
        initial_balance_cents,initial_payment_pending,initial_room_number,updated_at
      ) VALUES(?,?,?,?,?,?,NULL,?,?,?,CURRENT_TIMESTAMP)
    `).run(
      id, 'manual', null,
      cleanText(payload.responsible_email, 180) || null,
      cleanText(payload.responsible_phone, 60) || null,
      cleanText(payload.notes, 2000) || null,
      balanceCents, paymentPending, roomNumber
    );

    if (tableExists('process_state')) {
      db.prepare(`INSERT OR IGNORE INTO process_state(reservation_id,govbr_verified,updated_at) VALUES(?,0,CURRENT_TIMESTAMP)`).run(id);
    }
    audit('reservation.manual.created', id, { reservation_number: reservationNumber, adults, children, balance_cents: balanceCents });
  })();

  return adminBundle(id);
}

function updateReservation(id, payload) {
  const current = db.prepare('SELECT * FROM reservations WHERE id=?').get(id);
  if (!current) return null;

  const checkinDate = cleanText(payload.checkin_date ?? current.checkin_date, 10);
  const checkoutDate = cleanText(payload.checkout_date ?? current.checkout_date, 10);
  validateDates(checkinDate, checkoutDate);

  const allowedStatuses = new Set(['reserved', 'checked_in', 'checked_out', 'cancelled']);
  const status = cleanText(payload.status ?? current.status, 30);
  if (!allowedStatuses.has(status)) throw new Error('Status da reserva inválido.');

  const responsibleName = cleanText(payload.responsible_name ?? current.responsible_name, 160);
  if (!responsibleName) throw new Error('Informe o responsável.');
  const cpf = digits(payload.responsible_cpf ?? current.responsible_cpf);
  if (cpf && cpf.length !== 11) throw new Error('O CPF deve ter 11 dígitos.');

  const balanceCents = payload.balance_cents == null ? Number(current.balance_cents || 0) : int(payload.balance_cents, 0);
  const paymentPending = payload.payment_pending == null ? Number(current.payment_pending || 0) : (bool(payload.payment_pending) && balanceCents > 0 ? 1 : 0);
  const roomNumber = cleanText(payload.room_number ?? current.room_number, 30) || null;

  db.transaction(() => {
    db.prepare(`
      UPDATE reservations
         SET responsible_name=?, responsible_cpf=?, checkin_date=?, checkout_date=?, room_number=?,
             status=?, balance_cents=?, payment_pending=?
       WHERE id=?
    `).run(responsibleName, cpf || null, checkinDate, checkoutDate, roomNumber, status, balanceCents, paymentPending, id);

    const meta = metaFor(id);
    db.prepare(`
      INSERT INTO reservation_admin_meta(
        reservation_id,source,external_id,responsible_email,responsible_phone,notes,last_sync_at,
        initial_balance_cents,initial_payment_pending,initial_room_number,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(reservation_id) DO UPDATE SET
        external_id=excluded.external_id,
        responsible_email=excluded.responsible_email,
        responsible_phone=excluded.responsible_phone,
        notes=excluded.notes,
        updated_at=CURRENT_TIMESTAMP
    `).run(
      id, meta.source || 'integration',
      cleanText(payload.external_id ?? meta.external_id, 160) || null,
      cleanText(payload.responsible_email ?? meta.responsible_email, 180) || null,
      cleanText(payload.responsible_phone ?? meta.responsible_phone, 60) || null,
      cleanText(payload.notes ?? meta.notes, 2000) || null,
      meta.last_sync_at || null,
      Number(meta.initial_balance_cents || 0), Number(meta.initial_payment_pending || 0), meta.initial_room_number || null
    );
    audit('reservation.admin.updated', id, { status, balance_cents: balanceCents, payment_pending: paymentPending });
  })();
  return adminBundle(id);
}

function resetForTotem(id) {
  const reservation = db.prepare('SELECT * FROM reservations WHERE id=?').get(id);
  if (!reservation) return null;
  const meta = metaFor(id);

  db.transaction(() => {
    db.prepare(`
      UPDATE reservations
         SET status='reserved', room_number=?, balance_cents=?, payment_pending=?
       WHERE id=?
    `).run(meta.initial_room_number || null, Number(meta.initial_balance_cents || 0), Number(meta.initial_payment_pending || 0), id);
    db.prepare('UPDATE guests SET wristband_code=NULL,face_verified=0 WHERE reservation_id=?').run(id);
    db.prepare('DELETE FROM wristband_returns WHERE reservation_id=?').run(id);
    db.prepare('DELETE FROM payments WHERE reservation_id=?').run(id);
    db.prepare('DELETE FROM upload_tokens WHERE reservation_id=?').run(id);
    if (tableExists('process_state')) db.prepare('UPDATE process_state SET govbr_verified=0,updated_at=CURRENT_TIMESTAMP WHERE reservation_id=?').run(id);
    if (tableExists('exit_authorizations')) db.prepare('DELETE FROM exit_authorizations WHERE reservation_id=?').run(id);
    audit('reservation.admin.reset_for_totem', id, { documents_preserved: true });
  })();

  return adminBundle(id);
}

function installReservationAdminRuntime(app) {
  initReservationAdminRuntime();

  app.get('/api/admin/reservations', requireAdmin, (req, res) => {
    const search = cleanText(req.query.search, 120).toLowerCase();
    const status = cleanText(req.query.status, 30);
    const source = cleanText(req.query.source, 30);
    const limit = Math.min(250, Math.max(1, int(req.query.limit, 100)));

    let sql = `
      SELECT r.*, m.source, m.external_id, m.responsible_email, m.responsible_phone, m.notes, m.last_sync_at,
             (SELECT COUNT(*) FROM guests g WHERE g.reservation_id=r.id) AS guest_count,
             (SELECT COUNT(*) FROM documents d WHERE d.reservation_id=r.id) AS document_count,
             (SELECT COUNT(*) FROM documents d WHERE d.reservation_id=r.id AND d.status='received') AS documents_received,
             (SELECT COUNT(*) FROM guests g WHERE g.reservation_id=r.id AND g.adult=1 AND g.face_verified=1) AS faces_verified,
             (SELECT COUNT(*) FROM guests g WHERE g.reservation_id=r.id AND g.adult=1 AND COALESCE(g.wristband_code,'')<>'') AS wristbands_encoded,
             (SELECT COUNT(*) FROM payments p WHERE p.reservation_id=r.id AND p.status='approved') AS approved_payments
        FROM reservations r
        LEFT JOIN reservation_admin_meta m ON m.reservation_id=r.id
       WHERE 1=1`;
    const params = [];
    if (search) {
      sql += ` AND (LOWER(r.reservation_number) LIKE ? OR LOWER(r.responsible_name) LIKE ? OR LOWER(COALESCE(r.responsible_cpf,'')) LIKE ? OR LOWER(COALESCE(r.room_number,'')) LIKE ? OR LOWER(COALESCE(m.external_id,'')) LIKE ?)`;
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }
    if (status) { sql += ' AND r.status=?'; params.push(status); }
    if (source) { sql += ' AND COALESCE(m.source,\'integration\')=?'; params.push(source); }
    sql += ' ORDER BY r.checkin_date DESC,r.id DESC LIMIT ?';
    params.push(limit);
    const rows = db.prepare(sql).all(...params).map(row => ({ ...row, payment_pending: Boolean(row.payment_pending) }));

    const statsRows = db.prepare(`
      SELECT r.status,COALESCE(m.source,'integration') AS source,COUNT(*) AS total
        FROM reservations r LEFT JOIN reservation_admin_meta m ON m.reservation_id=r.id
       GROUP BY r.status,COALESCE(m.source,'integration')
    `).all();
    const stats = { total: 0, reserved: 0, checked_in: 0, checked_out: 0, cancelled: 0, manual: 0, integration: 0, demo: 0 };
    for (const row of statsRows) {
      const n = Number(row.total || 0);
      stats.total += n;
      if (Object.prototype.hasOwnProperty.call(stats, row.status)) stats[row.status] += n;
      if (Object.prototype.hasOwnProperty.call(stats, row.source)) stats[row.source] += n;
    }
    res.json({ rows, stats });
  });

  app.get('/api/admin/reservations/:id', requireAdmin, (req, res) => {
    const bundle = adminBundle(Number(req.params.id));
    if (!bundle) return res.status(404).json({ error: 'Reserva não encontrada.' });
    res.json(bundle);
  });

  app.post('/api/admin/reservations', requireAdmin, (req, res) => {
    try {
      const bundle = createManualReservation(req.body || {});
      res.status(201).json(bundle);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put('/api/admin/reservations/:id', requireAdmin, (req, res) => {
    try {
      const bundle = updateReservation(Number(req.params.id), req.body || {});
      if (!bundle) return res.status(404).json({ error: 'Reserva não encontrada.' });
      res.json(bundle);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/admin/reservations/:id/reset-for-totem', requireAdmin, (req, res) => {
    const bundle = resetForTotem(Number(req.params.id));
    if (!bundle) return res.status(404).json({ error: 'Reserva não encontrada.' });
    res.json(bundle);
  });

  app.delete('/api/admin/reservations/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const reservation = db.prepare('SELECT * FROM reservations WHERE id=?').get(id);
    if (!reservation) return res.status(404).json({ error: 'Reserva não encontrada.' });
    const meta = metaFor(id);
    if (meta.source !== 'manual') return res.status(409).json({ error: 'Somente reservas manuais podem ser excluídas por este painel.' });
    audit('reservation.manual.deleted', id, { reservation_number: reservation.reservation_number });
    db.prepare('DELETE FROM reservations WHERE id=?').run(id);
    res.json({ ok: true });
  });
}

module.exports = { installReservationAdminRuntime, initReservationAdminRuntime, adminBundle };
