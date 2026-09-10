const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-payment-gate-'));
process.env.DATA_DIR = temp;
process.env.UPLOAD_DIR = path.join(temp, 'uploads');
process.env.ADMIN_PASSWORD = '251933';

const app = require('../src/server');
const { db } = require('../src/db');

test('check-in bloqueia gravação de pulseira até saldo e pendência estarem zerados', async () => {
  const lookup = await request(app)
    .post('/api/reservations/lookup')
    .send({ query: 'RES-20080' });

  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.reservation.payment_pending, true);
  assert.equal(lookup.body.reservation.balance_cents, 85000);

  const reservationId = lookup.body.reservation.id;
  const adult = lookup.body.guests.find(guest => guest.adult);
  assert.ok(adult);

  const blocked = await request(app)
    .post(`/api/reservations/${reservationId}/wristbands/encode`)
    .send({ guest_id: adult.id, code: 'TEST-BLOCKED-BAND' });

  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /pagamento pendente/i);

  const unchanged = db.prepare('SELECT wristband_code FROM guests WHERE id=?').get(adult.id);
  assert.equal(unchanged.wristband_code, null);

  // Mesmo que a flag fique inconsistente, saldo positivo continua bloqueando acesso.
  db.prepare('UPDATE reservations SET payment_pending=0 WHERE id=?').run(reservationId);
  const blockedByBalance = await request(app)
    .post(`/api/reservations/${reservationId}/wristbands/encode`)
    .send({ guest_id: adult.id, code: 'TEST-BALANCE-BAND' });

  assert.equal(blockedByBalance.status, 409);
  assert.match(blockedByBalance.body.error, /pagamento pendente/i);

  // Restaura a pendência e efetua o pagamento pelo fluxo normal.
  db.prepare('UPDATE reservations SET payment_pending=1 WHERE id=?').run(reservationId);
  const paid = await request(app)
    .post(`/api/reservations/${reservationId}/payment`)
    .send({ method: 'credit', amount_cents: 85000 });

  assert.equal(paid.status, 200);
  assert.equal(paid.body.approved, true);

  const settled = await request(app).get(`/api/reservations/${reservationId}`);
  assert.equal(settled.status, 200);
  assert.equal(settled.body.reservation.payment_pending, false);
  assert.equal(settled.body.reservation.balance_cents, 0);

  const encoded = await request(app)
    .post(`/api/reservations/${reservationId}/wristbands/encode`)
    .send({ guest_id: adult.id, code: 'TEST-PAID-BAND' });

  assert.equal(encoded.status, 200);
  assert.equal(encoded.body.code, 'TEST-PAID-BAND');
});
