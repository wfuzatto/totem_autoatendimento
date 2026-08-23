(() => {
  const SKINS = {
    vale_mantiqueira: {
      label: 'Vale da Mantiqueira',
      description: 'Identidade oficial do Hotel Fazenda Vale da Mantiqueira',
      themeColor: '#006b3c',
      logo: '/assets/skins/vale-mantiqueira/logo.jpg',
      swatches: ['#006b3c', '#73b842', '#f6c515']
    },
    neutral: {
      label: 'Neutro',
      description: 'Tema técnico sem identidade específica de hotel',
      themeColor: '#0d6efd',
      logo: null,
      swatches: ['#0d6efd', '#4c8dff', '#9cc3ff']
    }
  };

  let config = null;
  let observerBusy = false;

  function normalizeSkin(name) {
    return Object.prototype.hasOwnProperty.call(SKINS, name) ? name : 'vale_mantiqueira';
  }

  function applySkin(name, persistLocal = true) {
    const skinName = normalizeSkin(name);
    const skin = SKINS[skinName];
    document.body.dataset.skin = skinName;
    if (persistLocal) localStorage.setItem('totem-theme-skin', skinName);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', skin.themeColor);

    const logo = document.getElementById('brandLogo');
    if (logo && skin.logo) logo.src = skin.logo;

    document.dispatchEvent(new CustomEvent('totem:skin-changed', { detail: { skin: skinName } }));
  }

  function renderPreview(name) {
    const skinName = normalizeSkin(name);
    const skin = SKINS[skinName];
    const preview = document.getElementById('skinPreview');
    if (!preview) return;
    preview.innerHTML = `
      <div class="skin-preview-head">
        ${skin.logo
          ? `<img src="${skin.logo}" class="skin-preview-logo" alt="">`
          : '<div class="skin-preview-neutral"><i class="bi bi-grid-1x2-fill"></i></div>'}
      </div>
      <div class="skin-preview-copy">
        <strong>${skin.label}</strong>
        <small>${skin.description}</small>
        <div class="skin-swatches" aria-hidden="true">
          ${skin.swatches.map(color => `<span style="--swatch:${color}"></span>`).join('')}
        </div>
      </div>`;
  }

  function injectAdminTheme() {
    if (observerBusy) return;
    const adminBody = document.getElementById('adminBody');
    if (!adminBody || !adminBody.children.length || adminBody.querySelector('[data-theme-section]')) return;

    observerBusy = true;
    try {
      const current = normalizeSkin(config?.theme_skin || localStorage.getItem('totem-theme-skin'));
      const section = document.createElement('div');
      section.className = 'admin-section theme-admin-section';
      section.dataset.themeSection = '1';
      section.innerHTML = `
        <h3><i class="bi bi-palette me-2"></i>Identidade visual</h3>
        <div class="row g-3 align-items-stretch">
          <div class="col-lg-7">
            <label class="form-label" for="themeSkinSelect">Skin do totem</label>
            <select class="form-select touch-select" data-setting="theme_skin" id="themeSkinSelect">
              ${Object.entries(SKINS).map(([value, skin]) =>
                `<option value="${value}" ${value === current ? 'selected' : ''}>${skin.label}</option>`
              ).join('')}
            </select>
            <div class="form-text mt-2">
              A skin altera a identidade visual sem modificar os fluxos de check-in/check-out.
              A logomarca Vale da Mantiqueira é exibida no arquivo original, sem recoloração ou redesenho.
            </div>
          </div>
          <div class="col-lg-5">
            <div class="skin-preview" id="skinPreview" aria-label="Prévia da skin selecionada"></div>
          </div>
        </div>`;

      adminBody.prepend(section);
      renderPreview(current);

      const select = document.getElementById('themeSkinSelect');
      select?.addEventListener('change', () => {
        applySkin(select.value);
        renderPreview(select.value);
      });
    } finally {
      observerBusy = false;
    }
  }

  async function refreshConfig() {
    try {
      const response = await fetch('/api/config', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      config = await response.json();
      applySkin(config.theme_skin || localStorage.getItem('totem-theme-skin') || 'vale_mantiqueira', false);
      injectAdminTheme();
    } catch (_) {
      applySkin(localStorage.getItem('totem-theme-skin') || 'vale_mantiqueira', false);
    }
  }

  const initial = localStorage.getItem('totem-theme-skin') || 'vale_mantiqueira';
  if (document.body) applySkin(initial, false);

  document.addEventListener('DOMContentLoaded', () => {
    refreshConfig();

    const adminBody = document.getElementById('adminBody');
    if (adminBody) {
      new MutationObserver(() => injectAdminTheme())
        .observe(adminBody, { childList: true });
    }

    const adminModal = document.getElementById('adminModal');
    if (adminModal) {
      adminModal.addEventListener('shown.bs.modal', injectAdminTheme);
      adminModal.addEventListener('hidden.bs.modal', refreshConfig);
    }

    const saveButton = document.getElementById('saveSettingsBtn');
    if (saveButton) {
      saveButton.addEventListener('click', () => {
        const selected = document.getElementById('themeSkinSelect')?.value;
        if (selected) applySkin(selected);
        setTimeout(refreshConfig, 300);
      });
    }
  });

  window.totemTheme = { applySkin, refreshConfig, skins: SKINS };
})();
