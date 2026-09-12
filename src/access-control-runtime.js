const crypto = require('crypto');
const express = require('express');
const { db, getSetting, audit } = require('./db');
const bisApi = require('./bis-api-client');

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
  const provider = () => String(process.env.HOTEL_CARD_PROVIDER || (process.env.NODE_ENV === 'production' ? 'bis_api' : 'mock')).trim().toLowerCase();
  const encodingInFlight = new Set();
  let readerBusy = false;
  let awaitingRemoval = false;
  let removalNoCardReads = 0;
  const requiredRemovalReads = 2;

  function realCredential(guestId) {
    const row = db.prepare("SELECT * FROM wristband_credentials WHERE guest_id=? AND provider='bis_api' AND status='encoded'").get(guestId);
    return row && bisApi.validUid(row.wristband_code) ? row : null;
  }

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
    if (provider() === 'bis_api') return guests(id).filter(g => g.adult).every(g => realCredential(g.id));
    const row = db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN wristband_code IS NOT NULL AND wristband_code != '' THEN 1 ELSE 0 END) AS encoded
        FROM guests
       WHERE reservation_id=? AND adult=1
    `).get(id);
    return Number(row?.total || 0) === Number(row?.encoded || 0);
  }

  function providerBlockers(res) {
    if (provider() !== 'bis_api') return [];
    return bisApi.staticBlockers(res);
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
    blockers.push(...providerBlockers(res));
    return blockers;
  }

  function resolvedWindow(res) {
    if (provider() !== 'bis_api') return { validFrom: res.checkin_date || null, validUntil: res.checkout_date || null };
    try { return bisApi.accessWindow(res); }
    catch (_) { return { validFrom: null, validUntil: null }; }
  }

  function hasConfirmedVendorWriteFailure(error) {
    const failure = error?.details?.writeFailure;
    return error?.code === 'bis_api_vendor_write_failed'
      && failure?.written === false
      && Number.isInteger(failure.vendorResult)
      && failure.vendorResult !== 0;
  }

  function accessContext(res) {
    const blockers = blockersFor(res);
    const window = resolvedWindow(res);
    return {
      reservation_id: res.id,
      reservation_number: res.reservation_number,
      room_number: res.room_number || null,
      checkin_date: res.checkin_date || null,
      checkout_date: res.checkout_date || null,
      valid_from: window.validFrom,
      valid_until: window.validUntil,
      provider: provider(),
      credentials: guests(res.id).filter(g => g.adult).map(g => ({
        guest_id: g.id,
        uid: provider() === 'bis_api' ? realCredential(g.id)?.wristband_code || null : g.wristband_code || null
      })),
      ready_for_wristband: blockers.length === 0,
      blockers,
      bis_api: provider() === 'bis_api' ? {
        configured: bisApi.staticBlockers(res).length === 0,
        timeout_ms: bisApi.providerConfig().timeoutMs
      } : null,
      bis_api_contract: {
        endpoint: '/api/hotel-card/encode',
        request_template: {
          RoomOrDoorId: res.room_number || null,
          ValidFrom: window.validFrom,
          ValidUntil: window.validUntil,
          Confirmation: '[server-side]',
          GuestName: null
        }
      }
    };
  }

  function upsertCredential({ current, guest, selectedProvider, status, code = null, externalReference = null, encodedAt = null, lastError = null, validFrom = null, validUntil = null }) {
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
        wristband_code=COALESCE(excluded.wristband_code,wristband_credentials.wristband_code),
        external_reference=COALESCE(excluded.external_reference,wristband_credentials.external_reference),
        encoded_at=COALESCE(excluded.encoded_at,wristband_credentials.encoded_at),
        last_error=excluded.last_error,
        updated_at=CURRENT_TIMESTAMP
    `).run(
      current.id,
      guest.id,
      current.reservation_number,
      guest.name,
      current.room_number,
      validFrom,
      validUntil,
      selectedProvider,
      status,
      code,
      externalReference,
      encodedAt,
      lastError
    );
  }

  app.get('/api/reservations/:id/access-context', (req, res) => {
    const id = Number(req.params.id);
    const current = reservation(id);
    if (!current) return res.status(404).json({ error: 'Reserva não encontrada.' });
    return res.json(accessContext(current));
  });

  app.get('/api/access-control/status', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    if (provider() === 'mock') return res.json({ ok: true, provider: 'mock', mock: true, online: true });
    if (provider() !== 'bis_api') return res.json({ ok: false, provider: provider(), error: 'Provedor de gravação inválido.' });
    return res.json(await bisApi.hardwareStatus());
  });

  app.get('/api/access-control/card-status', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    if (provider() !== 'bis_api') return res.json({ ok: false, provider: provider(), error: 'Gravação real não configurada.' });
    if (readerBusy) return res.json({ ok: true, provider: 'bis_api', busy: true, present: null, awaiting_removal: awaitingRemoval });
    readerBusy = true;
    try {
      const status = await bisApi.hardwareStatus();
      if (!status.ready_for_write) return res.json({ ...status, present: null });
      const card = await bisApi.cardStatus(status.reader);
      // Require two consecutive explicit PC/SC no-card responses before allowing
      // the next guest. A transient reader gap must not release the previous UID.
      if (card.present === false) {
        removalNoCardReads += 1;
        if (removalNoCardReads >= requiredRemovalReads) awaitingRemoval = false;
      } else if (card.present === true) {
        removalNoCardReads = 0;
      }
      return res.json({ ok: true, provider: 'bis_api', present: card.present, reader: card.reader, uidHex: card.uidHex || null, awaiting_removal: awaitingRemoval });
    } catch (error) {
      return res.json({ ok: false, provider: 'bis_api', present: null, error: error.message, code: error.code || 'bis_api_error' });
    } finally { readerBusy = false; }
  });

  app.post('/api/reservations/:id/wristbands/:guestId/recover', express.json({ limit: '1mb' }), async (req, res) => {
    const id = Number(req.params.id);
    const guestId = Number(req.params.guestId);
    const current = reservation(id);
    if (!current) return res.status(404).json({ error: 'Reserva não encontrada.' });
    if (provider() !== 'bis_api') return res.status(409).json({ error: 'Recuperação disponível somente para o BisApi.', code: 'provider_not_real' });

    const guest = db.prepare('SELECT * FROM guests WHERE id=? AND reservation_id=? AND adult=1').get(guestId, id);
    if (!guest) return res.status(404).json({ error: 'Hóspede adulto não encontrado.' });
    const previous = db.prepare("SELECT * FROM wristband_credentials WHERE reservation_id=? AND guest_id=? AND provider='bis_api'").get(id, guestId);
    if (previous?.status !== 'uncertain') {
      return res.status(409).json({ error: 'Não existe uma gravação incerta a recuperar para esta pulseira.', code: 'recovery_not_needed' });
    }

    const expectedUid = String(req.body?.expected_uid || '').trim().toUpperCase();
    if (!bisApi.validUid(expectedUid)) {
      return res.status(400).json({ error: 'UID da pulseira inválido para recuperação.', code: 'uid_invalid' });
    }
    if (readerBusy) return res.status(409).json({ error: 'Leitor ocupado. Aguarde a conclusão da operação atual.', code: 'reader_busy' });

    readerBusy = true;
    try {
      const status = await bisApi.hardwareStatus();
      if (!status.ready_for_write) throw new bisApi.BisApiError(status.error, { status: 503, code: status.code });
      const card = await bisApi.cardStatus(status.reader);
      if (!card.present) throw new bisApi.BisApiError('Aproxime a mesma pulseira antes de confirmar a reemissão.', { status: 409, code: 'card_absent' });
      if (card.uidHex !== expectedUid) throw new bisApi.BisApiError('A pulseira no leitor não corresponde à tentativa anterior.', { status: 409, code: 'card_changed' });

      const duplicate = db.prepare("SELECT guest_id FROM wristband_credentials WHERE reservation_id=? AND provider='bis_api' AND status='encoded' AND wristband_code=? AND guest_id<>?")
        .get(id, card.uidHex, guestId);
      if (duplicate) throw new bisApi.BisApiError('Esta pulseira já pertence a outro hóspede da reserva. Aproxime outra pulseira.', { status: 409, code: 'uid_in_use' });

      db.prepare("UPDATE wristband_credentials SET status='failed',last_error='Reemissão autorizada após confirmação física da pulseira.',updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(previous.id);
      awaitingRemoval = true;
      removalNoCardReads = 0;
      audit('wristband.encode.recovery_confirmed', id, { guest_id: guestId, provider: 'bis_api', room_number: current.room_number, uid: card.uidHex });
      return res.json({ ok: true, provider: 'bis_api', recovered: true, code: card.uidHex, instruction: 'Retire a pulseira antes da nova tentativa.' });
    } catch (error) {
      return res.status(Number(error?.status || 502)).json({
        error: error?.message || 'Não foi possível confirmar a recuperação da pulseira.',
        code: error?.code || 'recovery_failed',
        provider: 'bis_api'
      });
    } finally { readerBusy = false; }
  });

  app.post('/api/reservations/:id/wristbands/encode', express.json({ limit: '1mb' }), async (req, res) => {
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

    const existingCode = provider() === 'bis_api' ? realCredential(guestId)?.wristband_code : guest.wristband_code;
    if (existingCode) {
      return res.json({
        ok: true,
        already_encoded: true,
        code: existingCode,
        provider: provider(),
        access: accessContext(current)
      });
    }

    const selectedProvider = provider();
    if (selectedProvider === 'mock') {
      const code = String(req.body?.code || `TOTEM-${id}-${guestId}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`).trim();
      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare('UPDATE guests SET wristband_code=? WHERE id=?').run(code, guestId);
        upsertCredential({
          current,
          guest,
          selectedProvider,
          status: 'encoded_mock',
          code,
          externalReference: code,
          encodedAt: now,
          validFrom: current.checkin_date,
          validUntil: current.checkout_date
        });
      })();
      audit('wristband.encoded', id, { guest_id: guestId, provider: selectedProvider, room_number: current.room_number });
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
    }

    if (selectedProvider !== 'bis_api') {
      audit('wristband.encode.provider_not_ready', id, { guest_id: guestId, provider: selectedProvider });
      return res.status(503).json({
        error: `Provider de acesso "${selectedProvider}" não suportado. Nenhuma pulseira foi gravada.`,
        provider: selectedProvider,
        access: accessContext(current)
      });
    }

    const lockKey = `${id}:${guestId}`;
    if (encodingInFlight.has(lockKey) || readerBusy) {
      return res.status(409).json({ error: 'Já existe uma gravação em andamento para este hóspede. Aguarde a conclusão.' });
    }
    encodingInFlight.add(lockKey);
    readerBusy = true;

    let window = { validFrom: null, validUntil: null };
    let writeDispatched = false;
    try {
      const previous = db.prepare('SELECT status FROM wristband_credentials WHERE guest_id=?').get(guestId);
      if (['encoding', 'uncertain'].includes(previous?.status)) {
        throw new bisApi.BisApiError('Resultado anterior incerto. Solicite à recepção a conferência da pulseira antes de reemitir.', { status: 409, code: 'write_uncertain' });
      }
      if (awaitingRemoval) throw new bisApi.BisApiError('Retire a pulseira anterior do leitor.', { status: 409, code: 'awaiting_removal' });
      const status = await bisApi.hardwareStatus();
      if (!status.ready_for_write) throw new bisApi.BisApiError(status.error, { status: 503, code: status.code });
      const card = await bisApi.cardStatus(status.reader);
      if (!card.present) throw new bisApi.BisApiError('Nenhuma pulseira detectada.', { status: 409, code: 'card_absent' });
      if (!bisApi.validUid(req.body?.expected_uid) || card.uidHex !== String(req.body.expected_uid).toUpperCase()) {
        throw new bisApi.BisApiError('Pulseira retirada ou trocada antes da gravação.', { status: 409, code: 'card_changed' });
      }
      const duplicate = db.prepare("SELECT guest_id FROM wristband_credentials WHERE reservation_id=? AND provider='bis_api' AND status='encoded' AND wristband_code=? AND guest_id<>?").get(id, card.uidHex, guestId);
      if (duplicate) throw new bisApi.BisApiError('Esta pulseira já pertence a outro hóspede da reserva. Aproxime outra pulseira.', { status: 409, code: 'uid_in_use' });
      window = bisApi.accessWindow(current);
      upsertCredential({
        current,
        guest,
        selectedProvider,
        status: 'encoding',
        validFrom: window.validFrom,
        validUntil: window.validUntil
      });
      audit('wristband.encode.started', id, {
        guest_id: guestId,
        provider: selectedProvider,
        room_number: current.room_number,
        valid_from: window.validFrom,
        valid_until: window.validUntil
      });

      writeDispatched = true;
      awaitingRemoval = true;
      removalNoCardReads = 0;
      const hardware = await bisApi.encodeHotelCard({ reservation: current, guest });
      if (!bisApi.validUid(hardware.uidHex) || hardware.uidHex !== card.uidHex) {
        throw new bisApi.BisApiError('O bis_api confirmou a gravação, mas não retornou o UID do cartão.', {
          status: 502,
          code: 'bis_api_uid_missing',
          details: hardware.raw
        });
      }

      const code = hardware.uidHex;
      const now = new Date().toISOString();
      const externalReference = JSON.stringify({
        guest_serial: hardware.guestSerial,
        holder_serial: hardware.holderSerial,
        reader: hardware.reader,
        door_id: hardware.doorId,
        vendor_result: hardware.vendorResult
      });

      db.transaction(() => {
        db.prepare('UPDATE guests SET wristband_code=? WHERE id=?').run(code, guestId);
        upsertCredential({
          current,
          guest,
          selectedProvider,
          status: 'encoded',
          code,
          externalReference,
          encodedAt: now,
          validFrom: hardware.validFrom,
          validUntil: hardware.validUntil,
          lastError: null
        });
      })();

      audit('wristband.encoded', id, {
        guest_id: guestId,
        provider: selectedProvider,
        room_number: current.room_number,
        uid: code,
        reader: hardware.reader,
        door_id: hardware.doorId,
        guest_serial: hardware.guestSerial
      });

      return res.json({
        ok: true,
        code,
        provider: selectedProvider,
        mode: 'real',
        mock: false,
        message: hardware.message,
        hardware: {
          reader: hardware.reader,
          uid: code,
          door_id: hardware.doorId,
          vendor_result: hardware.vendorResult,
          guest_serial: hardware.guestSerial,
          begin_time: hardware.beginTime,
          end_time: hardware.endTime
        },
        access: {
          room_number: current.room_number,
          valid_from: hardware.validFrom,
          valid_until: hardware.validUntil,
          guest_name: guest.name,
          reservation_number: current.reservation_number
        }
      });
    } catch (error) {
      const message = error?.message || 'Falha ao gravar pulseira no bis_api.';
      // Timeouts, disconnects and malformed responses may leave the physical
      // outcome unknown and remain locked for review. A documented
      // Written=false + non-zero vendor result comes from the codec after its
      // call completed, so it is a confirmed failure: the guest can retry
      // deliberately after removing the same pulseira.
      const confirmedVendorFailure = hasConfirmedVendorWriteFailure(error);
      const outcomeUncertain = (writeDispatched && !confirmedVendorFailure) || error.code === 'write_uncertain';
      upsertCredential({
        current,
        guest,
        selectedProvider,
        status: outcomeUncertain ? 'uncertain' : 'failed',
        validFrom: window.validFrom,
        validUntil: window.validUntil,
        lastError: message
      });
      audit('wristband.encode.failed', id, {
        guest_id: guestId,
        provider: selectedProvider,
        room_number: current.room_number,
        error: message,
        code: error?.code || null
      });
      return res.status(Number(error?.status || 502)).json({
        error: message,
        code: error?.code || 'bis_api_error',
        provider: selectedProvider,
        retryable: confirmedVendorFailure || (!writeDispatched && error.code !== 'write_uncertain'),
        access: accessContext(current)
      });
    } finally {
      encodingInFlight.delete(lockKey);
      readerBusy = false;
    }
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
