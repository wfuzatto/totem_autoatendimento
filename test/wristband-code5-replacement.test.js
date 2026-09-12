const test = require('node:test');
const assert = require('node:assert/strict');
const createWristbandFlow = require('../public/wristband-flow.js');

test('BIS code 5 never retries the same UID and resumes with a replacement wristband', async () => {
  const guard = { waitingRemoval: false, removalReads: 0 };
  const states = [];
  let active = true;
  let encodeCalls = 0;
  let written = 0;
  let card = { ok: true, present: true, uidHex: 'A1B2C3D4', awaiting_removal: false };

  const flow = createWristbandFlow({
    guard,
    active: () => active,
    readCard: async () => ({ ...card }),
    encode: async uid => {
      encodeCalls += 1;
      if (uid === 'A1B2C3D4') {
        throw Object.assign(new Error('Esta pulseira não autentica com o código deste hotel (BIS código 5). Retire-a e use outra pulseira já preparada para este hotel; repetir a mesma pulseira não resolverá.'), {
          code: 'bis_api_vendor_write_failed',
          retryable: true
        });
      }
      return { ok: true, provider: 'bis_api', code: uid, mock: false };
    },
    onWritten: async () => { written += 1; },
    onState: (...args) => states.push(args)
  });

  // First physical wristband is rejected by the codec with deterministic code 5.
  await flow.step();
  assert.equal(encodeCalls, 1);
  assert.equal(written, 0);
  assert.match(states.at(-1)[1], /código 5/i);
  assert.equal(states.at(-1)[2], false, 'code 5 must not expose a normal retry button');

  // Removal must be physically observed before anything else can happen.
  card = { ok: true, present: false, awaiting_removal: true };
  await flow.step();
  card = { ok: true, present: false, awaiting_removal: false };
  await flow.step();

  // Putting the SAME wristband back cannot dispatch another write.
  card = { ok: true, present: true, uidHex: 'A1B2C3D4', awaiting_removal: false };
  await flow.step();
  assert.equal(encodeCalls, 1, 'same rejected UID must never be written again automatically');
  assert.equal(written, 0);

  // A physically different wristband clears only the local code-5 lock and
  // is allowed to enter the normal server-side validation/write path.
  card = { ok: true, present: true, uidHex: '11223344', awaiting_removal: false };
  await flow.step();
  assert.equal(encodeCalls, 2);
  assert.equal(written, 1);
  assert.equal(states.at(-1)[0], 'written');

  active = false;
});
