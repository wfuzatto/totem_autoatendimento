const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require('express');
const runtimeApp = require('./server-runtime');
const { installCheckoutRuntime } = require('./checkout-runtime');
const { installDocumentRemovalRuntime } = require('./document-removal-runtime');
const { installFaceScannerRuntime } = require('./face-scanner-runtime');

installCheckoutRuntime(runtimeApp);
installDocumentRemovalRuntime(runtimeApp);
installFaceScannerRuntime(runtimeApp);

function normalizeBasePath(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '/') return '';
  return `/${raw.replace(/^\/+|\/+$/g, '')}`;
}

const publicBasePath = normalizeBasePath(process.env.PUBLIC_BASE_PATH || '/totem');

function prefixPublicValue(value) {
  if (!publicBasePath) return value;
  if (typeof value === 'string') {
    if (value.startsWith('/') && !value.startsWith('//') && value !== publicBasePath && !value.startsWith(`${publicBasePath}/`)) {
      return `${publicBasePath}${value}`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(prefixPublicValue);
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, prefixPublicValue(item)]));
  }
  return value;
}

function prefixPublicResponses(_req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = payload => originalJson(prefixPublicValue(payload));

  const originalRedirect = res.redirect.bind(res);
  res.redirect = (statusOrUrl, maybeUrl) => {
    if (typeof statusOrUrl === 'number') {
      return originalRedirect(statusOrUrl, prefixPublicValue(maybeUrl));
    }
    return originalRedirect(prefixPublicValue(statusOrUrl));
  };
  next();
}

const app = express();
if (publicBasePath) {
  app.use(publicBasePath, prefixPublicResponses, runtimeApp);
}
// Mantém healthchecks e integrações internas Docker nas rotas nativas (/api/...).
app.use(runtimeApp);

function start() {
  const port = Number(process.env.PORT || 3080);
  const host = process.env.HOST || '0.0.0.0';
  const httpServer = http.createServer(app);
  httpServer.listen(port, host, () => {
    console.log(`Totem HTTP interno em http://${host}:${port}`);
    console.log(`Totem público preparado em ${publicBasePath || '/'} atrás do reverse proxy.`);
  });

  const keyFile = process.env.HTTPS_KEY_FILE;
  const certFile = process.env.HTTPS_CERT_FILE;
  if (keyFile && certFile) {
    const httpsPort = Number(process.env.HTTPS_PORT || 3443);
    const httpsServer = https.createServer({
      key: fs.readFileSync(keyFile),
      cert: fs.readFileSync(certFile)
    }, app);
    httpsServer.listen(httpsPort, host, () => {
      console.log(`Totem HTTPS direto em https://${host}:${httpsPort}`);
    });
  } else {
    console.log('HTTPS direto desativado. Em produção, use o gateway do HUB Core na porta 443.');
  }
}

if (require.main === module) start();

module.exports = app;
