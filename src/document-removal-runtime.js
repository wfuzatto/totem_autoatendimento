const fs = require('fs');
const path = require('path');
const { db, audit } = require('./db');

const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');

function validUploadToken(token) {
  const entry = db.prepare('SELECT * FROM upload_tokens WHERE token=?').get(String(token || ''));
  if (!entry) return null;
  const expiresAt = Date.parse(entry.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return entry;
}

function removeStoredFilename(filename) {
  if (!filename) return;
  const safeName = path.basename(String(filename));
  try { fs.unlinkSync(path.join(uploadsDir, safeName)); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function installDocumentRemovalRuntime(app) {
  app.delete('/api/public/upload/:token/:documentId', (req, res, next) => {
    try {
      const entry = validUploadToken(req.params.token);
      if (!entry) return res.status(410).json({ error: 'QR Code expirado. Gere um novo no totem.' });

      const reservation = db.prepare('SELECT id,status FROM reservations WHERE id=?').get(entry.reservation_id);
      if (!reservation) return res.status(404).json({ error: 'Reserva não encontrada.' });
      if (['checked_in', 'checked_out'].includes(reservation.status)) {
        return res.status(409).json({ error: 'O check-in já foi concluído. Para alterar documentos, procure a recepção.' });
      }

      const documentId = Number(req.params.documentId);
      const doc = db.prepare('SELECT * FROM documents WHERE id=? AND reservation_id=?').get(documentId, entry.reservation_id);
      if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });
      if (!doc.filename && doc.status !== 'received') {
        return res.status(409).json({ error: 'Este documento ainda não possui um arquivo enviado.' });
      }

      removeStoredFilename(doc.filename);
      db.prepare("UPDATE documents SET filename=NULL,status='pending',uploaded_at=NULL WHERE id=?").run(doc.id);
      audit('document.removed_by_guest', entry.reservation_id, { document_id: doc.id, type: doc.type });

      return res.json({
        ok: true,
        status: 'pending',
        document_id: doc.id,
        message: 'Documento removido. Envie novamente o arquivo correto.'
      });
    } catch (error) {
      return next(error);
    }
  });
}

module.exports = { installDocumentRemovalRuntime };
