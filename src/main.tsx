import 'core-js/actual/array/at'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'streamdown/styles.css'
import './index.css'
import './design-system/styles.css'
import { installMobileViewportGuards } from './lib/viewport'
import { installChunkLoadRecovery } from './lib/chunkRecovery'

installMobileViewportGuards()
installChunkLoadRecovery()

if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error) => {
        console.error('Service worker registration failed:', error)
      })
    })
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return
      refreshing = true
      window.location.reload()
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    })
  }
}

const DesignSystemPreview = lazy(() => import('./design-system/DesignSystemPreview'))
const isDesignSystemPreview =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get('design-system') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDesignSystemPreview ? (
      <Suspense fallback={null}>
        <DesignSystemPreview />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
