const CHUNK_LOAD_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /loading chunk \d+ failed/i,
  /importing a module script failed/i,
]

export function isChunkLoadFailure(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : String(error ?? '')
  return CHUNK_LOAD_PATTERNS.some((pattern) => pattern.test(message))
}

export function installChunkLoadRecovery(win: Window = window) {
  const isElectronRuntime = (typeof (win as unknown as Record<string, unknown>).electronAPI !== 'undefined'
    && ((win as unknown as Record<string, { isElectron?: boolean }>).electronAPI?.isElectron === true))
    || (typeof win.navigator !== 'undefined' && win.navigator.userAgent.includes('Electron'))

  if (isElectronRuntime) return

  const reloadOnce = () => {
    const key = 'chunk-load-recovery-reloaded'
    try {
      if (win.sessionStorage.getItem(key) === '1') return
      win.sessionStorage.setItem(key, '1')
    } catch { return }
    win.location.reload()
  }

  win.addEventListener('error', (event) => {
    if (isChunkLoadFailure(event.error) || isChunkLoadFailure(event.message)) reloadOnce()
  })
  win.addEventListener('unhandledrejection', (event) => {
    if (isChunkLoadFailure(event.reason)) reloadOnce()
  })
  win.addEventListener('load', () => {
    try { win.sessionStorage.removeItem('chunk-load-recovery-reloaded') } catch {}
  })
}
