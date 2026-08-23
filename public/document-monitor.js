(() => {
  const originalFetch = window.fetch.bind(window);
  let latestBundle = null;
  let kioskPoll = null;
  let decorating = false;

  function guestName(bundle, guestId) {
    return bundle.guests?.find(guest => guest.id === guestId)?.name || 'hóspede';
  }

  function isDocumentScreen() {
    const title = document.querySelector('#app .step-title')?.textContent?.trim().toLowerCase() || '';
    return title.includes('confira os documentos');
  }

  function renderWarning(bundle) {
    const docs = (bundle.documents || []).filter(doc => ['invalid', 'validation_error'].includes(doc.status));

    setTimeout(() => {
      const app = document.getElementById('app');
      const panel = app?.querySelector('.panel-card');
      const existing = document.getElementById('documentValidationBanner');

      if (!docs.length) {
        existing?.remove();
        return;
      }
      if (!panel) return;

      const lines = docs.map(doc => {
        const who = guestName(bundle, doc.guest_id);
        return doc.status === 'invalid'
          ? `<li><strong>${who}:</strong> documento inválido. Envie novamente uma CNH ou RG/CIN com CPF legível.</li>`
          : `<li><strong>${who}:</strong> não foi possível validar o documento. Tente novamente ou procure um atendente.</li>`;
      }).join('');

      const banner = existing || document.createElement('div');
      banner.id = 'documentValidationBanner';
      banner.className = 'alert alert-danger mb-4';
      banner.setAttribute('role', 'alert');
      banner.innerHTML = `<div class="fw-bold mb-1"><i class="bi bi-exclamation-triangle-fill me-2"></i>Documento precisa ser reenviado</div><ul class="mb-0 ps-4">${lines}</ul>`;

      if (!existing) panel.insertBefore(banner, panel.firstChild);
    }, 80);
  }

  async function requestJson(url, options = {}) {
    const response = await window.fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a solicitação.');
    return data;
  }

  function stopKioskPoll() {
    if (kioskPoll) clearInterval(kioskPoll);
    kioskPoll = null;
  }

  function setDocumentRowState(row, doc) {
    let status = row.querySelector('.status-pill');
    if (!status) {
      status = document.createElement('span');
      row.appendChild(status);
    }
    const received = doc.status === 'received';
    status.className = `status-pill ${received ? 'status-ok' : 'status-pending'}`;
    status.innerHTML = `<i class="bi ${received ? 'bi-check-circle' : 'bi-clock'}"></i>${received ? 'Enviado' : 'Enviar'}`;

    const existing = row.querySelector('[data-kiosk-remove-document]');
    if (!received) {
      existing?.remove();
      return;
    }

    if (!existing) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-outline-danger btn-sm kiosk-remove-document';
      button.dataset.kioskRemoveDocument = String(doc.id);
      button.innerHTML = '<i class="bi bi-trash3 me-1"></i>Remover';
      button.addEventListener('click', () => removeDocument(doc, button));
      row.appendChild(button);
    }
  }

  function updateDocumentScreen(bundle) {
    if (!isDocumentScreen() || !bundle?.reservation?.id) return;
    const rows = [...document.querySelectorAll('#app .document-row')];
    if (!rows.length) return;

    const documents = bundle.documents || [];
    rows.forEach((row, index) => {
      const doc = documents[index];
      if (!doc) return;
      row.dataset.documentId = String(doc.id);
      setDocumentRowState(row, doc);
    });

    const allDone = documents.length > 0 && documents.every(doc => doc.status === 'received');
    const advance = document.querySelector('#app [data-action="docs-ok"]');
    if (advance) advance.disabled = !allDone;

    const subtitle = document.querySelector('#app .step-subtitle');
    if (subtitle) subtitle.textContent = allDone
      ? 'Todos os documentos necessários foram recebidos.'
      : 'Há documentos pendentes. Escaneie o QR Code com o celular para enviar.';

    const panel = document.querySelector('#app .panel-card');
    if (!panel) return;
    const flowActions = panel.querySelector('.flow-actions');
    const completeAlert = [...panel.querySelectorAll('.alert-success')].find(el => /documenta[cç][aã]o completa/i.test(el.textContent || ''));
    const qrBlock = document.getElementById('v2DocumentUploadQr');

    if (allDone) {
      qrBlock?.remove();
      if (!completeAlert && flowActions) {
        const alert = document.createElement('div');
        alert.className = 'alert alert-success mt-4';
        alert.innerHTML = '<i class="bi bi-check-circle me-2"></i>Documentação completa.';
        flowActions.before(alert);
      }
      stopKioskPoll();
    } else {
      completeAlert?.remove();
    }
  }

  async function ensureUploadQr(reservationId) {
    if (!isDocumentScreen()) return;
    const panel = document.querySelector('#app .panel-card');
    const flowActions = panel?.querySelector('.flow-actions');
    if (!panel || !flowActions) return;

    let block = document.getElementById('v2DocumentUploadQr');
    if (!block) {
      block = document.createElement('div');
      block.id = 'v2DocumentUploadQr';
      block.className = 'v2-document-upload-qr';
      block.innerHTML = '<div class="text-center py-3"><span class="spinner-border text-success"></span><div class="mt-2">Gerando QR Code para novo envio...</div></div>';
      flowActions.before(block);
    }

    try {
      const qr = await requestJson(`/api/reservations/${reservationId}/upload-token`, { method: 'POST', body: '{}' });
      block.innerHTML = `
        <div class="qr-wrap"><img src="${qr.qr_data_url}" alt="QR Code para envio de documentos"></div>
        <div class="text-center text-secondary">Escaneie o QR Code para enviar novamente o documento correto. A tela atualiza automaticamente.</div>`;
    } catch (error) {
      block.innerHTML = `<div class="alert alert-danger mb-0">${error.message}</div>`;
    }
  }

  async function refreshBundle(reservationId) {
    const fresh = await requestJson(`/api/reservations/${reservationId}`);
    latestBundle = fresh;
    updateDocumentScreen(fresh);
    renderWarning(fresh);
    return fresh;
  }

  function startKioskPoll(reservationId) {
    stopKioskPoll();
    kioskPoll = setInterval(async () => {
      if (!isDocumentScreen()) return stopKioskPoll();
      try {
        const fresh = await refreshBundle(reservationId);
        if (fresh.documents?.every(doc => doc.status === 'received')) stopKioskPoll();
      } catch (_) {}
    }, 3000);
  }

  async function removeDocument(doc, button) {
    const reservationId = latestBundle?.reservation?.id;
    if (!reservationId) return;
    if (!window.confirm('Remover este documento? Ele voltará para Pendente e o hóspede poderá enviar o arquivo correto.')) return;

    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Removendo...';
    try {
      await requestJson(`/api/reservations/${reservationId}/documents/${doc.id}`, { method: 'DELETE' });
      const fresh = await refreshBundle(reservationId);
      await ensureUploadQr(reservationId);
      startKioskPoll(reservationId);

      const toastBody = document.getElementById('toastBody');
      if (toastBody) toastBody.textContent = 'Documento removido. O hóspede pode enviar novamente o arquivo correto.';

      if (fresh.documents?.every(item => item.status === 'received')) stopKioskPoll();
    } catch (error) {
      button.disabled = false;
      button.innerHTML = '<i class="bi bi-trash3 me-1"></i>Remover';
      window.alert(error.message);
    }
  }

  function decorate() {
    if (decorating || !latestBundle || !isDocumentScreen()) return;
    decorating = true;
    try { updateDocumentScreen(latestBundle); } finally { decorating = false; }
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = String(args[1]?.method || 'GET').toUpperCase();
      if (response.ok && method === 'GET' && /\/api\/reservations\/\d+\/?$/.test(url)) {
        const bundle = await response.clone().json();
        latestBundle = bundle;
        renderWarning(bundle);
        setTimeout(decorate, 100);
      }
    } catch (_) {
      // O monitor nunca deve interferir no fluxo principal do totem.
    }
    return response;
  };

  const app = document.getElementById('app');
  if (app) new MutationObserver(() => setTimeout(decorate, 30)).observe(app, { childList: true, subtree: true });
})();
