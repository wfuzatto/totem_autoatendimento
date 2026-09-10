const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-face-test-'));
process.env.DATA_DIR = temp;
process.env.UPLOAD_DIR = path.join(temp, 'uploads');
process.env.BRANDING_DIR = path.join(temp, 'branding');
process.env.PRINT_JOB_DIR = path.join(temp, 'print-jobs');
process.env.ADMIN_PASSWORD = '251933';
process.env.FACE_SCANNER_URL = 'http://face-scanner.test:8091';
process.env.FACE_SCANNER_API_KEY = 'integration-test-key';

fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });

let verifyMode = 'match';
let verificationCounter = 0;
const originalFetch = global.fetch;

global.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;

  if (url === 'http://face-scanner.test:8091/api/v1/health') {
    return new Response(JSON.stringify({
      status: 'ok',
      version: '0.5.0',
      face_engine_ready: true,
      embedding_model_ready: true,
      provider_configured: true,
      thresholds_configured: true
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (url === 'http://face-scanner.test:8091/api/v1/document/analyze') {
    verificationCounter += 1;
    return new Response(JSON.stringify({
      request_id: `doc-${verificationCounter}`,
      verification_id: `verification-test-${verificationCounter}-abcdef`,
      reservation_id: 'RES-20080',
      detected_document_type: 'cnh',
      fields: { name: 'Fernanda Almeida' },
      name_validation: { expected: 'Fernanda Almeida', extracted: 'Fernanda Almeida', score: 99, status: 'match', anchors_ok: true },
      portrait: { found: true, source: 'front', bbox: [10, 10, 100, 100], alignment: { success: true } },
      can_verify_face: true,
      warnings: []
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (url === 'http://face-scanner.test:8091/api/v1/face/preview') {
    return new Response(JSON.stringify({
      request_id: 'preview-1',
      face_count: 1,
      image_width: 640,
      image_height: 480,
      bbox: [220, 100, 200, 260],
      quality: { blur_score: 80, brightness: 120, face_ratio: 0.22, acceptable: true, issues: [] },
      message: 'Captura pronta.'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (url === 'http://face-scanner.test:8091/api/v1/face/verify') {
    const matched = verifyMode === 'match';
    return new Response(JSON.stringify({
      request_id: 'verify-1',
      verification_id: 'verification-test',
      status: matched ? 'match' : 'mismatch',
      identity_verified: matched,
      retry_allowed: !matched,
      attempts_used: 1,
      max_attempts: 3,
      attempts_remaining: matched ? 2 : 2,
      provider: 'internal',
      similarity: matched ? 0.82 : 0.21,
      review_threshold: 0.363,
      match_threshold: 0.5,
      metric: 'cosine',
      model: 'OpenCV SFace',
      model_version: '2021dec',
      quality: { blur_score: 82, brightness: 121, face_ratio: 0.23, acceptable: true, issues: [] },
      liveness: { status: 'not_checked', method: 'none' },
      checkin_gate: { allowed: false, reasons: ['liveness_not_passed'] },
      message: matched ? 'Identidade confirmada.' : 'Identidade não confere.'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  return originalFetch(input, init);
};

const app = require('../src/server-main');
const { db } = require('../src/db');

function demoContext() {
  const reservation = db.prepare("SELECT * FROM reservations WHERE reservation_number='RES-20080'").get();
  const guests = db.prepare('SELECT * FROM guests WHERE reservation_id=? AND adult=1 ORDER BY id').all(reservation.id);
  return { reservation, guests };
}

function attachIdentity(reservationId, guestId, filename) {
  fs.writeFileSync(path.join(process.env.UPLOAD_DIR, filename), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  db.prepare(`UPDATE documents SET filename=?, status='received', uploaded_at=CURRENT_TIMESTAMP
    WHERE reservation_id=? AND guest_id=? AND type='identity'`).run(filename, reservationId, guestId);
}

async function prepare(reservationId, guestId) {
  return request(app)
    .post(`/api/face-scanner/reservations/${reservationId}/guests/${guestId}/prepare`)
    .send({});
}

async function verify(reservationId, guestId, verificationId) {
  return request(app)
    .post('/api/face-scanner/face/verify')
    .field('verification_id', verificationId)
    .field('reservation_id', String(reservationId))
    .field('guest_id', String(guestId))
    .attach('selfie', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { filename: 'selfie.jpg', contentType: 'image/jpeg' });
}

test('check-in prepara o documento armazenado e só marca face_verified após match real', async () => {
  verifyMode = 'match';
  const { reservation, guests } = demoContext();
  const guest = guests[0];
  db.prepare('UPDATE guests SET face_verified=0 WHERE id=?').run(guest.id);
  attachIdentity(reservation.id, guest.id, 'face-doc-fernanda.jpg');

  const prepared = await prepare(reservation.id, guest.id);
  assert.equal(prepared.status, 200);
  assert.ok(prepared.body.verification_id);
  assert.equal(prepared.body.document.name_status, 'match');
  assert.equal(prepared.body.document.portrait_found, true);

  const before = db.prepare('SELECT face_verified FROM guests WHERE id=?').get(guest.id);
  assert.equal(Number(before.face_verified), 0);

  const verified = await verify(reservation.id, guest.id, prepared.body.verification_id);
  assert.equal(verified.status, 200);
  assert.equal(verified.body.face_scanner.status, 'match');
  assert.equal(verified.body.face_scanner.identity_verified, true);
  assert.equal(verified.body.totem.face_verified, true);

  const after = db.prepare('SELECT face_verified FROM guests WHERE id=?').get(guest.id);
  assert.equal(Number(after.face_verified), 1);
});

test('mismatch biométrico nunca libera o hóspede', async () => {
  verifyMode = 'mismatch';
  const { reservation, guests } = demoContext();
  const guest = guests[1];
  db.prepare('UPDATE guests SET face_verified=0 WHERE id=?').run(guest.id);
  attachIdentity(reservation.id, guest.id, 'face-doc-rafael.jpg');

  const prepared = await prepare(reservation.id, guest.id);
  assert.equal(prepared.status, 200);

  const checked = await verify(reservation.id, guest.id, prepared.body.verification_id);
  assert.equal(checked.status, 200);
  assert.equal(checked.body.face_scanner.status, 'mismatch');
  assert.equal(checked.body.totem.face_verified, false);

  const after = db.prepare('SELECT face_verified FROM guests WHERE id=?').get(guest.id);
  assert.equal(Number(after.face_verified), 0);
});

test('verification_id fica vinculado à reserva e ao hóspede', async () => {
  verifyMode = 'match';
  const { reservation, guests } = demoContext();
  const first = guests[0];
  const second = guests[1];
  db.prepare('UPDATE guests SET face_verified=0 WHERE id IN (?,?)').run(first.id, second.id);
  attachIdentity(reservation.id, first.id, 'face-bind-first.jpg');
  attachIdentity(reservation.id, second.id, 'face-bind-second.jpg');

  const prepared = await prepare(reservation.id, first.id);
  assert.equal(prepared.status, 200);

  const wrongGuest = await verify(reservation.id, second.id, prepared.body.verification_id);
  assert.equal(wrongGuest.status, 409);
  assert.match(wrongGuest.body.error, /não pertence/i);

  const secondState = db.prepare('SELECT face_verified FROM guests WHERE id=?').get(second.id);
  assert.equal(Number(secondState.face_verified), 0);
});

test('endpoint facial mock legado fica bloqueado no runtime Docker', async () => {
  const { reservation, guests } = demoContext();
  const guest = guests[0];
  db.prepare('UPDATE guests SET face_verified=0 WHERE id=?').run(guest.id);

  const legacy = await request(app)
    .post(`/api/reservations/${reservation.id}/face/verify`)
    .send({ guest_id: guest.id, capture: 'data:image/jpeg;base64,/9j/2Q==' });

  assert.equal(legacy.status, 410);
  assert.match(legacy.body.error, /legada desativada/i);
  const after = db.prepare('SELECT face_verified FROM guests WHERE id=?').get(guest.id);
  assert.equal(Number(after.face_verified), 0);
});

test.after(() => {
  global.fetch = originalFetch;
  try { db.close(); } catch (_) {}
  fs.rmSync(temp, { recursive: true, force: true });
});
