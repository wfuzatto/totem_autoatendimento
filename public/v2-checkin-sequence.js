(() => {
  const app = document.getElementById('app');
  if (!app) return;

  let latestBundle = null;
  let activeReservationId = null;
  let faceVerifiedThisAttempt = new Set();
  let cameraStream = null;
  let customFlowActive = false;

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[c]));
  const money = cents => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL'
  }).format(Number(cents || 0) / 100);

  function stopCamera() {
    if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    const video = document.getElementById('v2FaceVideo') || document.getElementById('cameraVideo');
    if (video?.srcObject) {
      try { video.srcObject.getTracks().forEach(track => track.stop()); } catch (_) {}
      video.srcObject = null;
    }
  }

  function notify(message, danger = false) {
    const toastEl = document.getElementById('appToast');
    const body = document.getElementById('toastBody');
    if (!toastEl || !body || !window.bootstrap?.Toast) return;
    toastEl.classList.toggle('text-bg-danger', danger);
    toastEl.classList.toggle('text-bg-dark', !danger);
    body.textContent = message;
    bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 }).show();
  }

  async function json(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(url, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Erro ${response.status}`);
    return data;
  }

  function header(step, title, subtitle) {
    return `<div class="mb-4">
      <div class="step-badge"><i class="bi bi-list-check"></i>Check-in · Etapa ${step}</div>
      <h1 class="step-title">${esc(title)}</h1>
      <div class="step-subtitle">${esc(subtitle)}</div>
    </div>`;
  }

  function actions({ label = 'Avançar', action = '', disabled = false } = {}) {
    return `<div class="flow-actions">
      <button class="btn btn-outline-danger btn-touch" data-v2-cancel>
        <i class="bi bi-x-circle me-2"></i>Cancelar e recomeçar
      </button>
      <div class="right">
        ${action ? `<button class="btn btn-primary btn-touch" data-v2-action="${action}" ${disabled ? 'disabled' : ''}>${esc(label)}<i class="bi bi-arrow-right ms-2"></i></button>` : ''}
      </div>
    </div>`;
  }

  function bindCancel() {
    app.querySelectorAll('[data-v2-cancel]').forEach(button => {
      button.onclick = () => {
        stopCamera();
        customFlowActive = false;
        faceVerifiedThisAttempt = new Set();
        location.reload();
      };
    });
  }

  async function refreshBundle() {
    if (!activeReservationId) throw new Error('Reserva do check-in não localizada.');
    latestBundle = await json(`/api/reservations/${activeReservationId}`, { cache: 'no-store' });
    return latestBundle;
  }

  function activateForBundle(bundle) {
    if (!bundle?.reservation?.id) return;
    const status = String(bundle.reservation.status || '').toLowerCase();
    if (status === 'checked_in' || status === 'checked_out') return;
    if (activeReservationId !== bundle.reservation.id) {
      activeReservationId = bundle.reservation.id;
      faceVerifiedThisAttempt = new Set();
    }
    latestBundle = bundle;
  }

  // Mantém o id da reserva de check-in mesmo com a aplicação-base encapsulando o estado.
  const previousFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await previousFetch(...args);
    try {
      const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (response.ok && (/\/api\/reservations\/lookup(?:\?|$)/.test(requestUrl) || /\/api\/reservations\/\d+(?:\?|$)/.test(requestUrl))) {
        const data = await response.clone().json();
        activateForBundle(data);
      }
    } catch (_) {}
    return response;
  };

  async function startSequence() {
    if (!activeReservationId && latestBundle?.reservation?.id) activeReservationId = latestBundle.reservation.id;
    if (!activeReservationId) {
      notify('Não foi possível identificar a reserva para continuar o check-in.', true);
      return;
    }
    customFlowActive = true;
    faceVerifiedThisAttempt = new Set();
    stopCamera();
    await renderFace();
  }

  async function openCamera() {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Webcam indisponível neste navegador.');
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: 'user' },
      audio: false
    });
    const video = document.getElementById('v2FaceVideo');
    if (video) video.srcObject = cameraStream;
  }

  async function renderFace() {
    customFlowActive = true;
    let config;
    try { config = await json('/api/config', { cache: 'no-store' }); } catch (error) { return notify(error.message, true); }
    if (!config.require_face_match) return renderGovbr();

    let bundle;
    try { bundle = await refreshBundle(); } catch (error) { return notify(error.message, true); }
    const adults = bundle.guests.filter(guest => guest.adult);
    const next = adults.find(guest => !faceVerifiedThisAttempt.has(guest.id));
    if (!next) {
      stopCamera();
      return renderGovbr();
    }

    app.innerHTML = `<section class="panel-card" data-v2-checkin-sequence="face">
      ${header(4, 'Reconhecimento facial', `Posicione ${esc(next.name)} em frente à câmera para comparar o rosto com o documento enviado.`)}
      <div class="camera-box">
        <video id="v2FaceVideo" autoplay playsinline muted></video>
        <canvas id="v2FaceCanvas" class="d-none"></canvas>
        <div class="face-guide"></div>
      </div>
      <div class="text-center">
        <button class="btn btn-primary btn-touch" id="v2CaptureFace"><i class="bi bi-camera me-2"></i>Capturar e validar</button>
      </div>
      <div class="alert alert-warning mt-4"><strong>Modo de demonstração:</strong> a captura da webcam é real, mas o motor biométrico ainda está simulado. Esta validação é exigida novamente em cada nova tentativa de check-in.</div>
      <div class="wristband-list mt-3">
        ${adults.map(guest => `<div class="wristband-item"><span>${esc(guest.name)}</span>${faceVerifiedThisAttempt.has(guest.id) ? '<span class="status-pill status-ok">Validado agora</span>' : '<span class="status-pill status-pending">Pendente</span>'}</div>`).join('')}
      </div>
      ${actions({})}
    </section>`;
    bindCancel();

    try {
      await openCamera();
    } catch (_) {
      notify('Não foi possível abrir a webcam. Verifique o HTTPS, a permissão e a conexão USB.', true);
    }

    const capture = document.getElementById('v2CaptureFace');
    capture.onclick = async () => {
      const video = document.getElementById('v2FaceVideo');
      const canvas = document.getElementById('v2FaceCanvas');
      if (!video?.videoWidth) return notify('Aguarde a câmera inicializar.', true);

      const width = Math.min(960, video.videoWidth);
      canvas.width = width;
      canvas.height = Math.round(width * video.videoHeight / video.videoWidth);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const captureData = canvas.toDataURL('image/jpeg', 0.82);

      try {
        capture.disabled = true;
        capture.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Validando...';
        await json(`/api/reservations/${activeReservationId}/face/verify`, {
          method: 'POST', body: JSON.stringify({ guest_id: next.id, capture: captureData })
        });
        faceVerifiedThisAttempt.add(next.id);
        notify(`${next.name}: reconhecimento facial concluído.`);
        stopCamera();
        await renderFace();
      } catch (error) {
        notify(error.message, true);
        capture.disabled = false;
        capture.innerHTML = '<i class="bi bi-camera me-2"></i>Capturar e validar';
      }
    };
  }

  async function renderGovbr() {
    customFlowActive = true;
    stopCamera();

    let config;
    try { config = await json('/api/config', { cache: 'no-store' }); } catch (error) { return notify(error.message, true); }
    if (!config.require_govbr) return renderWristbands();

    let bundle;
    try { bundle = await refreshBundle(); } catch (error) { return notify(error.message, true); }
    const verified = Boolean(bundle.state?.govbr_verified);

    app.innerHTML = `<section class="panel-card" data-v2-checkin-sequence="govbr">
      ${header(5, 'Validação gov.br', 'O responsável deverá autenticar sua identidade pelo fluxo oficial do gov.br.')}
      <div class="scan-box">
        <i class="bi bi-shield-check scan-icon"></i>
        <h2 class="h4 fw-bold mt-3">Autenticação segura</h2>
        <p class="text-secondary">Escolha usar o celular pelo QR Code ou realizar o processo diretamente neste totem.</p>
        <button class="btn btn-primary btn-touch mt-3" id="govBtn" ${verified ? 'disabled' : ''}>
          <i class="bi ${verified ? 'bi-check2-circle' : 'bi-box-arrow-up-right'} me-2"></i>${verified ? 'Autenticação concluída' : 'Entrar com gov.br'}
        </button>
      </div>
      ${actions({ action: 'govbr-ok', label: 'Avançar para pulseiras', disabled: !verified })}
    </section>`;
    bindCancel();

    const govButton = document.getElementById('govBtn');
    if (govButton && !verified) {
      govButton.onclick = async () => {
        try {
          govButton.disabled = true;
          govButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Confirmando...';
          await json(`/api/reservations/${activeReservationId}/govbr/verify`, { method: 'POST', body: '{}' });
          notify('Autenticação gov.br registrada no modo de demonstração.');
          await renderGovbr();
        } catch (error) {
          notify(error.message, true);
          await renderGovbr();
        }
      };
    }

    const advance = app.querySelector('[data-v2-action="govbr-ok"]');
    if (advance) advance.onclick = renderWristbands;
  }

  async function renderWristbands() {
    customFlowActive = true;
    stopCamera();
    let bundle;
    try { bundle = await refreshBundle(); } catch (error) { return notify(error.message, true); }
    const adults = bundle.guests.filter(guest => guest.adult);
    const next = adults.find(guest => !String(guest.wristband_code || '').trim());

    app.innerHTML = `<section class="panel-card" data-v2-checkin-sequence="wristbands">
      ${header(6, 'Grave as pulseiras', `Será gravada uma pulseira NFC para cada hóspede adulto (${adults.length}).`)}
      <div class="scan-box">
        <i class="bi bi-wifi scan-icon"></i>
        <h2 class="h4 fw-bold mt-3">${next ? `Aproxime a pulseira de ${esc(next.name)}` : 'Todas as pulseiras foram gravadas'}</h2>
        <p class="text-secondary">Leitor/gravador previsto: ACS ACR122U.</p>
        ${next
          ? '<button class="btn btn-primary btn-touch mt-3" id="v2EncodeBand"><i class="bi bi-broadcast me-2"></i>Gravar pulseira</button>'
          : '<span class="status-pill status-ok mt-2"><i class="bi bi-check-circle"></i>Concluído</span>'}
      </div>
      <div class="wristband-list">
        ${adults.map((guest, index) => `<div class="wristband-item">
          <span><strong>Pulseira ${index + 1}</strong> · ${esc(guest.name)}</span>
          ${guest.wristband_code
            ? '<span class="status-pill status-ok">Gravada</span>'
            : '<span class="status-pill status-pending">Aguardando</span>'}
        </div>`).join('')}
      </div>
      ${actions({ action: 'wristbands-ok', label: 'Avançar para pagamento', disabled: Boolean(next) })}
    </section>`;
    bindCancel();

    const encode = document.getElementById('v2EncodeBand');
    if (encode && next) {
      encode.onclick = async () => {
        try {
          encode.disabled = true;
          encode.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Gravando...';
          const result = await json(`/api/reservations/${activeReservationId}/wristbands/encode`, {
            method: 'POST', body: JSON.stringify({ guest_id: next.id })
          });
          notify(`Pulseira gravada: ${result.code}`);
          await renderWristbands();
        } catch (error) {
          notify(error.message, true);
          await renderWristbands();
        }
      };
    }

    const advance = app.querySelector('[data-v2-action="wristbands-ok"]');
    if (advance) advance.onclick = renderPayment;
  }

  async function renderPayment() {
    customFlowActive = true;
    stopCamera();
    let bundle;
    try { bundle = await refreshBundle(); } catch (error) { return notify(error.message, true); }
    const reservation = bundle.reservation;

    if (!reservation.payment_pending) {
      app.innerHTML = `<section class="panel-card" data-v2-checkin-sequence="payment-confirmed">
        ${header(7, 'Pagamento', 'Confira a situação financeira da reserva antes de concluir o check-in.')}
        <div class="alert alert-success py-4">
          <div class="d-flex align-items-center gap-3">
            <i class="bi bi-check-circle-fill fs-2"></i>
            <div><strong class="d-block fs-5">Pagamento já confirmado</strong><span>Não existe saldo pendente nesta reserva. Nenhuma nova cobrança será realizada.</span></div>
          </div>
        </div>
        <div class="total-bar"><span>Saldo pendente</span><strong>${money(reservation.balance_cents)}</strong></div>
        ${actions({ action: 'finish-checkin', label: 'Concluir check-in' })}
      </section>`;
      bindCancel();
      app.querySelector('[data-v2-action="finish-checkin"]').onclick = finishCheckin;
      return;
    }

    app.innerHTML = `<section class="panel-card" data-v2-checkin-sequence="payment">
      ${header(7, 'Pagamento pendente', 'Há um saldo pendente na reserva. Escolha a forma de pagamento para continuar.')}
      <div class="total-bar"><span>Valor a pagar</span><strong>${money(reservation.balance_cents)}</strong></div>
      <div class="payment-grid">
        <button class="payment-option" data-payment="pix"><i class="bi bi-qr-code"></i>PIX</button>
        <button class="payment-option" data-payment="debit"><i class="bi bi-credit-card-2-front"></i>Cartão de débito</button>
        <button class="payment-option" data-payment="credit"><i class="bi bi-credit-card"></i>Cartão de crédito</button>
      </div>
      <div class="alert alert-info mt-4"><i class="bi bi-info-circle me-2"></i>Integração Gertec PPC930 / SiTef ainda em modo visual. O pagamento será apenas simulado.</div>
      <div class="flow-actions">
        <button class="btn btn-outline-danger btn-touch" data-v2-cancel><i class="bi bi-x-circle me-2"></i>Cancelar e recomeçar</button>
        <div class="right"><button class="btn btn-primary btn-touch" data-action="pay" disabled>Pagar e avançar<i class="bi bi-arrow-right ms-2"></i></button></div>
      </div>
    </section>`;
    bindCancel();

    let selected = '';
    const pay = app.querySelector('[data-action="pay"]');
    app.querySelectorAll('[data-payment]').forEach(button => {
      button.onclick = () => {
        app.querySelectorAll('[data-payment]').forEach(item => item.classList.remove('selected'));
        button.classList.add('selected');
        selected = button.dataset.payment;
        pay.disabled = false;
      };
    });

    pay.onclick = async () => {
      if (!selected) return;
      try {
        pay.disabled = true;
        await json(`/api/reservations/${activeReservationId}/payment`, {
          method: 'POST',
          body: JSON.stringify({ method: selected, amount_cents: reservation.balance_cents })
        });
        notify('Pagamento aprovado no modo simulado.');
        await finishCheckin();
      } catch (error) {
        notify(error.message, true);
        await renderPayment();
      }
    };
  }

  async function finishCheckin() {
    stopCamera();
    try {
      const result = await json(`/api/reservations/${activeReservationId}/checkin`, { method: 'POST', body: '{}' });
      app.innerHTML = `<section class="panel-card success-screen" data-v2-checkin-sequence="success">
        <div class="success-icon"><i class="bi bi-check-lg"></i></div>
        <h1>Check-in concluído</h1>
        <p class="lead text-secondary">Tudo certo! Sua UH é <strong>${esc(result.room_number)}</strong>.</p>
        <p class="text-secondary">Retire suas pulseiras e siga para a acomodação.</p>
        <button class="btn btn-primary btn-touch mt-4" id="v2FinishHome">Finalizar</button>
      </section>`;
      document.getElementById('v2FinishHome').onclick = () => location.reload();
    } catch (error) {
      notify(error.message, true);
    }
  }

  // A V2 assume o fluxo imediatamente após a documentação estar completa.
  // Ordem: documentos -> facial -> gov.br -> pulseiras -> pagamento.
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-action="docs-ok"]');
    if (!button || button.disabled) return;
    const title = app.querySelector('.step-title')?.textContent?.trim().toLowerCase() || '';
    if (!title.includes('confira os documentos')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    startSequence().catch(error => notify(error.message, true));
  }, true);

  // Compatibilidade para instalações já no meio do fluxo antigo.
  const observer = new MutationObserver(() => {
    if (customFlowActive || app.querySelector('[data-v2-checkin-sequence]')) return;
    const title = app.querySelector('.step-title')?.textContent?.trim().toLowerCase() || '';
    if (title.includes('validação facial') || title.includes('validação gov.br') || title.includes('grave as pulseiras')) {
      const video = app.querySelector('video');
      if (video?.srcObject) {
        try { video.srcObject.getTracks().forEach(track => track.stop()); } catch (_) {}
      }
      setTimeout(() => startSequence().catch(error => notify(error.message, true)), 0);
    }
  });
  observer.observe(app, { childList: true, subtree: true });
})();
