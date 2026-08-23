const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[|]/g, 'I')
    .replace(/\s+/g, ' ')
    .trim();
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function isValidCpf(value) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const digit = factor => {
    let total = 0;
    for (let i = 0; i < factor - 1; i += 1) total += Number(cpf[i]) * (factor - i);
    const mod = (total * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  return digit(10) === Number(cpf[9]) && digit(11) === Number(cpf[10]);
}

function extractValidCpfs(text) {
  const normalized = String(text || '').replace(/[Oo]/g, '0');
  const candidates = new Set();

  const formatted = normalized.match(/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g) || [];
  formatted.forEach(value => candidates.add(onlyDigits(value)));

  const digitsOnly = normalized.replace(/\D/g, ' ');
  (digitsOnly.match(/\b\d{11}\b/g) || []).forEach(value => candidates.add(value));

  return [...candidates].filter(isValidCpf);
}

function hasAny(text, terms) {
  return terms.some(term => text.includes(term));
}

function classifyIdentityText(rawText) {
  const text = normalizeText(rawText);
  const validCpfs = extractValidCpfs(rawText);
  const hasCpf = validCpfs.length > 0;

  const cnhMarkers = [
    'CARTEIRA NACIONAL DE HABILITACAO',
    'PERMISSAO PARA DIRIGIR',
    'HABILITACAO'
  ];
  const rgMarkers = [
    'CARTEIRA DE IDENTIDADE NACIONAL',
    'CARTEIRA DE IDENTIDADE',
    'REGISTRO GERAL',
    'IDENTIDADE NACIONAL'
  ];

  const explicitCnh = text.includes('CARTEIRA NACIONAL DE HABILITACAO') || text.includes('PERMISSAO PARA DIRIGIR');
  const compactCnh = /\bCNH\b/.test(text) && text.includes('HABILITACAO');
  const looksLikeCnh = explicitCnh || compactCnh || (hasAny(text, cnhMarkers) && text.includes('VALIDADE') && text.includes('CPF'));
  const looksLikeRg = hasAny(text, rgMarkers);

  if (looksLikeCnh && hasCpf) {
    return {
      accepted: true,
      detectedType: 'cnh',
      cpfDetected: true,
      message: 'CNH reconhecida e CPF validado.'
    };
  }

  if (looksLikeRg && hasCpf) {
    return {
      accepted: true,
      detectedType: text.includes('IDENTIDADE NACIONAL') ? 'cin' : 'rg_cpf',
      cpfDetected: true,
      message: 'Documento de identidade reconhecido e CPF validado.'
    };
  }

  if ((looksLikeCnh || looksLikeRg) && !hasCpf) {
    return {
      accepted: false,
      detectedType: looksLikeCnh ? 'cnh_incompleta' : 'rg_sem_cpf',
      cpfDetected: false,
      message: 'O documento parece ser uma identidade, mas não foi possível localizar um CPF válido. Envie uma CNH completa ou RG/CIN junto com o CPF, com todos os dados legíveis.'
    };
  }

  return {
    accepted: false,
    detectedType: 'unknown',
    cpfDetected: hasCpf,
    message: 'Documento inválido. Envie uma CNH ou RG/CIN com CPF visível, em foto nítida e sem cortes.'
  };
}

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      ...options
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      const wrapped = new Error(`Dependência de validação ausente: ${command}.`);
      wrapped.code = 'VALIDATOR_DEPENDENCY_MISSING';
      throw wrapped;
    }
    if (error.killed || error.signal === 'SIGTERM') {
      const wrapped = new Error(`Tempo excedido ao processar o documento com ${command}.`);
      wrapped.code = 'VALIDATOR_TIMEOUT';
      throw wrapped;
    }
    throw error;
  }
}

async function ocrImage(imagePath) {
  const { stdout } = await run('tesseract', [
    imagePath,
    'stdout',
    '-l',
    'por+eng',
    '--psm',
    '6'
  ]);
  return stdout || '';
}

async function ocrPdf(pdfPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-doc-'));
  const prefix = path.join(tempDir, 'page');

  try {
    await run('pdftoppm', ['-png', '-f', '1', '-l', '3', '-r', '220', pdfPath, prefix]);
    const pages = fs.readdirSync(tempDir)
      .filter(name => /^page-\d+\.png$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .slice(0, 3);

    if (!pages.length) throw new Error('Não foi possível converter o PDF para validação.');

    const texts = [];
    for (const page of pages) texts.push(await ocrImage(path.join(tempDir, page)));
    return texts.join('\n');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function extractDocumentText(filePath, mimetype) {
  if (mimetype === 'application/pdf' || path.extname(filePath).toLowerCase() === '.pdf') {
    return ocrPdf(filePath);
  }
  return ocrImage(filePath);
}

async function validateIdentityDocument(filePath, mimetype) {
  try {
    const text = await extractDocumentText(filePath, mimetype);
    if (normalizeText(text).length < 20) {
      return {
        accepted: false,
        detectedType: 'unreadable',
        cpfDetected: false,
        message: 'Não foi possível ler o documento. Tire outra foto com boa iluminação, sem reflexos e com o documento inteiro visível.'
      };
    }
    return classifyIdentityText(text);
  } catch (error) {
    return {
      accepted: false,
      systemError: true,
      detectedType: 'validation_error',
      cpfDetected: false,
      message: error.code === 'VALIDATOR_DEPENDENCY_MISSING'
        ? 'A validação automática está indisponível neste totem. Chame um atendente ou tente novamente após a correção do validador.'
        : 'Não foi possível validar o documento agora. Tente novamente; se persistir, procure um atendente.'
    };
  }
}

module.exports = {
  normalizeText,
  isValidCpf,
  extractValidCpfs,
  classifyIdentityText,
  extractDocumentText,
  validateIdentityDocument
};
