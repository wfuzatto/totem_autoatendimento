const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-reservation-admin-'));
process.env.DATA_DIR = temp;
process.env.UPLOAD_DIR = path.join(temp, 'uploads');
process.env.BRANDING_DIR = path.join(temp, 'branding');
process.env.PRINT_JOB_DIR = path.join(temp, 'print-jobs');
process.env.ADMIN_PASSWORD = '251933';

const app = require('../src/server-main');
const { db } = require('../src/db');

async function adminToken() {
  const login = await request(app).post('/api/admin/login').send({ password: '251933' });
  assert.equal(login.status, 200);
  return login.body.token;
}

test('dashboard cria, lista e abre reserva manual pronta para o totem', async () => {
  const token = await adminToken();
  const created = await request(app)
    .post('/api/admin/reservations')
    .set('Authorization', `Bearer ${token}`)
    .send({
      reservation_number: 'MAN-TESTE-001',
      responsible_name: 'Hóspede Teste',
      responsible_cpf: '52998224725',
      responsible_email: 'teste@example.com',
      responsible_phone: '35999999999',
      checkin_date: '2026-08-23',
      checkout_date: '2026-08-25',
      room_number: 'T01',
      balance_cents: 12345,
      payment_pending: true,
      require_payment_proof: true,
      notes: 'Reserva manual para teste interno',
      guests: [
        { name: 'Hóspede Teste', adult: true },
        { name: 'Segundo Adulto', adult: true },
        { name: 'Criança Teste', adult: false }
      ]
    });

  assert.equal(created.status, 201);
  assert.equal(created.body.meta.source, 'manual');
  assert.equal(created.body.reservation.status, 'reserved');
  assert.equal(created.body.reservation.adults, 2);
  assert.equal(created.body.reservation.children, 1);
  assert.equal(created.body.documents.length, 3);

  const list = await request(app)
    .get('/api/admin/reservations?source=manual&search=MAN-TESTE-001')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.rows.length, 1);
  assert.equal(list.body.rows[0].source, 'manual');

  const lookup = await request(app)
    .post('/api/reservations/lookup')
    .send({ query: 'MAN-TESTE-001', type: 'reservation' });
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.reservation.responsible_name, 'Hóspede Teste');
});

test('reserva manual continua localizável quando provider de integração está ativo', async () => {
  const token = await adminToken();
  const created = await request(app)
    .post('/api/admin/reservations')
    .set('Authorization', `Bearer ${token}`)
    .send({
      reservation_number: 'MAN-HYBRID-001',
      responsible_name: 'Teste Híbrido',
      responsible_cpf: '52998224725',
      checkin_date: '2026-08-23',
      checkout_date: '2026-08-24',
      balance_cents: 0,
      payment_pending: false,
      require_payment_proof: false,
      guests: [{ name: 'Teste Híbrido', adult: true }]
    });
  assert.equal(created.status, 201);

  db.prepare("UPDATE settings SET value='totvs',updated_at=CURRENT_TIMESTAMP WHERE key='api_provider'").run();
  const lookup = await request(app)
    .post('/api/reservations/lookup')
    .send({ query: 'MAN-HYBRID-001', type: 'reservation' });
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.reservation.reservation_number, 'MAN-HYBRID-001');
  db.prepare("UPDATE settings SET value='mock',updated_at=CURRENT_TIMESTAMP WHERE key='api_provider'").run();
});

test('dashboard prepara reserva novamente para teste e permite excluir somente manual', async () => {
  const token = await adminToken();
  const created = await request(app)
    .post('/api/admin/reservations')
    .set('Authorization', `Bearer ${token}`)
    .send({
      reservation_number: 'MAN-RESET-001',
      responsible_name: 'Reset Teste',
      responsible_cpf: '52998224725',
      checkin_date: '2026-08-23',
      checkout_date: '2026-08-26',
      room_number: '',
      balance_cents: 50000,
      payment_pending: true,
      guests: [{ name: 'Reset Teste', adult: true }]
    });
  assert.equal(created.status, 201);
  const id = created.body.reservation.id;

  db.prepare("UPDATE reservations SET status='checked_in',room_number='999',balance_cents=0,payment_pending=0 WHERE id=?").run(id);
  db.prepare("UPDATE guests SET face_verified=1,wristband_code='TEST-BAND' WHERE reservation_id=?").run(id);
  db.prepare(`INSERT INTO process_state(reservation_id,govbr_verified,updated_at) VALUES(?,1,CURRENT_TIMESTAMP)
    ON CONFLICT(reservation_id) DO UPDATE SET govbr_verified=1`).run(id);
  db.prepare("INSERT INTO payments(reservation_id,method,amount_cents,status,external_reference) VALUES(?,?,?,?,?)").run(id, 'pix', 50000, 'approved', 'MOCK-TEST');

  const reset = await request(app)
    .post(`/api/admin/reservations/${id}/reset-for-totem`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  assert.equal(reset.status, 200);
  assert.equal(reset.body.reservation.status, 'reserved');
  assert.equal(reset.body.reservation.balance_cents, 50000);
  assert.equal(reset.body.reservation.payment_pending, true);
  assert.equal(reset.body.guests[0].face_verified, false);
  assert.equal(reset.body.guests[0].wristband_code, null);
  assert.equal(reset.body.state.govbr_verified, false);
  assert.equal(reset.body.payments.length, 0);

  const removed = await request(app)
    .delete(`/api/admin/reservations/${id}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(removed.status, 200);

  const demo = db.prepare("SELECT id FROM reservations WHERE reservation_number='RES-20080'").get();
  const blocked = await request(app)
    .delete(`/api/admin/reservations/${demo.id}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(blocked.status, 409);
});
