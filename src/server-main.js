const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require('express');

// Compatibilidades SQLite da V2 para consultas legadas e instalações que ainda
// carregam trechos antigos do fluxo. Mantemos as normalizações concentradas aqui.
const { db } = require('./db');
const originalPrepare = db.prepare.bind(db);
db.prepare = sql => {
  let normalized = sql;
  if (typeof normalized === 'string') {
    normalized = normalized.replaceAll('wristband_code != ""', "wristband_code != ''");
    normalized = normalized.replace("VALUES(?,?,?,?,?,?,'reserved',?,?,?,?,?)", "VALUES(?,?,?,?,?,?,'reserved',?,?,?,?)");
  }
  return originalPrepare(normalized);
};

const coreApp = require('./server-runtime');
const { installCheckoutRuntime } = require('./checkout-runtime');
const { installDocumentRemovalRuntime } = require('./document-removal-runtime');
const { installV2Runtime } = require('./v2-runtime');
const { installReservationAdminRuntime } = require('./reservation-admin-runtime');
const { installHybridReservationLookup } = require('./hybrid-reservation-lookup');

installCheckoutRuntime(coreApp);
installDocumentRemovalRuntime(coreApp);
installV2Runtime(coreApp);
installReservationAdminRuntime(coreApp);

// A camada externa permite que reservas locais/manuais continuem disponíveis
// mesmo quando o provider de hotelaria estiver apontando para a integração real.
const app = express();
installHybridReservationLookup(app);
app.use(coreApp);

function start() {
  const port = Number(process.env.PORT || 3080);
  const host = process.env.HOST || '0.0.0.0';
  const httpServer = http.createServer(app);
  httpServer.listen(port, host, () => {
    console.log(`Totem HTTP interno em http://${host}:${port}`);
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
    console.log('HTTPS direto desativado. Em produção, use Caddy/Nginx na porta 443 apontando para 127.0.0.1:3080.');
  }
}

if (require.main === module) start();

module.exports = app;
