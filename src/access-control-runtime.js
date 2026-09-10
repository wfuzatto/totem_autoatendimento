const crypto = require('crypto');
const express = require('express');
const { db, getSetting, audit } = require('./db');

function installAccessControlRuntime(app) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wristband_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
      reservation_number TEXT NOT NULL,
      guest_name TEXT NOT NULL,
      room_number TEXT NOT NULL,
      valid_from TEXT,
      valid_until TEXT,
      provider TEXT NOT NULL DEFAULT 'mock',
      status TEXT NOT NULL DEFAULT 'pending',
      wristband_code TEXT,
      external_reference TEXT,
      encoded_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(reservation_id, guest_id)
    );
    CREATE INDEX IF NOT EXISTS idx_wristband_credentials_reservation
      ON wristband_credentials(reservation_id);
  `);

  const boolSetting = key => getSetting(key) === '1';
  const money = value => Number(value || 0);
  const provider = () => String(process.env.HOTEL_CARD_PROVIDER || 'mock').trim().toLowerCase() || 'mock';

  function reservation(id) {
    const row = db.prepare('SELECT * FROM reservations WHERE id=?').get(id);
    if (!row) return null;
    return {
      ...row,
      balance_cents: money(row.balance_cents),
      payment_pending: Boolean(row.payment_pending),
      room_number: String(row.room_number || '').trim()
    };
  }

  function guests(id) {
    return db.prepare('SELECT * FROM guests WHERE reservation_id=? ORDER BY adult DESC,id').all(id)
      .map(row => ({ ...row, adult: Boolean(row.adult), face_verified: Boolean(row.face_verified) }));
  }

  function docsComplete(id) {
    const row = db.prepare("SELECT COUNT(*) AS c FROM documents WHERE reservation_id=? AND status!='received'").get(id);
    return Number(row?.c || 0) === 0;
  }

  function govbrComplete(id) {
    if (!boolSetting('require_govbr')) return true;
    const row = db.prepare('SELECT govbr_verified FROM process_state WHERE reservation_id=?').get(id);
    return Boolean(row?.govbr_verified);
  }

  function faceComplete(id) {
    if (!boolSetting('require_face_match')) return true;
    return !guests(id).filter(guest => guest.adult).some(guest => !guest.face_verified);
  }

  function adultWristbandsEncoded(id) {
    const row = db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN wristband_code IS NOT NULL AND wristband_code != '' THEN 1 ELSE 0 END) AS encoded
        FROM guests
       WHERE reservation_id=? AND adult=1
    `).get(id);
    return Number(row?.total || 0) === Number(row?.encoded || 0);
  }

  function blockersFor(res) {
    const blockers = [];
    if (res.payment_pending || res.balance_cents > 0) {
      blockers.push({ code: 'payment_pending', message: 'Existe pagamento pendente. Quite o saldo antes de gravar qualquer pulseira.' });
    }
    if (!docsComplete(res.id)) {
      blockers.push({ code: 'documents_pending', message: 'Ainda existem documentos pendentes.' });
    }
    if (!govbrComplete(res.id)) {
      blockers.push({ code: 'govbr_pending', message: 'Autenticação gov.br ainda não concluída.' });
    }
    if (!faceComplete(res.id)) {
      blockers.push({ code: 'face_pending', message: 'Validação facial ainda não concluída para todos os hóspedes adultos.' });
    }
    if (!res.room_number) {
      blockers.push({ code: 'room_missing', message: 'UH ainda não atribuída pelo PMS. Não é permitido gravar pulseira sem UH.' });
    }
    if (!res.checkin_date || !res.checkout_date) {
      blockers.push({ code: 'validity_missing', message: 'Período da hospedagem incompleto. Não é permitido gravar a pulseira sem validade.' });
    }
    return blockers;
  }

  function accessContext(res) {
    const blockers = blockersFor(res);
    return {
      reservation_id: res.id,
      reservation_number: res.reservation_number,
      room_number: res.room_number || null,
      checkin_date: res.checkin_date || null,
      checkout_date: res.checkout_date || null,
      provider: provider(),
      ready_for_wristband: blockers.length === 0,
      blockers,
      bis_api_contract: {
        endpoint: '/api/hotel-card/encode',
        request_template: {
          Room: res.room_number || null,
          ValidFrom: null,
          ValidUntil: null,
          GuestName: null
        },
        note: 'ValidFrom/ValidUntil exigem DateTimeOffset exato. A integração PMS/BIS deverá fornecer os horários; o Totem não inventa horários de acesso.'
      }
    };
  }

  app.get('/api/reservations/:id/access-context', (req, res) => {
    const id = Number(req.params.id);
    const current = reservation(id);
    if (!current) return res.status(404).json({ error: 'Reserva não encontrada.' });
    return res.json(accessContext(current));
  });

  app.post('/api/reservations/:id/wristbands/encode', express.json({ limit: '1mb' }), (req, res) => {
    const id = Number(req.params.id);
    const current = reservation(id);
    if (!current) return res.status(404).json({ error: 'Reserva não encontrada.' });

    const blockers = blockersFor(current);
    if (blockers.length) {
      audit('wristband.encode.blocked', id, { blockers: blockers.map(item => item.code) });
      return res.status(409).json({ error: blockers[0].message, blockers, access: accessContext(current) });
    }

    const guestId = Number(req.body?.guest_id);
    const guest = db.prepare('SELECT * FROM guests WHERE id=? AND reservation_id=? AND adult=1').get(guestId, id);
    if (!guest) return res.status(404).json({ error: 'Hóspede adulto não encontrado.' });

    const selectedProvider = provider();
    if (selectedProvider !== 'mock') {
      audit('wristband.encode.provider_not_ready', id, { guest_id: guestId, provider: selectedProvider });
      return res.status(503).json({
        error: `Provider de acesso "${selectedProvider}" ainda não está integrado. Nenhuma pulseira foi gravada.`,
        provider: selectedProvider,
        access: accessContext(current)
      });
    }

    const code = String(req.body?.code || `TOTEM-${id}-${guestId}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`).trim();
    const now = new Date().toISOString();

    db.transaction(() => {
      db.prepare('UPDATE guests SET wristband_code=? WHERE id=?').run(code, guestId);
      db.prepare(`
        INSERT INTO wristband_credentials(
          reservation_id,guest_id,reservation_number,guest_name,room_number,
          valid_from,valid_until,provider,status,wristband_code,external_reference,encoded_at,last_error,updated_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(reservation_id,guest_id) DO UPDATE SET
          reservation_number=excluded.reservation_number,
          guest_name=excluded.guest_name,
          room_number=excluded.room_number,
          valid_from=excluded.valid_from,
          valid_until=excluded.valid_until,
          provider=excluded.provider,
          status=excluded.status,
          wristband_code=excluded.wristband_code,
          external_reference=excluded.external_reference,
          encoded_at=excluded.encoded_at,
          last_error=NULL,
          updated_at=CURRENT_TIMESTAMP
      `).run(
        id,
        guestId,
        current.reservation_number,
        guest.name,
        current.room_number,
        current.checkin_date,
        current.checkout_date,
        selectedProvider,
        'encoded_mock',
        code,
        code,
        now,
        null
      );
    })();

    audit('wristband.encoded', id, {
      guest_id: guestId,
      provider: selectedProvider,
      room_number: current.room_number,
      valid_from: current.checkin_date,
      valid_until: current.checkout_date
    });

    return res.json({
      ok: true,
      code,
      provider: selectedProvider,
      mode: 'mock',
      mock: true,
      access: {
        room_number: current.room_number,
        valid_from: current.checkin_date,
        valid_until: current.checkout_date,
        guest_name: guest.name,
        reservation_number: current.reservation_number
      }
    });
  });

  app.post('/api/reservations/:id/checkin', express.json({ limit: '1mb' }), (req, res) => {
    const id = Number(req.params.id);
    const current = reservation(id);
    if (!current) return res.status(404).json({ error: 'Reserva não encontrada.' });

    const blockers = blockersFor(current);
    if (blockers.length) {
      audit('checkin.blocked_access_prerequisite', id, { blockers: blockers.map(item => item.code) });
      return res.status(409).json({ error: blockers[0].message, blockers });
    }

    if (!adultWristbandsEncoded(id)) {
      return res.status(409).json({ error: 'Grave todas as pulseiras dos hóspedes adultos.' });
    }

    db.prepare("UPDATE reservations SET status='checked_in' WHERE id=?").run(id);
    audit('checkin.completed', id, { room: current.room_number, room_source: 'reservation/pms' });
    const updated = reservation(id);
    return res.json({ ok: true, room_number: updated.room_number, reservation: updated });
  });
}

module.exports = { installAccessControlRuntime };
