const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-document-removal-'));
process.env.DATA_DIR = temp;
process.env.UPLOAD_DIR = path.join(temp, 'uploads');
process.env.BRANDING_DIR = path.join(temp, 'branding');
process.env.PRINT_JOB_DIR = path.join(temp, 'print-jobs');
process.env.ADMIN_PASSWORD = '251933';

const app = require('../src/server-main');

test('hóspede pode remover documento enviado e reenviar pelo mesmo QR Code', async () => {
  const lookup = await request(app)
    .post('/api/reservations/lookup')
    .send({ query: 'RES-20080', type: 'reservation' });
  assert.equal(lookup.status, 200);

  const reservationId = lookup.body.reservation.id;
  const tokenResponse = await request(app)
    .post(`/api/reservations/${reservationId}/upload-token`)
    .send({});
  assert.equal(tokenResponse.status, 200);

  const token = tokenResponse.body.token;
  const before = await request(app).get(`/api/public/upload/${encodeURIComponent(token)}`);
  assert.equal(before.status, 200);

  const uploaded = before.body.documents.find(doc => doc.status === 'received');
  assert.ok(uploaded, 'a reserva de demonstração deve possuir ao menos um documento enviado');

  const removed = await request(app)
    .delete(`/api/public/upload/${encodeURIComponent(token)}/${uploaded.id}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.ok, true);
  assert.equal(removed.body.status, 'pending');

  const after = await request(app).get(`/api/public/upload/${encodeURIComponent(token)}`);
  assert.equal(after.status, 200);
  const updated = after.body.documents.find(doc => doc.id === uploaded.id);
  assert.equal(updated.status, 'pending');
  assert.equal(updated.filename, null);
  assert.equal(updated.uploaded_at, null);
});
