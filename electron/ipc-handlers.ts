import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'path'
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, copyFileSync, statSync, unlinkSync, renameSync } from 'fs'

const LOCAL_SETTINGS_FILE = 'local-settings.json'
const sessionAllowedRoots = new Set<string>()

function getLocalSettingsPath(): string {
  return path.join(app.getPath('userData'), LOCAL_SETTINGS_FILE)
}

function normalizeFsPath(value: string): string {
  return path.resolve(value)
}

function addAllowedRoot(value: string | null | undefined): void {
  if (!value) return
  sessionAllowedRoots.add(normalizeFsPath(value))
}

function getAllowedRoots(): string[] {
  const roots = [
    app.getPath('userData'),
    app.getPath('desktop'),
    app.getPath('documents'),
    app.getPath('downloads'),
    app.getPath('pictures'),
    ...sessionAllowedRoots,
  ]
  const settings = readLocalSettings()
  if (typeof settings.localSavePath === 'string') roots.push(settings.localSavePath)
  return roots.map(normalizeFsPath)
}

function isPathInside(targetPath: string, rootPath: string): boolean {
  const target = normalizeFsPath(targetPath).toLowerCase()
  const root = normalizeFsPath(rootPath).toLowerCase()
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function assertAllowedPath(targetPath: string): string {
  const normalized = normalizeFsPath(targetPath)
  if (!getAllowedRoots().some((root) => isPathInside(normalized, root))) {
    throw new Error('Path is outside allowed application directories')
  }
  return normalized
}

export function initLocalSavePath(): void {
  try {
    const settings = readLocalSettings()
    if (!settings.localSavePath) {
      settings.localSavePath = path.join(app.getPath('userData'), 'local-saves')
      writeLocalSettings(settings)
    }
    if (typeof settings.localSavePath === 'string') addAllowedRoot(settings.localSavePath)
  } catch (err) {
    console.error('初始化本地保存路径失败:', err)
  }
}

function readLocalSettings(): Record<string, unknown> {
  try {
    const content = readFileSync(getLocalSettingsPath(), 'utf-8')
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeLocalSettings(settings: Record<string, unknown>): void {
  writeFileSync(getLocalSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!matches) throw new Error('Invalid data URL format')
  const mime = matches[1]
  const base64 = matches[2]
  return {
    buffer: Buffer.from(base64, 'base64'),
    mime,
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('fs:select-directory', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择本地保存目录',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    addAllowedRoot(result.filePaths[0])
    return result.filePaths[0]
  })

  ipcMain.handle('fs:save-image', async (_event, { filePath, dataUrl }: { filePath: string; dataUrl: string }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      const { buffer } = dataUrlToBuffer(dataUrl)
      const dir = path.dirname(safeFilePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(safeFilePath, buffer)
      return true
    } catch (err) {
      console.error('保存图片失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:save-json', async (_event, { filePath, data }: { filePath: string; data: unknown }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      const dir = path.dirname(safeFilePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(safeFilePath, JSON.stringify(data, null, 2), 'utf-8')
      return true
    } catch (err) {
      console.error('保存 JSON 失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:save-text', async (_event, { filePath, content }: { filePath: string; content: string }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      const dir = path.dirname(safeFilePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(safeFilePath, content, 'utf-8')
      return true
    } catch (err) {
      console.error('保存文本失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:ensure-dir', async (_event, { dirPath }: { dirPath: string }) => {
    try {
      const safeDirPath = assertAllowedPath(dirPath)
      if (!existsSync(safeDirPath)) mkdirSync(safeDirPath, { recursive: true })
      return true
    } catch (err) {
      console.error('创建目录失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:path-join', async (_event, { paths }: { paths: string[] }) => {
    return path.join(...paths)
  })

  ipcMain.handle('fs:check-exists', async (_event, { filePath }: { filePath: string }) => {
    try {
      return existsSync(assertAllowedPath(filePath))
    } catch {
      return false
    }
  })

  ipcMain.handle('fs:read-dir', async (_event, { dirPath }: { dirPath: string }) => {
    try {
      const safeDirPath = assertAllowedPath(dirPath)
      if (!existsSync(safeDirPath)) return []
      return readdirSync(safeDirPath)
    } catch {
      return []
    }
  })

  ipcMain.handle('fs:read-file-buffer', async (_event, { filePath }: { filePath: string }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      if (!existsSync(safeFilePath)) return null
      const buffer = readFileSync(safeFilePath)
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      return { data: arrayBuffer, name: path.basename(safeFilePath) }
    } catch (err) {
      console.error('读取文件失败:', err)
      return null
    }
  })

  ipcMain.handle('fs:get-default-path', async () => {
    return path.join(app.getPath('userData'), 'local-saves')
  })

  ipcMain.handle('fs:get-desktop-path', async () => {
    return app.getPath('desktop')
  })

  ipcMain.handle('fs:open-in-explorer', async (_event, { filePath }: { filePath: string }) => {
    const safePath = assertAllowedPath(filePath)
    if (existsSync(safePath) && statSync(safePath).isDirectory()) {
      await shell.openPath(safePath)
      return
    }
    shell.showItemInFolder(safePath)
  })

  ipcMain.handle('store:get-local-save-path', async () => {
    const settings = readLocalSettings()
    return (settings.localSavePath as string) ?? null
  })

  ipcMain.handle('store:set-local-save-path', async (_event, { path: savePath }: { path: string }) => {
    const settings = readLocalSettings()
    const safeSavePath = assertAllowedPath(savePath)
    addAllowedRoot(safeSavePath)
    settings.localSavePath = safeSavePath
    writeLocalSettings(settings)
  })

  ipcMain.handle('fs:read-json-text', async (_event, { filePath }: { filePath: string }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      if (!existsSync(safeFilePath)) return null
      const content = readFileSync(safeFilePath, 'utf-8')
      if (content && content.trim()) return content
      const bakPath = safeFilePath + '.bak'
      if (existsSync(bakPath)) {
        const bakContent = readFileSync(bakPath, 'utf-8')
        if (bakContent && bakContent.trim()) return bakContent
      }
      return null
    } catch (err) {
      console.error('读取 JSON 文本失败:', err)
      try {
        const bakPath = assertAllowedPath(filePath) + '.bak'
        if (existsSync(bakPath)) {
          const bakContent = readFileSync(bakPath, 'utf-8')
          if (bakContent && bakContent.trim()) return bakContent
        }
      } catch {}
      return null
    }
  })

  ipcMain.handle('fs:write-json-text', async (_event, { filePath, content, skipBackup, backupInterval }: { filePath: string; content: string; skipBackup?: boolean; backupInterval?: number }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      const dir = path.dirname(safeFilePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      // 写入前自动备份旧文件
      if (!skipBackup && existsSync(safeFilePath)) {
        try {
          const backupDir = path.join(dir, 'backups')
          if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })
          const intervalMs = (backupInterval ?? 0) * 60 * 1000
          const baseName = path.basename(safeFilePath).replace(/\.[^.]+$/, '')
          let shouldBackup = true
          if (intervalMs > 0) {
            const backups = readdirSync(backupDir)
              .map((name) => ({ name, fullPath: path.join(backupDir, name) }))
              .filter((f) => f.name.startsWith(baseName + '-'))
              .sort((a, b) => statSync(b.fullPath).mtimeMs - statSync(a.fullPath).mtimeMs)
            if (backups.length > 0) {
              const lastBackupTime = statSync(backups[0].fullPath).mtimeMs
              shouldBackup = Date.now() - lastBackupTime >= intervalMs
            }
          }
          if (shouldBackup) {
            const ts = new Date().toISOString().replace(/[:.]/g, '-')
            const backupName = baseName + '-' + ts + '.json'
            copyFileSync(safeFilePath, path.join(backupDir, backupName))
          }
          // 只保留最近 30 个备份
          const backups = readdirSync(backupDir)
            .map((name) => ({ name, fullPath: path.join(backupDir, name) }))
            .filter((f) => f.name.startsWith(baseName + '-'))
            .sort((a, b) => statSync(b.fullPath).mtimeMs - statSync(a.fullPath).mtimeMs)
          for (let i = 30; i < backups.length; i++) {
            try { writeFileSync(backups[i].fullPath, '') } catch { }
          }
        } catch (backupErr) {
          console.error('自动备份失败（不影响写入）:', backupErr)
        }
      }
      const bakPath = safeFilePath + '.bak'
      if (existsSync(safeFilePath)) {
        try { copyFileSync(safeFilePath, bakPath) } catch {}
      }
      const tmpPath = safeFilePath + '.tmp'
      writeFileSync(tmpPath, content, 'utf-8')
      try {
        renameSync(tmpPath, safeFilePath)
      } catch {
        try { copyFileSync(tmpPath, safeFilePath) } catch {}
        try { unlinkSync(tmpPath) } catch {}
      }
      return true
    } catch (err) {
      console.error('写入 JSON 文本失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:list-backups', async (_event, { filePath }: { filePath: string }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      const dir = path.join(path.dirname(safeFilePath), 'backups')
      if (!existsSync(dir)) return []
      return readdirSync(dir)
        .map((name) => ({ name, fullPath: path.join(dir, name) }))
        .filter((f) => f.name.startsWith(path.basename(safeFilePath).replace(/\.[^.]+$/, '') + '-'))
        .sort((a, b) => statSync(b.fullPath).mtimeMs - statSync(a.fullPath).mtimeMs)
        .map((f) => f.fullPath)
    } catch (err) {
      console.error('列出备份失败:', err)
      return []
    }
  })

  ipcMain.handle('fs:check-backup-has-data', async (_event, { backupPath }: { backupPath: string }) => {
    try {
      const safeBackupPath = assertAllowedPath(backupPath)
      if (!existsSync(safeBackupPath)) return false
      const content = readFileSync(safeBackupPath, 'utf-8')
      const data = JSON.parse(content)
      const state = data?.state ?? data
      const hasTasks = Array.isArray(state?.tasks) && state.tasks.length > 0
      const hasConversations = Array.isArray(state?.agentConversations) && state.agentConversations.length > 0
      return hasTasks || hasConversations
    } catch (err) {
      return false
    }
  })

  ipcMain.handle('fs:restore-from-backup', async (_event, { backupPath, targetPath }: { backupPath: string; targetPath: string }) => {
    try {
      const safeBackupPath = assertAllowedPath(backupPath)
      const safeTargetPath = assertAllowedPath(targetPath)
      if (!existsSync(safeBackupPath)) return false
      const dir = path.dirname(safeTargetPath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      copyFileSync(safeBackupPath, safeTargetPath)
      return true
    } catch (err) {
      console.error('从备份恢复失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:delete-backup', async (_event, { backupPath }: { backupPath: string }) => {
    try {
      const safeBackupPath = assertAllowedPath(backupPath)
      if (!existsSync(safeBackupPath)) return false
      unlinkSync(safeBackupPath)
      return true
    } catch (err) {
      console.error('删除备份失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:save-zip-buffer', async (_event, { filePath, buffer }: { filePath: string; buffer: ArrayBuffer }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      const dir = path.dirname(safeFilePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(safeFilePath, Buffer.from(buffer))
      return true
    } catch (err) {
      console.error('保存 ZIP 文件失败:', err)
      return false
    }
  })
}
