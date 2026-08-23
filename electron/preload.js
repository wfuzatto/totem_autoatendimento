const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('kiosk', {
  exit: () => ipcRenderer.send('kiosk-exit')
});
