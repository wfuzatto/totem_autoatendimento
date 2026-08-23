const express = require('express');
const { db, getSetting, audit } = require('./db');

function cpfValid(value) {
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

function bundle(row) {
  if (!row) return null;
  const guests = db.prepare('SELECT * FROM guests WHERE reservation_id=? ORDER BY adult DESC,id').all(row.id)
    .map(g => ({ ...g, adult: Boolean(g.adult), face_verified: Boolean(g.face_verified) }));
  const documents = db.prepare('SELECT * FROM documents WHERE reservation_id=? ORDER BY guest_id,type').all(row.id);
  const state = db.prepare('SELECT * FROM process_state WHERE reservation_id=?').get(row.id) || { govbr_verified: 0 };
  return {
    reservation: {
      ...row,
      adults: Number(row.adults || 0),
      children: Number(row.children || 0),
      balance_cents: Number(row.balance_cents || 0),
      payment_pending: Boolean(row.payment_pending)
    },
    guests,
    documents,
    state: { govbr_verified: Boolean(state.govbr_verified) }
  };
}

function qrCandidates(payload) {
  const raw = String(payload || '').trim();
  const values = [];
  const add = value => {
    const candidate = String(value || '').trim();
    if (candidate && candidate.length <= 120 && !values.includes(candidate)) values.push(candidate);
  };
  try {
    const parsed = JSON.parse(raw);
    ['reservation_number','reservation','reserva','booking','booking_id','codigo_reserva'].forEach(key => add(parsed?.[key]));
  } catch (_) {}
  try {
    const parsed = new URL(raw);
    ['reservation_number','reservation','reserva','booking','booking_id','codigo_reserva'].forEach(key => add(parsed.searchParams.get(key)));
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length) add(segments[segments.length - 1]);
  } catch (_) {}
  if (/^[A-Za-z0-9][A-Za-z0-9._\/-]{2,80}$/.test(raw)) add(raw);
  return values;
}

function findLocal(query, type = 'auto') {
  const raw = String(query || '').trim();
  if (!raw) return null;
  let row = null;
  if (type === 'reservation') {
    row = db.prepare('SELECT * FROM reservations WHERE reservation_number=? COLLATE NOCASE LIMIT 1').get(raw);
  } else if (type === 'cpf') {
    const cpf = raw.replace(/\D/g, '');
    if (!cpfValid(cpf)) return null;
    row = db.prepare("SELECT * FROM reservations WHERE REPLACE(REPLACE(REPLACE(responsible_cpf,'.',''),'-',''),' ','')=? LIMIT 1").get(cpf);
  } else if (type === 'qr') {
    for (const candidate of qrCandidates(raw)) {
      row = db.prepare('SELECT * FROM reservations WHERE reservation_number=? COLLATE NOCASE LIMIT 1').get(candidate);
      if (row) break;
    }
  } else {
    row = db.prepare('SELECT * FROM reservations WHERE reservation_number=? COLLATE NOCASE OR room_number=? COLLATE NOCASE LIMIT 1').get(raw, raw);
    if (!row) {
      const cpf = raw.replace(/\D/g, '');
      if (cpf) row = db.prepare("SELECT * FROM reservations WHERE REPLACE(REPLACE(REPLACE(responsible_cpf,'.',''),'-',''),' ','')=? LIMIT 1").get(cpf);
    }
    if (!row) row = db.prepare('SELECT r.* FROM guests g JOIN reservations r ON r.id=g.reservation_id WHERE g.wristband_code=? COLLATE NOCASE LIMIT 1').get(raw);
  }
  return bundle(row);
}

function installHybridReservationLookup(app) {
  app.post('/api/reservations/lookup', express.json({ limit: '2mb' }), (req, res, next) => {
    // No modo mock, deixa o runtime original cuidar de todo o lookup.
    if (getSetting('api_provider') === 'mock') return next();

    const type = ['reservation','cpf','qr','auto'].includes(req.body?.type) ? req.body.type : 'auto';
    const found = findLocal(req.body?.query, type);
    if (!found) return next();

    audit('reservation.lookup.local_before_integration', found.reservation.id, { query_type: type });
    return res.json(found);
  });
}

module.exports = { installHybridReservationLookup, findLocal };
