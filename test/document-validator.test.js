const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidCpf,
  classifyIdentityText
} = require('../src/document-validator');

test('valida CPF pelo dígito verificador', () => {
  assert.equal(isValidCpf('529.982.247-25'), true);
  assert.equal(isValidCpf('529.982.247-24'), false);
  assert.equal(isValidCpf('111.111.111-11'), false);
});

test('aceita CNH somente quando reconhece documento e CPF válido', () => {
  const result = classifyIdentityText(`
    REPÚBLICA FEDERATIVA DO BRASIL
    CARTEIRA NACIONAL DE HABILITAÇÃO
    NOME: MARIA DA SILVA
    CPF 529.982.247-25
    VALIDADE 10/10/2032
  `);
  assert.equal(result.accepted, true);
  assert.equal(result.detectedType, 'cnh');
  assert.equal(result.cpfDetected, true);
});

test('aceita RG/CIN quando há marcador de identidade e CPF válido', () => {
  const result = classifyIdentityText(`
    REPÚBLICA FEDERATIVA DO BRASIL
    CARTEIRA DE IDENTIDADE NACIONAL
    REGISTRO GERAL
    CPF 52998224725
  `);
  assert.equal(result.accepted, true);
  assert.ok(['cin', 'rg_cpf'].includes(result.detectedType));
});

test('rejeita imagem aleatória mesmo que contenha um CPF', () => {
  const result = classifyIdentityText('NOTA FISCAL CONSUMIDOR CPF 529.982.247-25 VALOR TOTAL 125,00');
  assert.equal(result.accepted, false);
  assert.equal(result.detectedType, 'unknown');
});

test('rejeita identidade quando o CPF não é encontrado ou é inválido', () => {
  const result = classifyIdentityText('CARTEIRA NACIONAL DE HABILITAÇÃO CPF 111.111.111-11 VALIDADE 2030');
  assert.equal(result.accepted, false);
  assert.equal(result.cpfDetected, false);
});
