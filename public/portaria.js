(() => {
  const card = document.getElementById('gateCard');
  const token = new URLSearchParams(location.search).get('token') || '';
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));

  async function request(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'Não foi possível validar a autorização.');
      error.data = data;
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function renderInvalid(message, icon = 'bi-x-octagon-fill') {
    card.className = 'gate-card gate-invalid';
    card.innerHTML = `<div class="gate-status-icon"><i class="bi ${icon}"></i></div><h1>SAÍDA NÃO AUTORIZADA</h1><p>${esc(message)}</p><div class="gate-instruction">Não permita a saída e encaminhe o hóspede à recepção.</div>`;
  }

  function renderUsed(data) {
    card.className = 'gate-card gate-used';
    card.innerHTML = `<div class="gate-status-icon"><i class="bi bi-shield-exclamation"></i></div><h1>AUTORIZAÇÃO JÁ UTILIZADA</h1><p>Este QR Code já foi confirmado anteriormente.</p><div class="gate-details"><div><span>Comprovante</span><strong>${esc(data.receipt_number || '—')}</strong></div><div><span>Validado em</span><strong>${esc(data.consumed_at || '—')}</strong></div></div><div class="gate-instruction">Em caso de dúvida, confirme com a recepção antes de liberar nova saída.</div>`;
  }

  function renderValid(data) {
    card.className = 'gate-card gate-valid';
    card.innerHTML = `
      <div class="gate-status-icon"><i class="bi bi-shield-check"></i></div>
      <h1>AUTORIZAÇÃO VÁLIDA</h1>
      <p class="gate-lead">Confira os dados e confirme a saída somente quando o hóspede estiver na portaria.</p>
      <div class="gate-details">
        <div><span>Comprovante</span><strong>${esc(data.receipt_number)}</strong></div>
        <div><span>Reserva</span><strong>${esc(data.reservation_number)}</strong></div>
        <div><span>UH</span><strong>${esc(data.room_number || '—')}</strong></div>
        <div><span>Titular</span><strong>${esc(data.responsible_name)}</strong></div>
        <div><span>Check-in</span><strong>${esc(data.checkin_date || '—')}</strong></div>
        <div><span>Check-out</span><strong>${esc(data.checkout_date || '—')}</strong></div>
      </div>
      <button class="btn btn-success gate-confirm" id="confirmExit"><i class="bi bi-check2-circle me-2"></i>CONFIRMAR SAÍDA</button>
      <div class="gate-note"><i class="bi bi-lock-fill me-1"></i>O QR Code possui assinatura digital e a confirmação é registrada no servidor.</div>`;

    document.getElementById('confirmExit').onclick = async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Confirmando...';
      try {
        const result = await request(`/api/public/exit/${encodeURIComponent(token)}/consume`, { method: 'POST', body: '{}' });
        card.className = 'gate-card gate-confirmed';
        card.innerHTML = `<div class="gate-status-icon"><i class="bi bi-check-circle-fill"></i></div><h1>SAÍDA CONFIRMADA</h1><p>Autorização registrada com sucesso.</p><div class="gate-details"><div><span>Comprovante</span><strong>${esc(result.receipt_number)}</strong></div><div><span>Horário</span><strong>${esc(result.consumed_at)}</strong></div></div>`;
      } catch (error) {
        if (error.data?.status === 'used') renderUsed(error.data);
        else renderInvalid(error.message);
      }
    };
  }

  async function init() {
    if (!token) return renderInvalid('QR Code sem token de autorização.');
    try {
      const data = await request(`/api/public/exit/${encodeURIComponent(token)}`);
      if (data.status === 'used') return renderUsed(data);
      if (data.status !== 'active' || !data.valid) return renderInvalid('Autorização inválida ou expirada.');
      renderValid(data);
    } catch (error) {
      if (error.data?.status === 'used') return renderUsed(error.data);
      renderInvalid(error.message, error.status === 410 ? 'bi-clock-history' : 'bi-x-octagon-fill');
    }
  }

  fetch('/api/config', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(config => {
    if (config?.logo_url) document.getElementById('gateLogo').src = config.logo_url;
  }).catch(() => {});
  init();
})();
