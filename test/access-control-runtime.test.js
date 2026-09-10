const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-access-control-'));
process.env.DATA_DIR = temp;
process.env.UPLOAD_DIR = path.join(temp, 'uploads');
process.env.BRANDING_DIR = path.join(temp, 'branding');
process.env.ADMIN_PASSWORD = '251933';
process.env.HOTEL_CARD_PROVIDER = 'mock';

const app = require('../src/server-main');
const { db } = require('../src/db');

test('pulseira exige UH real e persiste contexto de acesso da reserva', async () => {
  const lookup = await request(app)
    .post('/api/reservations/lookup')
    .send({ query: 'RES-20080' });

  assert.equal(lookup.status, 200);
  const reservationId = lookup.body.reservation.id;
  const adults = lookup.body.guests.filter(guest => guest.adult);
  assert.equal(adults.length, 2);

  // Deixa todos os demais gates concluídos para isolar a regra de UH.
  db.prepare("UPDATE documents SET status='received' WHERE reservation_id=?").run(reservationId);
  db.prepare('UPDATE guests SET face_verified=1 WHERE reservation_id=? AND adult=1').run(reservationId);
  db.prepare(`INSERT INTO process_state(reservation_id,govbr_verified,updated_at)
              VALUES(?,1,CURRENT_TIMESTAMP)
              ON CONFLICT(reservation_id) DO UPDATE SET govbr_verified=1,updated_at=CURRENT_TIMESTAMP`).run(reservationId);
  db.prepare('UPDATE reservations SET payment_pending=0,balance_cents=0,room_number=NULL WHERE id=?').run(reservationId);

  const missingRoom = await request(app)
    .post(`/api/reservations/${reservationId}/wristbands/encode`)
    .send({ guest_id: adults[0].id, code: 'ROOM-MISSING-BAND' });

  assert.equal(missingRoom.status, 409);
  assert.match(missingRoom.body.error, /UH.*PMS/i);
  assert.equal(db.prepare('SELECT wristband_code FROM guests WHERE id=?').get(adults[0].id).wristband_code, null);

  const blockedContext = await request(app).get(`/api/reservations/${reservationId}/access-context`);
  assert.equal(blockedContext.status, 200);
  assert.equal(blockedContext.body.ready_for_wristband, false);
  assert.equal(blockedContext.body.room_number, null);
  assert.ok(blockedContext.body.blockers.some(item => item.code === 'room_missing'));

  // Simula a UH atribuída pelo PMS. O Totem deve usar exatamente esse valor.
  db.prepare("UPDATE reservations SET room_number='204' WHERE id=?").run(reservationId);

  const readyContext = await request(app).get(`/api/reservations/${reservationId}/access-context`);
  assert.equal(readyContext.status, 200);
  assert.equal(readyContext.body.ready_for_wristband, true);
  assert.equal(readyContext.body.room_number, '204');
  assert.equal(readyContext.body.bis_api_contract.request_template.Room, '204');
  assert.equal(readyContext.body.bis_api_contract.request_template.ValidFrom, null);
  assert.equal(readyContext.body.bis_api_contract.request_template.ValidUntil, null);

  for (let index = 0; index < adults.length; index += 1) {
    const encoded = await request(app)
      .post(`/api/reservations/${reservationId}/wristbands/encode`)
      .send({ guest_id: adults[index].id, code: `TEST-UH204-${index + 1}` });

    assert.equal(encoded.status, 200);
    assert.equal(encoded.body.access.room_number, '204');
    assert.equal(encoded.body.access.valid_from, lookup.body.reservation.checkin_date);
    assert.equal(encoded.body.access.valid_until, lookup.body.reservation.checkout_date);
  }

  const credential = db.prepare('SELECT * FROM wristband_credentials WHERE reservation_id=? AND guest_id=?')
    .get(reservationId, adults[0].id);
  assert.ok(credential);
  assert.equal(credential.room_number, '204');
  assert.equal(credential.reservation_number, 'RES-20080');
  assert.equal(credential.status, 'encoded_mock');

  // Mesmo com as pulseiras gravadas, o check-in nunca deve criar uma UH fictícia.
  db.prepare('UPDATE reservations SET room_number=NULL WHERE id=?').run(reservationId);
  const noFallback = await request(app)
    .post(`/api/reservations/${reservationId}/checkin`)
    .send({});
  assert.equal(noFallback.status, 409);
  assert.match(noFallback.body.error, /UH.*PMS/i);
  assert.equal(db.prepare('SELECT room_number FROM reservations WHERE id=?').get(reservationId).room_number, null);

  db.prepare("UPDATE reservations SET room_number='204' WHERE id=?").run(reservationId);
  const completed = await request(app)
    .post(`/api/reservations/${reservationId}/checkin`)
    .send({});
  assert.equal(completed.status, 200);
  assert.equal(completed.body.room_number, '204');
});
