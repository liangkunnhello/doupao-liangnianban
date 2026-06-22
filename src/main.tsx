import 'core-js/actual/array/at'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'streamdown/styles.css'
import './index.css'
import { installMobileViewportGuards } from './lib/viewport'
import { installChunkLoadRecovery } from './lib/chunkRecovery'
import { isElectron } from './lib/localSave'

installMobileViewportGuards()
installChunkLoadRecovery()

// Electron 桌面端不需要 PWA Service Worker，避免 SW 更新/缓存导致页面刷新或请求异常
const isElectronRuntime = isElectron()

if ('serviceWorker' in navigator) {
  if (isElectronRuntime) {
    // Electron 桌面端不需要 PWA Service Worker；若旧版本已注册，全部注销
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    })
  } else if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
        console.error('Service worker registration failed:', error)
      })
    })
    const SW_RELOAD_KEY = 'sw-controllerchange-reload'
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // 防止 Service Worker 反复更新导致页面无限刷新
      if (sessionStorage.getItem(SW_RELOAD_KEY) === '1') return
      sessionStorage.setItem(SW_RELOAD_KEY, '1')
      window.location.reload()
    })
    window.addEventListener('load', () => {
      sessionStorage.removeItem(SW_RELOAD_KEY)
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    })
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
