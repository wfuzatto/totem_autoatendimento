(() => {
  const app = document.getElementById('app');
  const hotelName = document.getElementById('hotelName');
  const settingsBtn = document.getElementById('settingsBtn');
  const adminLoginModal = new bootstrap.Modal(document.getElementById('adminLoginModal'));
  const adminModal = new bootstrap.Modal(document.getElementById('adminModal'));
  const toast = new bootstrap.Toast(document.getElementById('appToast'), { delay: 3500 });

  const state = {
    config: null,
    flow: null,
    step: 0,
    reservation: null,
    statement: null,
    adminToken: null,
    selectedPayment: null,
    cameraStream: null,
    inactivityTimer: null,
    documentPoll: null
  };

  const fmtMoney = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents || 0) / 100);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));

  async function api(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (state.adminToken && url.startsWith('/api/admin/')) headers.Authorization = `Bearer ${state.adminToken}`;
    const res = await fetch(url, { ...options, headers });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    return data;
  }

  function notify(message, danger = false) {
    const el = document.getElementById('appToast');
    el.classList.toggle('text-bg-danger', danger);
    el.classList.toggle('text-bg-dark', !danger);
    document.getElementById('toastBody').textContent = message;
    toast.show();
  }

  function stopCamera() {
    if (state.cameraStream) state.cameraStream.getTracks().forEach(t => t.stop());
    state.cameraStream = null;
  }

  function clearPoll() {
    if (state.documentPoll) clearInterval(state.documentPoll);
    state.documentPoll = null;
  }

  function resetInactivity() {
    clearTimeout(state.inactivityTimer);
    if (!state.flow || !state.config) return;
    state.inactivityTimer = setTimeout(() => {
      notify('Sessão encerrada por inatividade.');
      goHome();
    }, Math.max(30, state.config.inactivity_seconds || 120) * 1000);
  }

  ['pointerdown','keydown','touchstart'].forEach(event => document.addEventListener(event, resetInactivity, { passive: true }));

  function goHome() {
    stopCamera();
    clearPoll();
    state.flow = null;
    state.step = 0;
    state.reservation = null;
    state.statement = null;
    state.selectedPayment = null;
    clearTimeout(state.inactivityTimer);
    renderHome();
  }

  function flowHeader(step, title, subtitle) {
    return `<div class="mb-4">
      <div class="step-badge"><i class="bi bi-list-check"></i>${esc(state.flow === 'checkin' ? 'Check-in' : 'Check-out')} · Etapa ${step}</div>
      <h1 class="step-title">${esc(title)}</h1>
      <div class="step-subtitle">${esc(subtitle)}</div>
    </div>`;
  }

  function actions({ advanceLabel = 'Avançar', onAdvance = '', advanceDisabled = false, extra = '' } = {}) {
    return `<div class="flow-actions">
      <button class="btn btn-outline-danger btn-touch" data-action="cancel"><i class="bi bi-x-circle me-2"></i>Cancelar e recomeçar</button>
      <div class="right">${extra}
        ${onAdvance ? `<button class="btn btn-primary btn-touch" data-action="${onAdvance}" ${advanceDisabled ? 'disabled' : ''}>${esc(advanceLabel)}<i class="bi bi-arrow-right ms-2"></i></button>` : ''}
      </div>
    </div>`;
  }

  function bindCancel() {
    document.querySelectorAll('[data-action="cancel"]').forEach(btn => btn.addEventListener('click', goHome));
  }

  function renderHome() {
    app.innerHTML = `<section class="hero">
      <h1>Como podemos ajudar?</h1>
      <p>Escolha uma opção para iniciar. Você poderá cancelar e recomeçar em qualquer etapa.</p>
    </section>
    <section class="choice-grid" aria-label="Escolha o atendimento">
      <button class="choice-card" id="checkinChoice">
        <i class="bi bi-door-open big-icon"></i>
        <h2>Fazer check-in</h2>
        <p>Confirme sua reserva, documentos, pulseiras e pagamento.</p>
      </button>
      <button class="choice-card" id="checkoutChoice">
        <i class="bi bi-box-arrow-right big-icon"></i>
        <h2>Fazer check-out</h2>
        <p>Consulte o extrato, devolva as pulseiras e finalize sua conta.</p>
      </button>
    </section>`;
    document.getElementById('checkinChoice').onclick = () => startFlow('checkin');
    document.getElementById('checkoutChoice').onclick = () => startFlow('checkout');
  }

  function startFlow(flow) {
    state.flow = flow;
    state.step = 1;
    resetInactivity();
    flow === 'checkin' ? renderCheckinLookup() : renderCheckoutLookup();
  }

  function lookupScreen({ title, subtitle, placeholder, hint, mode }) {
    app.innerHTML = `<section class="panel-card">
      ${flowHeader(1, title, subtitle)}
      <div class="scan-box mb-4">
        <i class="bi ${mode === 'checkout' ? 'bi-wifi' : 'bi-search'} scan-icon"></i>
        <h2 class="h4 fw-bold mt-3">${mode === 'checkout' ? 'Aproxime a pulseira ou digite os dados' : 'Localize sua reserva'}</h2>
        <p class="text-secondary mb-0">${esc(hint)}</p>
      </div>
      <label class="form-label fw-semibold" for="lookupInput">Reserva ${mode === 'checkout' ? '/ UH / pulseira' : '/ CPF'}</label>
      <input id="lookupInput" class="form-control touch-input" autocomplete="off" placeholder="${esc(placeholder)}">
      <div class="mt-3 d-flex gap-2 flex-wrap">
        ${mode === 'checkout' ? '<button class="btn btn-outline-primary btn-touch" id="simulateNfc"><i class="bi bi-wifi me-2"></i>Simular pulseira ACR122U</button>' : ''}
        <button class="btn btn-outline-secondary btn-touch" id="demoValue"><i class="bi bi-lightning me-2"></i>Usar reserva de demonstração</button>
      </div>
      ${actions({ onAdvance: 'lookup', advanceLabel: 'Buscar' })}
    </section>`;
    bindCancel();
    const input = document.getElementById('lookupInput');
    document.getElementById('demoValue').onclick = () => { input.value = mode === 'checkout' ? 'RES-10025' : 'RES-20080'; };
    if (mode === 'checkout') document.getElementById('simulateNfc').onclick = () => { input.value = 'SAGA-204-CARLOS'; notify('Pulseira simulada lida: SAGA-204-CARLOS'); };
    document.querySelector('[data-action="lookup"]').onclick = async () => {
      try {
        const result = await api('/api/reservations/lookup', { method: 'POST', body: JSON.stringify({ query: input.value, type: 'auto' }) });
        state.reservation = result;
        if (state.flow === 'checkout') renderCheckoutStatement(); else renderCheckinPreview();
      } catch (e) { notify(e.message, true); }
    };
  }

  function renderCheckoutLookup() {
    lookupScreen({
      title: 'Localize sua hospedagem',
      subtitle: 'Leia uma pulseira ou informe a UH ou o número da reserva.',
      placeholder: 'Ex.: 204 ou RES-10025',
      hint: 'O ACR122U será usado no modo real. Neste MVP a leitura pode ser simulada.',
      mode: 'checkout'
    });
  }

  function renderCheckinLookup() {
    lookupScreen({
      title: 'Encontre sua reserva',
      subtitle: 'Informe o número da reserva ou o CPF do responsável.',
      placeholder: 'Ex.: RES-20080 ou 98765432100',
      hint: 'Use os mesmos dados informados na reserva.',
      mode: 'checkin'
    });
  }

  async function renderCheckoutStatement() {
    try {
      state.statement = await api(`/api/reservations/${state.reservation.reservation.id}/statement`);
    } catch (e) { return notify(e.message, true); }
    const s = state.statement;
    const groups = s.groups.map(group => `<section class="guest-section">
      <div class="guest-header"><div class="guest-name"><i class="bi bi-person-circle me-2"></i>${esc(group.guest.name)}</div><strong>${fmtMoney(group.subtotal_cents)}</strong></div>
      ${group.items.length ? group.items.map(item => `<div class="folio-row ${item.contested ? 'folio-contested' : ''}">
        <div><div class="fw-semibold">${esc(item.description)}</div><small class="text-secondary">${esc(item.occurred_at)}</small></div>
        <div class="amount">${fmtMoney(item.amount_cents)}</div>
        <div class="contest-cell">${s.allow_item_contest && !item.contested ? `<button class="btn btn-outline-danger" data-contest="${item.id}">Contestar item</button>` : item.contested ? '<span class="status-pill status-pending">Contestado</span>' : ''}</div>
      </div>`).join('') : '<div class="p-3 text-secondary">Sem lançamentos.</div>'}
    </section>`).join('');

    app.innerHTML = `<section class="panel-card">
      ${flowHeader(2, 'Confira seu extrato', 'Os consumos de toda a reserva estão unificados e separados por hóspede/pulseira.')}
      <div class="summary-grid">
        <div class="summary-box"><div class="summary-label">Reserva</div><div class="summary-value">${esc(s.reservation.reservation_number)}</div></div>
        <div class="summary-box"><div class="summary-label">UH</div><div class="summary-value">${esc(s.reservation.room_number || '—')}</div></div>
        <div class="summary-box"><div class="summary-label">Responsável</div><div class="summary-value">${esc(s.reservation.responsible_name)}</div></div>
      </div>
      ${groups}
      <div class="total-bar"><span>Total da reserva</span><strong>${fmtMoney(s.total_cents)}</strong></div>
      ${actions({ onAdvance: 'statement-ok', advanceLabel: 'Extrato conferido' })}
    </section>`;
    bindCancel();
    document.querySelector('[data-action="statement-ok"]').onclick = renderCheckoutWristbands;
    document.querySelectorAll('[data-contest]').forEach(btn => btn.onclick = async () => {
      try {
        await api(`/api/reservations/${s.reservation.id}/statement/${btn.dataset.contest}/contest`, { method: 'POST', body: '{}' });
        notify('Item marcado como contestado. A recepção poderá revisar a ocorrência.');
        renderCheckoutStatement();
      } catch (e) { notify(e.message, true); }
    });
  }

  async function renderCheckoutWristbands() {
    const id = state.reservation.reservation.id;
    let data;
    try { data = await api(`/api/reservations/${id}/wristbands/returns`); } catch (e) { return notify(e.message, true); }
    app.innerHTML = `<section class="panel-card">
      ${flowHeader(3, 'Devolva as pulseiras', `Precisamos receber ${data.expected} pulseira(s), uma por hóspede adulto.`)}
      <div class="scan-box">
        <i class="bi bi-wifi scan-icon"></i>
        <h2 class="h4 fw-bold mt-3">Aproxime uma pulseira do leitor</h2>
        <p class="text-secondary">Pulseiras recebidas: <strong>${data.returned_count}/${data.expected}</strong></p>
        <div class="input-group mt-3 mx-auto" style="max-width:620px">
          <input id="returnCode" class="form-control touch-input" placeholder="Código da pulseira">
          <button class="btn btn-primary px-4" id="returnBand">Registrar</button>
        </div>
        <button class="btn btn-outline-primary btn-touch mt-3" id="simulateReturn"><i class="bi bi-lightning me-2"></i>Simular próxima pulseira</button>
      </div>
      <div class="wristband-list">${data.returned.map((r,i) => `<div class="wristband-item"><span><i class="bi bi-check-circle-fill text-success me-2"></i>Pulseira ${i+1}</span><code>${esc(r.code)}</code></div>`).join('')}</div>
      ${actions({ onAdvance: 'bands-ok', advanceLabel: 'Avançar para pagamento', advanceDisabled: !data.complete })}
    </section>`;
    bindCancel();
    const input = document.getElementById('returnCode');
    const known = state.reservation.guests.filter(g => g.adult && g.wristband_code).map(g => g.wristband_code);
    document.getElementById('simulateReturn').onclick = () => {
      const returned = new Set(data.returned.map(r => r.code));
      input.value = known.find(code => !returned.has(code)) || known[0] || '';
      notify(input.value ? `Leitura simulada: ${input.value}` : 'Nenhuma pulseira cadastrada.', !input.value);
    };
    document.getElementById('returnBand').onclick = async () => {
      try {
        await api(`/api/reservations/${id}/wristbands/return`, { method:'POST', body:JSON.stringify({ code:input.value }) });
        renderCheckoutWristbands();
      } catch(e) { notify(e.message, true); }
    };
    const advance = document.querySelector('[data-action="bands-ok"]');
    if (advance) advance.onclick = renderCheckoutPayment;
  }

  function paymentScreen(title, subtitle, amountCents, onFinished) {
    state.selectedPayment = null;
    app.innerHTML = `<section class="panel-card">
      ${flowHeader(state.flow === 'checkout' ? 4 : 7, title, subtitle)}
      <div class="total-bar"><span>Valor a pagar</span><strong>${fmtMoney(amountCents)}</strong></div>
      <div class="payment-grid">
        <button class="payment-option" data-payment="pix"><i class="bi bi-qr-code"></i>PIX</button>
        <button class="payment-option" data-payment="debit"><i class="bi bi-credit-card-2-front"></i>Cartão de débito</button>
        <button class="payment-option" data-payment="credit"><i class="bi bi-credit-card"></i>Cartão de crédito</button>
      </div>
      <div class="alert alert-info mt-4"><i class="bi bi-info-circle me-2"></i>Integração Gertec PPC930 / SiTef ainda em modo visual. O pagamento é aprovado automaticamente no MVP.</div>
      ${actions({ onAdvance:'pay', advanceLabel:'Pagar e avançar', advanceDisabled:true })}
    </section>`;
    bindCancel();
    const payButton = document.querySelector('[data-action="pay"]');
    document.querySelectorAll('[data-payment]').forEach(btn => btn.onclick = () => {
      document.querySelectorAll('[data-payment]').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.selectedPayment = btn.dataset.payment;
      payButton.disabled = false;
    });
    payButton.onclick = async () => {
      try {
        payButton.disabled = true;
        payButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Processando...';
        await api(`/api/reservations/${state.reservation.reservation.id}/payment`, { method:'POST', body:JSON.stringify({ method:state.selectedPayment, amount_cents:amountCents }) });
        notify('Pagamento aprovado no modo simulado.');
        state.reservation = await api(`/api/reservations/${state.reservation.reservation.id}`);
        onFinished();
      } catch(e) { notify(e.message,true); paymentScreen(title, subtitle, amountCents, onFinished); }
    };
  }

  function renderCheckoutPayment() {
    paymentScreen('Pagamento', 'Escolha como deseja pagar sua conta.', state.statement.total_cents, finishCheckout);
  }

  async function finishCheckout() {
    try {
      const result = await api(`/api/reservations/${state.reservation.reservation.id}/checkout`, { method:'POST', body:'{}' });
      app.innerHTML = `<section class="panel-card success-screen">
        <div class="success-icon"><i class="bi bi-check-lg"></i></div>
        <h1>Check-out concluído</h1>
        <p class="lead text-secondary">Obrigado pela hospedagem. Sua reserva ${esc(result.reservation.reservation_number)} foi encerrada.</p>
        <button class="btn btn-primary btn-touch mt-4" id="finishHome">Finalizar</button>
        ${actions({})}
      </section>`;
      bindCancel();
      document.getElementById('finishHome').onclick = goHome;
    } catch(e) { notify(e.message,true); }
  }

  function renderCheckinPreview() {
    const r = state.reservation.reservation;
    app.innerHTML = `<section class="panel-card">
      ${flowHeader(2, 'Confirme sua reserva', 'Veja se os dados encontrados correspondem à sua hospedagem.')}
      <div class="summary-grid">
        <div class="summary-box"><div class="summary-label">Reserva</div><div class="summary-value">${esc(r.reservation_number)}</div></div>
        <div class="summary-box"><div class="summary-label">Entrada</div><div class="summary-value">${esc(r.checkin_date || '—')}</div></div>
        <div class="summary-box"><div class="summary-label">Saída</div><div class="summary-value">${esc(r.checkout_date || '—')}</div></div>
        <div class="summary-box"><div class="summary-label">Responsável</div><div class="summary-value">${esc(r.responsible_name)}</div></div>
        <div class="summary-box"><div class="summary-label">Adultos</div><div class="summary-value">${r.adults}</div></div>
        <div class="summary-box"><div class="summary-label">Crianças</div><div class="summary-value">${r.children}</div></div>
      </div>
      <div class="guest-section"><div class="guest-header"><div class="guest-name">Hóspedes</div></div>${state.reservation.guests.map(g => `<div class="folio-row"><div><strong>${esc(g.name)}</strong><br><small class="text-secondary">${g.adult ? 'Adulto' : 'Criança'}</small></div><div>${esc(g.document || 'Documento não informado')}</div><div></div></div>`).join('')}</div>
      ${actions({ onAdvance:'preview-ok', advanceLabel:'Sim, é minha reserva' })}
    </section>`;
    bindCancel();
    document.querySelector('[data-action="preview-ok"]').onclick = renderCheckinDocuments;
  }

  async function renderCheckinDocuments() {
    clearPoll();
    const id = state.reservation.reservation.id;
    try { state.reservation = await api(`/api/reservations/${id}`); } catch(e) { return notify(e.message,true); }
    const missing = state.reservation.documents.filter(d => d.status !== 'received');
    let qr = null;
    if (missing.length) {
      try { qr = await api(`/api/reservations/${id}/upload-token`, { method:'POST', body:'{}' }); } catch(e) { notify(e.message,true); }
    }
    const guestName = gid => state.reservation.guests.find(g => g.id === gid)?.name || 'Reserva';
    app.innerHTML = `<section class="panel-card">
      ${flowHeader(3, 'Confira os documentos', missing.length ? 'Há documentos pendentes. Escaneie o QR Code com o celular para enviar.' : 'Todos os documentos necessários foram recebidos.')}
      <div class="guest-section">
        ${state.reservation.documents.map(doc => `<div class="document-row px-3"><div><strong>${doc.type === 'identity' ? 'Identidade' : 'Comprovante de pagamento'}</strong><br><small class="text-secondary">${esc(guestName(doc.guest_id))}</small></div><span class="status-pill ${doc.status === 'received' ? 'status-ok' : 'status-pending'}"><i class="bi ${doc.status === 'received' ? 'bi-check-circle' : 'bi-clock'}"></i>${doc.status === 'received' ? 'Enviado' : 'Enviar'}</span></div>`).join('')}
      </div>
      ${missing.length && qr ? `<div class="qr-wrap"><img src="${qr.qr_data_url}" alt="QR Code para envio de documentos"></div><div class="text-center text-secondary">A tela atualiza automaticamente quando os arquivos forem enviados.</div>` : '<div class="alert alert-success mt-4"><i class="bi bi-check-circle me-2"></i>Documentação completa.</div>'}
      ${actions({ onAdvance:'docs-ok', advanceLabel:'Avançar', advanceDisabled:missing.length > 0 })}
    </section>`;
    bindCancel();
    const adv = document.querySelector('[data-action="docs-ok"]');
    if (adv) adv.onclick = () => { clearPoll(); renderCheckinGovbr(); };
    if (missing.length) {
      state.documentPoll = setInterval(async () => {
        try {
          const fresh = await api(`/api/reservations/${id}`);
          if (fresh.documents.every(d => d.status === 'received')) {
            state.reservation = fresh;
            clearPoll();
            notify('Todos os documentos foram recebidos.');
            renderCheckinDocuments();
          }
        } catch (_) {}
      }, 3000);
    }
  }

  function renderCheckinGovbr() {
    if (!state.config.require_govbr) return renderCheckinFace();
    const verified = Boolean(state.reservation.state?.govbr_verified);
    app.innerHTML = `<section class="panel-card">
      ${flowHeader(4, 'Validação gov.br', 'O responsável deverá autenticar sua identidade pelo fluxo oficial do gov.br.')}
      <div class="scan-box"><i class="bi bi-shield-check scan-icon"></i><h2 class="h4 fw-bold mt-3">Autenticação segura</h2><p class="text-secondary">No MVP este botão simula o retorno positivo. O OAuth/OpenID oficial será conectado no adapter de produção.</p><button class="btn btn-primary btn-touch mt-3" id="govBtn"><i class="bi bi-box-arrow-up-right me-2"></i>${verified ? 'Autenticação concluída' : 'Entrar com gov.br'}</button></div>
      ${actions({ onAdvance:'gov-ok', advanceLabel:'Avançar', advanceDisabled:!verified })}
    </section>`;
    bindCancel();
    document.getElementById('govBtn').onclick = async () => {
      try {
        await api(`/api/reservations/${state.reservation.reservation.id}/govbr/verify`, { method:'POST', body:'{}' });
        state.reservation = await api(`/api/reservations/${state.reservation.reservation.id}`);
        notify('Autenticação gov.br simulada com sucesso.');
        renderCheckinGovbr();
      } catch(e) { notify(e.message,true); }
    };
    const adv = document.querySelector('[data-action="gov-ok"]');
    if (adv) adv.onclick = renderCheckinFace;
  }

  async function startCamera() {
    stopCamera();
    try {
      state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width:{ ideal:1920 }, height:{ ideal:1080 }, facingMode:'user' }, audio:false });
      const video = document.getElementById('cameraVideo');
      if (video) video.srcObject = state.cameraStream;
    } catch(e) { notify('Não foi possível abrir a webcam. Verifique a permissão e a conexão USB.', true); }
  }

  function renderCheckinFace() {
    if (!state.config.require_face_match) return renderCheckinWristbands();
    const adults = state.reservation.guests.filter(g => g.adult);
    const next = adults.find(g => !g.face_verified);
    if (!next) { stopCamera(); return renderCheckinWristbands(); }
    app.innerHTML = `<section class="panel-card">
      ${flowHeader(5, 'Validação facial', `Posicione ${next.name} em frente à câmera para comparar o rosto com o documento enviado.`)}
      <div class="camera-box"><video id="cameraVideo" autoplay playsinline muted></video><canvas id="cameraCanvas" class="d-none"></canvas><div class="face-guide"></div></div>
      <div class="text-center"><button class="btn btn-primary btn-touch" id="captureFace"><i class="bi bi-camera me-2"></i>Capturar e validar</button></div>
      <div class="alert alert-warning mt-4"><strong>MVP:</strong> a captura da webcam é real, mas o motor biométrico está simulado. Em produção, o check-in só será liberado com comparação biométrica homologada e tratamento adequado dos dados.</div>
      ${actions({ onAdvance:'face-ok', advanceLabel:'Avançar', advanceDisabled:true })}
    </section>`;
    bindCancel();
    startCamera();
    document.getElementById('captureFace').onclick = async () => {
      const video = document.getElementById('cameraVideo');
      const canvas = document.getElementById('cameraCanvas');
      if (!video.videoWidth) return notify('Aguarde a câmera inicializar.', true);
      canvas.width = Math.min(960, video.videoWidth);
      canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
      canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
      const capture = canvas.toDataURL('image/jpeg', .82);
      try {
        await api(`/api/reservations/${state.reservation.reservation.id}/face/verify`, { method:'POST', body:JSON.stringify({ guest_id:next.id, capture }) });
        state.reservation = await api(`/api/reservations/${state.reservation.reservation.id}`);
        notify(`${next.name}: validação concluída no modo simulado.`);
        stopCamera();
        renderCheckinFace();
      } catch(e) { notify(e.message,true); }
    };
  }

  function renderCheckinWristbands() {
    stopCamera();
    const adults = state.reservation.guests.filter(g => g.adult);
    const next = adults.find(g => !g.wristband_code);
    app.innerHTML = `<section class="panel-card">
      ${flowHeader(6, 'Grave as pulseiras', `Será gravada uma pulseira NFC para cada hóspede adulto (${adults.length}).`)}
      <div class="scan-box"><i class="bi bi-wifi scan-icon"></i><h2 class="h4 fw-bold mt-3">${next ? `Aproxime a pulseira de ${esc(next.name)}` : 'Todas as pulseiras foram gravadas'}</h2><p class="text-secondary">Leitor/gravador previsto: ACS ACR122U.</p>${next ? '<button class="btn btn-primary btn-touch mt-3" id="encodeBand"><i class="bi bi-broadcast me-2"></i>Gravar pulseira</button>' : '<span class="status-pill status-ok mt-2"><i class="bi bi-check-circle"></i>Concluído</span>'}</div>
      <div class="wristband-list">${adults.map((g,i) => `<div class="wristband-item"><span><strong>Pulseira ${i+1}</strong> · ${esc(g.name)}</span>${g.wristband_code ? `<span class="status-pill status-ok">Gravada</span>` : `<span class="status-pill status-pending">Aguardando</span>`}</div>`).join('')}</div>
      ${actions({ onAdvance:'bands-encoded', advanceLabel:'Avançar', advanceDisabled:!!next })}
    </section>`;
    bindCancel();
    if (next) document.getElementById('encodeBand').onclick = async () => {
      try {
        const result = await api(`/api/reservations/${state.reservation.reservation.id}/wristbands/encode`, { method:'POST', body:JSON.stringify({ guest_id:next.id }) });
        notify(`Pulseira gravada: ${result.code}`);
        state.reservation = await api(`/api/reservations/${state.reservation.reservation.id}`);
        renderCheckinWristbands();
      } catch(e) { notify(e.message,true); }
    };
    const adv = document.querySelector('[data-action="bands-encoded"]');
    if (adv) adv.onclick = () => {
      if (state.reservation.reservation.payment_pending) renderCheckinPayment();
      else finishCheckin();
    };
  }

  function renderCheckinPayment() {
    paymentScreen('Pagamento pendente', 'Há um saldo pendente na reserva. Escolha a forma de pagamento para continuar.', state.reservation.reservation.balance_cents, finishCheckin);
  }

  async function finishCheckin() {
    try {
      const result = await api(`/api/reservations/${state.reservation.reservation.id}/checkin`, { method:'POST', body:'{}' });
      app.innerHTML = `<section class="panel-card success-screen"><div class="success-icon"><i class="bi bi-check-lg"></i></div><h1>Check-in concluído</h1><p class="lead text-secondary">Tudo certo! Sua UH é <strong>${esc(result.room_number)}</strong>.</p><p class="text-secondary">Retire suas pulseiras e siga para a acomodação. A impressão do comprovante será ligada à POS 80 mm no adapter de produção.</p><button class="btn btn-primary btn-touch mt-4" id="finishHome">Finalizar</button>${actions({})}</section>`;
      bindCancel();
      document.getElementById('finishHome').onclick = goHome;
    } catch(e) { notify(e.message,true); }
  }

  async function loadAdmin() {
    try {
      const [s, hw] = await Promise.all([api('/api/admin/settings'), api('/api/admin/hardware')]);
      const checked = v => String(v) === '1' ? 'checked' : '';
      document.getElementById('adminBody').innerHTML = `
        <div class="admin-section"><h3><i class="bi bi-sliders me-2"></i>Regras do fluxo</h3>
          <div class="row g-3">
            <div class="col-md-6"><label class="form-label">Nome do hotel</label><input class="form-control touch-input" data-setting="hotel_name" value="${esc(s.hotel_name)}"></div>
            <div class="col-md-6"><label class="form-label">Inatividade para reiniciar (segundos)</label><input type="number" min="30" class="form-control touch-input" data-setting="inactivity_seconds" value="${esc(s.inactivity_seconds)}"></div>
            <div class="col-md-6 form-check form-switch ms-2"><input class="form-check-input" type="checkbox" data-setting="allow_item_contest" ${checked(s.allow_item_contest)}><label class="form-check-label">Permitir contestação de item</label></div>
            <div class="col-md-6 form-check form-switch ms-2"><input class="form-check-input" type="checkbox" data-setting="require_govbr" ${checked(s.require_govbr)}><label class="form-check-label">Exigir gov.br</label></div>
            <div class="col-md-6 form-check form-switch ms-2"><input class="form-check-input" type="checkbox" data-setting="require_face_match" ${checked(s.require_face_match)}><label class="form-check-label">Exigir validação facial</label></div>
            <div class="col-md-6 form-check form-switch ms-2"><input class="form-check-input" type="checkbox" data-setting="require_wristband_return" ${checked(s.require_wristband_return)}><label class="form-check-label">Exigir devolução das pulseiras</label></div>
            <div class="col-md-6 form-check form-switch ms-2"><input class="form-check-input" type="checkbox" data-setting="enable_accessibility_toolbar" ${checked(s.enable_accessibility_toolbar)}><label class="form-check-label">Barra de acessibilidade</label></div>
          </div>
        </div>
        <div class="admin-section"><h3><i class="bi bi-cloud-arrow-down me-2"></i>Integração hotelaria</h3><div class="row g-3"><div class="col-md-4"><label class="form-label">Provider</label><select class="form-select touch-select" data-setting="api_provider"><option value="mock" ${s.api_provider==='mock'?'selected':''}>Mock / demonstração</option><option value="totvs" ${s.api_provider==='totvs'?'selected':''}>TOTVS Guest API</option></select></div><div class="col-md-8"><label class="form-label">URL base TOTVS</label><input class="form-control touch-input" data-setting="totvs_base_url" value="${esc(s.totvs_base_url)}" placeholder="https://..."></div><div class="col-12"><label class="form-label">Token / credencial</label><input type="password" class="form-control touch-input" data-setting="totvs_token" value="${esc(s.totvs_token || '')}" placeholder="Credencial da API"></div></div></div>
        <div class="admin-section"><h3><i class="bi bi-cpu me-2"></i>Hardware e pagamento</h3><div class="row g-3">
          <div class="col-lg-3"><div class="hardware-card"><strong>ACR122U</strong><div class="text-secondary mt-1">${esc(hw.nfc.status)}</div><select class="form-select mt-3" data-setting="nfc_mode"><option value="mock" ${s.nfc_mode==='mock'?'selected':''}>Simulado</option><option value="pcsc" ${s.nfc_mode==='pcsc'?'selected':''}>PC/SC real</option></select></div></div>
          <div class="col-lg-3"><div class="hardware-card"><strong>POS 80 mm</strong><div class="text-secondary mt-1">${esc(hw.printer.status)}</div><select class="form-select mt-3" data-setting="printer_mode"><option value="mock" ${s.printer_mode==='mock'?'selected':''}>Simulada</option><option value="escpos" ${s.printer_mode==='escpos'?'selected':''}>ESC/POS real</option></select></div></div>
          <div class="col-lg-3"><div class="hardware-card"><strong>Gertec PPC930</strong><div class="text-secondary mt-1">${esc(hw.payment.status)}</div><select class="form-select mt-3" data-setting="payment_provider"><option value="mock" ${s.payment_provider==='mock'?'selected':''}>Simulado</option><option value="sitef" ${s.payment_provider==='sitef'?'selected':''}>SiTef</option></select></div></div>
          <div class="col-lg-3"><div class="hardware-card"><strong>Webcam USB</strong><div class="text-secondary mt-1">${esc(hw.webcam.status)}</div><select class="form-select mt-3" data-setting="webcam_mode"><option value="browser" selected>Browser / USB</option></select></div></div>
          <div class="col-12"><label class="form-label">Servidor SiTef</label><input class="form-control touch-input" data-setting="sitef_server" value="${esc(s.sitef_server)}" placeholder="IP ou hostname"></div>
        </div></div>`;
      adminModal.show();
    } catch(e) { state.adminToken=null; notify(e.message,true); }
  }

  settingsBtn.onclick = () => {
    document.getElementById('adminPassword').value = '';
    document.getElementById('adminLoginError').textContent = '';
    adminLoginModal.show();
    setTimeout(() => document.getElementById('adminPassword').focus(), 400);
  };

  document.getElementById('adminLoginBtn').onclick = async () => {
    try {
      const result = await api('/api/admin/login', { method:'POST', body:JSON.stringify({ password:document.getElementById('adminPassword').value }) });
      state.adminToken = result.token;
      adminLoginModal.hide();
      await loadAdmin();
    } catch(e) { document.getElementById('adminLoginError').textContent = e.message; }
  };

  document.getElementById('saveSettingsBtn').onclick = async () => {
    try {
      const body = {};
      document.querySelectorAll('[data-setting]').forEach(el => { body[el.dataset.setting] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value; });
      await api('/api/admin/settings', { method:'PUT', body:JSON.stringify(body) });
      state.config = await api('/api/config');
      hotelName.textContent = state.config.hotel_name;
      document.getElementById('accessibilityToolbar').style.display = state.config.enable_accessibility_toolbar ? 'flex' : 'none';
      notify('Configurações salvas.');
      adminModal.hide();
      goHome();
    } catch(e) { notify(e.message,true); }
  };

  document.getElementById('exitKioskBtn').onclick = async () => {
    try {
      await api('/api/admin/prepare-exit', { method:'POST', body:'{}' });
      if (window.kiosk?.exit) window.kiosk.exit();
      else notify('Saída autorizada. No navegador comum, feche a janela manualmente; no Electron o totem encerra agora.');
    } catch(e) { notify(e.message,true); }
  };

  document.getElementById('fontBtn').onclick = () => document.body.classList.toggle('large-text');
  document.getElementById('contrastBtn').onclick = () => document.body.classList.toggle('high-contrast');
  document.getElementById('speakBtn').onclick = () => {
    if (!('speechSynthesis' in window)) return notify('Leitura em voz alta não está disponível neste equipamento.', true);
    speechSynthesis.cancel();
    const text = app.innerText.replace(/\s+/g,' ').trim();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR'; u.rate = .92;
    speechSynthesis.speak(u);
  };

  document.addEventListener('keydown', e => {
    const blocked = e.key === 'F12' || (e.ctrlKey && ['r','w','l','t','n'].includes(e.key.toLowerCase())) || (e.altKey && ['ArrowLeft','ArrowRight'].includes(e.key));
    if (blocked) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  async function init() {
    try {
      state.config = await api('/api/config');
      hotelName.textContent = state.config.hotel_name;
      document.getElementById('accessibilityToolbar').style.display = state.config.enable_accessibility_toolbar ? 'flex' : 'none';
      renderHome();
    } catch(e) {
      app.innerHTML = `<div class="alert alert-danger"><h1 class="h4">Não foi possível iniciar o totem</h1><p>${esc(e.message)}</p><button class="btn btn-danger" onclick="location.reload()">Tentar novamente</button></div>`;
    }
  }

  init();
})();
