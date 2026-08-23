(() => {
  let govbrConfig = null;
  let loadingConfig = null;
  let injectingAdmin = false;

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));

  async function json(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
    return data;
  }

  async function loadConfig(force = false) {
    if (govbrConfig && !force) return govbrConfig;
    if (loadingConfig && !force) return loadingConfig;
    loadingConfig = json('/api/v2/govbr-config', { cache: 'no-store' })
      .then(data => { govbrConfig = data; return data; })
      .finally(() => { loadingConfig = null; });
    return loadingConfig;
  }

  function isGovbrScreen() {
    const title = document.querySelector('#app .step-title')?.textContent?.trim().toLowerCase() || '';
    return title.includes('validação gov.br');
  }

  async function decorateGovbrScreen() {
    if (!isGovbrScreen()) return;
    let config;
    try { config = await loadConfig(); } catch (_) { return; }
    if (!isGovbrScreen()) return;

    const scanBox = document.querySelector('#app .scan-box');
    if (!scanBox) return;
    scanBox.querySelector('#govbrHotelQr')?.remove();
    scanBox.querySelector('#govbrQrMissing')?.remove();

    const paragraph = scanBox.querySelector('p.text-secondary');
    const button = document.getElementById('govBtn');
    const verified = Boolean(button?.textContent?.toLowerCase().includes('concluída'));

    if (config.govbr_qr_url) {
      const block = document.createElement('div');
      block.id = 'govbrHotelQr';
      block.className = 'govbr-hotel-qr';
      block.innerHTML = `
        <div class="govbr-qr-label"><i class="bi bi-qr-code me-2"></i>Escaneie com seu celular</div>
        <div class="govbr-qr-frame"><img src="${esc(config.govbr_qr_url)}" alt="QR Code para check-in e autenticação gov.br do hotel"></div>
        <div class="govbr-qr-help">Abra a câmera do celular, leia o QR Code e conclua a autenticação no fluxo gov.br do hotel.</div>`;
      if (paragraph) paragraph.before(block); else scanBox.appendChild(block);
      if (paragraph) paragraph.textContent = verified
        ? 'Autenticação registrada. Você pode avançar.'
        : 'Após concluir no celular, aguarde a confirmação no totem. No MVP, o botão abaixo simula o retorno positivo.';
    } else {
      const warning = document.createElement('div');
      warning.id = 'govbrQrMissing';
      warning.className = 'alert alert-warning govbr-qr-missing';
      warning.innerHTML = '<i class="bi bi-exclamation-triangle-fill me-2"></i>QR Code gov.br ainda não configurado. Um administrador deve enviar a imagem em Configurações.';
      if (paragraph) paragraph.before(warning); else scanBox.appendChild(warning);
    }

    if (button && !verified) {
      button.innerHTML = '<i class="bi bi-check2-circle me-2"></i>Simular confirmação gov.br (MVP)';
    }
  }

  function adminToken() {
    return sessionStorage.getItem('totem-admin-token') || '';
  }

  async function adminJson(url, options = {}) {
    const token = adminToken();
    if (!token) throw new Error('Sessão administrativa expirada. Feche e abra as configurações novamente.');
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
    return data;
  }

  async function renderAdminPreview() {
    const preview = document.getElementById('govbrQrAdminPreview');
    if (!preview) return;
    try {
      const data = await adminJson('/api/admin/v2/govbr-qr');
      preview.innerHTML = data.govbr_qr_url
        ? `<img src="${esc(data.govbr_qr_url)}" alt="QR Code gov.br configurado"><div class="govbr-admin-overlay"><i class="bi bi-cloud-arrow-up-fill"></i><span>Clique para trocar</span></div>`
        : '<div class="govbr-admin-empty"><i class="bi bi-qr-code"></i><strong>Enviar QR Code gov.br</strong><small>PNG, JPG ou WEBP</small></div>';
      const remove = document.getElementById('removeGovbrQr');
      if (remove) remove.hidden = !data.govbr_qr_url;
    } catch (error) {
      preview.innerHTML = `<div class="text-danger p-3">${esc(error.message)}</div>`;
    }
  }

  async function uploadGovbrQr(file) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Use uma imagem PNG, JPG ou WEBP.');
    if (file.size > 8 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 8 MB.');
    const status = document.getElementById('govbrQrAdminStatus');
    if (status) { status.className = 'form-text text-primary mt-2'; status.textContent = 'Enviando QR Code...'; }
    const form = new FormData();
    form.append('qr', file);
    await adminJson('/api/admin/v2/govbr-qr', { method: 'POST', body: form });
    govbrConfig = null;
    await loadConfig(true);
    if (status) { status.className = 'form-text text-success mt-2'; status.textContent = 'QR Code gov.br atualizado com sucesso.'; }
    await renderAdminPreview();
    decorateGovbrScreen();
  }

  async function removeGovbrQr() {
    await adminJson('/api/admin/v2/govbr-qr', { method: 'DELETE' });
    govbrConfig = null;
    await loadConfig(true);
    const status = document.getElementById('govbrQrAdminStatus');
    if (status) { status.className = 'form-text text-success mt-2'; status.textContent = 'QR Code gov.br removido.'; }
    await renderAdminPreview();
    decorateGovbrScreen();
  }

  function injectAdmin() {
    if (injectingAdmin) return;
    const body = document.getElementById('adminBody');
    if (!body || !body.children.length || body.querySelector('[data-v2-govbr-admin]')) return;
    injectingAdmin = true;
    try {
      const section = document.createElement('div');
      section.className = 'admin-section';
      section.dataset.v2GovbrAdmin = '1';
      section.innerHTML = `
        <h3><i class="bi bi-shield-check me-2"></i>QR Code gov.br do hotel</h3>
        <div class="row g-3 align-items-center">
          <div class="col-lg-7">
            <label class="form-label">QR Code do check-in gov.br</label>
            <p class="text-secondary mb-3">Envie a imagem do QR Code que direciona o hóspede ao fluxo gov.br do hotel. Ela será mostrada na Etapa 4 do check-in.</p>
            <button type="button" class="btn btn-primary btn-lg" id="selectGovbrQr"><i class="bi bi-upload me-2"></i>Enviar/trocar QR Code</button>
            <button type="button" class="btn btn-outline-danger btn-lg ms-2" id="removeGovbrQr" hidden><i class="bi bi-trash me-2"></i>Remover</button>
            <input type="file" id="govbrQrInput" accept="image/png,image/jpeg,image/webp" hidden>
            <div id="govbrQrAdminStatus" class="form-text mt-2">Preferencialmente envie o QR Code original em alta resolução, sem recortes ou alterações.</div>
          </div>
          <div class="col-lg-5">
            <button type="button" class="govbr-admin-preview" id="govbrQrAdminPreview" aria-label="Prévia do QR Code gov.br. Clique para enviar ou trocar."></button>
          </div>
        </div>`;
      body.appendChild(section);

      const input = document.getElementById('govbrQrInput');
      document.getElementById('selectGovbrQr').onclick = () => input.click();
      document.getElementById('govbrQrAdminPreview').onclick = () => input.click();
      document.getElementById('removeGovbrQr').onclick = () => removeGovbrQr().catch(error => {
        const status = document.getElementById('govbrQrAdminStatus');
        status.className = 'form-text text-danger mt-2';
        status.textContent = error.message;
      });
      input.onchange = () => uploadGovbrQr(input.files?.[0]).catch(error => {
        const status = document.getElementById('govbrQrAdminStatus');
        status.className = 'form-text text-danger mt-2';
        status.textContent = error.message;
      }).finally(() => { input.value = ''; });
      renderAdminPreview();
    } finally {
      injectingAdmin = false;
    }
  }

  loadConfig().catch(() => {});

  const app = document.getElementById('app');
  if (app) new MutationObserver(() => setTimeout(decorateGovbrScreen, 40)).observe(app, { childList: true, subtree: true });

  const adminBody = document.getElementById('adminBody');
  if (adminBody) new MutationObserver(() => setTimeout(injectAdmin, 30)).observe(adminBody, { childList: true, subtree: false });
  document.getElementById('adminModal')?.addEventListener('shown.bs.modal', () => setTimeout(injectAdmin, 30));
})();
