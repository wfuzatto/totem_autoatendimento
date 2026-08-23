const { app, BrowserWindow, ipcMain, globalShortcut, session } = require('electron');
const path = require('path');

let win;
let exitAllowed = false;
let virtualKeyboardFrame = null;
const kioskUrl = process.env.TOTEM_URL || 'http://127.0.0.1:3080';
const kioskOrigin = new URL(kioskUrl).origin;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function frameAlive(frame) {
  if (!frame) return false;
  try { return !frame.isDestroyed(); } catch (_) { return false; }
}

function rememberFocusedIframe() {
  if (!win || win.isDestroyed()) return null;
  const mainFrame = win.webContents.mainFrame;
  const focused = win.webContents.focusedFrame;
  if (focused && focused !== mainFrame && frameAlive(focused)) {
    virtualKeyboardFrame = focused;
    return focused;
  }
  return null;
}

function virtualKeyboardTargetFrame() {
  if (!win || win.isDestroyed()) return null;
  const focused = rememberFocusedIframe();
  if (focused) return focused;
  if (frameAlive(virtualKeyboardFrame)) return virtualKeyboardFrame;

  // Fallback: usa um subframe real da página. Normalmente o gov.br é o único
  // iframe externo do kiosk, mas não dependemos do domínio para acompanhar redirects.
  const mainFrame = win.webContents.mainFrame;
  const frames = mainFrame.framesInSubtree || [];
  const candidate = frames.find(frame => frame !== mainFrame && frameAlive(frame) && /^https?:/i.test(frame.url || ''))
    || frames.find(frame => frame !== mainFrame && frameAlive(frame));
  if (candidate) virtualKeyboardFrame = candidate;
  return candidate || null;
}

function createWindow() {
  win = new BrowserWindow({
    fullscreen: true,
    kiosk: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: process.env.KIOSK_DEVTOOLS === '1'
    }
  });

  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(kioskUrl)) event.preventDefault();
  });
  win.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) virtualKeyboardFrame = null;
  });
  win.webContents.on('render-process-gone', () => setTimeout(() => win && !win.isDestroyed() && win.reload(), 1200));
  win.on('close', event => { if (!exitAllowed) event.preventDefault(); });
  win.loadURL(kioskUrl).catch(() => setTimeout(() => win && !win.isDestroyed() && win.loadURL(kioskUrl), 2000));
}

app.whenReady().then(() => {
  // O kiosk pode usar webcam sem depender de um popup de permissão que ficaria
  // escondido em fullscreen. A autorização fica restrita à origem local do totem.
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return permission === 'media' && requestingOrigin === kioskOrigin;
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const requestOrigin = (() => {
      try { return new URL(webContents.getURL()).origin; } catch (_) { return ''; }
    })();
    callback(permission === 'media' && requestOrigin === kioskOrigin);
  });

  createWindow();
  ['CommandOrControl+R','CommandOrControl+W','CommandOrControl+L','CommandOrControl+T','CommandOrControl+N','F12','Alt+Left','Alt+Right','Alt+F4'].forEach(key => {
    try { globalShortcut.register(key, () => {}); } catch (_) {}
  });
});

ipcMain.on('kiosk-zoom', (_event, factor) => {
  const numeric = Number(factor);
  const safeFactor = Number.isFinite(numeric) ? Math.min(1.6, Math.max(0.8, numeric)) : 1;
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(safeFactor);
});

function sendKeyPress(keyCode) {
  if (!win || win.isDestroyed()) return;
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
}

function iframeKeyboardScript(action, value = '') {
  const safeAction = JSON.stringify(String(action || ''));
  const safeValue = JSON.stringify(String(value || '').slice(0, 8));
  return `(() => {
    const action = ${safeAction};
    const value = ${safeValue};
    const el = document.activeElement;
    if (!el) return false;

    const tag = String(el.tagName || '').toUpperCase();
    const type = String(el.type || '').toLowerCase();
    const blocked = ['hidden','checkbox','radio','range','file','button','submit','reset','color'];
    const editable = el.isContentEditable || tag === 'TEXTAREA' || (tag === 'INPUT' && !blocked.includes(type));
    if (!editable || el.disabled || el.readOnly) return false;

    const emitInput = (inputType, data) => {
      try {
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType, data }));
      } catch (_) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const replaceSelection = text => {
      el.focus();
      if (el.isContentEditable) {
        try {
          if (document.execCommand && document.execCommand('insertText', false, text)) return true;
        } catch (_) {}
        const selection = window.getSelection();
        if (!selection || !selection.rangeCount) return false;
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        emitInput('insertText', text);
        return true;
      }

      const current = String(el.value ?? '');
      const start = Number.isInteger(el.selectionStart) ? el.selectionStart : current.length;
      const end = Number.isInteger(el.selectionEnd) ? el.selectionEnd : start;
      try {
        el.setRangeText(text, start, end, 'end');
      } catch (_) {
        el.value = current.slice(0, start) + text + current.slice(end);
      }
      emitInput('insertText', text);
      return true;
    };

    if (action === 'char') return replaceSelection(value);
    if (action === 'space') return replaceSelection(' ');

    if (action === 'backspace') {
      el.focus();
      if (el.isContentEditable) {
        try {
          if (document.execCommand && document.execCommand('delete', false, null)) return true;
        } catch (_) {}
        return false;
      }
      const current = String(el.value ?? '');
      let start = Number.isInteger(el.selectionStart) ? el.selectionStart : current.length;
      let end = Number.isInteger(el.selectionEnd) ? el.selectionEnd : start;
      if (start === end && start > 0) start -= 1;
      try {
        el.setRangeText('', start, end, 'end');
      } catch (_) {
        el.value = current.slice(0, start) + current.slice(end);
      }
      emitInput('deleteContentBackward', null);
      return true;
    }

    if (action === 'tab') {
      const selector = 'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const candidates = Array.from(document.querySelectorAll(selector)).filter(node => !node.hidden && node.getClientRects().length > 0);
      const index = candidates.indexOf(el);
      const next = candidates[index + 1] || candidates[0];
      if (next) next.focus();
      return Boolean(next);
    }

    if (action === 'enter') {
      if (tag === 'TEXTAREA' || el.isContentEditable) return replaceSelection('\n');
      const down = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
      const allowed = el.dispatchEvent(down);
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
      if (allowed && el.form && typeof el.form.requestSubmit === 'function') {
        try { el.form.requestSubmit(); } catch (_) {}
      }
      return true;
    }

    return false;
  })()`;
}

ipcMain.on('kiosk-keyboard-remember-frame', () => {
  rememberFocusedIframe();
});

ipcMain.on('kiosk-keyboard-input', async (_event, payload = {}) => {
  if (!win || win.isDestroyed()) return;
  const action = String(payload.action || '');

  if (payload.target === 'iframe') {
    const frame = virtualKeyboardTargetFrame();
    if (frame) {
      try {
        const handled = await frame.executeJavaScript(iframeKeyboardScript(action, payload.value), true);
        if (handled) return;
      } catch (_) {}
    }
  }

  // Fallback para campos da janela principal ou caso o frame ainda esteja carregando.
  if (action === 'char') {
    const value = String(payload.value || '').slice(0, 8);
    if (value) win.webContents.insertText(value);
    return;
  }
  if (action === 'space') {
    win.webContents.insertText(' ');
    return;
  }
  const allowed = { backspace: 'Backspace', enter: 'Enter', tab: 'Tab' };
  if (allowed[action]) sendKeyPress(allowed[action]);
});

ipcMain.on('kiosk-exit', () => {
  exitAllowed = true;
  if (win && !win.isDestroyed()) {
    win.setKiosk(false);
    win.close();
  }
  app.quit();
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
