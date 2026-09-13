const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function functionBody(name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} não encontrado em public/app.js`);
  assert.ok(end > start, `${nextName} não encontrado após ${name}`);
  return source.slice(start, end);
}

test('Etapa 5 continua visível quando a validação facial já está concluída ou não é exigida', () => {
  const body = functionBody('renderCheckinFace', 'renderCheckinPaymentGate');
  assert.doesNotMatch(body, /if\s*\(!state\.config\.require_face_match\)\s*return\s+renderCheckinPaymentGate/);
  assert.match(body, /flowHeader\(5,\s*'Validação facial'/);
  assert.match(body, /data-action=\"face-complete\"/);
  assert.match(body, /renderCheckinPaymentGate/);
});

test('Etapa 6 continua visível quando não existe pagamento pendente', () => {
  const body = functionBody('renderCheckinPaymentGate', 'renderCheckinWristbands');
  assert.match(body, /flowHeader\(6,\s*'Pagamento'/);
  assert.match(body, /Pagamento confirmado/);
  assert.match(body, /data-action=\"payment-complete\"/);
  assert.doesNotMatch(body, /return\s+renderCheckinWristbands\(\)/);
});
