const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const multer = require('multer');
const { db, audit } = require('./db');

const execFileAsync = promisify(execFile);
const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
const FACE_SESSION_TTL_MS = 10 * 60 * 1000;

fs.mkdirSync(uploadsDir, { recursive: true });

db.exec(`CREATE TABLE IF NOT EXISTS face_verification_bindings (
  verification_id TEXT PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_face_verification_bindings_guest
  ON face_verification_bindings(reservation_id, guest_id);`);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Para o Face Scanner use JPG, PNG ou WEBP.'), ok);
  }
});

function faceScannerConfig() {
  return {
    baseUrl: String(process.env.FACE_SCANNER_URL || '').trim().replace(/\/$/, ''),
    apiKey: String(process.env.FACE_SCANNER_API_KEY || '').trim()
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function faceScannerPost(endpoint, form) {
  const { baseUrl, apiKey } = faceScannerConfig();
  if (!baseUrl) {
    const error = new Error('FACE_SCANNER_URL não configurada no Totem.');
    error.statusCode = 503;
    throw error;
  }

  const headers = apiKey ? { 'X-Face-Scanner-Key': apiKey } : {};
  const response = await fetchWithTimeout(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: form
  });

  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok) {
    const error = new Error(payload?.detail || payload?.error || `Face Scanner HTTP ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  return payload;
}

function imageMimeFromFilename(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return null;
}

async function pdfPagesAsJpeg(pdfPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-face-doc-'));
  const prefix = path.join(tempDir, 'page');
  try {
    try {
      await execFileAsync('pdftoppm', ['-jpeg', '-f', '1', '-l', '2', '-r', '180', pdfPath, prefix], {
        timeout: 30000,
        maxBuffer: 2 * 1024 * 1024
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        const wrapped = new Error('Conversão de PDF indisponível no container do Totem (pdftoppm ausente).');
        wrapped.statusCode = 503;
        throw wrapped;
      }
      throw error;
    }

    const pages = fs.readdirSync(tempDir)
      .filter(name => /^page-\d+\.jpg$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .slice(0, 2)
      .map(name => ({
        buffer: fs.readFileSync(path.join(tempDir, name)),
        mimetype: 'image/jpeg',
        filename: name
      }));

    if (!pages.length) {
      const error = new Error('Não foi possível converter o PDF do documento para reconhecimento facial.');
      error.statusCode = 422;
      throw error;
    }
    return pages;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function storedDocumentParts(filename) {
  const safeName = path.basename(String(filename || ''));
  if (!safeName) {
    const error = new Error('Documento de identidade não possui arquivo armazenado.');
    error.statusCode = 409;
    throw error;
  }

  const fullPath = path.join(uploadsDir, safeName);
  if (!fs.existsSync(fullPath)) {
    const error = new Error('Arquivo do documento não foi encontrado no volume persistente do Totem.');
    error.statusCode = 409;
    throw error;
  }

  if (path.extname(safeName).toLowerCase() === '.pdf') {
    return pdfPagesAsJpeg(fullPath);
  }

  const mimetype = imageMimeFromFilename(safeName);
  if (!mimetype) {
    const error = new Error('Formato do documento não pode ser usado para reconhecimento facial.');
    error.statusCode = 415;
    throw error;
  }

  return [{ buffer: fs.readFileSync(fullPath), mimetype, filename: safeName }];
}

function createBinding(verificationId, reservationId, guestId) {
  const expiresAt = new Date(Date.now() + FACE_SESSION_TTL_MS).toISOString();
  db.prepare('DELETE FROM face_verification_bindings WHERE reservation_id=? AND guest_id=?').run(reservationId, guestId);
  db.prepare(`INSERT INTO face_verification_bindings(verification_id,reservation_id,guest_id,expires_at)
    VALUES(?,?,?,?)`).run(verificationId, reservationId, guestId, expiresAt);
  return expiresAt;
}

function getBinding(verificationId) {
  const binding = db.prepare('SELECT * FROM face_verification_bindings WHERE verification_id=?').get(verificationId);
  if (!binding) return null;
  if (!Number.isFinite(Date.parse(binding.expires_at)) || Date.parse(binding.expires_at) <= Date.now()) {
    db.prepare('DELETE FROM face_verification_bindings WHERE verification_id=?').run(verificationId);
    return null;
  }
  return binding;
}

function consumeBinding(verificationId) {
  db.prepare('DELETE FROM face_verification_bindings WHERE verification_id=?').run(verificationId);
}

async function analyzeStoredIdentity(reservationId, guestId) {
  const reservation = db.prepare('SELECT * FROM reservations WHERE id=?').get(reservationId);
  if (!reservation) {
    const error = new Error('Reserva não encontrada.');
    error.statusCode = 404;
    throw error;
  }

  const guest = db.prepare('SELECT * FROM guests WHERE id=? AND reservation_id=? AND adult=1').get(guestId, reservationId);
  if (!guest) {
    const error = new Error('Hóspede adulto não pertence a esta reserva.');
    error.statusCode = 404;
    throw error;
  }

  const document = db.prepare(`SELECT * FROM documents
    WHERE reservation_id=? AND guest_id=? AND type='identity' AND status='received'
    LIMIT 1`).get(reservationId, guestId);
  if (!document?.filename) {
    const error = new Error('Documento de identidade validado não foi encontrado para este hóspede.');
    error.statusCode = 409;
    throw error;
  }

  const parts = await storedDocumentParts(document.filename);
  const form = new FormData();
  form.append('expected_name', guest.name);
  form.append('reservation_id', reservation.reservation_number);
  form.append('document_type', 'auto');
  form.append('front', new Blob([parts[0].buffer], { type: parts[0].mimetype }), parts[0].filename || 'document-front.jpg');
  if (parts[1]) {
    form.append('back', new Blob([parts[1].buffer], { type: parts[1].mimetype }), parts[1].filename || 'document-back.jpg');
  }

  const result = await faceScannerPost('/api/v1/document/analyze', form);
  const nameStatus = result?.name_validation?.status || 'unknown';
  const portraitFound = Boolean(result?.portrait?.found);
  const canVerify = Boolean(result?.can_verify_face && result?.verification_id && portraitFound);

  audit('face_scanner.document.checkin_analyzed', reservationId, {
    guest_id: guestId,
    name_status: nameStatus,
    detected_document_type: result?.detected_document_type || null,
    portrait_found: portraitFound,
    can_verify_face: canVerify
  });

  if (nameStatus !== 'match') {
    const error = new Error(nameStatus === 'review'
      ? 'O nome extraído do documento exige revisão. Procure a recepção para continuar.'
      : 'O nome do documento não confere com o hóspede da reserva. Procure a recepção.');
    error.statusCode = 409;
    error.faceScanner = result;
    throw error;
  }

  if (!canVerify) {
    const error = new Error('Não foi possível localizar uma face válida no documento. Reenvie uma imagem nítida ou procure a recepção.');
    error.statusCode = 409;
    error.faceScanner = result;
    throw error;
  }

  const expiresAt = createBinding(result.verification_id, reservationId, guestId);
  return { reservation, guest, result, expiresAt };
}

function installFaceScannerRuntime(app) {
  app.get('/api/face-scanner/status', async (_req, res) => {
    const { baseUrl, apiKey } = faceScannerConfig();
    if (!baseUrl) return res.json({ configured: false, reachable: false });
    try {
      const headers = apiKey ? { 'X-Face-Scanner-Key': apiKey } : {};
      const response = await fetchWithTimeout(`${baseUrl}/api/v1/health`, { headers }, 5000);
      const health = await response.json();
      return res.json({ configured: true, reachable: response.ok, base_url: baseUrl, health });
    } catch (error) {
      return res.status(503).json({ configured: true, reachable: false, base_url: baseUrl, error: error.message });
    }
  });

  app.post(
    '/api/face-scanner/document/analyze',
    upload.fields([{ name: 'front', maxCount: 1 }, { name: 'back', maxCount: 1 }]),
    async (req, res) => {
      try {
        const reservationId = Number(req.body?.reservation_id || 0);
        const guestId = Number(req.body?.guest_id || 0);
        const front = req.files?.front?.[0];
        const back = req.files?.back?.[0];

        if (!reservationId || !guestId) return res.status(400).json({ error: 'Reserva e hóspede são obrigatórios.' });
        if (!front) return res.status(400).json({ error: 'Selecione a frente/página com foto do documento.' });

        const reservation = db.prepare('SELECT * FROM reservations WHERE id=?').get(reservationId);
        if (!reservation) return res.status(404).json({ error: 'Reserva não encontrada.' });

        const guest = db.prepare('SELECT * FROM guests WHERE id=? AND reservation_id=?').get(guestId, reservationId);
        if (!guest) return res.status(404).json({ error: 'Hóspede não pertence a esta reserva.' });

        const form = new FormData();
        form.append('expected_name', guest.name);
        form.append('reservation_id', reservation.reservation_number);
        form.append('document_type', String(req.body?.document_type || 'auto'));
        form.append('front', new Blob([front.buffer], { type: front.mimetype }), front.originalname || 'document-front.jpg');
        if (back) form.append('back', new Blob([back.buffer], { type: back.mimetype }), back.originalname || 'document-back.jpg');

        const result = await faceScannerPost('/api/v1/document/analyze', form);
        const nameStatus = result?.name_validation?.status || 'unknown';

        audit('face_scanner.document.tested', reservationId, {
          guest_id: guestId,
          name_status: nameStatus,
          detected_document_type: result?.detected_document_type || null,
          portrait_found: Boolean(result?.portrait?.found),
          can_verify_face: Boolean(result?.can_verify_face)
        });

        return res.json({
          ok: true,
          totem_context: {
            reservation_id: reservation.id,
            reservation_number: reservation.reservation_number,
            guest_id: guest.id,
            guest_name: guest.name
          },
          face_scanner: result
        });
      } catch (error) {
        console.error('Face Scanner integration:', error);
        return res.status(error.statusCode || 502).json({ error: error.message || 'Falha ao consultar Face Scanner.' });
      }
    }
  );

  app.post('/api/face-scanner/reservations/:reservationId/guests/:guestId/prepare', async (req, res) => {
    const reservationId = Number(req.params.reservationId);
    const guestId = Number(req.params.guestId);
    try {
      const prepared = await analyzeStoredIdentity(reservationId, guestId);
      return res.json({
        ok: true,
        verification_id: prepared.result.verification_id,
        expires_at: prepared.expiresAt,
        document: {
          name_status: prepared.result?.name_validation?.status || null,
          detected_document_type: prepared.result?.detected_document_type || null,
          portrait_found: Boolean(prepared.result?.portrait?.found),
          can_verify_face: Boolean(prepared.result?.can_verify_face)
        },
        face_scanner: prepared.result
      });
    } catch (error) {
      console.error('Face Scanner check-in prepare:', error);
      audit('face_scanner.document.checkin_blocked', reservationId || null, {
        guest_id: guestId || null,
        error: error.message || 'unknown'
      });
      return res.status(error.statusCode || 502).json({
        error: error.message || 'Falha ao preparar reconhecimento facial.',
        face_scanner: error.faceScanner || undefined
      });
    }
  });

  app.post(
    '/api/face-scanner/face/preview',
    upload.single('selfie'),
    async (req, res) => {
      try {
        const selfie = req.file;
        if (!selfie) return res.status(400).json({ error: 'Frame da câmera ausente.' });

        const form = new FormData();
        form.append('selfie', new Blob([selfie.buffer], { type: selfie.mimetype }), selfie.originalname || 'preview.jpg');
        const result = await faceScannerPost('/api/v1/face/preview', form);
        return res.json({ ok: true, face_scanner: result });
      } catch (error) {
        console.error('Face Scanner preview:', error);
        return res.status(error.statusCode || 502).json({ error: error.message || 'Falha ao validar preview da câmera.' });
      }
    }
  );

  app.post(
    '/api/face-scanner/face/verify',
    upload.single('selfie'),
    async (req, res) => {
      try {
        const verificationId = String(req.body?.verification_id || '').trim();
        const reservationId = Number(req.body?.reservation_id || 0);
        const guestId = Number(req.body?.guest_id || 0);
        const selfie = req.file;

        if (!verificationId) return res.status(400).json({ error: 'verification_id é obrigatório.' });
        if (!selfie) return res.status(400).json({ error: 'Capture a foto ao vivo antes de continuar.' });

        let binding = null;
        if (reservationId || guestId) {
          if (!reservationId || !guestId) return res.status(400).json({ error: 'Reserva e hóspede devem ser informados juntos.' });
          binding = getBinding(verificationId);
          if (!binding) return res.status(409).json({ error: 'Sessão facial expirada ou inválida. Refaça a preparação do documento.' });
          if (Number(binding.reservation_id) !== reservationId || Number(binding.guest_id) !== guestId) {
            audit('face_scanner.binding.rejected', reservationId, { guest_id: guestId });
            return res.status(409).json({ error: 'A sessão facial não pertence a este hóspede/reserva.' });
          }
        }

        const form = new FormData();
        form.append('verification_id', verificationId);
        form.append('selfie', new Blob([selfie.buffer], { type: selfie.mimetype }), selfie.originalname || 'live-capture.jpg');

        const result = await faceScannerPost('/api/v1/face/verify', form);
        const identityVerified = result?.status === 'match' && result?.identity_verified === true;
        let faceVerified = false;

        if (binding && identityVerified) {
          const guest = db.prepare('SELECT id FROM guests WHERE id=? AND reservation_id=? AND adult=1').get(guestId, reservationId);
          if (!guest) return res.status(404).json({ error: 'Hóspede adulto não encontrado.' });
          db.prepare('UPDATE guests SET face_verified=1 WHERE id=?').run(guestId);
          consumeBinding(verificationId);
          faceVerified = true;
          audit('face_scanner.identity.verified', reservationId, {
            guest_id: guestId,
            provider: result?.provider || null,
            similarity: result?.similarity ?? null,
            model: result?.model || null,
            model_version: result?.model_version || null,
            attempts_used: result?.attempts_used ?? null
          });
        } else if (binding) {
          audit('face_scanner.identity.not_verified', reservationId, {
            guest_id: guestId,
            status: result?.status || null,
            provider: result?.provider || null,
            similarity: result?.similarity ?? null,
            retry_allowed: Boolean(result?.retry_allowed)
          });
          if (result?.retry_allowed !== true) consumeBinding(verificationId);
        }

        return res.json({
          ok: true,
          face_scanner: result,
          totem: binding ? {
            reservation_id: reservationId,
            guest_id: guestId,
            face_verified: faceVerified,
            identity_verified: identityVerified
          } : undefined
        });
      } catch (error) {
        console.error('Face Scanner capture:', error);
        return res.status(error.statusCode || 502).json({ error: error.message || 'Falha ao enviar captura ao Face Scanner.' });
      }
    }
  );
}

module.exports = { installFaceScannerRuntime, analyzeStoredIdentity };
