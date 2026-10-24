const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('connector', Object.freeze({
  state: () => ipcRenderer.invoke('connector:state'),
  pair: code => ipcRenderer.invoke('connector:pair', typeof code === 'string' ? code : ''),
  openWeb: () => ipcRenderer.invoke('connector:open-web'),
  refresh: () => ipcRenderer.invoke('connector:refresh'),
  pause: () => ipcRenderer.invoke('connector:pause'),
  quit: () => ipcRenderer.invoke('connector:quit'),
  autoStart: enabled => ipcRenderer.invoke('connector:auto-start', enabled === true),
  pet: enabled => ipcRenderer.invoke('connector:pet', enabled === true),
  terminal: provider => ipcRenderer.invoke('connector:terminal', ['codex', 'claude'].includes(provider) ? provider : ''),
  help: provider => ipcRenderer.invoke('connector:help', provider),
  onState: listener => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, value) => listener(value);
    ipcRenderer.on('connector:state', handler);
    return () => ipcRenderer.removeListener('connector:state', handler);
  },
}));
