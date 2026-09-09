const fs = require('fs');
const path = require('path');

function normalizeBasePath(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '/') return '';
  return `/${raw.replace(/^\/+|\/+$/g, '')}`;
}

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'public'));
const base = normalizeBasePath(process.argv[3] || process.env.PUBLIC_BASE_PATH || '/totem');

if (!base) process.exit(0);

function transform(file) {
  const ext = path.extname(file).toLowerCase();
  let text = fs.readFileSync(file, 'utf8');

  if (ext === '.html') {
    // Apenas referências estáticas do HTML recebem o prefixo. Não alteramos
    // JavaScript inline/externo porque strings como '/api/*' também fazem parte
    // da lógica da aplicação e uma reescrita textual pode mudar seu significado.
    text = text.replace(/\b(href|src|action)=(['"])\/(?!\/)/gi, (_m, attr, quote) => `${attr}=${quote}${base}/`);
  } else if (ext === '.css') {
    text = text.replace(/url\((['"]?)\/(?!\/)/gi, (_m, quote) => `url(${quote}${base}/`);
  } else {
    return;
  }

  fs.writeFileSync(file, text);
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else transform(full);
  }
}

walk(root);
console.log(`Referências estáticas preparadas para base path ${base}; JavaScript preservado.`);
