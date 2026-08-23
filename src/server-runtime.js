const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const baseApp = require('./server');
const { db, audit } = require('./db');
const { validateIdentityDocument } = require('./document-validator');

const app = express();
const PORT = Number(process.env.PORT || 3080);
const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const allowedMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => cb(
      null,
      `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).slice(0, 12).toLowerCase()}`
    )
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = allowedMimeTypes.has(file.mimetype);
    cb(ok ? null : new Error('Formato não permitido. Use PDF, JPG, PNG ou WEBP.'), ok);
  }
});

function validUploadToken(token) {
  const entry = db.prepare('SELECT * FROM upload_tokens WHERE token=?').get(token);
  if (!entry) return null;
  const expiresAt = Date.parse(entry.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return entry;
}

function removeUploadedFile(file) {
  if (!file?.path) return;
  try { fs.unlinkSync(file.path); } catch (_) {}
}

function removeStoredFilename(filename) {
  if (!filename) return;
  const safeName = path.basename(String(filename));
  try { fs.unlinkSync(path.join(uploadsDir, safeName)); } catch (_) {}
}

app.get('/api/public/upload/:token', (req, res) => {
  const entry = validUploadToken(req.params.token);
  if (!entry) return res.status(410).json({ error: 'QR Code expirado. Gere um novo no totem.' });

  const reservation = db.prepare('SELECT * FROM reservations WHERE id=?').get(entry.reservation_id);
  if (!reservation) return res.status(404).json({ error: 'Reserva não encontrada.' });
  const guests = db.prepare('SELECT * FROM guests WHERE reservation_id=? ORDER BY adult DESC, id').all(entry.reservation_id);
  const documents = db.prepare('SELECT * FROM documents WHERE reservation_id=? ORDER BY guest_id, type').all(entry.reservation_id);
  return res.json({ reservation, guests, documents });
});

// Intercepta o upload antes da rota legada do app base. Documentos de identidade
// só entram como "received" depois da validação OCR/classificação.
app.post('/api/public/upload/:token/:documentId', upload.single('file'), async (req, res, next) => {
  let activeDoc = null;
  try {
    const entry = validUploadToken(req.params.token);
    if (!entry) {
      removeUploadedFile(req.file);
      return res.status(410).json({ error: 'QR Code expirado. Gere um novo no totem.' });
    }
    if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });

    const documentId = Number(req.params.documentId);
    const doc = db.prepare('SELECT * FROM documents WHERE id=? AND reservation_id=?')
      .get(documentId, entry.reservation_id);
    activeDoc = doc;
    if (!doc) {
      removeUploadedFile(req.file);
      return res.status(404).json({ error: 'Documento não encontrado.' });
    }

    removeStoredFilename(doc.filename);
    db.prepare("UPDATE documents SET filename=?, status='validating', uploaded_at=NULL WHERE id=?")
      .run(req.file.filename, doc.id);

    if (doc.type !== 'identity') {
      db.prepare("UPDATE documents SET status='received', uploaded_at=CURRENT_TIMESTAMP WHERE id=?").run(doc.id);
      audit('document.uploaded', entry.reservation_id, { document_id: doc.id, type: doc.type, validated: false });
      return res.json({
        ok: true,
        accepted: true,
        status: 'received',
        detected_type: doc.type,
        message: 'Arquivo recebido com sucesso.'
      });
    }

    const validation = await validateIdentityDocument(req.file.path, req.file.mimetype);

    if (validation.accepted) {
      db.prepare("UPDATE documents SET status='received', uploaded_at=CURRENT_TIMESTAMP WHERE id=?").run(doc.id);
      audit('document.identity.validated', entry.reservation_id, {
        document_id: doc.id,
        detected_type: validation.detectedType,
        cpf_detected: validation.cpfDetected
      });
      return res.json({
        ok: true,
        accepted: true,
        status: 'received',
        detected_type: validation.detectedType,
        message: validation.message
      });
    }

    removeUploadedFile(req.file);
    const rejectedStatus = validation.systemError ? 'validation_error' : 'invalid';
    db.prepare('UPDATE documents SET filename=NULL, status=?, uploaded_at=NULL WHERE id=?')
      .run(rejectedStatus, doc.id);
    audit(validation.systemError ? 'document.identity.validation_error' : 'document.identity.rejected', entry.reservation_id, {
      document_id: doc.id,
      detected_type: validation.detectedType,
      cpf_detected: validation.cpfDetected
    });

    return res.json({
      ok: true,
      accepted: false,
      status: rejectedStatus,
      detected_type: validation.detectedType,
      message: validation.message
    });
  } catch (error) {
    removeUploadedFile(req.file);
    if (activeDoc?.id) {
      try {
        db.prepare("UPDATE documents SET filename=NULL, status='validation_error', uploaded_at=NULL WHERE id=?").run(activeDoc.id);
      } catch (_) {}
    }
    next(error);
  }
});

app.use((err, _req, res, next) => {
  if (!err) return next();
  console.error(err);
  return res.status(400).json({ error: err.message || 'Erro ao processar o arquivo.' });
});

app.use(baseApp);

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Totem API/UI em http://0.0.0.0:${PORT}`);
    console.log('Validação de identidade: OCR local (Tesseract + regras CNH/RG/CIN + CPF).');
  });
}

module.exports = app;
