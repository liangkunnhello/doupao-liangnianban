import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  selectDirectory: () => ipcRenderer.invoke('fs:select-directory'),
  saveImage: (filePath: string, dataUrl: string) => ipcRenderer.invoke('fs:save-image', { filePath, dataUrl }),
  saveJson: (filePath: string, data: unknown) => ipcRenderer.invoke('fs:save-json', { filePath, data }),
  saveText: (filePath: string, content: string) => ipcRenderer.invoke('fs:save-text', { filePath, content }),
  ensureDir: (dirPath: string) => ipcRenderer.invoke('fs:ensure-dir', { dirPath }),
  pathJoin: (...paths: string[]) => ipcRenderer.invoke('fs:path-join', { paths }),
  checkExists: (filePath: string) => ipcRenderer.invoke('fs:check-exists', { filePath }),
  readDir: (dirPath: string) => ipcRenderer.invoke('fs:read-dir', { dirPath }),
  getDefaultPath: () => ipcRenderer.invoke('fs:get-default-path'),
  openInExplorer: (filePath: string) => ipcRenderer.invoke('fs:open-in-explorer', { filePath }),
  getLocalSavePath: () => ipcRenderer.invoke('store:get-local-save-path'),
  setLocalSavePath: (path: string) => ipcRenderer.invoke('store:set-local-save-path', { path }),
  onUpdateStatus: (callback: (status: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on('update:status', handler)
    return () => ipcRenderer.removeListener('update:status', handler)
  },
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  isElectron: true,
})