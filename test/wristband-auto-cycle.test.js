const test = require('node:test');
const assert = require('node:assert/strict');
const createWristbandFlow = require('../public/wristband-flow.js');

test('automatic cycle writes once per presented UID and requires physical removal before the next wristband', async () => {
  const guard = { waitingRemoval: false, removalReads: 0 };
  const states = [];
  let card = { ok: true, present: true, uidHex: 'A1B2C3D4', awaiting_removal: false };
  let encodeCalls = 0;
  let written = 0;

  const flow = createWristbandFlow({
    guard,
    active: () => true,
    readCard: async () => ({ ...card }),
    encode: async uid => {
      encodeCalls += 1;
      return { ok: true, provider: 'bis_api', code: uid, mock: false };
    },
    onWritten: async () => { written += 1; },
    onState: (...args) => states.push(args)
  });

  // First presentation: one write only.
  await flow.step();
  assert.equal(encodeCalls, 1);
  assert.equal(written, 1);
  assert.equal(guard.waitingRemoval, true);
  assert.equal(states.at(-1)[0], 'written');

  // Keeping the same wristband on the reader must never write it again.
  await flow.step();
  await flow.step();
  assert.equal(encodeCalls, 1, 'same physical presentation must not trigger a second write');
  assert.equal(written, 1);
  assert.equal(guard.waitingRemoval, true);

  // Removal is detected and confirmed without dispatching a write.
  let removalRead = 0;
  card = { ok: true, present: false, awaiting_removal: true };
  const originalCard = card;
  const removalFlow = createWristbandFlow({
    guard,
    active: () => true,
    readCard: async () => {
      removalRead += 1;
      return removalRead === 1
        ? { ...originalCard }
        : { ok: true, present: false, awaiting_removal: false };
    },
    encode: async uid => {
      encodeCalls += 1;
      return { ok: true, provider: 'bis_api', code: uid, mock: false };
    },
    onWritten: async () => { written += 1; },
    onState: (...args) => states.push(args)
  });
  await removalFlow.step();
  assert.equal(guard.waitingRemoval, false);
  assert.equal(encodeCalls, 1);

  // A new physical wristband is then eligible for exactly one write.
  const nextFlow = createWristbandFlow({
    guard,
    active: () => true,
    readCard: async () => ({ ok: true, present: true, uidHex: '11223344', awaiting_removal: false }),
    encode: async uid => {
      encodeCalls += 1;
      return { ok: true, provider: 'bis_api', code: uid, mock: false };
    },
    onWritten: async () => { written += 1; },
    onState: (...args) => states.push(args)
  });
  await nextFlow.step();
  assert.equal(encodeCalls, 2);
  assert.equal(written, 2);
  assert.equal(guard.waitingRemoval, true);
});
