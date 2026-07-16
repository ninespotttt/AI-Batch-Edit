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

function bindImageActionResult(callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on('image:action-result', listener);
  return () => ipcRenderer.removeListener('image:action-result', listener);
}

contextBridge.exposeInMainWorld('batchApi', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  bootMark: (label) => ipcRenderer.invoke('boot:mark', label),
  selectImageFolder: () => ipcRenderer.invoke('images:selectFolder'),
  selectImageFiles: () => ipcRenderer.invoke('images:selectFiles'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  imagesFromPaths: (paths) => ipcRenderer.invoke('images:fromPaths', paths),
  imagesFromClipboard: (items) => ipcRenderer.invoke('images:fromClipboard', items),
  downloadImage: (payload) => ipcRenderer.invoke('images:download', payload),
  copyImage: (sourcePath) => ipcRenderer.invoke('images:copy', sourcePath),
  showImageContextMenu: (payload) => ipcRenderer.invoke('images:contextMenu', payload),
  selectOutputRoot: () => ipcRenderer.invoke('output:selectRoot'),
  createBatch: (payload) => ipcRenderer.invoke('output:createBatch', payload),
  runTask: (payload) => ipcRenderer.invoke('generation:runTask', payload),
  writeManifest: (payload) => ipcRenderer.invoke('manifest:write', payload),
  updateManifestTask: (payload) => ipcRenderer.invoke('manifest:updateTask', payload),
  listHistory: (payload) => ipcRenderer.invoke('history:list', payload),
  listPendingTasks: (payload) => ipcRenderer.invoke('tasks:listPending', payload),
  resumePendingTasks: (payload) => ipcRenderer.invoke('tasks:resumePending', payload),
  deleteFiles: (paths) => ipcRenderer.invoke('files:delete', paths),
  onRecoveryResult: (callback) => bindRecoveryResult(callback),
  onImageActionResult: (callback) => bindImageActionResult(callback),
  onRequestClose: (callback) => bindCloseRequest(callback),
  checkNotice: () => ipcRenderer.invoke('notice:check'),
  dismissNotice: (noticeId) => ipcRenderer.invoke('notice:dismiss', noticeId),
  openPath: (targetPath) => ipcRenderer.invoke('shell:openPath', targetPath),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  cancelClose: () => ipcRenderer.invoke('app:cancelClose'),
  confirmClose: () => ipcRenderer.invoke('app:confirmClose')
});
