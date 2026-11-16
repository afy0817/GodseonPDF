'use strict';

// 렌더러에 노출하는 최소한의 API. (contextIsolation + sandbox 환경)
const { contextBridge, ipcRenderer, webUtils } = require('electron');

function on(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('godseon', {
  platform: process.platform,
  openDialog: () => ipcRenderer.invoke('pdf:open-dialog'),
  openPath: (filePath) => ipcRenderer.invoke('pdf:open-path', filePath),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
  save: (filePath, data) => ipcRenderer.invoke('pdf:save', { path: filePath, data }),
  saveAs: (data, suggestedName, defaultDir) => ipcRenderer.invoke('pdf:save-as', { data, suggestedName, defaultDir }),
  confirmUnsaved: (docName) => ipcRenderer.invoke('dialog:confirm-unsaved', docName),
  setDocState: (state) => ipcRenderer.send('doc:state', state),
  ready: () => ipcRenderer.send('renderer:ready'),
  closeConfirmed: () => ipcRenderer.send('window:close-confirmed'),
  onCommand: (callback) => on('menu:command', callback),
  onOpenFile: (callback) => on('pdf:opened', callback),
  onSaveAndClose: (callback) => on('app:save-and-close', () => callback()),
  getLanguage: () => ipcRenderer.sendSync('app:get-language'),
  setLanguage: (lang) => ipcRenderer.send('app:set-language', lang),
  onLanguage: (callback) => on('app:language', callback),
  exportBegin: (opts) => ipcRenderer.invoke('export:begin', opts),
  exportWrite: (id, name, chunks) => ipcRenderer.invoke('export:write', { id, name, chunks }),
  exportFinish: (id) => ipcRenderer.invoke('export:finish', id),
  exportAbort: (id) => ipcRenderer.invoke('export:abort', id),
  exportReveal: (path) => ipcRenderer.invoke('export:reveal', path),
  listSignatures: () => ipcRenderer.invoke('signatures:list'),
  saveSignature: (signature) => ipcRenderer.invoke('signatures:save', signature),
  removeSignature: (id) => ipcRenderer.invoke('signatures:remove', id),
  listFonts: () => ipcRenderer.invoke('fonts:list'),
  normalizeFont: (data) => ipcRenderer.invoke('fonts:normalize', data),
  saveFont: (font) => ipcRenderer.invoke('fonts:save', font),
  removeFont: (id) => ipcRenderer.invoke('fonts:remove', id),
});
