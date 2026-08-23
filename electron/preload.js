const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kiosk', {
  exit: () => ipcRenderer.send('kiosk-exit'),
  setZoomFactor: factor => ipcRenderer.send('kiosk-zoom', factor),
  rememberVirtualKeyboardTarget: () => ipcRenderer.send('kiosk-keyboard-remember-frame'),
  sendVirtualKey: payload => ipcRenderer.send('kiosk-keyboard-input', payload),
  isElectron: true
});
