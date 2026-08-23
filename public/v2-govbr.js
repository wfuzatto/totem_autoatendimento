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

  function mobileMethod(config) {
    if (!config.govbr_qr_url) {
      return `<section class="govbr-method-card govbr-method-mobile">
        <div class="govbr-method-heading"><span class="govbr-method-number">1</span><div><strong>Usar meu celular</strong><small>Leia o QR Code com a câmera do celular</small></div></div>
        <div class="alert alert-warning govbr-qr-missing mb-0"><i class="bi bi-exclamation-triangle-fill me-2"></i>QR Code gov.br ainda não configurado. Um administrador deve enviar a imagem em Configurações.</div>
      </section>`;
    }
    return `<section class="govbr-method-card govbr-method-mobile">
      <div class="govbr-method-heading"><span class="govbr-method-number">1</span><div><strong>Usar meu celular</strong><small>Leia o QR Code com a câmera do celular</small></div></div>
      <div class="govbr-hotel-qr" id="govbrHotelQr">
        <div class="govbr-qr-frame"><img src="${esc(config.govbr_qr_url)}" alt="QR Code para check-in e autenticação gov.br do hotel"></div>
        <div class="govbr-qr-help">Abra a câmera do celular, leia o QR Code e conclua a autenticação no fluxo gov.br do hotel.</div>
      </div>
    </section>`;
  }

  function kioskMethod(config) {
    if (!config.govbr_hotel_url) {
      return `<section class="govbr-method-card govbr-method-kiosk">
        <div class="govbr-method-heading"><span class="govbr-method-number">2</span><div><strong>Usar este totem</strong><small>Faça a autenticação sem usar outro aparelho</small></div></div>
        <div class="alert alert-warning mb-0"><i class="bi bi-link-45deg me-2"></i>Link gov.br do hotel ainda não configurado. Informe o endereço HTTPS nas Configurações.</div>
      </section>`;
    }

    return `<section class="govbr-method-card govbr-method-kiosk">
      <div class="govbr-method-heading"><span class="govbr-method-number">2</span><div><strong>Usar este totem</strong><small>Faça a autenticação diretamente abaixo</small></div></div>
      <div class="govbr-iframe-shell">
        <div class="govbr-iframe-toolbar">
          <div><i class="bi bi-shield-lock-fill me-2"></i>Ambiente gov.br do hotel</div>
          <a class="btn btn-outline-primary btn-sm" href="${esc(config.govbr_hotel_url)}" target="_blank" rel="noopener noreferrer"><i class="bi bi-box-arrow-up-right me-1"></i>Abrir em nova janela</a>
        </div>
        <iframe
          id="govbrHotelFrame"
          class="govbr-hotel-iframe"
          src="${esc(config.govbr_hotel_url)}"
          title="Autenticação gov.br do hotel"
          loading="eager"
          referrerpolicy="strict-origin-when-cross-origin"
          allow="clipboard-read; clipboard-write">
        </iframe>
      </div>
      <div class="govbr-frame-help"><i class="bi bi-info-circle me-1"></i>Se o portal não aparecer dentro do quadro, use <strong>Abrir em nova janela</strong>. Alguns serviços gov.br impedem abertura em iframe por política de segurança.</div>
    </section>`;
  }

  async function decorateGovbrScreen() {
    if (!isGovbrScreen()) return;
    let config;
    try { config = await loadConfig(); } catch (_) { return; }
    if (!isGovbrScreen()) return;

    const scanBox = document.querySelector('#app .scan-box');
    if (!scanBox || scanBox.dataset.govbrV2Decorated === '1') return;

    const button = document.getElementById('govBtn');
    const verified = Boolean(button?.textContent?.toLowerCase().includes('concluída'));
    const buttonHolder = document.createElement('div');
    if (button) buttonHolder.appendChild(button);

    scanBox.dataset.govbrV2Decorated = '1';
    scanBox.classList.add('govbr-auth-box');
    scanBox.innerHTML = `
      <div class="govbr-auth-intro">
        <i class="bi bi-shield-check scan-icon"></i>
        <h2 class="h4 fw-bold mt-3">Escolha como deseja autenticar</h2>
        <p class="text-secondary mb-0">Você pode continuar pelo seu celular ou realizar a autenticação diretamente neste totem.</p>
      </div>
      <div class="govbr-methods">
        ${mobileMethod(config)}
        ${kioskMethod(config)}
      </div>
      <div id="govbrVerificationAction" class="govbr-verification-action"></div>`;

    const action = document.getElementById('govbrVerificationAction');
    if (button && action) {
      if (!verified) button.innerHTML = '<i class="bi bi-check2-circle me-2"></i>Simular confirmação gov.br (MVP)';
      action.appendChild(button);
      const status = document.createElement('div');
      status.className = verified ? 'alert alert-success mt-3 mb-0' : 'form-text mt-2';
      status.innerHTML = verified
        ? '<i class="bi bi-check-circle-fill me-2"></i>Autenticação gov.br registrada. Você pode avançar.'
        : 'Enquanto a integração oficial de retorno não estiver conectada, o botão acima simula a confirmação para permitir os testes da V2.';
      action.appendChild(status);
    }
  }

  function adminToken() {
    return sessionStorage.getItem('totem-admin-token') || '';
  }

  async function adminJson(url, options = {}) {
    const token = adminToken();
    if (!token) throw new Error('Sessão administrativa expirada. Feche e abra as configurações novamente.');
    const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
    if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, { ...options, headers });
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
      const urlInput = document.getElementById('govbrHotelUrl');
      if (urlInput && document.activeElement !== urlInput) urlInput.value = data.govbr_hotel_url || '';
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
  }

  async function removeGovbrQr() {
    await adminJson('/api/admin/v2/govbr-qr', { method: 'DELETE' });
    govbrConfig = null;
    await loadConfig(true);
    const status = document.getElementById('govbrQrAdminStatus');
    if (status) { status.className = 'form-text text-success mt-2'; status.textContent = 'QR Code gov.br removido.'; }
    await renderAdminPreview();
  }

  async function saveGovbrUrl() {
    const input = document.getElementById('govbrHotelUrl');
    const status = document.getElementById('govbrUrlAdminStatus');
    if (!input) return;
    const value = input.value.trim();
    if (value) {
      try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'https:') throw new Error();
      } catch (_) {
        throw new Error('Informe um endereço HTTPS válido, por exemplo https://hotel.exemplo.gov.br/checkin.');
      }
    }
    if (status) { status.className = 'form-text text-primary mt-2'; status.textContent = 'Salvando link...'; }
    const data = await adminJson('/api/admin/v2/govbr-settings', {
      method: 'PUT',
      body: JSON.stringify({ govbr_hotel_url: value })
    });
    govbrConfig = null;
    await loadConfig(true);
    if (status) {
      status.className = 'form-text text-success mt-2';
      status.textContent = data.govbr_hotel_url ? 'Link gov.br salvo. O iframe usará este endereço.' : 'Link removido. O iframe ficará desativado.';
    }
    await renderAdminPreview();
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
        <h3><i class="bi bi-shield-check me-2"></i>Autenticação gov.br do hotel</h3>
        <div class="row g-4 align-items-start">
          <div class="col-lg-7">
            <div class="govbr-admin-group">
              <label class="form-label fw-bold" for="govbrHotelUrl">Link gov.br do hotel</label>
              <input id="govbrHotelUrl" type="url" inputmode="url" class="form-control touch-input" placeholder="https://..." autocomplete="off">
              <div class="form-text">Este endereço HTTPS será aberto dentro do iframe na Etapa 4. Use o link exato do fluxo de check-in/autenticação do hotel.</div>
              <button type="button" class="btn btn-primary mt-3" id="saveGovbrUrl"><i class="bi bi-link-45deg me-2"></i>Salvar link gov.br</button>
              <div id="govbrUrlAdminStatus" class="form-text mt-2"></div>
            </div>

            <hr class="my-4">

            <div class="govbr-admin-group">
              <label class="form-label fw-bold">QR Code para usar pelo celular</label>
              <p class="text-secondary mb-3">Envie a imagem do QR Code que direciona ao mesmo fluxo gov.br do hotel. Ela será mostrada como a opção “Usar meu celular”.</p>
              <button type="button" class="btn btn-primary btn-lg" id="selectGovbrQr"><i class="bi bi-upload me-2"></i>Enviar/trocar QR Code</button>
              <button type="button" class="btn btn-outline-danger btn-lg ms-2" id="removeGovbrQr" hidden><i class="bi bi-trash me-2"></i>Remover</button>
              <input type="file" id="govbrQrInput" accept="image/png,image/jpeg,image/webp" hidden>
              <div id="govbrQrAdminStatus" class="form-text mt-2">Preferencialmente envie o QR Code original em alta resolução, sem recortes ou alterações.</div>
            </div>
          </div>
          <div class="col-lg-5">
            <div class="form-label fw-bold">Prévia do QR Code</div>
            <button type="button" class="govbr-admin-preview" id="govbrQrAdminPreview" aria-label="Prévia do QR Code gov.br. Clique para enviar ou trocar."></button>
          </div>
        </div>`;
      body.appendChild(section);

      const input = document.getElementById('govbrQrInput');
      document.getElementById('selectGovbrQr').onclick = () => input.click();
      document.getElementById('govbrQrAdminPreview').onclick = () => input.click();
      document.getElementById('saveGovbrUrl').onclick = () => saveGovbrUrl().catch(error => {
        const status = document.getElementById('govbrUrlAdminStatus');
        status.className = 'form-text text-danger mt-2';
        status.textContent = error.message;
      });
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
