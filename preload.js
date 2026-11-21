// Pont sécurisé entre la page et le système de fichiers
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFile: () => ipcRenderer.invoke('open-file'),
  readPath: (p) => ipcRenderer.invoke('read-path', p),
  saveFile: (path, content, suggested) => ipcRenderer.invoke('save-file', { path, content, suggested }),
  exportFile: (opts) => ipcRenderer.invoke('export-file', opts),
  exportPDF: (suggested) => ipcRenderer.invoke('export-pdf', { suggested }),
  print: () => ipcRenderer.invoke('print'),
  chooseDir: () => ipcRenderer.invoke('choose-dir'),
  exportPDFTo: (dir, name) => ipcRenderer.invoke('export-pdf-to', { dir, name }),
  openPath: (p) => ipcRenderer.invoke('open-external-path', p),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return null; } },
  setDirty: (d) => ipcRenderer.send('dirty', !!d),
  quitNow: () => ipcRenderer.send('quit-now'),
  onCommand: (cb) => ipcRenderer.on('command', (e, c) => cb(c)),
  onOpenPath: (cb) => ipcRenderer.on('open-path', (e, r) => cb(r)),
  // scanner et reconnaissance de partitions
  omrStatus: () => ipcRenderer.invoke('omr-status'),
  scanList: () => ipcRenderer.invoke('scan-list'),
  scanPage: (opts) => ipcRenderer.invoke('scan-page', opts),
  omrRun: (files) => ipcRenderer.invoke('omr-run', files),
  omrCancel: () => ipcRenderer.invoke('omr-cancel'),
  onOmrProgress: (cb) => { const f = (e, p) => cb(p); ipcRenderer.on('omr-progress', f); return () => ipcRenderer.removeListener('omr-progress', f); },
  openAudiverisSite: () => ipcRenderer.invoke('open-audiveris-site'),
});
