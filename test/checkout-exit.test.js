const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-exit-'));
process.env.DATA_DIR = temp;
process.env.UPLOAD_DIR = path.join(temp, 'uploads');
process.env.BRANDING_DIR = path.join(temp, 'branding');
process.env.PRINT_JOB_DIR = path.join(temp, 'print-jobs');
process.env.ADMIN_PASSWORD = '251933';

const app = require('../src/server-main');

async function completeCheckout() {
  const lookup = await request(app).post('/api/reservations/lookup').send({ query: 'RES-10025', type: 'reservation' });
  assert.equal(lookup.status, 200);
  const id = lookup.body.reservation.id;

  for (const code of ['SAGA-204-CARLOS', 'SAGA-204-MARIANA']) {
    const returned = await request(app).post(`/api/reservations/${id}/wristbands/return`).send({ code });
    assert.equal(returned.status, 200);
  }

  const payment = await request(app).post(`/api/reservations/${id}/payment`).send({ method: 'pix', amount_cents: 42870 });
  assert.equal(payment.status, 200);

  const checkout = await request(app).post(`/api/reservations/${id}/checkout`).send({});
  assert.equal(checkout.status, 200);
  return id;
}

test('checkout gera guia, QR assinado e validação de uso único na portaria', async () => {
  const id = await completeCheckout();
  const finalize = await request(app).post(`/api/checkout/${id}/finalize`).send({});
  assert.equal(finalize.status, 200);
  assert.equal(finalize.body.ok, true);
  assert.match(finalize.body.authorization.receipt_number, /^SAI-/);
  assert.ok(finalize.body.authorization.qr_data_url.startsWith('data:image/png;base64,'));
  assert.equal(finalize.body.authorization.print.status, 'simulado');

  const validationUrl = new URL(finalize.body.authorization.validation_url, 'http://127.0.0.1');
  const token = validationUrl.searchParams.get('token');
  assert.ok(token);

  const inspect = await request(app).get(`/api/public/exit/${encodeURIComponent(token)}`);
  assert.equal(inspect.status, 200);
  assert.equal(inspect.body.valid, true);
  assert.equal(inspect.body.status, 'active');
  assert.equal(inspect.body.reservation_number, 'RES-10025');

  const consume = await request(app).post(`/api/public/exit/${encodeURIComponent(token)}/consume`).send({});
  assert.equal(consume.status, 200);
  assert.equal(consume.body.status, 'used');

  const reuse = await request(app).post(`/api/public/exit/${encodeURIComponent(token)}/consume`).send({});
  assert.equal(reuse.status, 409);
  assert.equal(reuse.body.status, 'used');
});

test('dashboard aceita propaganda PNG de checkout', async () => {
  const login = await request(app).post('/api/admin/login').send({ password: '251933' });
  const auth = `Bearer ${login.body.token}`;
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

  const upload = await request(app)
    .post('/api/admin/branding/checkout-ad')
    .set('Authorization', auth)
    .attach('ad', tinyPng, { filename: 'propaganda.png', contentType: 'image/png' });
  assert.equal(upload.status, 200);
  assert.ok(upload.body.ad_url);

  const config = await request(app).get('/api/checkout/config');
  assert.equal(config.status, 200);
  assert.equal(config.body.ad_duration_seconds, 30);
  assert.ok(config.body.ad_url);
});
