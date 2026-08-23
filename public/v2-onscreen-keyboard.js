(() => {
  const editableSelector = [
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="button"]):not([type="submit"])',
    'textarea',
    '[contenteditable="true"]'
  ].join(',');

  let keyboard = null;
  let keysHost = null;
  let status = null;
  let activeTarget = null;
  let targetMode = 'local';
  let layoutMode = 'text';
  let shift = false;
  let lastIframeFocused = false;

  const isElectronBridge = () => Boolean(window.kiosk && typeof window.kiosk.sendVirtualKey === 'function');
  const canRememberIframe = () => Boolean(window.kiosk && typeof window.kiosk.rememberVirtualKeyboardTarget === 'function');

  const textRows = [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l','ç'],
    [{ action:'shift', label:'⇧', wide:true },'z','x','c','v','b','n','m',',','.',{ action:'backspace', label:'⌫', wide:true }],
    ['á','é','í','ó','ú','ã','õ','â','ê','ô'],
    [{ action:'numeric', label:'&123', wide:true },{ action:'tab', label:'Tab', wide:true },{ action:'space', label:'Espaço', flex:5 },{ action:'enter', label:'Enter', wide:true },{ action:'hide', label:'⌄', wide:true }]
  ];

  const numericRows = [
    ['1','2','3'],
    ['4','5','6'],
    ['7','8','9'],
    ['-','0','.'],
    [{ action:'text', label:'ABC', wide:true },{ action:'backspace', label:'⌫', wide:true },{ action:'enter', label:'Enter', wide:true },{ action:'hide', label:'⌄', wide:true }]
  ];

  function keyDescriptor(item) {
    if (typeof item === 'string') return { action:'char', value:item, label:item };
    return item;
  }

  function rememberIframeTarget() {
    if (!canRememberIframe()) return;
    try { window.kiosk.rememberVirtualKeyboardTarget(); } catch (_) {}
  }

  function ensureKeyboard() {
    if (keyboard) return;
    keyboard = document.createElement('section');
    keyboard.id = 'v2OnScreenKeyboard';
    keyboard.className = 'v2-osk';
    keyboard.hidden = true;
    keyboard.setAttribute('role', 'application');
    keyboard.setAttribute('aria-label', 'Teclado na tela');
    keyboard.innerHTML = `
      <div class="v2-osk-header">
        <div>
          <div class="v2-osk-title"><i class="bi bi-keyboard-fill me-2"></i>Teclado na tela</div>
          <div class="v2-osk-status" id="v2OskStatus">Toque em um campo para digitar.</div>
        </div>
        <button type="button" tabindex="-1" class="v2-osk-close" data-osk-action="hide" aria-label="Fechar teclado"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="v2-osk-keys" id="v2OskKeys"></div>`;
    document.body.appendChild(keyboard);
    keysHost = keyboard.querySelector('#v2OskKeys');
    status = keyboard.querySelector('#v2OskStatus');

    // Processa a tecla no pointerdown. O preventDefault impede que o botão do
    // teclado roube o foco do campo que está dentro de um iframe cross-origin.
    keyboard.addEventListener('pointerdown', event => {
      const key = event.target.closest?.('[data-osk-action]');
      event.preventDefault();
      event.stopPropagation();
      if (!key) return;
      handleKey(key.dataset.oskAction, key.dataset.oskValue || '');
    }, true);

    // O clique posterior ao pointerdown não deve alterar foco nem repetir a tecla.
    keyboard.addEventListener('click', event => {
      if (!event.target.closest?.('[data-osk-action]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  function inferLayout(element) {
    if (!element) return 'text';
    const inputMode = String(element.getAttribute?.('inputmode') || '').toLowerCase();
    const type = String(element.getAttribute?.('type') || '').toLowerCase();
    if (['numeric','decimal','tel'].includes(inputMode) || ['number','tel'].includes(type)) return 'numeric';
    return 'text';
  }

  function renderKeys() {
    ensureKeyboard();
    const rows = layoutMode === 'numeric' ? numericRows : textRows;
    keysHost.classList.toggle('v2-osk-numeric', layoutMode === 'numeric');
    keysHost.innerHTML = rows.map(row => `<div class="v2-osk-row">${row.map(item => {
      const key = keyDescriptor(item);
      const value = key.action === 'char' && shift ? String(key.value).toLocaleUpperCase('pt-BR') : key.value;
      const label = key.action === 'char' && shift ? String(key.label).toLocaleUpperCase('pt-BR') : key.label;
      const classes = ['v2-osk-key'];
      if (key.wide) classes.push('v2-osk-key-wide');
      if (key.flex) classes.push('v2-osk-key-space');
      if (key.action === 'shift' && shift) classes.push('is-active');
      return `<button type="button" tabindex="-1" class="${classes.join(' ')}" data-osk-action="${key.action}"${value != null ? ` data-osk-value="${String(value).replace(/&/g,'&amp;').replace(/\"/g,'&quot;')}"` : ''}>${label}</button>`;
    }).join('')}</div>`).join('');
  }

  function showKeyboard(mode = 'local', target = null, forcedLayout = null) {
    ensureKeyboard();
    targetMode = mode;
    activeTarget = mode === 'local' ? target : null;
    layoutMode = forcedLayout || (mode === 'local' ? inferLayout(target) : 'text');
    shift = false;

    if (mode === 'iframe') rememberIframeTarget();

    renderKeys();
    keyboard.hidden = false;
    document.body.classList.add('v2-keyboard-open');

    if (mode === 'iframe') {
      status.textContent = isElectronBridge()
        ? 'Campo do formulário externo selecionado. Digite normalmente no teclado abaixo.'
        : 'Em navegador comum, um iframe externo só pode receber o teclado do próprio sistema. No kiosk Electron este teclado funciona diretamente.';
    } else {
      const label = target?.getAttribute?.('aria-label') || target?.getAttribute?.('placeholder') || target?.name || 'campo selecionado';
      status.textContent = `Digitando em: ${label}`;
      setTimeout(() => {
        try { target?.scrollIntoView?.({ block:'center', behavior:'smooth' }); } catch (_) {}
      }, 80);
    }
  }

  function hideKeyboard() {
    if (!keyboard) return;
    keyboard.hidden = true;
    document.body.classList.remove('v2-keyboard-open');
    shift = false;
    activeTarget = null;
    targetMode = 'local';
  }

  function dispatchInput(element) {
    element.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertText', data:null }));
  }

  function replaceSelection(element, text) {
    if (!element) return;
    if (element.isContentEditable) {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      dispatchInput(element);
      return;
    }

    const current = String(element.value ?? '');
    const start = Number.isInteger(element.selectionStart) ? element.selectionStart : current.length;
    const end = Number.isInteger(element.selectionEnd) ? element.selectionEnd : start;
    const maxLength = Number(element.maxLength || -1);
    if (text && maxLength > 0 && current.length - (end - start) + text.length > maxLength) return;

    try {
      element.setRangeText(text, start, end, 'end');
    } catch (_) {
      element.value = current.slice(0, start) + text + current.slice(end);
    }
    dispatchInput(element);
  }

  function backspaceLocal(element) {
    if (!element) return;
    if (element.isContentEditable) {
      document.execCommand?.('delete', false, null);
      dispatchInput(element);
      return;
    }
    const current = String(element.value ?? '');
    let start = Number.isInteger(element.selectionStart) ? element.selectionStart : current.length;
    let end = Number.isInteger(element.selectionEnd) ? element.selectionEnd : start;
    if (start === end && start > 0) start -= 1;
    try {
      element.setRangeText('', start, end, 'end');
    } catch (_) {
      element.value = current.slice(0, start) + current.slice(end);
    }
    dispatchInput(element);
  }

  function focusNextLocal() {
    const fields = [...document.querySelectorAll(editableSelector)].filter(el => !el.disabled && !el.readOnly && el.offsetParent !== null);
    const index = fields.indexOf(activeTarget);
    const next = fields[index + 1] || fields[0];
    if (next) {
      activeTarget = next;
      next.focus({ preventScroll:true });
      layoutMode = inferLayout(next);
      renderKeys();
    }
  }

  function sendToIframe(action, value = '') {
    if (isElectronBridge()) {
      rememberIframeTarget();
      window.kiosk.sendVirtualKey({ target:'iframe', action, value });
      return true;
    }

    // Fallback apenas para iframe same-origin. Cross-origin é bloqueado pelo navegador.
    const frame = document.getElementById('govbrHotelFrame');
    try {
      const focused = frame?.contentDocument?.activeElement;
      if (focused && focused !== frame.contentDocument.body && focused.matches?.(editableSelector)) {
        const previous = activeTarget;
        activeTarget = focused;
        if (action === 'char') replaceSelection(focused, value);
        else if (action === 'space') replaceSelection(focused, ' ');
        else if (action === 'backspace') backspaceLocal(focused);
        else if (action === 'enter') replaceSelection(focused, focused.tagName === 'TEXTAREA' ? '\n' : '');
        activeTarget = previous;
        return true;
      }
    } catch (_) {}
    return false;
  }

  function handleKey(action, value) {
    if (action === 'hide') return hideKeyboard();
    if (action === 'shift') {
      shift = !shift;
      renderKeys();
      return;
    }
    if (action === 'numeric') {
      layoutMode = 'numeric';
      shift = false;
      renderKeys();
      return;
    }
    if (action === 'text') {
      layoutMode = 'text';
      shift = false;
      renderKeys();
      return;
    }

    if (targetMode === 'iframe') {
      const sent = sendToIframe(action, value);
      if (!sent && status) status.textContent = 'Toque primeiro em um campo do formulário. Em navegador externo, use o teclado do sistema.';
      return;
    }

    if (!activeTarget || !document.contains(activeTarget)) return;
    activeTarget.focus({ preventScroll:true });
    if (action === 'char') replaceSelection(activeTarget, value);
    else if (action === 'space') replaceSelection(activeTarget, ' ');
    else if (action === 'backspace') backspaceLocal(activeTarget);
    else if (action === 'tab') focusNextLocal();
    else if (action === 'enter') {
      if (activeTarget.tagName === 'TEXTAREA') replaceSelection(activeTarget, '\n');
      else {
        activeTarget.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', code:'Enter', bubbles:true }));
        activeTarget.dispatchEvent(new KeyboardEvent('keyup', { key:'Enter', code:'Enter', bubbles:true }));
      }
    }
  }

  function isEditable(element) {
    return Boolean(element?.matches?.(editableSelector) && !element.disabled && !element.readOnly);
  }

  function decorateGovbrIframe() {
    document.querySelectorAll('.govbr-iframe-toolbar').forEach(toolbar => {
      if (toolbar.querySelector('[data-v2-iframe-keyboard]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.className = 'btn btn-outline-primary btn-sm v2-iframe-keyboard-btn';
      button.dataset.v2IframeKeyboard = '1';
      button.innerHTML = '<i class="bi bi-keyboard-fill me-1"></i>Teclado na tela';

      // Também abre no pointerdown para não retirar o foco de um input do iframe.
      button.addEventListener('pointerdown', event => {
        event.preventDefault();
        event.stopPropagation();
        rememberIframeTarget();
        showKeyboard('iframe');
      }, true);
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
      toolbar.appendChild(button);
    });
  }

  document.addEventListener('focusin', event => {
    const target = event.target;
    if (keyboard?.contains(target)) return;
    if (isEditable(target)) showKeyboard('local', target);
  }, true);

  document.addEventListener('pointerdown', event => {
    if (keyboard?.contains(event.target)) return;
    if (event.target.closest?.('[data-v2-iframe-keyboard]')) return;
    if (isEditable(event.target)) return;
    const frame = event.target.closest?.('#govbrHotelFrame');
    if (frame) {
      rememberIframeTarget();
      return showKeyboard('iframe');
    }
    setTimeout(() => {
      const active = document.activeElement;
      if (!isEditable(active) && active?.id !== 'govbrHotelFrame') hideKeyboard();
    }, 80);
  }, true);

  setInterval(() => {
    decorateGovbrIframe();
    const active = document.activeElement;
    const iframeFocused = active?.id === 'govbrHotelFrame';
    if (iframeFocused) rememberIframeTarget();
    if (iframeFocused && !lastIframeFocused) showKeyboard('iframe');
    lastIframeFocused = iframeFocused;
  }, 200);

  const app = document.getElementById('app');
  if (app) new MutationObserver(decorateGovbrIframe).observe(app, { childList:true, subtree:true });

  window.v2OnScreenKeyboard = {
    show: () => showKeyboard('local', document.activeElement),
    showForIframe: () => showKeyboard('iframe'),
    hide: hideKeyboard
  };
})();
