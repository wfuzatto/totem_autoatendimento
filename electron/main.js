const { app, BrowserWindow, ipcMain, globalShortcut, session } = require('electron');
const path = require('path');

let win;
let exitAllowed = false;
const kioskUrl = process.env.TOTEM_URL || 'http://127.0.0.1:3080';
const kioskOrigin = new URL(kioskUrl).origin;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

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

ipcMain.on('kiosk-keyboard-input', (_event, payload = {}) => {
  if (!win || win.isDestroyed()) return;
  const action = String(payload.action || '');

  if (action === 'char') {
    const value = String(payload.value || '').slice(0, 8);
    if (value) win.webContents.insertText(value);
    return;
  }

  if (action === 'space') {
    win.webContents.insertText(' ');
    return;
  }

  const allowed = {
    backspace: 'Backspace',
    enter: 'Enter',
    tab: 'Tab'
  };
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
