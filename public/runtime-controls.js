(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const featureState = {
    loading: true,
    keyboard: true,
    configLoaded: false
  };

  let loadingCount = 0;
  let loadingTimer = null;
  let loadingShownAt = 0;
  let activeInput = null;
  let keyboardUppercase = true;
  let adminEnhanceTimer = null;

  function html(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function ensureLoadingOverlay() {
    let overlay = document.getElementById('totemLoadingOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'totemLoadingOverlay';
    overlay.className = 'totem-loading-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="totem-loading-card" role="status" aria-live="polite">
        <div class="spinner-border" aria-hidden="true"></div>
        <strong>Aguarde...</strong>
        <span>Estamos preparando a próxima etapa.</span>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function shouldShowLoading(input, init = {}) {
    if (!featureState.loading) return false;
    const url = typeof input === 'string' ? input : (input?.url || '');
    const method = String(init.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase();
    const ignored = [
      '/api/access-control/card-status',
      '/api/access-control/status',
      '/api/health',
      '/api/config',
      '/api/admin/hardware'
    ];
    if (ignored.some(item => url.includes(item))) return false;
    if (/\/api\/reservations\/\d+\/documents(?:\?|$)/.test(url) && method === 'GET') return false;
    return url.includes('/api/');
  }

  function beginLoading() {
    loadingCount += 1;
    if (loadingCount !== 1 || loadingTimer || !featureState.loading) return;
    loadingTimer = window.setTimeout(() => {
      loadingTimer = null;
      if (!loadingCount || !featureState.loading) return;
      const overlay = ensureLoadingOverlay();
      loadingShownAt = Date.now();
      overlay.hidden = false;
    }, 250);
  }

  function endLoading() {
    loadingCount = Math.max(0, loadingCount - 1);
    if (loadingCount) return;
    if (loadingTimer) {
      clearTimeout(loadingTimer);
      loadingTimer = null;
    }
    const overlay = document.getElementById('totemLoadingOverlay');
    if (!overlay || overlay.hidden) return;
    const remaining = Math.max(0, 180 - (Date.now() - loadingShownAt));
    window.setTimeout(() => {
      if (!loadingCount) overlay.hidden = true;
    }, remaining);
  }

  window.fetch = async (input, init = {}) => {
    const tracked = shouldShowLoading(input, init);
    if (tracked) beginLoading();
    try {
      return await nativeFetch(input, init);
    } finally {
      if (tracked) endLoading();
    }
  };

  function ensureKeyboard() {
    let keyboard = document.getElementById('totemVirtualKeyboard');
    if (keyboard) return keyboard;
    keyboard = document.createElement('div');
    keyboard.id = 'totemVirtualKeyboard';
    keyboard.className = 'totem-virtual-keyboard';
    keyboard.hidden = true;
    keyboard.setAttribute('aria-label', 'Teclado virtual');
    document.body.appendChild(keyboard);
    return keyboard;
  }

  function isTextInput(el) {
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
    if (el.disabled || el.readOnly) return false;
    if (el instanceof HTMLTextAreaElement) return true;
    return !['checkbox', 'radio', 'file', 'hidden', 'button', 'submit', 'reset', 'range', 'color'].includes(el.type);
  }

  function keyboardLayout(input) {
    const numeric = ['numeric', 'decimal', 'tel'].includes(String(input?.inputMode || '').toLowerCase()) || input?.type === 'number';
    if (numeric) {
      return [
        ['1','2','3'], ['4','5','6'], ['7','8','9'], ['0','backspace'], ['clear','close']
      ];
    }
    const letters = keyboardUppercase ? 'QWERTYUIOPASDFGHJKLZXCVBNM' : 'qwertyuiopasdfghjklzxcvbnm';
    return [
      letters.slice(0, 10).split(''),
      letters.slice(10, 19).split(''),
      letters.slice(19).split(''),
      ['1','2','3','4','5','6','7','8','9','0'],
      ['shift','.','-','_','/',';',':','@','space','backspace'],
      ['clear','enter','close']
    ];
  }

  function keyLabel(key) {
    return ({
      backspace: '⌫', clear: 'Limpar', close: 'Fechar', space: 'Espaço', enter: 'Enter', shift: '⇧'
    })[key] || key;
  }

  function renderKeyboard() {
    const keyboard = ensureKeyboard();
    if (!featureState.keyboard || !activeInput || !document.contains(activeInput)) {
      keyboard.hidden = true;
      return;
    }
    keyboard.innerHTML = keyboardLayout(activeInput).map(row => `
      <div class="totem-keyboard-row">
        ${row.map(key => `<button type="button" class="totem-key" data-key="${html(key)}">${html(keyLabel(key))}</button>`).join('')}
      </div>`).join('');
    keyboard.hidden = false;
  }

  function dispatchInput() {
    if (!activeInput) return;
    activeInput.dispatchEvent(new Event('input', { bubbles: true }));
    activeInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function replaceSelection(text) {
    if (!activeInput) return;
    const value = activeInput.value || '';
    const start = Number.isInteger(activeInput.selectionStart) ? activeInput.selectionStart : value.length;
    const end = Number.isInteger(activeInput.selectionEnd) ? activeInput.selectionEnd : start;
    activeInput.value = value.slice(0, start) + text + value.slice(end);
    const next = start + text.length;
    try { activeInput.setSelectionRange(next, next); } catch (_) {}
    dispatchInput();
    activeInput.focus({ preventScroll: true });
  }

  function backspace() {
    if (!activeInput) return;
    const value = activeInput.value || '';
    let start = Number.isInteger(activeInput.selectionStart) ? activeInput.selectionStart : value.length;
    let end = Number.isInteger(activeInput.selectionEnd) ? activeInput.selectionEnd : start;
    if (start === end && start > 0) start -= 1;
    activeInput.value = value.slice(0, start) + value.slice(end);
    try { activeInput.setSelectionRange(start, start); } catch (_) {}
    dispatchInput();
    activeInput.focus({ preventScroll: true });
  }

  document.addEventListener('focusin', event => {
    if (!featureState.keyboard || !isTextInput(event.target)) return;
    activeInput = event.target;
    keyboardUppercase = event.target.type !== 'email' && event.target.type !== 'url';
    renderKeyboard();
  });

  document.addEventListener('pointerdown', event => {
    const keyboard = document.getElementById('totemVirtualKeyboard');
    if (!keyboard || keyboard.hidden) return;
    if (keyboard.contains(event.target) || event.target === activeInput) return;
    if (isTextInput(event.target)) return;
    keyboard.hidden = true;
  }, { passive: true });

  document.addEventListener('click', event => {
    const button = event.target.closest?.('#totemVirtualKeyboard [data-key]');
    if (!button || !activeInput) return;
    event.preventDefault();
    const key = button.dataset.key;
    if (key === 'close') {
      ensureKeyboard().hidden = true;
      activeInput.blur();
      return;
    }
    if (key === 'clear') {
      activeInput.value = '';
      dispatchInput();
      activeInput.focus({ preventScroll: true });
      return;
    }
    if (key === 'backspace') return backspace();
    if (key === 'space') return replaceSelection(' ');
    if (key === 'enter') {
      dispatchInput();
      ensureKeyboard().hidden = true;
      activeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      activeInput.blur();
      return;
    }
    if (key === 'shift') {
      keyboardUppercase = !keyboardUppercase;
      renderKeyboard();
      return;
    }
    replaceSelection(key);
  });

  function cameraStatusText() {
    const status = window.TotemCameraManager?.status?.();
    if (!status) return 'Browser / USB · getUserMedia';
    if (!status.hot) return 'Browser / USB · câmera pronta para abrir sob demanda';
    const label = status.label ? ` · ${status.label}` : '';
    return `Browser / USB · câmera quente ativa${label}`;
  }

  function sectionByTitle(title) {
    return [...document.querySelectorAll('#adminBody .admin-section')]
      .find(section => section.querySelector('h3')?.textContent?.toLowerCase().includes(title.toLowerCase()));
  }

  function ensureFlowSwitches(config) {
    const section = sectionByTitle('Regras do fluxo');
    if (!section || section.querySelector('[data-runtime-controls="flow"]')) return;
    const wrapper = document.createElement('div');
    wrapper.dataset.runtimeControls = 'flow';
    wrapper.className = 'row g-2 mt-1';
    wrapper.innerHTML = `
      <div class="col-md-6 form-check form-switch ms-2">
        <input class="form-check-input" type="checkbox" data-setting="enable_loading_screen" ${config.enable_loading_screen ? 'checked' : ''}>
        <label class="form-check-label">Tela de carregamento</label>
      </div>
      <div class="col-md-6 form-check form-switch ms-2">
        <input class="form-check-input" type="checkbox" data-setting="enable_virtual_keyboard" ${config.enable_virtual_keyboard ? 'checked' : ''}>
        <label class="form-check-label">Teclado virtual</label>
      </div>`;
    section.appendChild(wrapper);
  }

  function enhanceHardwareCards() {
    const section = sectionByTitle('Hardware e pagamento');
    if (!section) return;
    const cards = [...section.querySelectorAll('.hardware-card')];
    if (cards.length < 4) return;

    const [nfc, printer, payment, webcam] = cards;
    nfc.querySelector('select')?.remove();
    payment.querySelector('select')?.remove();
    webcam.querySelector('select')?.remove();

    nfc.classList.add('hardware-runtime-card');
    payment.classList.add('hardware-runtime-card');
    webcam.classList.add('hardware-runtime-card');

    const webcamStatus = webcam.querySelector('.text-secondary');
    if (webcamStatus) webcamStatus.textContent = cameraStatusText();

    const printerSelect = printer.querySelector('[data-setting="printer_mode"]');
    if (printerSelect) {
      const note = printer.querySelector('.runtime-hardware-note') || document.createElement('small');
      note.className = 'runtime-hardware-note d-block mt-2 text-secondary';
      note.textContent = 'Este seletor tem efeito real no backend de impressão.';
      if (!note.parentNode) printer.appendChild(note);
    }

    if (!section.querySelector('.runtime-hardware-explainer')) {
      const note = document.createElement('div');
      note.className = 'runtime-hardware-explainer alert alert-light border mt-3 mb-0';
      note.innerHTML = '<strong>Estado real:</strong> ACR122U e pagamentos são lidos dos providers efetivos do runtime. Somente opções que realmente alteram o backend permanecem editáveis.';
      section.appendChild(note);
    }
  }

  function fixLegacyPaymentMessage() {
    document.querySelectorAll('#app .alert.alert-info').forEach(alert => {
      if (!/Gertec PPC930|aprovado automaticamente no MVP/i.test(alert.textContent || '')) return;
      alert.innerHTML = '<i class="bi bi-info-circle me-2"></i>Pagamento enviado ao gateway central <strong>api_pagamento</strong>. Aguarde a confirmação do provider antes de continuar.';
    });
  }

  async function loadFeatureConfig() {
    try {
      const response = await nativeFetch(window.totemPublicUrl ? window.totemPublicUrl('/api/config') : '/api/config', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const config = await response.json();
      featureState.loading = config.enable_loading_screen !== false;
      featureState.keyboard = config.enable_virtual_keyboard !== false;
      featureState.configLoaded = true;
      if (!featureState.loading) {
        loadingCount = 0;
        const overlay = document.getElementById('totemLoadingOverlay');
        if (overlay) overlay.hidden = true;
      }
      if (!featureState.keyboard) {
        const keyboard = document.getElementById('totemVirtualKeyboard');
        if (keyboard) keyboard.hidden = true;
      }
      return config;
    } catch (error) {
      console.warn('[runtime-controls] Não foi possível carregar recursos do Totem.', error);
      return {
        enable_loading_screen: featureState.loading,
        enable_virtual_keyboard: featureState.keyboard
      };
    }
  }

  async function enhanceAdmin() {
    const adminBody = document.getElementById('adminBody');
    if (!adminBody || !adminBody.children.length) return;
    const config = await loadFeatureConfig();
    ensureFlowSwitches(config);
    enhanceHardwareCards();
  }

  function scheduleAdminEnhance() {
    clearTimeout(adminEnhanceTimer);
    adminEnhanceTimer = setTimeout(() => { void enhanceAdmin(); }, 30);
  }

  const adminBody = document.getElementById('adminBody');
  if (adminBody) {
    new MutationObserver(scheduleAdminEnhance).observe(adminBody, { childList: true, subtree: true });
  }

  document.getElementById('adminModal')?.addEventListener('shown.bs.modal', scheduleAdminEnhance);
  document.getElementById('saveSettingsBtn')?.addEventListener('click', () => {
    setTimeout(() => { void loadFeatureConfig(); }, 400);
  }, true);

  const app = document.getElementById('app');
  if (app) new MutationObserver(fixLegacyPaymentMessage).observe(app, { childList: true, subtree: true });

  void loadFeatureConfig();
  ensureLoadingOverlay();
  ensureKeyboard();
  fixLegacyPaymentMessage();
})();
