(() => {
  const previousFetch = window.fetch.bind(window);
  const verificationCache = new Map();
  const appRoot = document.getElementById('app');
  let activeGuide = null;
  let activeVideo = null;
  let activeCaptureButton = null;
  let captureInFlight = false;

  function requestPath(input) {
    try {
      if (typeof input === 'string') return new URL(input, location.href).pathname;
      if (input instanceof Request) return new URL(input.url, location.href).pathname;
    } catch (_) {}
    return '';
  }

  function dataUrlToBlob(value) {
    const raw = String(value || '');
    const match = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i);
    if (!match) throw new Error('Captura facial inválida. Refaça a foto.');
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1].toLowerCase() });
  }

  async function readJson(response) {
    let payload = null;
    try { payload = await response.json(); } catch (_) {}
    return payload;
  }

  async function backendJson(url, options = {}) {
    const response = await previousFetch(url, options);
    const payload = await readJson(response);
    if (!response.ok) {
      const error = new Error(payload?.error || payload?.detail || `HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function syntheticJson(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  function retryInstruction(result) {
    const issues = result?.quality?.issues || [];
    if (issues.includes('nenhum_rosto_detectado')) return 'Não encontrei um rosto. Posicione-se dentro da área indicada.';
    if (issues.includes('mais_de_um_rosto_detectado')) return 'Apenas uma pessoa deve aparecer na câmera.';
    if (issues.includes('rosto_muito_pequeno')) return 'Aproxime um pouco o rosto da câmera.';
    if (issues.includes('imagem_escura')) return 'Melhore a iluminação do seu rosto.';
    if (issues.includes('imagem_clara_demais')) return 'Evite luz forte diretamente no rosto.';
    if (issues.includes('imagem_desfocada')) return 'Fique parado por alguns instantes para a imagem ficar nítida.';
    if (result?.status === 'mismatch') return 'O rosto não conferiu com o documento. Refaça a captura olhando para frente.';
    return result?.message || 'Ajuste a posição e tente novamente.';
  }

  function cacheKey(reservationId, guestId) {
    return `${reservationId}:${guestId}`;
  }

  async function prepareVerification(reservationId, guestId) {
    const key = cacheKey(reservationId, guestId);
    const cached = verificationCache.get(key);
    if (cached?.verification_id && Date.parse(cached.expires_at || '') > Date.now() + 5000) return cached;

    const payload = await backendJson(
      `/api/face-scanner/reservations/${reservationId}/guests/${guestId}/prepare`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    );
    verificationCache.set(key, payload);
    return payload;
  }

  function pauseGuide(message = 'Validando identidade…', state = 'warn') {
    activeGuide?.setPaused(true);
    activeGuide?.setState(state, message, activeGuide?.metrics?.textContent || '');
  }

  function resumeGuide(message) {
    activeGuide?.setPaused(false);
    if (message) activeGuide?.setState('warn', message, activeGuide?.metrics?.textContent || '');
  }

  async function verifyWithFaceScanner(reservationId, guestId, capture) {
    const key = cacheKey(reservationId, guestId);
    if (captureInFlight) {
      return syntheticJson({ error: 'A validação facial já está em andamento.' }, 409);
    }

    captureInFlight = true;
    pauseGuide('Analisando documento e comparando o rosto…', 'warn');

    try {
      const prepared = await prepareVerification(reservationId, guestId);
      const blob = dataUrlToBlob(capture);
      const form = new FormData();
      form.append('verification_id', prepared.verification_id);
      form.append('reservation_id', String(reservationId));
      form.append('guest_id', String(guestId));
      form.append('selfie', blob, 'live-capture.jpg');

      const response = await previousFetch('/api/face-scanner/face/verify', {
        method: 'POST',
        body: form
      });
      const payload = await readJson(response);

      if (!response.ok) {
        if (response.status === 409 && /expirada|sessão/i.test(payload?.error || '')) verificationCache.delete(key);
        resumeGuide(payload?.error || 'Falha na validação facial. Refaça a captura.');
        return syntheticJson({ error: payload?.error || `Face Scanner HTTP ${response.status}` }, response.status);
      }

      const result = payload?.face_scanner || {};
      const verified = result.status === 'match'
        && result.identity_verified === true
        && payload?.totem?.face_verified === true;

      if (verified) {
        verificationCache.delete(key);
        pauseGuide('Identidade confirmada.', 'good');
        return syntheticJson({
          ok: true,
          matched: true,
          real: true,
          provider: result.provider,
          similarity: result.similarity,
          model: result.model,
          model_version: result.model_version
        });
      }

      const message = retryInstruction(result);
      if (result.retry_allowed === true) {
        resumeGuide(message);
      } else {
        verificationCache.delete(key);
        pauseGuide(message, 'bad');
      }

      return syntheticJson({
        error: message,
        face_scanner: {
          status: result.status,
          identity_verified: Boolean(result.identity_verified),
          retry_allowed: Boolean(result.retry_allowed),
          attempts_used: result.attempts_used,
          attempts_remaining: result.attempts_remaining,
          provider: result.provider,
          similarity: result.similarity
        }
      }, 409);
    } catch (error) {
      verificationCache.delete(key);
      resumeGuide(error.message || 'Não foi possível validar o rosto.');
      return syntheticJson({ error: error.message || 'Não foi possível validar o rosto.' }, error.status || 502);
    } finally {
      captureInFlight = false;
    }
  }

  window.fetch = async (input, init = {}) => {
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const pathname = requestPath(input);
    const match = pathname.match(/\/api\/reservations\/(\d+)\/face\/verify$/);

    if (method === 'POST' && match && !(init.body instanceof FormData)) {
      let body = null;
      try { body = JSON.parse(String(init.body || '{}')); } catch (_) {}
      const guestId = Number(body?.guest_id || 0);
      const reservationId = Number(match[1]);
      if (guestId && body?.capture) {
        return verifyWithFaceScanner(reservationId, guestId, body.capture);
      }
    }

    return previousFetch(input, init);
  };

  function teardownGuide() {
    if (activeGuide) activeGuide.stop();
    activeGuide = null;
    activeVideo = null;
    activeCaptureButton = null;
  }

  function ensureElement(parent, id, className, text = '') {
    let element = document.getElementById(id);
    if (!element) {
      element = document.createElement('div');
      element.id = id;
      element.className = className;
      element.textContent = text;
      parent.appendChild(element);
    }
    return element;
  }

  function enhanceFaceCapture() {
    const video = document.getElementById('cameraVideo');
    const captureButton = document.getElementById('captureFace');
    const box = video?.closest('.camera-box');

    if (!video || !captureButton || !box) {
      if (activeVideo && !document.documentElement.contains(activeVideo)) teardownGuide();
      return;
    }
    if (activeVideo === video && activeCaptureButton === captureButton) return;

    teardownGuide();
    activeVideo = video;
    activeCaptureButton = captureButton;
    box.classList.add('face-checkin-camera');

    let guide = box.querySelector('.face-guide');
    if (!guide) {
      guide = document.createElement('div');
      guide.className = 'face-guide';
      box.appendChild(guide);
    }
    guide.classList.add('guide-warn');

    const instruction = ensureElement(
      box,
      'checkinCaptureInstruction',
      'capture-instruction capture-warn',
      'Posicione seu rosto dentro da área indicada.'
    );
    const metrics = ensureElement(box, 'checkinCaptureMetrics', 'capture-metrics', 'Aguardando análise…');
    const countdown = ensureElement(box, 'checkinCaptureCountdown', 'capture-countdown');
    countdown.hidden = true;

    if (!box.nextElementSibling?.classList?.contains('face-capture-tips')) {
      const tips = document.createElement('div');
      tips.className = 'face-capture-tips';
      tips.innerHTML = '<div>Olhe para frente</div><div>Mantenha o rosto parado</div><div>Evite luz atrás de você</div>';
      box.insertAdjacentElement('afterend', tips);
    }

    captureButton.innerHTML = '<i class="bi bi-camera me-2"></i>Capturar agora';

    if (!window.FaceCaptureGuide) return;
    activeGuide = new window.FaceCaptureGuide({
      video,
      guide,
      instruction,
      metrics,
      countdown,
      previewEndpoint: '/api/face-scanner/face/preview',
      intervalMs: 800,
      onAutoCapture: () => {
        if (!captureInFlight && document.documentElement.contains(captureButton)) captureButton.click();
      }
    });

    captureButton.addEventListener('click', () => {
      if (!captureInFlight) pauseGuide('Captura realizada. Comparando com o documento…', 'warn');
    }, true);

    const startGuide = () => {
      if (activeVideo === video && document.documentElement.contains(video)) activeGuide?.start();
    };
    if (video.readyState >= 2 && video.videoWidth) startGuide();
    else video.addEventListener('loadeddata', startGuide, { once: true });
    window.setTimeout(startGuide, 1200);
  }

  if (appRoot) {
    const observer = new MutationObserver(enhanceFaceCapture);
    observer.observe(appRoot, { childList: true, subtree: true });
    enhanceFaceCapture();
  }
})();
