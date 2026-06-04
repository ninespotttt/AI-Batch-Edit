const { contextBridge, ipcRenderer, webUtils } = require('electron');

function bindRecoveryResult(callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on('recovery:result', listener);
  return () => ipcRenderer.removeListener('recovery:result', listener);
}

function bindCloseRequest(callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = () => callback();
  ipcRenderer.on('app:request-close', listener);
  return () => ipcRenderer.removeListener('app:request-close', listener);
}

contextBridge.exposeInMainWorld('batchApi', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  bootMark: (label) => ipcRenderer.invoke('boot:mark', label),
  selectImageFolder: () => ipcRenderer.invoke('images:selectFolder'),
  selectImageFiles: () => ipcRenderer.invoke('images:selectFiles'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  imagesFromPaths: (paths) => ipcRenderer.invoke('images:fromPaths', paths),
  selectOutputRoot: () => ipcRenderer.invoke('output:selectRoot'),
  createBatch: (payload) => ipcRenderer.invoke('output:createBatch', payload),
  runTask: (payload) => ipcRenderer.invoke('generation:runTask', payload),
  writeManifest: (payload) => ipcRenderer.invoke('manifest:write', payload),
  listHistory: (payload) => ipcRenderer.invoke('history:list', payload),
  onRecoveryResult: (callback) => bindRecoveryResult(callback),
  onRequestClose: (callback) => bindCloseRequest(callback),
  checkNotice: () => ipcRenderer.invoke('notice:check'),
  dismissNotice: (noticeId) => ipcRenderer.invoke('notice:dismiss', noticeId),
  openPath: (targetPath) => ipcRenderer.invoke('shell:openPath', targetPath),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  cancelClose: () => ipcRenderer.invoke('app:cancelClose'),
  confirmClose: () => ipcRenderer.invoke('app:confirmClose')
});
