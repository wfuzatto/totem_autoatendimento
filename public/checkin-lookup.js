(() => {
  const app = document.getElementById('app');
  if (!app) return;

  let stream = null;
  let scanTimer = null;
  let scanBusy = false;
  let lastQr = '';
  let lastQrAt = 0;
  let enhanced = false;

  const cpfValid = value => {
    const cpf = String(value || '').replace(/\D/g, '');
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    const digit = length => {
      let sum = 0;
      for (let i = 0; i < length; i += 1) sum += Number(cpf[i]) * (length + 1 - i);
      const mod = (sum * 10) % 11;
      return mod === 10 ? 0 : mod;
    };
    return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
  };

  const setMessage = (id, message, danger = true) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = `lookup-message ${danger ? 'lookup-message-error' : 'lookup-message-ok'}`;
    el.textContent = message || '';
  };

  async function lookup(query, type) {
    const response = await fetch('/api/reservations/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, type })
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(data.error || 'Dados inválidos.');
    return data;
  }

  function stopScanner() {
    clearInterval(scanTimer);
    scanTimer = null;
    scanBusy = false;
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
      return await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
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

  async function validateQr(raw, originalInput, originalButton) {
    const now = Date.now();
    if (raw === lastQr && now - lastQrAt < 2200) return;
    lastQr = raw;
    lastQrAt = now;
    setMessage('qrLookupMessage', 'QR Code detectado. Validando...', false);
    try {
      const result = await lookup(raw, 'qr');
      setMessage('qrLookupMessage', 'Reserva encontrada.', false);
      stopScanner();
      originalInput.value = result.reservation.reservation_number;
      originalButton.click();
    } catch (_) {
      setMessage('qrLookupMessage', 'QR Code inválido', true);
    }
  }

  async function startScanner(originalInput, originalButton) {
    const video = document.getElementById('qrLookupVideo');
    const canvas = document.getElementById('qrLookupCanvas');
    if (!video || !canvas) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage('qrLookupMessage', 'Câmera indisponível neste navegador.', true);
      return;
    }
    try {
      stream = await preferredCameraStream();
      video.srcObject = stream;
      await video.play();
      setMessage('qrLookupMessage', 'Aponte o QR Code para a câmera.', false);
      scanTimer = setInterval(async () => {
        if (scanBusy || !stream) return;
        scanBusy = true;
        try {
          const raw = await decodeFrame(video, canvas);
          if (raw) await validateQr(raw, originalInput, originalButton);
        } finally {
          scanBusy = false;
        }
      }, 220);
    } catch (_) {
      setMessage('qrLookupMessage', 'Não foi possível abrir a câmera. Verifique a conexão USB e a permissão do navegador.', true);
    }
  }

  function formatCpf(input) {
    let digits = input.value.replace(/\D/g, '').slice(0, 11);
    digits = digits.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    input.value = digits;
  }

  function enhance() {
    const originalInput = document.getElementById('lookupInput');
    const originalButton = app.querySelector('[data-action="lookup"]');
    const originalCancel = app.querySelector('[data-action="cancel"]');
    const isCheckout = Boolean(document.getElementById('simulateNfc'));

    if (!originalInput || !originalButton || !originalCancel || isCheckout || enhanced) return;
    enhanced = true;

    originalInput.remove();
    originalButton.remove();
    originalCancel.remove();

    app.innerHTML = `<section class="panel-card checkin-lookup-panel">
      <div class="mb-4">
        <div class="step-badge"><i class="bi bi-list-check"></i>Check-in · Etapa 1</div>
        <h1 class="step-title">Encontre sua reserva</h1>
        <div class="step-subtitle">Use uma das opções abaixo para encontrar sua reserva:</div>
      </div>

      <div class="checkin-lookup-grid">
        <section class="lookup-option lookup-option-qr">
          <div class="lookup-option-title"><span class="lookup-number">1</span><div><strong>QR CODE</strong><small>Aponte o QR Code da reserva para a câmera</small></div></div>
          <div class="qr-camera-square">
            <video id="qrLookupVideo" autoplay muted playsinline></video>
            <canvas id="qrLookupCanvas" hidden></canvas>
            <div class="qr-corners" aria-hidden="true"></div>
          </div>
          <div id="qrLookupMessage" class="lookup-message">Abrindo câmera...</div>
        </section>

        <section class="lookup-option">
          <div class="lookup-option-title"><span class="lookup-number">2</span><div><strong>NÚMERO DA RESERVA</strong><small>Digite exatamente como aparece na confirmação</small></div></div>
          <label class="form-label fw-semibold" for="reservationLookupInput">Número da reserva</label>
          <input id="reservationLookupInput" class="form-control touch-input text-uppercase" autocomplete="off" placeholder="Ex.: RES-20080">
          <div id="reservationLookupMessage" class="lookup-message"></div>
          <button id="reservationLookupBtn" class="btn btn-primary btn-touch w-100 mt-3">Buscar reserva <i class="bi bi-arrow-right ms-2"></i></button>
        </section>

        <section class="lookup-option">
          <div class="lookup-option-title"><span class="lookup-number">3</span><div><strong>CPF DO TITULAR</strong><small>Informe o CPF do responsável pela reserva</small></div></div>
          <label class="form-label fw-semibold" for="cpfLookupInput">CPF do titular</label>
          <input id="cpfLookupInput" class="form-control touch-input" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00">
          <div id="cpfLookupMessage" class="lookup-message"></div>
          <button id="cpfLookupBtn" class="btn btn-primary btn-touch w-100 mt-3">Buscar por CPF <i class="bi bi-arrow-right ms-2"></i></button>
        </section>
      </div>

      <div class="flow-actions mt-4">
        <button id="enhancedLookupCancel" class="btn btn-outline-danger btn-touch"><i class="bi bi-x-circle me-2"></i>Cancelar e recomeçar</button>
      </div>
      <div id="legacyLookupBridge" hidden></div>
    </section>`;

    const bridge = document.getElementById('legacyLookupBridge');
    bridge.append(originalInput, originalButton, originalCancel);

    document.getElementById('enhancedLookupCancel').onclick = () => {
      stopScanner();
      enhanced = false;
      originalCancel.click();
    };

    const reservationInput = document.getElementById('reservationLookupInput');
    document.getElementById('reservationLookupBtn').onclick = async () => {
      const value = reservationInput.value.trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]{2,80}$/.test(value)) {
        return setMessage('reservationLookupMessage', 'Número da reserva inválido', true);
      }
      setMessage('reservationLookupMessage', 'Buscando...', false);
      try {
        const result = await lookup(value, 'reservation');
        setMessage('reservationLookupMessage', 'Reserva encontrada.', false);
        stopScanner();
        originalInput.value = result.reservation.reservation_number;
        originalButton.click();
      } catch (_) {
        setMessage('reservationLookupMessage', 'Número da reserva inválido', true);
      }
    };

    const cpfInput = document.getElementById('cpfLookupInput');
    cpfInput.addEventListener('input', () => formatCpf(cpfInput));
    document.getElementById('cpfLookupBtn').onclick = async () => {
      const value = cpfInput.value;
      if (!cpfValid(value)) return setMessage('cpfLookupMessage', 'CPF inválido', true);
      setMessage('cpfLookupMessage', 'Buscando...', false);
      try {
        const result = await lookup(value, 'cpf');
        setMessage('cpfLookupMessage', 'Reserva encontrada.', false);
        stopScanner();
        originalInput.value = result.reservation.reservation_number;
        originalButton.click();
      } catch (_) {
        setMessage('cpfLookupMessage', 'CPF inválido', true);
      }
    };

    startScanner(originalInput, originalButton);
  }

  new MutationObserver(() => {
    if (!document.getElementById('lookupInput')) {
      if (enhanced) stopScanner();
      enhanced = false;
      return;
    }
    queueMicrotask(enhance);
  }).observe(app, { childList: true, subtree: true });
})();
