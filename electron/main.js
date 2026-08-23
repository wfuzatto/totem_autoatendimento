const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');

let win;
let exitAllowed = false;
const kioskUrl = process.env.TOTEM_URL || 'http://127.0.0.1:3080';

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
  createWindow();
  ['CommandOrControl+R','CommandOrControl+W','CommandOrControl+L','CommandOrControl+T','CommandOrControl+N','F12','Alt+Left','Alt+Right','Alt+F4'].forEach(key => {
    try { globalShortcut.register(key, () => {}); } catch (_) {}
  });
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
