const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kiosk', {
  exit: () => ipcRenderer.send('kiosk-exit'),
  setZoomFactor: factor => ipcRenderer.send('kiosk-zoom', factor)
});
