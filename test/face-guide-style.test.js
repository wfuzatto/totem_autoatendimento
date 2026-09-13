const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'public', 'face-checkin.css');

function ruleBody(css, selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `Regra ${selector} não encontrada.`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  assert.ok(open > start && close > open, `Regra ${selector} inválida.`);
  return css.slice(open + 1, close);
}

test('guia facial permanece centralizado sobre a imagem da câmera', () => {
  const css = fs.readFileSync(cssPath, 'utf8');
  const rule = ruleBody(css, '.face-checkin-camera .face-guide');

  assert.match(rule, /left:\s*50%/);
  assert.match(rule, /top:\s*49%/);
  assert.match(rule, /right:\s*auto/);
  assert.match(rule, /bottom:\s*auto/);
  assert.match(rule, /transform:\s*translate\(-50%,\s*-50%\)/);
  assert.doesNotMatch(rule, /inset:\s*auto/);
});
