const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: () => ipcRenderer.invoke('fs:select-directory'),
  saveImage: (filePath, dataUrl) => ipcRenderer.invoke('fs:save-image', { filePath, dataUrl }),
  saveJson: (filePath, data) => ipcRenderer.invoke('fs:save-json', { filePath, data }),
  saveText: (filePath, content) => ipcRenderer.invoke('fs:save-text', { filePath, content }),
  ensureDir: (dirPath) => ipcRenderer.invoke('fs:ensure-dir', { dirPath }),
  pathJoin: (...paths) => ipcRenderer.invoke('fs:path-join', { paths }),
  checkExists: (filePath) => ipcRenderer.invoke('fs:check-exists', { filePath }),
  readDir: (dirPath) => ipcRenderer.invoke('fs:read-dir', { dirPath }),
  readFileBuffer: (filePath) => ipcRenderer.invoke('fs:read-file-buffer', { filePath }),
  getDefaultPath: () => ipcRenderer.invoke('fs:get-default-path'),
  openInExplorer: (filePath) => ipcRenderer.invoke('fs:open-in-explorer', { filePath }),
  getLocalSavePath: () => ipcRenderer.invoke('store:get-local-save-path'),
  setLocalSavePath: (path) => ipcRenderer.invoke('store:set-local-save-path', { path }),
  isElectron: true,
})