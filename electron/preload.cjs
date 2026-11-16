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
});
