(() => {
  const app = document.getElementById('app');
  if (!app) return;

  let cachedConfig = null;
  let loadingConfig = null;

  function mediaUrl(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url, window.location.origin);
      if (/\/api\/branding\/checkout-ad$/i.test(parsed.pathname)) parsed.pathname = '/api/v2/media/checkout-ad';
      parsed.protocol = window.location.protocol;
      parsed.host = window.location.host;
      return parsed.href;
    } catch (_) {
      return `${window.location.origin}/api/v2/media/checkout-ad`;
    }
  }

  async function getConfig() {
    if (cachedConfig) return cachedConfig;
    if (!loadingConfig) {
      loadingConfig = fetch('/api/checkout/config', { cache: 'no-store' })
        .then(async response => response.ok ? response.json() : {})
        .catch(() => ({}))
        .then(config => {
          cachedConfig = config;
          return config;
        });
    }
    return loadingConfig;
  }

  async function decorateCheckinSuccess() {
    const screen = app.querySelector('[data-v2-checkin-sequence="success"]');
    const button = screen?.querySelector('#v2FinishHome');
    if (!screen || !button || screen.querySelector('[data-v2-final-ad]')) return;

    const slot = document.createElement('div');
    slot.className = 'v2-final-ad-slot is-loading';
    slot.dataset.v2FinalAd = 'checkin';
    slot.innerHTML = '<div><span class="spinner-border spinner-border-sm me-2"></span>Carregando mensagem do hotel...</div>';
    button.insertAdjacentElement('afterend', slot);

    const config = await getConfig();
    const url = mediaUrl(config.ad_url);
    if (!url) {
      slot.remove();
      return;
    }

    slot.classList.remove('is-loading');
    slot.innerHTML = `<img src="${url}" alt="Mensagem do Hotel Fazenda Vale da Mantiqueira após o check-in">`;
    const image = slot.querySelector('img');
    image.addEventListener('error', () => slot.classList.add('is-error'), { once: true });
  }

  const observer = new MutationObserver(() => {
    queueMicrotask(() => decorateCheckinSuccess().catch(() => {}));
  });
  observer.observe(app, { childList: true, subtree: true });
  decorateCheckinSuccess().catch(() => {});
})();
