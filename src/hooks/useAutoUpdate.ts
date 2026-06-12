import { useState, useEffect, useCallback } from 'react'

type UpdateStatus =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'not-available'; version: string }
  | { status: 'downloading'; progress: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }

type AutoUpdateHook = {
  status: string
  version?: string
  progress?: number
  message?: string
  check: () => void
  download: () => void
  install: () => void
}

export { type UpdateStatus }

export function useAutoUpdate(): AutoUpdateHook {
  const [state, setState] = useState<UpdateStatus>({ status: 'idle' })

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onUpdateStatus) return

    const unsubscribe = api.onUpdateStatus((payload: UpdateStatus) => {
      setState(payload)
    })

    return unsubscribe
  }, [])

  const check = useCallback(() => {
    window.electronAPI?.checkForUpdate?.()
  }, [])

  const download = useCallback(() => {
    window.electronAPI?.downloadUpdate?.()
  }, [])

  const install = useCallback(() => {
    window.electronAPI?.installUpdate?.()
  }, [])

  return {
    status: state.status,
    version: 'version' in state ? state.version : undefined,
    progress: 'progress' in state ? state.progress : undefined,
    message: 'message' in state ? state.message : undefined,
    check,
    download,
    install,
  }
}
