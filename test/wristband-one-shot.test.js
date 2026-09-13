const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('etapa 7 inicia o fluxo NFC automaticamente sem exigir botao', () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'public', 'wristband-access-ui.js'), 'utf8');
  const tickStart = file.indexOf('async function tick()');
  assert.notEqual(tickStart, -1, 'tick() nao encontrado');
  const tickEnd = file.indexOf("state('checking'", tickStart);
  assert.notEqual(tickEnd, -1, 'fim de tick() nao encontrado');
  const tickBody = file.slice(tickStart, tickEnd);

  assert.match(tickBody, /const canAutoProbe/);
  assert.match(tickBody, /if \(canAutoProbe\) await flow\.step\(\)/);
  assert.doesNotMatch(file, /O cartao so e acessado quando voce tocar no botao\./);
  assert.match(file, /button\.hidden = !manualAction/);
});
