const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise(resolve => server.close(() => resolve()));
}

test('Totem grava pulseira pelo bis_api e só persiste UID após confirmação real', async t => {
  let encodeMode = 'success';
  const received = [];
  const fakeBis = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url === '/api/health') {
      res.end(JSON.stringify({
        ok: true,
        service: 'bis_api',
        processArchitecture: 'X86',
        vendor: {
          codecPresent: true,
          pcscShimPresent: true,
          hotelCardWritesEnabled: true,
          hotelPasswordConfigured: true,
          pcscReader: 'ACS ACR122 0',
          dateTimeFormat: 'yyMMddHHmm'
        }
      }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/hotel-card/encode') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body || '{}');
      received.push(payload);
      if (encodeMode === 'failure') {
        res.statusCode = 502;
        res.end(JSON.stringify({ written: false, vendorResult: 6, message: 'Falha de gravação' }));
        return;
      }
      res.end(JSON.stringify({
        written: true,
        vendorResult: 0,
        message: 'Sucesso',
        reader: 'ACS ACR122 0',
        uidHex: 'A1B2C3D4',
        doorId: '000204',
        beginTime: '2608231400',
        endTime: '2608261200',
        guestSerial: 123456,
        holderSerial: 0,
        guestIndex: 2,
        suitDoor: '000000000000',
        publicDoor: '00000000'
      }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });

  const address = await listen(fakeBis);
  t.after(() => close(fakeBis));

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-bis-api-'));
  process.env.DATA_DIR = temp;
  process.env.UPLOAD_DIR = path.join(temp, 'uploads');
  process.env.BRANDING_DIR = path.join(temp, 'branding');
  process.env.ADMIN_PASSWORD = '251933';
  process.env.HOTEL_CARD_PROVIDER = 'bis_api';
  process.env.BIS_API_URL = `http://127.0.0.1:${address.port}`;
  process.env.BIS_API_WRITE_CONFIRMATION = 'TESTE-SEGREDO-GRAVAR';
  process.env.BIS_API_TIMEOUT_MS = '3000';
  process.env.HOTEL_ACCESS_CHECKIN_TIME = '14:00';
  process.env.HOTEL_ACCESS_CHECKOUT_TIME = '12:00';
  process.env.HOTEL_ACCESS_UTC_OFFSET = '-03:00';

  const app = require('../src/server-main');
  const { db } = require('../src/db');

  const lookup = await request(app)
    .post('/api/reservations/lookup')
    .send({ query: 'RES-20080' });
  assert.equal(lookup.status, 200);

  const reservationId = lookup.body.reservation.id;
  const adults = lookup.body.guests.filter(guest => guest.adult);
  assert.equal(adults.length, 2);

  db.prepare("UPDATE documents SET status='received' WHERE reservation_id=?").run(reservationId);
  db.prepare('UPDATE guests SET face_verified=1 WHERE reservation_id=? AND adult=1').run(reservationId);
  db.prepare(`INSERT INTO process_state(reservation_id,govbr_verified,updated_at)
              VALUES(?,1,CURRENT_TIMESTAMP)
              ON CONFLICT(reservation_id) DO UPDATE SET govbr_verified=1,updated_at=CURRENT_TIMESTAMP`).run(reservationId);
  db.prepare("UPDATE reservations SET payment_pending=0,balance_cents=0,room_number='204' WHERE id=?").run(reservationId);

  const context = await request(app).get(`/api/reservations/${reservationId}/access-context`);
  assert.equal(context.status, 200);
  assert.equal(context.body.provider, 'bis_api');
  assert.equal(context.body.ready_for_wristband, true);
  assert.equal(context.body.room_number, '204');
  assert.equal(context.body.valid_from, '2026-08-23T14:00:00-03:00');
  assert.equal(context.body.valid_until, '2026-08-26T12:00:00-03:00');
  assert.equal(context.body.bis_api_contract.request_template.RoomOrDoorId, '204');

  const status = await request(app).get('/api/access-control/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.online, true);
  assert.equal(status.body.codec_present, true);
  assert.equal(status.body.pcsc_shim_present, true);
  assert.equal(status.body.writes_enabled, true);
  assert.equal(status.body.hotel_password_configured, true);

  const encoded = await request(app)
    .post(`/api/reservations/${reservationId}/wristbands/encode`)
    .send({ guest_id: adults[0].id });

  assert.equal(encoded.status, 200);
  assert.equal(encoded.body.ok, true);
  assert.equal(encoded.body.mock, false);
  assert.equal(encoded.body.provider, 'bis_api');
  assert.equal(encoded.body.code, 'A1B2C3D4');
  assert.equal(encoded.body.hardware.reader, 'ACS ACR122 0');
  assert.equal(encoded.body.hardware.door_id, '000204');

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], {
    RoomOrDoorId: '204',
    ValidFrom: '2026-08-23T14:00:00-03:00',
    ValidUntil: '2026-08-26T12:00:00-03:00',
    Confirmation: 'TESTE-SEGREDO-GRAVAR',
    GuestName: 'Fernanda Almeida'
  });

  const guestAfter = db.prepare('SELECT wristband_code FROM guests WHERE id=?').get(adults[0].id);
  assert.equal(guestAfter.wristband_code, 'A1B2C3D4');

  const credential = db.prepare('SELECT * FROM wristband_credentials WHERE reservation_id=? AND guest_id=?')
    .get(reservationId, adults[0].id);
  assert.equal(credential.provider, 'bis_api');
  assert.equal(credential.status, 'encoded');
  assert.equal(credential.room_number, '204');
  assert.equal(credential.valid_from, '2026-08-23T14:00:00-03:00');
  assert.equal(credential.valid_until, '2026-08-26T12:00:00-03:00');
  assert.equal(credential.wristband_code, 'A1B2C3D4');
  assert.match(credential.external_reference, /123456/);

  encodeMode = 'failure';
  const failed = await request(app)
    .post(`/api/reservations/${reservationId}/wristbands/encode`)
    .send({ guest_id: adults[1].id });

  assert.equal(failed.status, 502);
  assert.match(failed.body.error, /Falha de gravação/i);
  assert.equal(db.prepare('SELECT wristband_code FROM guests WHERE id=?').get(adults[1].id).wristband_code, null);
  const failedCredential = db.prepare('SELECT * FROM wristband_credentials WHERE reservation_id=? AND guest_id=?')
    .get(reservationId, adults[1].id);
  assert.equal(failedCredential.status, 'failed');
  assert.match(failedCredential.last_error, /Falha de gravação/i);
});
