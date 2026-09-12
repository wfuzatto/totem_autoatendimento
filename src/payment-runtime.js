'use strict';
const express = require('express');
const { db, audit } = require('./db');
const gateway = require('./payment-gateway');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitMs = Math.max(1000, Number(process.env.PAYMENT_UI_WAIT_MS || 90000));
const pollMs = Math.max(250, Number(process.env.PAYMENT_UI_POLL_MS || 750));
const allowLegacyTestMock = () => process.env.NODE_ENV === 'test' && process.env.PAYMENT_ALLOW_LEGACY_MOCK === '1';

function localPayment(id) {
  return db.prepare('SELECT * FROM payments WHERE id=?').get(id);
}
function latestActive(reservationId) {
  return db.prepare("SELECT * FROM payments WHERE reservation_id=? AND status IN ('initiating','pending') ORDER BY id DESC LIMIT 1").get(reservationId);
}
function applyGatewayResult(reservationId, localId, amountCents, result) {
  const status = String(result.status || 'pending').toLowerCase();
  db.prepare('UPDATE payments SET status=?, external_reference=? WHERE id=?').run(status, result.gatewayId || null, localId);
  if (status === 'approved') {
    db.transaction(() => {
      const reservation = db.prepare('SELECT balance_cents FROM reservations WHERE id=?').get(reservationId);
      const remaining = Math.max(0, Number(reservation?.balance_cents || 0) - Number(amountCents || 0));
      db.prepare('UPDATE reservations SET balance_cents=?,payment_pending=? WHERE id=?').run(remaining, remaining > 0 ? 1 : 0, reservationId);
      audit('payment.approved', reservationId, { gateway_payment_id: result.gatewayId, amount_cents: Number(amountCents), provider: result.provider || null, external_id: result.externalId || null });
    })();
  } else if (['declined','cancelled','error'].includes(status)) {
    audit(`payment.${status}`, reservationId, { gateway_payment_id: result.gatewayId, amount_cents: Number(amountCents), provider: result.provider || null });
  }
  return localPayment(localId);
}
async function syncPayment(row) {
  if (!row?.external_reference) return row;
  const remote = await gateway.getPayment(row.external_reference);
  return applyGatewayResult(row.reservation_id, row.id, row.amount_cents, remote);
}
async function waitForTerminal(row) {
  const deadline = Date.now() + waitMs;
  let current = row;
  while (Date.now() < deadline && ['initiating','pending'].includes(String(current.status))) {
    if (current.external_reference) current = await syncPayment(current);
    if (!['initiating','pending'].includes(String(current.status))) break;
    await sleep(pollMs);
  }
  return current;
}

function installPaymentRuntime(app) {
  app.post('/api/reservations/:id/payment', express.json(), async (req, res, next) => {
    try {
      // Compatibilidade EXCLUSIVA da suíte histórica. Produção nunca habilita esta flag.
      if (!gateway.configured() && allowLegacyTestMock()) return next('route');
      const reservationId = Number(req.params.id);
      const method = String(req.body?.method || 'pix').toLowerCase();
      if (!['pix','debit','credit'].includes(method)) return res.status(400).json({ error: 'Forma de pagamento inválida.' });
      const reservation = db.prepare('SELECT * FROM reservations WHERE id=?').get(reservationId);
      if (!reservation) return res.status(404).json({ error: 'Reserva não encontrada.' });
      const amount = Number(req.body?.amount_cents ?? reservation.balance_cents ?? 0);
      if (!Number.isSafeInteger(amount) || amount <= 0) return res.status(422).json({ error: 'Valor de pagamento inválido.' });
      if (amount > Number(reservation.balance_cents || 0)) return res.status(422).json({ error: 'Valor maior que o saldo pendente.' });

      let payment = latestActive(reservationId);
      if (payment && payment.method !== method) return res.status(409).json({ error: 'Já existe outro pagamento em andamento para esta reserva.' });
      if (!payment) {
        const result = db.prepare("INSERT INTO payments(reservation_id,method,amount_cents,status,external_reference) VALUES(?,?,?,?,NULL)").run(reservationId, method, amount, 'initiating');
        payment = localPayment(Number(result.lastInsertRowid));
        audit('payment.started', reservationId, { local_payment_id: payment.id, method, amount_cents: amount, gateway: 'api_pagamento' });
      }

      if (!payment.external_reference) {
        const created = await gateway.createPayment({ reservation, method, amountCents: payment.amount_cents, localPaymentId: payment.id });
        payment = applyGatewayResult(reservationId, payment.id, payment.amount_cents, created);
      }
      payment = await waitForTerminal(payment);
      if (payment.status === 'approved') {
        return res.json({ ok: true, approved: true, provider: 'api_pagamento', reference: payment.external_reference, payment_id: payment.id });
      }
      if (['declined','cancelled','error'].includes(payment.status)) {
        return res.status(402).json({ error: `Pagamento ${payment.status}.`, payment_id: payment.id, reference: payment.external_reference });
      }
      return res.status(409).json({ error: 'Pagamento ainda está em processamento. Aguarde a confirmação antes de continuar.', payment_id: payment.id, reference: payment.external_reference });
    } catch (error) { next(error); }
  });

  app.get('/api/reservations/:id/payment/status', async (req, res, next) => {
    try {
      const reservationId = Number(req.params.id);
      let payment = latestActive(reservationId) || db.prepare('SELECT * FROM payments WHERE reservation_id=? ORDER BY id DESC LIMIT 1').get(reservationId);
      if (!payment) return res.status(404).json({ error: 'Pagamento não encontrado.' });
      if (['initiating','pending'].includes(payment.status) && payment.external_reference) payment = await syncPayment(payment);
      return res.json({ payment_id: payment.id, status: payment.status, reference: payment.external_reference, amount_cents: Number(payment.amount_cents) });
    } catch (error) { next(error); }
  });
}

module.exports = { installPaymentRuntime };
