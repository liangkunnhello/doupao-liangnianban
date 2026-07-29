import { contextBridge, ipcRenderer } from 'electron'

type ApiFetchEvent = { id: string; type: 'chunk' | 'done' | 'error'; data?: Uint8Array; error?: string }
type ApiFetchRequest = { id: string }
const apiFetchListeners = new Map<string, (_event: Electron.IpcRendererEvent, payload: unknown) => void>()

async function apiFetch(request: ApiFetchRequest, onEvent: (event: ApiFetchEvent) => void) {
  const previous = apiFetchListeners.get(request.id)
  if (previous) ipcRenderer.removeListener('api:fetch:event', previous)
  const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
    const event = payload as ApiFetchEvent
    if (!event || event.id !== request.id) return
    onEvent(event)
    if (event.type === 'done' || event.type === 'error') {
      ipcRenderer.removeListener('api:fetch:event', handler)
      apiFetchListeners.delete(request.id)
    }
  }
  apiFetchListeners.set(request.id, handler)
  ipcRenderer.on('api:fetch:event', handler)
  try {
    return await ipcRenderer.invoke('api:fetch', request)
  } catch (error) {
    ipcRenderer.removeListener('api:fetch:event', handler)
    apiFetchListeners.delete(request.id)
    throw error
  }
}

function cancelApiFetch(id: string) {
  ipcRenderer.send('api:fetch:abort', id)
  const handler = apiFetchListeners.get(id)
  if (handler) ipcRenderer.removeListener('api:fetch:event', handler)
  apiFetchListeners.delete(id)
}

contextBridge.exposeInMainWorld('electronAPI', {
  apiFetch,
  cancelApiFetch,
  selectDirectory: () => ipcRenderer.invoke('fs:select-directory'),
  selectFile: (filters?: { name: string; extensions: string[] }[]) => ipcRenderer.invoke('fs:select-file', { filters }),
  selectFiles: (filters?: { name: string; extensions: string[] }[]) => ipcRenderer.invoke('fs:select-files', { filters }),
  saveImage: (filePath: string, dataUrl: string) => ipcRenderer.invoke('fs:save-image', { filePath, dataUrl }),
  saveCompositeImage: (filePath: string, dataUrl: string, maxSizeKb?: number) => ipcRenderer.invoke('composite:save-image', { filePath, dataUrl, maxSizeKb }),
  authorizeCompositeOutputDirectory: (dirPath: string) => ipcRenderer.invoke('composite:authorize-output-directory', { dirPath }),
  saveJson: (filePath: string, data: unknown) => ipcRenderer.invoke('fs:save-json', { filePath, data }),
  saveText: (filePath: string, content: string) => ipcRenderer.invoke('fs:save-text', { filePath, content }),
  ensureDir: (dirPath: string) => ipcRenderer.invoke('fs:ensure-dir', { dirPath }),
  pathJoin: (...paths: string[]) => ipcRenderer.invoke('fs:path-join', { paths }),
  checkExists: (filePath: string) => ipcRenderer.invoke('fs:check-exists', { filePath }),
  readDir: (dirPath: string) => ipcRenderer.invoke('fs:read-dir', { dirPath }),
  readImageFile: (filePath: string) => ipcRenderer.invoke('composite:read-image-file', { filePath }),
  listImageFiles: (dirPath: string) => ipcRenderer.invoke('composite:list-image-files', { dirPath }),
  listCompositeBackgroundFiles: (dirPath: string, recursive: boolean) => ipcRenderer.invoke('composite:list-background-files', { dirPath, recursive }),
  scanEnteredCompositeBackgroundFolder: (dirPath: string, recursive: boolean) => ipcRenderer.invoke('composite:scan-entered-background-folder', { dirPath, recursive }),
  pickImageFile: (input: { path: string; mode: 'random' | 'sequential'; index: number }) => ipcRenderer.invoke('composite:pick-image-file', input),
  deleteCompositeFiles: (filePaths: string[]) => ipcRenderer.invoke('composite:delete-files', { filePaths }),
  distributeFile: (input: { sourcePath: string; targetPath: string; mode: 'copy' | 'move'; appendRandomByte?: boolean }) => ipcRenderer.invoke('composite:distribute-file', input),
  readFileBuffer: (filePath: string) => ipcRenderer.invoke('fs:read-file-buffer', { filePath }),
  getDefaultPath: () => ipcRenderer.invoke('fs:get-default-path'),
  openInExplorer: (filePath: string) => ipcRenderer.invoke('fs:open-in-explorer', { filePath }),
  getLocalSavePath: () => ipcRenderer.invoke('store:get-local-save-path'),
  setLocalSavePath: (path: string) => ipcRenderer.invoke('store:set-local-save-path', { path }),
  copyCacheToRoot: (newRoot: string) => ipcRenderer.invoke('store:copy-cache-to-root', { newRoot }),
  readJsonText: (filePath: string) => ipcRenderer.invoke('fs:read-json-text', { filePath }),
  writeJsonText: (filePath: string, content: string, backupIntervalOrSkip?: boolean | number) => ipcRenderer.invoke('fs:write-json-text', { filePath, content, skipBackup: typeof backupIntervalOrSkip === 'boolean' ? backupIntervalOrSkip : undefined, backupInterval: typeof backupIntervalOrSkip === 'number' ? backupIntervalOrSkip : undefined }),
  listBackups: (filePath: string) => ipcRenderer.invoke('fs:list-backups', { filePath }),
  checkBackupHasData: (backupPath: string) => ipcRenderer.invoke('fs:check-backup-has-data', { backupPath }),
  restoreFromBackup: (backupPath: string, targetPath: string) => ipcRenderer.invoke('fs:restore-from-backup', { backupPath, targetPath }),
  deleteBackup: (backupPath: string) => ipcRenderer.invoke('fs:delete-backup', { backupPath }),
  saveZipBuffer: (filePath: string, buffer: ArrayBuffer) => ipcRenderer.invoke('fs:save-zip-buffer', { filePath, buffer }),
  selectZipSavePath: (defaultName: string) => ipcRenderer.invoke('fs:select-zip-save-path', { defaultName }),
  exportZipToPath: (request: unknown) => ipcRenderer.invoke('fs:export-zip', request),
  deleteCacheImages: (filePaths: string[]) => ipcRenderer.invoke('store:delete-cache-images', { filePaths }),
  reconcileCacheImages: (referencedFileNames: string[]) => ipcRenderer.invoke('store:reconcile-cache-images', { referencedFileNames }),
  getDesktopPath: () => ipcRenderer.invoke('fs:get-desktop-path'),
  onUpdateStatus: (callback: (status: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on('update:status', handler)
    return () => ipcRenderer.removeListener('update:status', handler)
  },
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getStartupMode: () => ipcRenderer.invoke('app:get-startup-mode'),
  isElectron: true,
})
