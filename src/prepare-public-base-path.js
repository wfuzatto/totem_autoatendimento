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

function prefixQuotedStrings(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const quote = text[i];
    if (!['"', "'", '`'].includes(quote)) {
      out += text[i++];
      continue;
    }

    out += quote;
    i += 1;
    if (text[i] === '/' && text[i + 1] !== '/' && !text.startsWith(`${base}/`, i) && !text.startsWith(base + quote, i)) {
      out += base;
    }

    while (i < text.length) {
      const ch = text[i];
      out += ch;
      i += 1;
      if (ch === '\\' && i < text.length) {
        out += text[i++];
        continue;
      }
      if (ch === quote) break;
    }
  }
  return out;
}

function transform(file) {
  const ext = path.extname(file).toLowerCase();
  let text = fs.readFileSync(file, 'utf8');

  if (ext === '.html') {
    text = text.replace(/\b(href|src|action)=(['"])\/(?!\/)/gi, (_m, attr, quote) => `${attr}=${quote}${base}/`);
    text = text.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_m, open, body, close) => `${open}${prefixQuotedStrings(body)}${close}`);
  } else if (ext === '.js' || ext === '.json' || ext === '.webmanifest') {
    text = prefixQuotedStrings(text);
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
console.log(`Public assets preparados para base path ${base}`);
