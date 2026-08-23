(() => {
  const app = document.getElementById('app');
  if (!app) return;

  const MIN_PROCESSING_MS = 3000;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
  let stream = null;
  let timer = null;
  let scanBusy = false;
  let scanLocked = false;
  let lastQr = '';
  let lastQrAt = 0;

  function setMessage(id, text, danger = false) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = `lookup-message ${danger ? 'lookup-message-error' : 'lookup-message-ok'}`;
    el.textContent = text || '';
  }

  function showProcessing(title, message = 'Processando seu check-out...') {
    let overlay = document.getElementById('checkoutProcessingOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'checkoutProcessingOverlay';
      overlay.className = 'qr-processing-overlay';
      overlay.setAttribute('role', 'status');
      overlay.setAttribute('aria-live', 'polite');
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="qr-processing-card">
        <div class="qr-processing-spinner" aria-hidden="true"></div>
        <h2>${title}</h2>
        <p>${message}</p>
        <small>Aguarde um momento</small>
      </div>`;
    requestAnimationFrame(() => overlay.classList.add('show'));
  }

  function hideProcessing() {
    const overlay = document.getElementById('checkoutProcessingOverlay');
    if (!overlay) return;
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 180);
  }

  async function lookup(query, type) {
    const response = await fetch('/api/reservations/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, type })
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(data.error || 'Hospedagem não encontrada.');
    return data;
  }

  function stopCamera() {
    if (timer) clearInterval(timer);
    timer = null;
    scanBusy = false;
    scanLocked = false;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null;
  }

  async function preferredCameraStream() {
    let probe = null;
    try {
      probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter(device => device.kind === 'videoinput');
      const preferred = cameras.find(device => /usb|logitech|brio|webcam|hd pro|external/i.test(device.label)) || cameras[0];
      probe.getTracks().forEach(track => track.stop());
      probe = null;
      if (preferred?.deviceId) {
        try {
          return await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: preferred.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
          });
        } catch (_) {}
      }
      return navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (error) {
      if (probe) probe.getTracks().forEach(track => track.stop());
      throw error;
    }
  }

  async function decodeFrame(video, canvas) {
    if (!video.videoWidth || !video.videoHeight) return null;
    if ('BarcodeDetector' in window) {
      try {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        const codes = await detector.detect(video);
        if (codes?.[0]?.rawValue) return codes[0].rawValue;
      } catch (_) {}
    }
    if (typeof window.jsQR === 'function') {
      const width = Math.min(720, video.videoWidth);
      const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      return window.jsQR(image.data, width, height, { inversionAttempts: 'attemptBoth' })?.data || null;
    }
    return null;
  }

  async function runCheckoutLookup({ query, type, messageId, processingTitle, invalidMessage, validate, originalInput, originalButton }) {
    const startedAt = Date.now();
    showProcessing(processingTitle);
    try {
      const result = await lookup(query, type);
      if (validate && !validate(result)) throw new Error(invalidMessage);
      await sleep(MIN_PROCESSING_MS - (Date.now() - startedAt));
      stopCamera();
      hideProcessing();
      setMessage(messageId, 'Hospedagem encontrada.', false);
      originalInput.value = result.reservation.reservation_number;
      originalButton.click();
      return true;
    } catch (_) {
      await sleep(MIN_PROCESSING_MS - (Date.now() - startedAt));
      hideProcessing();
      setMessage(messageId, invalidMessage, true);
      return false;
    }
  }

  async function startQrCamera(originalInput, originalButton) {
    const video = document.getElementById('checkoutQrVideo');
    const canvas = document.getElementById('checkoutQrCanvas');
    if (!video || !canvas) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage('checkoutQrMessage', 'Câmera indisponível neste navegador.', true);
      return;
    }
    try {
      stream = await preferredCameraStream();
      video.srcObject = stream;
      await video.play();
      setMessage('checkoutQrMessage', 'Aponte o QR Code da hospedagem para a câmera.', false);
      timer = setInterval(async () => {
        if (scanBusy || scanLocked || !stream) return;
        scanBusy = true;
        try {
          const raw = await decodeFrame(video, canvas);
          if (!raw) return;
          const now = Date.now();
          if (raw === lastQr && now - lastQrAt < 4000) return;
          lastQr = raw;
          lastQrAt = now;
          scanLocked = true;
          setMessage('checkoutQrMessage', 'QR Code detectado. Processando...', false);
          const ok = await runCheckoutLookup({
            query: raw,
            type: 'qr',
            messageId: 'checkoutQrMessage',
            processingTitle: 'QR Code lido',
            invalidMessage: 'QR Code inválido',
            originalInput,
            originalButton
          });
          if (!ok) {
            lastQrAt = Date.now();
            scanLocked = false;
          }
        } finally {
          scanBusy = false;
        }
      }, 220);
    } catch (_) {
      setMessage('checkoutQrMessage', 'Não foi possível abrir a câmera. Verifique o HTTPS, a conexão USB e a permissão do navegador.', true);
    }
  }

  function enhanceCheckout(panel) {
    if (panel.dataset.qrCheckoutEnhanced === '1') return;
    const grid = panel.querySelector('.checkout-lookup-grid');
    const bridge = panel.querySelector('#legacyLookupBridge');
    if (!grid || !bridge) return;
    const originalInput = bridge.querySelector('#lookupInput');
    const originalButton = bridge.querySelector('[data-action="lookup"]');
    const originalSimulate = bridge.querySelector('#simulateNfc');
    if (!originalInput || !originalButton) return;

    panel.dataset.qrCheckoutEnhanced = '1';

    const qr = document.createElement('section');
    qr.className = 'lookup-option lookup-option-qr checkout-qr-option';
    qr.innerHTML = `
      <div class="lookup-option-title"><span class="lookup-number">1</span><div><strong>QR CODE</strong><small>Aponte o QR Code da hospedagem para a câmera</small></div></div>
      <div class="qr-camera-square checkout-qr-camera">
        <video id="checkoutQrVideo" autoplay muted playsinline></video>
        <canvas id="checkoutQrCanvas" hidden></canvas>
        <div class="qr-corners" aria-hidden="true"></div>
      </div>
      <div id="checkoutQrMessage" class="lookup-message">Abrindo câmera...</div>`;
    grid.prepend(qr);

    const cards = Array.from(grid.querySelectorAll('.lookup-option:not(.checkout-qr-option)'));
    cards.forEach((card, index) => {
      const badge = card.querySelector('.lookup-number');
      if (badge) badge.textContent = String(index + 2);
    });

    const nfcInput = document.getElementById('nfcLookupInput');
    const nfcButton = document.getElementById('nfcLookupBtn');
    if (nfcInput && nfcButton) {
      nfcButton.onclick = async () => {
        const value = nfcInput.value.trim();
        if (value.length < 3) return setMessage('nfcLookupMessage', 'Pulseira inválida', true);
        setMessage('nfcLookupMessage', 'Pulseira detectada. Processando...', false);
        await runCheckoutLookup({
          query: value,
          type: 'auto',
          messageId: 'nfcLookupMessage',
          processingTitle: 'Pulseira lida',
          invalidMessage: 'Pulseira inválida ou não vinculada a esta hospedagem',
          validate: result => result.guests?.some(guest => String(guest.wristband_code || '').toLowerCase() === value.toLowerCase()),
          originalInput,
          originalButton
        });
      };
    }

    const simulate = document.getElementById('simulateCheckoutNfc');
    if (simulate && nfcInput && nfcButton) {
      simulate.onclick = () => {
        if (originalSimulate) originalSimulate.click();
        setTimeout(() => {
          nfcInput.value = originalInput.value || 'SAGA-204-CARLOS';
          nfcButton.click();
        }, 0);
      };
    }

    const reservationInput = document.getElementById('checkoutReservationInput');
    const reservationButton = document.getElementById('checkoutReservationBtn');
    if (reservationInput && reservationButton) {
      reservationButton.onclick = async () => {
        const value = reservationInput.value.trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]{2,80}$/.test(value)) return setMessage('checkoutReservationMessage', 'Número da reserva inválido', true);
        setMessage('checkoutReservationMessage', 'Reserva informada. Processando...', false);
        await runCheckoutLookup({
          query: value,
          type: 'reservation',
          messageId: 'checkoutReservationMessage',
          processingTitle: 'Reserva localizada',
          invalidMessage: 'Número da reserva inválido',
          originalInput,
          originalButton
        });
      };
    }

    const roomInput = document.getElementById('checkoutRoomInput');
    const roomButton = document.getElementById('checkoutRoomBtn');
    if (roomInput && roomButton) {
      roomButton.onclick = async () => {
        const value = roomInput.value.trim();
        if (!/^[A-Za-z0-9._\/-]{1,20}$/.test(value)) return setMessage('checkoutRoomMessage', 'UH inválida', true);
        setMessage('checkoutRoomMessage', 'UH informada. Processando...', false);
        await runCheckoutLookup({
          query: value,
          type: 'auto',
          messageId: 'checkoutRoomMessage',
          processingTitle: 'Hospedagem localizada',
          invalidMessage: 'UH inválida ou sem hospedagem ativa',
          validate: result => String(result.reservation.room_number || '').toLowerCase() === value.toLowerCase(),
          originalInput,
          originalButton
        });
      };
    }

    const cancel = document.getElementById('enhancedLookupCancel');
    if (cancel) cancel.addEventListener('click', () => {
      stopCamera();
      hideProcessing();
    }, { capture: true });

    startQrCamera(originalInput, originalButton);
  }

  const observer = new MutationObserver(() => {
    const panel = app.querySelector('.checkout-lookup-panel');
    if (panel) enhanceCheckout(panel);
    else stopCamera();
  });
  observer.observe(app, { childList: true, subtree: true });

  const initial = app.querySelector('.checkout-lookup-panel');
  if (initial) enhanceCheckout(initial);
})();
