const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('leitor NFC não é consultado automaticamente em loop', () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'public', 'wristband-access-ui.js'), 'utf8');
  const tickStart = file.indexOf('async function tick()');
  assert.notEqual(tickStart, -1, 'tick() não encontrado');
  const tickEnd = file.indexOf("state('checking'", tickStart);
  assert.notEqual(tickEnd, -1, 'fim de tick() não encontrado');
  const tickBody = file.slice(tickStart, tickEnd);

  assert.doesNotMatch(tickBody, /flow\.step\s*\(/, 'tick() não deve acessar cartão automaticamente');
  assert.match(file, /button\.onclick\s*=\s*async\s*\(\)\s*=>[\s\S]*await flow\.step\(\)/, 'a leitura/gravação deve ocorrer apenas por ação do botão');
  assert.match(file, /O cartão só é acessado quando você tocar no botão\./);
});
