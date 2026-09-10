const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const runtimeApp = require('./server-runtime');
const { db, audit } = require('./db');
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

function prefixPublicValue(value, basePath, publicOrigin = '') {
  if (!basePath) return value;
  if (typeof value === 'string') {
    if (value.startsWith('/') && !value.startsWith('//') && value !== basePath && !value.startsWith(`${basePath}/`)) {
      return `${basePath}${value}`;
    }

    if (publicOrigin && /^https?:\/\//i.test(value)) {
      try {
        const parsed = new URL(value);
        if (parsed.origin === publicOrigin && parsed.pathname !== basePath && !parsed.pathname.startsWith(`${basePath}/`)) {
          parsed.pathname = `${basePath}${parsed.pathname.startsWith('/') ? parsed.pathname : `/${parsed.pathname}`}`;
          return parsed.toString();
        }
      } catch (_) {}
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(item => prefixPublicValue(item, basePath, publicOrigin));
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, prefixPublicValue(item, basePath, publicOrigin)])
    );
  }
  return value;
}

function forwardedPrefixResponses(req, res, next) {
  const basePath = normalizeBasePath(req.get('x-forwarded-prefix') || '');
  if (!basePath) return next();

  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  const publicOrigin = host ? `${proto}://${host}` : '';

  const originalJson = res.json.bind(res);
  res.json = payload => originalJson(prefixPublicValue(payload, basePath, publicOrigin));

  const originalRedirect = res.redirect.bind(res);
  res.redirect = (statusOrUrl, maybeUrl) => {
    if (typeof statusOrUrl === 'number') {
      return originalRedirect(statusOrUrl, prefixPublicValue(maybeUrl, basePath, publicOrigin));
    }
    return originalRedirect(prefixPublicValue(statusOrUrl, basePath, publicOrigin));
  };
  next();
}

function runtimeSetting(key) {
  try {
    return String(db.prepare('SELECT value FROM runtime_settings WHERE key=?').get(key)?.value || '').trim();
  } catch (_) {
    return '';
  }
}

function publicBaseForRequest(req) {
  const basePath = normalizeBasePath(req.get('x-forwarded-prefix') || '');
  const configured = runtimeSetting('public_qr_base_url');

  if (configured) {
    try {
      const parsed = new URL(configured);
      parsed.hash = '';
      parsed.search = '';
      const configuredPath = parsed.pathname.replace(/\/+$/, '');
      if (basePath && (!configuredPath || configuredPath === '/')) parsed.pathname = basePath;
      return parsed.toString().replace(/\/$/, '');
    } catch (_) {}
  }

  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return `${proto}://${host}${basePath}`.replace(/\/$/, '');
}

// O QR precisa nascer com o prefixo público. Prefixar apenas o JSON depois não
// basta, pois a imagem QR já foi codificada pelo backend com a URL original.
async function createUploadToken(req, res) {
  const id = Number(req.params.id);
  const reservation = db.prepare('SELECT id FROM reservations WHERE id=?').get(id);
  if (!reservation) return res.status(404).json({ error: 'Reserva não encontrada.' });

  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM upload_tokens WHERE reservation_id=?').run(id);
  db.prepare('INSERT INTO upload_tokens(token,reservation_id,expires_at) VALUES(?,?,?)').run(token, id, expires);

  const publicBase = publicBaseForRequest(req);
  const url = `${publicBase}/upload.html?token=${encodeURIComponent(token)}`;
  const qrDataUrl = await QRCode.toDataURL(url, { width: 420, margin: 2 });
  return res.json({ token, expires_at: expires, url, qr_data_url: qrDataUrl, public_base_url: publicBase });
}

// O Caddy remove /totem antes de encaminhar. A aplicação continua usando suas
// rotas nativas (/api, /assets, /vendor etc.) e apenas as URLs devolvidas ao
// navegador recebem novamente o prefixo indicado por X-Forwarded-Prefix.
const app = express();
app.use(forwardedPrefixResponses);
app.post('/api/reservations/:id/upload-token', express.json(), (req, res, next) => {
  createUploadToken(req, res).catch(next);
});

// Segurança fail-closed: a rota antiga aceitava uma captura e marcava
// face_verified sem consultar o motor biométrico. No runtime Docker oficial ela
// nunca pode ser usada. O navegador deve passar pelo adapter /api/face-scanner/*.
app.post('/api/reservations/:id/face/verify', express.json({ limit: '12mb' }), (req, res) => {
  const id = Number(req.params.id);
  audit('face.legacy_endpoint.blocked', Number.isFinite(id) ? id : null);
  return res.status(410).json({
    error: 'Validação facial legada desativada. Use o motor Face Scanner integrado.'
  });
});

app.use(runtimeApp);

function start() {
  const port = Number(process.env.PORT || 3080);
  const host = process.env.HOST || '0.0.0.0';
  const httpServer = http.createServer(app);
  httpServer.listen(port, host, () => {
    console.log(`Totem HTTP interno em http://${host}:${port}`);
    console.log('Totem preparado para publicação em /totem via reverse proxy com strip-prefix.');
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
