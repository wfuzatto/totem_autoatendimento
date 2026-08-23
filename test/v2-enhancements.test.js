const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-v2-enhancements-'));
process.env.DATA_DIR = temp;
process.env.UPLOAD_DIR = path.join(temp, 'uploads');
process.env.BRANDING_DIR = path.join(temp, 'branding');
process.env.PRINT_JOB_DIR = path.join(temp, 'print-jobs');
process.env.ADMIN_PASSWORD = '251933';

const app = require('../src/server-main');

test('totem pode remover documento recebido antes de concluir o check-in', async () => {
  const lookup = await request(app)
    .post('/api/reservations/lookup')
    .send({ query: 'RES-20080', type: 'reservation' });
  assert.equal(lookup.status, 200);

  const reservationId = lookup.body.reservation.id;
  const received = lookup.body.documents.find(doc => doc.status === 'received');
  assert.ok(received);

  const removed = await request(app)
    .delete(`/api/reservations/${reservationId}/documents/${received.id}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.ok, true);
  assert.equal(removed.body.status, 'pending');

  const fresh = await request(app).get(`/api/reservations/${reservationId}`);
  const updated = fresh.body.documents.find(doc => doc.id === received.id);
  assert.equal(updated.status, 'pending');
  assert.equal(updated.filename, null);
  assert.equal(updated.uploaded_at, null);
});

test('administrador pode configurar e remover imagem do QR Code gov.br', async () => {
  const login = await request(app)
    .post('/api/admin/login')
    .send({ password: '251933' });
  assert.equal(login.status, 200);
  const token = login.body.token;
  assert.ok(token);

  const initial = await request(app).get('/api/v2/govbr-config');
  assert.equal(initial.status, 200);
  assert.equal(initial.body.govbr_qr_configured, false);

  const uploaded = await request(app)
    .post('/api/admin/v2/govbr-qr')
    .set('Authorization', `Bearer ${token}`)
    .attach('qr', Buffer.from('fake-png-for-test'), { filename: 'govbr.png', contentType: 'image/png' });
  assert.equal(uploaded.status, 200);
  assert.equal(uploaded.body.ok, true);
  assert.match(uploaded.body.govbr_qr_url, /^\/api\/branding\/govbr-qr\?v=/);

  const configured = await request(app).get('/api/v2/govbr-config');
  assert.equal(configured.body.govbr_qr_configured, true);
  assert.ok(configured.body.govbr_qr_url);

  const image = await request(app).get('/api/branding/govbr-qr');
  assert.equal(image.status, 200);

  const removed = await request(app)
    .delete('/api/admin/v2/govbr-qr')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.ok, true);

  const after = await request(app).get('/api/v2/govbr-config');
  assert.equal(after.body.govbr_qr_configured, false);
});
