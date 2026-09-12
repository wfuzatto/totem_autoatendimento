const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

test('real NFC contract, failures, locks and simulated credential migration', async t => {
  let mode = 'ok', present = false, readers = ['ACS ACR122 0'], calls = 0, release;
  let writes = true, codec = true, shim = true, password = true, uid = '11223344';
  const fake = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/health') return res.end(JSON.stringify({ ok: true, processArchitecture: 'X86', vendor: {
      codecPresent: codec, pcscShimPresent: shim, hotelPasswordConfigured: password, hotelCardWritesEnabled: writes, pcscReader: 'ACS ACR122 0'
    } }));
    if (req.url === '/api/pcsc/readers') return res.end(JSON.stringify({ readers }));
    if (req.url.startsWith('/api/pcsc/probe')) {
      if (mode === 'probe500') { res.statusCode = 500; return res.end('{}'); }
      if (mode === 'sharing') { res.statusCode = 502; return res.end(JSON.stringify({ code: '0x8010000B' })); }
      if (!present) { res.statusCode = 502; return res.end(JSON.stringify({ code: '0x80100069' })); }
      return res.end(JSON.stringify({ uidHex: uid, reader: readers[0] }));
    }
    if (req.url === '/api/hotel-card/encode') {
      calls++;
      for await (const _ of req) {} // consume without logging secrets
      if (mode === 'slow') await new Promise(resolve => { release = resolve; });
      if (mode === 'timeout') return;
      if (mode === '500') { res.statusCode = 500; return res.end(JSON.stringify({ error: process.env.BIS_API_WRITE_CONFIRMATION })); }
      return res.end(JSON.stringify({ written: mode === 'string' ? 'true' : mode !== 'rejected', uidHex: mode === 'missing' ? '' : uid, vendorResult: 0 }));
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
  t.after(() => { fake.closeAllConnections(); fake.close(); });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-nfc-safety-'));
  Object.assign(process.env, { DATA_DIR: temp, UPLOAD_DIR: path.join(temp, 'uploads'), BRANDING_DIR: path.join(temp, 'branding'),
    HOTEL_CARD_PROVIDER: 'bis_api', BIS_API_URL: 'http://127.0.0.1:' + fake.address().port,
    BIS_API_WRITE_CONFIRMATION: 'PRIVATE-TEST-ONLY', BIS_API_TIMEOUT_MS: '1000',
    HOTEL_ACCESS_CHECKIN_TIME: '14:00', HOTEL_ACCESS_CHECKOUT_TIME: '12:00', HOTEL_ACCESS_UTC_OFFSET: '-03:00' });
  const app = require('../src/server-main');
  const { db } = require('../src/db');
  const lookup = (await request(app).post('/api/reservations/lookup').send({ query: 'RES-20080' })).body;
  const id = lookup.reservation.id, adults = lookup.guests.filter(g => g.adult);
  db.prepare("UPDATE documents SET status='received' WHERE reservation_id=?").run(id);
  db.prepare('UPDATE guests SET face_verified=1 WHERE reservation_id=?').run(id);
  db.prepare('INSERT OR REPLACE INTO process_state(reservation_id,govbr_verified) VALUES(?,1)').run(id);
  const encode = (guest = adults[0].id, expected = uid) => request(app).post('/api/reservations/' + id + '/wristbands/encode').send({ guest_id: guest, expected_uid: expected });
  const card = () => request(app).get('/api/access-control/card-status');
  const status = () => request(app).get('/api/access-control/status');
  const credential = () => db.prepare('SELECT * FROM wristband_credentials WHERE guest_id=?').get(adults[0].id);
  async function reset() {
    mode = 'ok'; present = false; calls = 0; readers = ['ACS ACR122 0']; writes = codec = shim = password = true; uid = '11223344';
    db.prepare('DELETE FROM wristband_credentials WHERE reservation_id=?').run(id);
    db.prepare('UPDATE guests SET wristband_code=NULL WHERE reservation_id=?').run(id);
    db.prepare("UPDATE reservations SET payment_pending=0,balance_cents=0,room_number='125' WHERE id=?").run(id);
    await card(); present = true;
  }
  await t.test('hardware reasons and only explicit no-card means removal', async () => {
    await reset();
    assert.equal((await status()).body.ready_for_write, true);
    readers = ['Other reader']; assert.equal((await status()).body.code, 'reader_missing');
    readers = ['ACS ACR122 0']; writes = false; assert.equal((await status()).body.code, 'writes_disabled');
    writes = true; password = false; assert.equal((await status()).body.code, 'hpass_missing');
    password = true; codec = false; assert.equal((await status()).body.code, 'codec_missing');
    codec = true; shim = false; assert.equal((await status()).body.code, 'shim_missing'); shim = true;
    for (const bad of ['probe500', 'sharing']) { mode = bad; const r = (await card()).body; assert.equal(r.ok, false); assert.equal(r.present, null); }
    mode = 'ok'; present = false; assert.equal((await card()).body.present, false);
    const url = process.env.BIS_API_URL; process.env.BIS_API_URL = 'http://127.0.0.1:1';
    assert.equal((await status()).body.online, false); process.env.BIS_API_URL = url;
  });
  await t.test('prerequisites and UID mismatch never dispatch a write', async () => {
    await reset();
    db.prepare('UPDATE reservations SET payment_pending=1 WHERE id=?').run(id);
    assert.equal((await encode()).status, 409);
    db.prepare('UPDATE reservations SET payment_pending=0,room_number=NULL WHERE id=?').run(id);
    assert.equal((await encode()).status, 409);
    db.prepare("UPDATE reservations SET room_number='125' WHERE id=?").run(id);
    assert.equal((await encode(-1)).status, 404);
    assert.equal((await encode(adults[0].id, 'AABBCCDD')).body.code, 'card_changed');
    writes = false; assert.equal((await encode()).status, 503); assert.equal(calls, 0);
  });
  await t.test('old mock badges do not count as real; persist only after returned confirmation', async () => {
    await reset();
    db.prepare("UPDATE guests SET wristband_code='TOTEM-MOCK' WHERE reservation_id=?").run(id);
    const context = (await request(app).get('/api/reservations/' + id + '/access-context')).body;
    assert.ok(context.credentials.every(c => c.uid === null));
    assert.equal((await request(app).post('/api/reservations/' + id + '/checkin').send({})).status, 409);
    mode = 'slow';
    const pending = encode().then(r => r);
    while (!release) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(credential().status, 'encoding'); assert.equal(credential().wristband_code, null);
    assert.equal((await encode()).status, 409);
    assert.equal((await encode(adults[1].id)).status, 409);
    assert.equal((await card()).body.busy, true);
    release(); const result = await pending;
    assert.equal(result.status, 200); assert.equal(calls, 1); assert.equal(credential().status, 'encoded');
    assert.equal(credential().wristband_code, uid);
    assert.equal((await encode()).body.already_encoded, true); assert.equal(calls, 1);
    assert.equal((await encode(adults[1].id)).body.code, 'awaiting_removal');
    present = false; await card(); present = true;
    assert.equal((await encode(adults[1].id)).body.code, 'awaiting_removal');
    present = false; await card(); present = true;
    assert.equal((await encode(adults[1].id)).body.code, 'uid_in_use'); assert.equal(calls, 1);
  });
  for (const bad of ['missing', 'rejected', 'string', '500', 'timeout']) await t.test(bad + ' never persists success or retries uncertain writes', async () => {
    await reset(); mode = bad;
    const result = await encode();
    assert.ok(result.status >= 400); assert.equal(credential().status, 'uncertain');
    assert.equal(db.prepare('SELECT wristband_code FROM guests WHERE id=?').get(adults[0].id).wristband_code, null);
    assert.ok(!JSON.stringify(result.body).includes(process.env.BIS_API_WRITE_CONFIRMATION));
    present = false; mode = 'ok'; await card(); present = true;
    assert.equal((await encode()).body.code, 'write_uncertain'); assert.equal(calls, 1);
  });
});
