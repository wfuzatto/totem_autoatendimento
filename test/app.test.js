const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-test-'));
process.env.DATA_DIR = temp;
process.env.UPLOAD_DIR = path.join(temp, 'uploads');
process.env.ADMIN_PASSWORD = '251933';

const app = require('../src/server');

test('health responde', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('localiza reserva demo de checkout por reserva, UH e pulseira', async () => {
  for (const query of ['RES-10025', '204', 'SAGA-204-CARLOS']) {
    const res = await request(app).post('/api/reservations/lookup').send({ query });
    assert.equal(res.status, 200);
    assert.equal(res.body.reservation.reservation_number, 'RES-10025');
  }
});

test('localiza reserva demo de checkin por CPF', async () => {
  const res = await request(app).post('/api/reservations/lookup').send({ query: '987.654.321-00' });
  assert.equal(res.status, 200);
  assert.equal(res.body.reservation.reservation_number, 'RES-20080');
});

test('dashboard rejeita senha errada e aceita a senha inicial', async () => {
  const bad = await request(app).post('/api/admin/login').send({ password: '000000' });
  assert.equal(bad.status, 401);
  const ok = await request(app).post('/api/admin/login').send({ password: '251933' });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  const settings = await request(app).get('/api/admin/settings').set('Authorization', `Bearer ${ok.body.token}`);
  assert.equal(settings.status, 200);
  assert.equal(settings.body.allow_item_contest, '1');
});

test('extrato retorna grupos e total', async () => {
  const lookup = await request(app).post('/api/reservations/lookup').send({ query: 'RES-10025' });
  const id = lookup.body.reservation.id;
  const res = await request(app).get(`/api/reservations/${id}/statement`);
  assert.equal(res.status, 200);
  assert.ok(res.body.groups.length >= 2);
  assert.equal(res.body.total_cents, 42870);
});
