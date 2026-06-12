import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'path'
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, copyFileSync, statSync, unlinkSync } from 'fs'

const LOCAL_SETTINGS_FILE = 'local-settings.json'

function getLocalSettingsPath(): string {
  return path.join(app.getPath('userData'), LOCAL_SETTINGS_FILE)
}

export function initLocalSavePath(): void {
  try {
    const settings = readLocalSettings()
    if (!settings.localSavePath) {
      settings.localSavePath = path.join(app.getPath('userData'), 'local-saves')
      writeLocalSettings(settings)
    }
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
    return result.filePaths[0]
  })

  ipcMain.handle('fs:save-image', async (_event, { filePath, dataUrl }: { filePath: string; dataUrl: string }) => {
    try {
      const { buffer } = dataUrlToBuffer(dataUrl)
      const dir = path.join(filePath, '..')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(filePath, buffer)
      return true
    } catch (err) {
      console.error('保存图片失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:save-json', async (_event, { filePath, data }: { filePath: string; data: unknown }) => {
    try {
      const dir = path.join(filePath, '..')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
      return true
    } catch (err) {
      console.error('保存 JSON 失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:save-text', async (_event, { filePath, content }: { filePath: string; content: string }) => {
    try {
      const dir = path.join(filePath, '..')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(filePath, content, 'utf-8')
      return true
    } catch (err) {
      console.error('保存文本失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:ensure-dir', async (_event, { dirPath }: { dirPath: string }) => {
    try {
      if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true })
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
    return existsSync(filePath)
  })

  ipcMain.handle('fs:read-dir', async (_event, { dirPath }: { dirPath: string }) => {
    try {
      if (!existsSync(dirPath)) return []
      return readdirSync(dirPath)
    } catch {
      return []
    }
  })

  ipcMain.handle('fs:read-file-buffer', async (_event, { filePath }: { filePath: string }) => {
    try {
      if (!existsSync(filePath)) return null
      const buffer = readFileSync(filePath)
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      return { data: arrayBuffer, name: path.basename(filePath) }
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
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('store:get-local-save-path', async () => {
    const settings = readLocalSettings()
    return (settings.localSavePath as string) ?? null
  })

  ipcMain.handle('store:set-local-save-path', async (_event, { path: savePath }: { path: string }) => {
    const settings = readLocalSettings()
    settings.localSavePath = savePath
    writeLocalSettings(settings)
  })

  ipcMain.handle('fs:read-json-text', async (_event, { filePath }: { filePath: string }) => {
    try {
      if (!existsSync(filePath)) return null
      return readFileSync(filePath, 'utf-8')
    } catch (err) {
      console.error('读取 JSON 文本失败:', err)
      return null
    }
  })

  ipcMain.handle('fs:write-json-text', async (_event, { filePath, content, skipBackup, backupInterval }: { filePath: string; content: string; skipBackup?: boolean; backupInterval?: number }) => {
    try {
      const dir = path.join(filePath, '..')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      // 写入前自动备份旧文件
      if (!skipBackup && existsSync(filePath)) {
        try {
          const backupDir = path.join(dir, 'backups')
          if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })
          const intervalMs = (backupInterval ?? 0) * 60 * 1000
          const baseName = path.basename(filePath).replace(/\.[^.]+$/, '')
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
            copyFileSync(filePath, path.join(backupDir, backupName))
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
      writeFileSync(filePath, content, 'utf-8')
      return true
    } catch (err) {
      console.error('写入 JSON 文本失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:list-backups', async (_event, { filePath }: { filePath: string }) => {
    try {
      const dir = path.join(path.join(filePath, '..'), 'backups')
      if (!existsSync(dir)) return []
      return readdirSync(dir)
        .map((name) => ({ name, fullPath: path.join(dir, name) }))
        .filter((f) => f.name.startsWith(path.basename(filePath).replace(/\.[^.]+$/, '') + '-'))
        .sort((a, b) => statSync(b.fullPath).mtimeMs - statSync(a.fullPath).mtimeMs)
        .map((f) => f.fullPath)
    } catch (err) {
      console.error('列出备份失败:', err)
      return []
    }
  })

  ipcMain.handle('fs:check-backup-has-data', async (_event, { backupPath }: { backupPath: string }) => {
    try {
      if (!existsSync(backupPath)) return false
      const content = readFileSync(backupPath, 'utf-8')
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
      if (!existsSync(backupPath)) return false
      const dir = path.join(targetPath, '..')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      copyFileSync(backupPath, targetPath)
      return true
    } catch (err) {
      console.error('从备份恢复失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:delete-backup', async (_event, { backupPath }: { backupPath: string }) => {
    try {
      if (!existsSync(backupPath)) return false
      unlinkSync(backupPath)
      return true
    } catch (err) {
      console.error('删除备份失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:save-zip-buffer', async (_event, { filePath, buffer }: { filePath: string; buffer: ArrayBuffer }) => {
    try {
      const dir = path.join(filePath, '..')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(filePath, Buffer.from(buffer))
      return true
    } catch (err) {
      console.error('保存 ZIP 文件失败:', err)
      return false
    }
  })
}