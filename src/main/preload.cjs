const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('batchApi', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  selectImageFolder: () => ipcRenderer.invoke('images:selectFolder'),
  selectImageFiles: () => ipcRenderer.invoke('images:selectFiles'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  imagesFromPaths: (paths) => ipcRenderer.invoke('images:fromPaths', paths),
  selectOutputRoot: () => ipcRenderer.invoke('output:selectRoot'),
  createBatch: (payload) => ipcRenderer.invoke('output:createBatch', payload),
  runTask: (payload) => ipcRenderer.invoke('generation:runTask', payload),
  writeManifest: (payload) => ipcRenderer.invoke('manifest:write', payload),
  listHistory: (payload) => ipcRenderer.invoke('history:list', payload),
  openPath: (targetPath) => ipcRenderer.invoke('shell:openPath', targetPath),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
});
