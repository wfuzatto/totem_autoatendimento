const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-checkin-lookup-'));
process.env.DATA_DIR = temp;
process.env.UPLOAD_DIR = path.join(temp, 'uploads');
process.env.BRANDING_DIR = path.join(temp, 'branding');
process.env.ADMIN_PASSWORD = '251933';

const app = require('../src/server-runtime');

test('check-in localiza pelo número exato da reserva', async () => {
  const res = await request(app).post('/api/reservations/lookup').send({ query: 'RES-20080', type: 'reservation' });
  assert.equal(res.status, 200);
  assert.equal(res.body.reservation.reservation_number, 'RES-20080');
});

test('check-in rejeita número de reserva inexistente', async () => {
  const res = await request(app).post('/api/reservations/lookup').send({ query: 'RES-INEXISTENTE', type: 'reservation' });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'Número da reserva inválido.');
});

test('check-in valida CPF antes de consultar a reserva', async () => {
  const invalid = await request(app).post('/api/reservations/lookup').send({ query: '111.111.111-11', type: 'cpf' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, 'CPF inválido.');

  const valid = await request(app).post('/api/reservations/lookup').send({ query: '987.654.321-00', type: 'cpf' });
  assert.equal(valid.status, 200);
  assert.equal(valid.body.reservation.reservation_number, 'RES-20080');
});

test('QR Code aceita código puro ou URL contendo a reserva', async () => {
  for (const query of ['RES-20080', 'https://hotel.exemplo/checkin?reserva=RES-20080']) {
    const res = await request(app).post('/api/reservations/lookup').send({ query, type: 'qr' });
    assert.equal(res.status, 200);
    assert.equal(res.body.reservation.reservation_number, 'RES-20080');
  }

  const invalid = await request(app).post('/api/reservations/lookup').send({ query: 'https://example.com/qualquer-coisa', type: 'qr' });
  assert.equal(invalid.status, 404);
  assert.equal(invalid.body.error, 'QR Code inválido.');
});

test('URL pública configurada é usada no QR Code de envio de documentos', async () => {
  const login = await request(app).post('/api/admin/login').send({ password: '251933' });
  assert.equal(login.status, 200);
  const auth = `Bearer ${login.body.token}`;

  const save = await request(app)
    .put('/api/admin/runtime-settings')
    .set('Authorization', auth)
    .send({ public_qr_base_url: 'https://checkin.valedamantiqueira.com.br/' });
  assert.equal(save.status, 200);
  assert.equal(save.body.public_qr_base_url, 'https://checkin.valedamantiqueira.com.br');

  const lookup = await request(app).post('/api/reservations/lookup').send({ query: 'RES-20080', type: 'reservation' });
  const qr = await request(app).post(`/api/reservations/${lookup.body.reservation.id}/upload-token`).send({});
  assert.equal(qr.status, 200);
  assert.match(qr.body.url, /^https:\/\/checkin\.valedamantiqueira\.com\.br\/upload\.html\?token=/);
});
