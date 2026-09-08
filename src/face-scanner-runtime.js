const multer = require('multer');
const { db, audit } = require('./db');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Para o teste Face Scanner use JPG, PNG ou WEBP.'), ok);
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

async function faceScannerPost(path, form) {
  const { baseUrl, apiKey } = faceScannerConfig();
  if (!baseUrl) {
    const error = new Error('FACE_SCANNER_URL não configurada no Totem.');
    error.statusCode = 503;
    throw error;
  }

  const headers = apiKey ? { 'X-Face-Scanner-Key': apiKey } : {};
  const response = await fetchWithTimeout(`${baseUrl}${path}`, {
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
        const selfie = req.file;

        if (!verificationId) return res.status(400).json({ error: 'verification_id é obrigatório.' });
        if (!selfie) return res.status(400).json({ error: 'Capture a foto ao vivo antes de continuar.' });

        const form = new FormData();
        form.append('verification_id', verificationId);
        form.append('selfie', new Blob([selfie.buffer], { type: selfie.mimetype }), selfie.originalname || 'live-capture.jpg');

        const result = await faceScannerPost('/api/v1/face/verify', form);
        return res.json({ ok: true, face_scanner: result });
      } catch (error) {
        console.error('Face Scanner capture:', error);
        return res.status(error.statusCode || 502).json({ error: error.message || 'Falha ao enviar captura ao Face Scanner.' });
      }
    }
  );
}

module.exports = { installFaceScannerRuntime };
