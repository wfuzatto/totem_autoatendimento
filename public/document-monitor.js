(() => {
  const originalFetch = window.fetch.bind(window);

  function guestName(bundle, guestId) {
    return bundle.guests?.find(guest => guest.id === guestId)?.name || 'hóspede';
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

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = String(args[1]?.method || 'GET').toUpperCase();
      if (response.ok && method === 'GET' && /\/api\/reservations\/\d+\/?$/.test(url)) {
        const bundle = await response.clone().json();
        renderWarning(bundle);
      }
    } catch (_) {
      // O monitor nunca deve interferir no fluxo principal do totem.
    }
    return response;
  };
})();
