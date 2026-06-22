import { app, BrowserWindow, ipcMain, nativeImage, protocol, net } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { autoUpdater } from 'electron-updater'
import { registerIpcHandlers, initLocalSavePath } from './ipc-handlers'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null
let pendingReleaseNotes: unknown

const iconPath = path.join(__dirname, '../public/app-icon.png')
const appIcon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined

autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true
// 允许预发布版本以跳过 getLatestTagName 的 406 错误
// 实际版本均为稳定版，无影响
autoUpdater.allowPrerelease = true

// 配置 GitHub 作为更新源
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'nideyilian',
  repo: 'doupao',
})

function sendToWindow(channel: string, ...args: unknown[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

autoUpdater.on('checking-for-update', () => {
  sendToWindow('update:status', { status: 'checking' })
})

autoUpdater.on('update-available', (info) => {
  pendingReleaseNotes = info.releaseNotes
  sendToWindow('update:status', { status: 'available', version: info.version, releaseNotes: info.releaseNotes })
})

autoUpdater.on('update-not-available', (info) => {
  pendingReleaseNotes = undefined
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
  sendToWindow('update:status', { status: 'downloaded', version: info.version, releaseNotes: info.releaseNotes ?? pendingReleaseNotes })
})

autoUpdater.on('error', (error) => {
  pendingReleaseNotes = undefined
  const rawMessage = error?.message || String(error)
  console.error('[autoUpdater] error:', rawMessage)

  // 将技术错误转换为用户友好的中文提示
  let friendlyMessage = rawMessage
  if (rawMessage.includes('Cannot find latest.yml') || rawMessage.includes('latest.yml')) {
    friendlyMessage = '未找到更新文件，可能还没有发布新版本'
  } else if (rawMessage.includes('404')) {
    friendlyMessage = '未找到更新资源，请稍后重试'
  } else if (rawMessage.includes('406')) {
    friendlyMessage = '服务器拒绝了请求，请检查网络或稍后再试'
  } else if (rawMessage.includes('403')) {
    friendlyMessage = '访问被拒绝，可能是请求过于频繁'
  } else if (rawMessage.includes('429')) {
    friendlyMessage = '请求过于频繁，请稍后再试'
  } else if (/50[0-9]/.test(rawMessage)) {
    friendlyMessage = '更新服务器暂时不可用，请稍后重试'
  } else if (rawMessage.includes('422')) {
    friendlyMessage = '更新请求格式错误，请检查发布配置'
  } else if (rawMessage.includes('ECONNREFUSED') || rawMessage.includes('ETIMEDOUT') || rawMessage.includes('ENOTFOUND') || rawMessage.includes('ENETUNREACH')) {
    friendlyMessage = '网络连接失败，请检查网络后重试'
  } else if (rawMessage.includes('certificate') || rawMessage.includes('CERT')) {
    friendlyMessage = '网络证书验证失败，请检查网络环境'
  } else if (rawMessage.includes('redirect') || rawMessage.includes('redirected')) {
    friendlyMessage = '更新地址发生跳转，请稍后重试'
  } else if (rawMessage.length > 120) {
    // 对于未识别的长错误，截断并提示用户
    friendlyMessage = '更新服务暂时不可用，请稍后重试'
  }

  sendToWindow('update:status', { status: 'error', message: friendlyMessage })
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
    title: 'DOUPAO Image',
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#1a1a2e',
    icon: appIcon,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      devTools: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadURL('app://./index.html')
  }

  mainWindow.webContents.on('preload-error', (_event, preloadPath, err) => {
    console.error('[preload-error] 加载失败:', preloadPath, err)
  })

  mainWindow.webContents.on('dom-ready', () => {
    mainWindow?.webContents.executeJavaScript(`
      if (!window.electronAPI) {
        console.error('[critical] preload failed to inject electronAPI - environment detection will use userAgent fallback')
      }
    `).catch(() => {})
  })

  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (message.includes('electronAPI') || message.includes('preload')) {
      console.log(`[renderer:${level}] ${message}`)
    }
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer-crash] reason=${details.reason} exitCode=${details.exitCode}`)
    // 不再自动 reload，避免刷新打断生图任务
    // 如果渲染进程崩溃，用户可手动重启应用
  })

  mainWindow.on('unresponsive', () => {
    console.error('[window-unresponsive]')
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

process.on('uncaughtException', (error) => {
  console.error('[main-uncaughtException]', error)
})

process.on('unhandledRejection', (reason) => {
  console.error('[main-unhandledRejection]', reason)
})

app.whenReady().then(() => {
  if (!process.env.VITE_DEV_SERVER_URL) {
    protocol.handle('app', (request) => {
      const url = new URL(request.url)
      const filePath = path.join(__dirname, '../dist', url.pathname)
      return net.fetch('file:///' + path.normalize(filePath).replace(/\\/g, '/'))
    })
  }

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
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {})
    }, 5000)
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
