const fs = require('fs');
const http = require('http');
const https = require('https');
const app = require('./server-runtime');
const { installCheckoutRuntime } = require('./checkout-runtime');
const { installDocumentRemovalRuntime } = require('./document-removal-runtime');
const { installV2Runtime } = require('./v2-runtime');

installCheckoutRuntime(app);
installDocumentRemovalRuntime(app);
installV2Runtime(app);

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
