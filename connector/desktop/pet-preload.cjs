const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
let latestMode;
ipcRenderer.on('connector:pet-state', (_event, mode) => {
  if (typeof mode !== 'string') return;
  latestMode = mode;
  for (const listener of listeners) listener(mode);
});

contextBridge.exposeInMainWorld('bri', {
  onState(listener) {
    listeners.add(listener);
    if (latestMode !== undefined) listener(latestMode);
    return () => listeners.delete(listener);
  },
});
