(() => {
  let injecting = false;

  async function api(url, options = {}) {
    const token = sessionStorage.getItem('totem-admin-token');
    if (!token) throw new Error('Sessão administrativa expirada.');
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
    return data;
  }

  async function renderPreview() {
    const preview = document.getElementById('checkoutAdPreview');
    if (!preview) return;
    try {
      const data = await api('/api/admin/checkout-settings');
      preview.innerHTML = data.ad_url
        ? `<img src="${data.ad_url}" alt="Propaganda atual do checkout"><div class="checkout-ad-admin-overlay"><i class="bi bi-cloud-arrow-up-fill"></i><span>Clique para trocar o PNG</span></div>`
        : '<div class="checkout-ad-empty"><i class="bi bi-image"></i><strong>Enviar propaganda PNG</strong><small>Será exibida por 30 segundos após o checkout.</small></div>';
      const remove = document.getElementById('removeCheckoutAd');
      if (remove) remove.hidden = !data.ad_url;
    } catch (error) {
      preview.innerHTML = `<div class="text-danger p-3">${error.message}</div>`;
    }
  }

  async function upload(file) {
    if (!file) return;
    if (file.type !== 'image/png') throw new Error('A propaganda deve ser um arquivo PNG.');
    if (file.size > 20 * 1024 * 1024) throw new Error('A propaganda deve ter no máximo 20 MB.');
    const status = document.getElementById('checkoutAdStatus');
    if (status) { status.className = 'form-text text-primary mt-2'; status.textContent = 'Enviando propaganda...'; }
    const form = new FormData();
    form.append('ad', file);
    await api('/api/admin/branding/checkout-ad', { method: 'POST', body: form });
    if (status) { status.className = 'form-text text-success mt-2'; status.textContent = 'Propaganda atualizada. Ela será exibida por 30 segundos após o checkout.'; }
    await renderPreview();
  }

  async function removeAd() {
    await api('/api/admin/branding/checkout-ad', { method: 'DELETE' });
    const status = document.getElementById('checkoutAdStatus');
    if (status) { status.className = 'form-text text-success mt-2'; status.textContent = 'Propaganda removida.'; }
    await renderPreview();
  }

  function inject() {
    if (injecting) return;
    const body = document.getElementById('adminBody');
    if (!body || !body.children.length || body.querySelector('[data-checkout-ad-section]')) return;
    injecting = true;
    try {
      const section = document.createElement('div');
      section.className = 'admin-section';
      section.dataset.checkoutAdSection = '1';
      section.innerHTML = `
        <h3><i class="bi bi-badge-ad me-2"></i>Mensagem após o checkout</h3>
        <div class="row g-3 align-items-center">
          <div class="col-lg-7">
            <label class="form-label">Propaganda pós-checkout</label>
            <p class="text-secondary mb-3">Após a confirmação e emissão da autorização de saída, esta arte PNG ocupará a tela por <strong>30 segundos</strong> e depois o totem voltará automaticamente ao início.</p>
            <button type="button" class="btn btn-primary btn-lg" id="selectCheckoutAd"><i class="bi bi-upload me-2"></i>Enviar/trocar PNG</button>
            <button type="button" class="btn btn-outline-danger btn-lg ms-2" id="removeCheckoutAd" hidden><i class="bi bi-trash me-2"></i>Remover</button>
            <input type="file" id="checkoutAdInput" accept="image/png" hidden>
            <div id="checkoutAdStatus" class="form-text mt-2">Use preferencialmente uma arte vertical na proporção da tela do totem.</div>
          </div>
          <div class="col-lg-5">
            <button type="button" class="checkout-ad-admin-preview" id="checkoutAdPreview" aria-label="Prévia da propaganda. Clique para enviar ou trocar."></button>
          </div>
        </div>`;
      body.appendChild(section);

      const input = document.getElementById('checkoutAdInput');
      document.getElementById('selectCheckoutAd').onclick = () => input.click();
      document.getElementById('checkoutAdPreview').onclick = () => input.click();
      document.getElementById('removeCheckoutAd').onclick = () => removeAd().catch(error => {
        document.getElementById('checkoutAdStatus').textContent = error.message;
      });
      input.onchange = () => upload(input.files?.[0]).catch(error => {
        const status = document.getElementById('checkoutAdStatus');
        status.className = 'form-text text-danger mt-2';
        status.textContent = error.message;
      }).finally(() => { input.value = ''; });
      renderPreview();
    } finally {
      injecting = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const body = document.getElementById('adminBody');
    if (body) new MutationObserver(inject).observe(body, { childList: true });
    document.getElementById('adminModal')?.addEventListener('shown.bs.modal', inject);
  });
})();
