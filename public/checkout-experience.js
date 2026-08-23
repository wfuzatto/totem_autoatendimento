(() => {
  const app = document.getElementById('app');
  if (!app) return;

  const nativeFetch = window.fetch.bind(window);
  let lastCheckout = null;
  let handled = false;

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));

  function mediaUrl(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url, window.location.origin);
      if (/\/api\/branding\/checkout-ad$/i.test(parsed.pathname)) parsed.pathname = '/api/v2/media/checkout-ad';
      parsed.protocol = window.location.protocol;
      parsed.host = window.location.host;
      return parsed.href;
    } catch (_) {
      return '/api/v2/media/checkout-ad';
    }
  }

  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = String(args[1]?.method || 'GET').toUpperCase();
      const match = url.match(/\/api\/reservations\/(\d+)\/checkout(?:\?|$)/);
      if (response.ok && method === 'POST' && match) {
        const finalize = await nativeFetch(`/api/checkout/${match[1]}/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        });
        const payload = await finalize.json().catch(() => ({}));
        lastCheckout = finalize.ok ? payload : { error: payload.error || 'Não foi possível gerar a autorização de saída.' };
      }
    } catch (error) {
      lastCheckout = { error: error.message || 'Falha ao gerar autorização de saída.' };
    }
    return response;
  };

  async function checkoutConfig() {
    try {
      const response = await nativeFetch('/api/checkout/config', { cache: 'no-store' });
      if (!response.ok) return {};
      return await response.json();
    } catch (_) {
      return {};
    }
  }

  function showAdvertisement(url, seconds = 30) {
    const safeUrl = mediaUrl(url);
    if (!safeUrl) {
      setTimeout(() => location.reload(), 8000);
      return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'checkout-ad-overlay';
    overlay.innerHTML = `
      <img src="${esc(safeUrl)}" class="checkout-ad-image" alt="Mensagem do Hotel Fazenda Vale da Mantiqueira">
      <div class="checkout-ad-footer">
        <span>Obrigado pela estadia!</span>
        <span>Retornando ao início em <strong id="checkoutAdCountdown">${Number(seconds) || 30}</strong>s</span>
      </div>`;
    document.body.appendChild(overlay);

    let remaining = Number(seconds) || 30;
    const countdown = document.getElementById('checkoutAdCountdown');
    const timer = setInterval(() => {
      remaining -= 1;
      if (countdown) countdown.textContent = String(Math.max(0, remaining));
      if (remaining <= 0) {
        clearInterval(timer);
        location.reload();
      }
    }, 1000);
  }

  async function renderEnhancedSuccess() {
    if (handled) return;
    handled = true;
    const config = await checkoutConfig();
    const authorization = lastCheckout?.authorization;
    const print = authorization?.print;
    const printingOk = print?.ok !== false;
    const simulated = print?.mode === 'mock';
    const printMessage = !printingOk
      ? '<span class="status-pill status-pending"><i class="bi bi-exclamation-triangle-fill"></i> Impressora indisponível — apresente o QR Code abaixo na portaria</span>'
      : simulated
        ? '<span class="status-pill status-pending"><i class="bi bi-info-circle-fill"></i> Guia gerada em modo simulado — ative ESC/POS nas configurações para impressão real</span>'
        : '<span class="status-pill status-ok"><i class="bi bi-check-circle-fill"></i> Guia impressa na POS 80 mm</span>';

    app.innerHTML = `
      <section class="panel-card checkout-complete-screen">
        <div class="success-icon"><i class="bi bi-check-lg"></i></div>
        <h1>Check-out efetuado com sucesso</h1>
        <p class="lead text-secondary">Obrigado por se hospedar conosco. Esperamos receber você novamente em breve.</p>

        ${authorization ? `
          <div class="checkout-exit-card ${printingOk ? '' : 'checkout-print-warning'}">
            <div>
              <div class="checkout-exit-title"><i class="bi bi-printer-fill me-2"></i>Autorização de saída</div>
              <div class="text-secondary">Comprovante <strong>${esc(authorization.receipt_number)}</strong></div>
              <div class="mt-2">${printMessage}</div>
            </div>
            <img class="checkout-exit-qr" src="${esc(authorization.qr_data_url)}" alt="QR Code da autorização de saída">
          </div>` : `
          <div class="alert alert-warning mt-4"><i class="bi bi-exclamation-triangle-fill me-2"></i>${esc(lastCheckout?.error || 'Não foi possível gerar a guia de autorização de saída. Procure a recepção.')}</div>`}

        <div class="checkout-next-message mt-4">
          <i class="bi bi-image me-2"></i>A mensagem do hotel será exibida em instantes.
        </div>
      </section>`;

    setTimeout(() => showAdvertisement(config.ad_url || lastCheckout?.advertisement?.url, config.ad_duration_seconds || 30), 6500);
  }

  const observer = new MutationObserver(() => {
    if (handled || !lastCheckout) return;
    const text = (app.innerText || '').toLowerCase();
    if (/check-?out\s+(conclu[ií]do|efetuado)/i.test(text)) renderEnhancedSuccess();
  });
  observer.observe(app, { childList: true, subtree: true, characterData: true });
})();