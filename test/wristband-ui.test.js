const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const createFlow = require('../public/wristband-flow');

test('flow requires physical removal, serializes polls and does not auto retry errors', async () => {
  let present = true, count = 0, alive = true, failed = false;
  const guard = { waitingRemoval: false }, states = [];
  const flow = createFlow({ guard, active: () => alive, onState: (...s) => states.push(s), onWritten: async () => {},
    readCard: async () => ({ ok: true, present, uidHex: '11223344' }),
    encode: async () => { count++; if (failed) throw new Error('timeout'); return { ok: true, provider: 'bis_api', mock: false, code: '11223344' }; }
  });
  await Promise.all([flow.step(), flow.step(), flow.step()]); assert.equal(count, 1);
  await flow.step(); assert.equal(count, 1); assert.equal(states.at(-1)[0], 'remove');
  present = false; await flow.step(); await flow.step(); present = true; failed = true;
  await flow.step(); assert.equal(count, 2);
  present = false; await flow.step(); await flow.step(); present = true; flow.retry(); await flow.step();
  assert.equal(count, 2); // timeout requires review, not automatic or manual blind retry
  alive = false; await flow.step(); assert.equal(count, 2);
});

test('screen entered after home auto writes, ignores simulated badge, waits removal and stops on navigation', async () => {
  const dom = new JSDOM('<div id="app">Home</div>', { url: 'https://hotel/totem/', runScripts: 'outside-only' });
  const w = dom.window;
  const timers = [];
  w.setTimeout = fn => { timers.push(fn); return timers.length; };
  w.clearTimeout = () => {};
  let present = false, uid = '11223344', calls = 0, reads = 0;
  const completed = new Map();
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
  w.fetch = async (url, options = {}) => {
    if (url.endsWith('/access-context')) return new Response(JSON.stringify({ provider: 'bis_api', ready_for_wristband: true, room_number: '125', valid_from: '2026-09-11', valid_until: '2026-09-12', credentials: [1, 2].map(id => ({ guest_id: id, uid: completed.get(id) || null })) }));
    if (url.endsWith('/status')) return new Response(JSON.stringify({ provider: 'bis_api', ready_for_write: true }));
    if (url.endsWith('/card-status')) { reads++; return new Response(JSON.stringify({ ok: true, present, uidHex: present ? uid : null })); }
    if (url.endsWith('/encode')) {
      const body = JSON.parse(options.body); assert.equal(body.expected_uid, uid); calls++; completed.set(body.guest_id, uid);
      return new Response(JSON.stringify({ ok: true, provider: 'bis_api', mock: false, code: uid }));
    }
    throw new Error('Unexpected request ' + url);
  };
  for (const script of ['wristband-flow.js', 'wristband-access-ui.js']) w.eval(fs.readFileSync(path.join(__dirname, '../public', script), 'utf8'));
  assert.equal(timers.length, 0); // Home must not consume the only polling timer.
  function mount() {
    w.document.getElementById('app').innerHTML = '<section class="panel-card"><div class="scan-box"><h2></h2><p></p><button id="encodeBand"></button></div><div class="wristband-list"></div><button data-action="bands-encoded" disabled></button></section>';
    w.TotemWristbands.mount({ reservationId: 2, guests: [{ id: 1, adult: true, name: 'Fernanda', wristband_code: 'TOTEM-MOCK' }, { id: 2, adult: true, name: 'Rafael' }], onWritten: async () => mount() });
  }
  async function tick() { const fn = timers.shift(); assert.ok(fn); await fn(); await settle(); }
  mount(); await settle();
  assert.match(w.document.querySelector('h2').textContent, /Fernanda/);
  assert.match(w.document.body.textContent, /Gravação real habilitada/);
  assert.ok(!w.document.body.textContent.includes('Simulada'));
  present = true; await tick(); assert.equal(calls, 1);
  await tick(); assert.equal(calls, 1);
  assert.match(w.document.body.textContent, /Retire a pulseira/);
  assert.equal(w.document.getElementById('encodeBand').disabled, true);
  present = false; await tick(); await tick(); present = true; uid = 'AABBCCDD'; await tick();
  assert.equal(calls, 2);
  present = false; await tick(); await tick();
  assert.equal(w.document.querySelector('[data-action="bands-encoded"]').disabled, false);
  w.document.getElementById('app').textContent = 'Home'; await settle(); const previousReads = reads;
  while (timers.length) await tick(); assert.equal(reads, previousReads);
  dom.window.close();
});

test('leaving the screen during detection cannot dispatch a write', async () => {
  let alive = true, release, calls = 0;
  const flow = createFlow({ guard: {}, active: () => alive, onState: () => {}, onWritten: async () => {},
    readCard: () => new Promise(resolve => { release = resolve; }), encode: async () => { calls++; }
  });
  const pending = flow.step(); alive = false; release({ ok: true, present: true, uidHex: '11223344' });
  await pending; assert.equal(calls, 0);
});
