(() => {
  const FALLBACK_LOGO = '/assets/skins/vale-mantiqueira/logo.jpg';
  const SKINS = {
    vale_mantiqueira: {
      label: 'Vale da Mantiqueira',
      description: 'Identidade oficial do Hotel Fazenda Vale da Mantiqueira',
      themeColor: '#006b3c',
      logo: FALLBACK_LOGO,
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
  let runtimeSaving = false;

  // O app principal guarda a sessão administrativa em memória. Como o tema é
  // carregado antes dele, capturamos de forma transparente o token retornado
  // pelo login para permitir upload de logo e configurações visuais protegidas.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input?.url || '';
      if (response.ok && /\/api\/admin\/login(?:\?|$)/.test(url)) {
        const payload = await response.clone().json();
        if (payload?.token) sessionStorage.setItem('totem-admin-token', payload.token);
      }
    } catch (_) {}
    return response;
  };

  function normalizeSkin(name) {
    return Object.prototype.hasOwnProperty.call(SKINS, name) ? name : 'vale_mantiqueira';
  }

  function activeLogo() {
    return config?.logo_url || FALLBACK_LOGO;
  }

  function applySkin(name, persistLocal = true) {
    const skinName = normalizeSkin(name);
    const skin = SKINS[skinName];
    document.body.dataset.skin = skinName;
    if (persistLocal) localStorage.setItem('totem-theme-skin', skinName);

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', skin.themeColor);

    const logo = document.getElementById('brandLogo');
    if (logo && skinName === 'vale_mantiqueira') logo.src = activeLogo();

    document.dispatchEvent(new CustomEvent('totem:skin-changed', { detail: { skin: skinName } }));
  }

  function renderPreview(name) {
    const skinName = normalizeSkin(name);
    const skin = SKINS[skinName];
    const preview = document.getElementById('skinPreview');
    if (!preview) return;
    const logo = skinName === 'vale_mantiqueira' ? activeLogo() : null;
    preview.innerHTML = `
      <div class="skin-preview-head">
        ${logo
          ? `<img src="${logo}" class="skin-preview-logo" alt="Logomarca atual do hotel">`
          : '<div class="skin-preview-neutral"><i class="bi bi-grid-1x2-fill"></i></div>'}
        <div class="skin-upload-overlay"><i class="bi bi-cloud-arrow-up-fill"></i><span>${logo ? 'Clique para trocar a logo' : 'Enviar logo'}</span></div>
      </div>
      <div class="skin-preview-copy">
        <strong>${skin.label}</strong>
        <small>${skin.description}</small>
        <div class="skin-swatches" aria-hidden="true">
          ${skin.swatches.map(color => `<span style="--swatch:${color}"></span>`).join('')}
        </div>
      </div>`;
  }

  async function uploadLogo(file) {
    const token = sessionStorage.getItem('totem-admin-token');
    const status = document.getElementById('logoUploadStatus');
    if (!token) throw new Error('Sessão administrativa expirada. Feche e abra as configurações novamente.');
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use uma imagem JPG, PNG ou WEBP.');
    if (file.size > 5 * 1024 * 1024) throw new Error('A logomarca deve ter no máximo 5 MB.');

    if (status) { status.className = 'form-text text-primary'; status.textContent = 'Enviando logomarca...'; }
    const form = new FormData();
    form.append('logo', file);
    const response = await fetch('/api/admin/branding/logo', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível enviar a logomarca.');
    if (status) { status.className = 'form-text text-success'; status.textContent = 'Logomarca atualizada com sucesso.'; }
    await refreshConfig();
    renderPreview(document.getElementById('themeSkinSelect')?.value || 'vale_mantiqueira');
  }

  function validatePublicUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return true;
    try {
      const parsed = new URL(raw);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch (_) {
      return false;
    }
  }

  async function saveRuntimeSettings() {
    if (runtimeSaving) return true;
    const input = document.getElementById('publicQrBaseUrl');
    if (!input) return true;
    const feedback = document.getElementById('publicQrBaseUrlFeedback');
    const value = input.value.trim();
    if (!validatePublicUrl(value)) {
      input.classList.add('is-invalid');
      if (feedback) { feedback.className = 'invalid-feedback d-block'; feedback.textContent = 'Informe uma URL completa iniciando com http:// ou https://.'; }
      return false;
    }

    const token = sessionStorage.getItem('totem-admin-token');
    if (!token) return false;
    runtimeSaving = true;
    try {
      const response = await fetch('/api/admin/runtime-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ public_qr_base_url: value })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível salvar a URL pública.');
      input.classList.remove('is-invalid');
      if (feedback) { feedback.className = 'form-text text-success'; feedback.textContent = value ? 'URL pública salva. Os próximos QR Codes usarão este endereço.' : 'Modo local: o endereço do próprio totem será usado.'; }
      if (config) config.public_qr_base_url = data.public_qr_base_url || '';
      return true;
    } catch (error) {
      input.classList.add('is-invalid');
      if (feedback) { feedback.className = 'invalid-feedback d-block'; feedback.textContent = error.message; }
      return false;
    } finally {
      runtimeSaving = false;
    }
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
              ${Object.entries(SKINS).map(([value, skin]) => `<option value="${value}" ${value === current ? 'selected' : ''}>${skin.label}</option>`).join('')}
            </select>
            <div class="form-text mt-2">A skin altera a identidade visual sem modificar os fluxos de check-in/check-out. A logomarca enviada é usada sem recoloração ou redesenho.</div>

            <label class="form-label mt-4" for="publicQrBaseUrl">URL pública para os QR Codes</label>
            <input id="publicQrBaseUrl" class="form-control touch-input" value="${String(config?.public_qr_base_url || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;')}" placeholder="https://checkin.valedamantiqueira.com.br">
            <div id="publicQrBaseUrlFeedback" class="form-text">Deixe vazio para usar o IP/endereço local do totem. Preencha quando o envio de documentos estiver publicado em um domínio acessível pelo celular.</div>
          </div>
          <div class="col-lg-5">
            <button type="button" class="skin-preview skin-preview-upload" id="skinPreview" aria-label="Prévia da skin. Clique para enviar ou trocar a logomarca."></button>
            <input id="logoUploadInput" type="file" accept="image/jpeg,image/png,image/webp" hidden>
            <div id="logoUploadStatus" class="form-text text-center mt-2">Clique na logomarca para enviar ou substituir o arquivo.</div>
          </div>
        </div>`;

      adminBody.prepend(section);
      renderPreview(current);

      const select = document.getElementById('themeSkinSelect');
      select?.addEventListener('change', () => {
        applySkin(select.value);
        renderPreview(select.value);
      });

      const logoInput = document.getElementById('logoUploadInput');
      document.getElementById('skinPreview')?.addEventListener('click', () => logoInput?.click());
      logoInput?.addEventListener('change', async () => {
        try { await uploadLogo(logoInput.files?.[0]); }
        catch (error) {
          const status = document.getElementById('logoUploadStatus');
          if (status) { status.className = 'form-text text-danger text-center mt-2'; status.textContent = error.message; }
        } finally { logoInput.value = ''; }
      });
      document.getElementById('publicQrBaseUrl')?.addEventListener('change', saveRuntimeSettings);
    } finally {
      observerBusy = false;
    }
  }

  async function refreshConfig() {
    try {
      const response = await fetch('/api/config', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      config = await response.json();
      SKINS.vale_mantiqueira.logo = config.logo_url || FALLBACK_LOGO;
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
    if (adminBody) new MutationObserver(() => injectAdminTheme()).observe(adminBody, { childList: true });

    const adminModal = document.getElementById('adminModal');
    if (adminModal) {
      adminModal.addEventListener('shown.bs.modal', injectAdminTheme);
      adminModal.addEventListener('hidden.bs.modal', refreshConfig);
    }

    const saveButton = document.getElementById('saveSettingsBtn');
    if (saveButton) {
      saveButton.addEventListener('click', async event => {
        const input = document.getElementById('publicQrBaseUrl');
        if (input && !validatePublicUrl(input.value)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          await saveRuntimeSettings();
          return;
        }
        await saveRuntimeSettings();
        const selected = document.getElementById('themeSkinSelect')?.value;
        if (selected) applySkin(selected);
        setTimeout(refreshConfig, 350);
      }, true);
    }
  });

  window.totemTheme = { applySkin, refreshConfig, skins: SKINS };
})();
