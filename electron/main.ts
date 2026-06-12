import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { autoUpdater } from 'electron-updater'
import { registerIpcHandlers, initLocalSavePath } from './ipc-handlers'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

function sendToWindow(channel: string, ...args: unknown[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

autoUpdater.on('checking-for-update', () => {
  sendToWindow('update:status', { status: 'checking' })
})

autoUpdater.on('update-available', (info) => {
  sendToWindow('update:status', { status: 'available', version: info.version, releaseNotes: info.releaseNotes })
})

autoUpdater.on('update-not-available', (info) => {
  sendToWindow('update:status', { status: 'not-available', version: info.version })
})

autoUpdater.on('download-progress', (progressInfo) => {
  sendToWindow('update:status', {
    status: 'downloading',
    progress: progressInfo.percent,
    transferred: progressInfo.transferred,
    total: progressInfo.total,
    speed: progressInfo.bytesPerSecond,
  })
})

autoUpdater.on('update-downloaded', (info) => {
  sendToWindow('update:status', { status: 'downloaded', version: info.version })
})

autoUpdater.on('error', (error) => {
  sendToWindow('update:status', { status: 'error', message: error?.message || String(error) })
})

function createWindow() {
  const isAsar = __dirname.includes('app.asar')
  const preloadPath = isAsar
    ? path.join(__dirname, '../dist-electron/electron/preload.cjs')
    : path.join(app.getAppPath(), 'electron', 'preload.cjs')
  console.log('[debug] app.getAppPath():', app.getAppPath())
  console.log('[debug] preload 路径:', preloadPath)
  console.log('[debug] preload 是否存在:', existsSync(preloadPath))

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'GPT Image Playground',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      devTools: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.webContents.on('preload-error', (_event, preloadPath, err) => {
    console.error('[preload-error] 加载失败:', preloadPath, err)
  })

  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (message.includes('electronAPI') || message.includes('preload')) {
      console.log(`[renderer:${level}] ${message}`)
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  initLocalSavePath()
  registerIpcHandlers()

  ipcMain.handle('update:check', async () => {
    try {
      await autoUpdater.checkForUpdates()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('update:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true)
    return { success: true }
  })

  ipcMain.handle('app:get-version', () => {
    return app.getVersion()
  })

  createWindow()

  if (!process.env.VITE_DEV_SERVER_URL) {
    autoUpdater.checkForUpdates()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
