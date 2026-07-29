import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAutoUpdate } from '../hooks/useAutoUpdate'
import { formatUpdateReleaseNotes } from '../lib/updateReleaseNotes'
import { isElectron as isElectronEnv } from '../lib/localSave'
import { CloseIcon } from './icons'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useDialogFocusTrap } from '../design-system'

const DISMISSED_VERSION_KEY = 'gpt-image-playground.dismissed-update-notes-version'

export default function UpdateReleaseNotesModal() {
  const autoUpdate = useAutoUpdate()
  const [visibleVersion, setVisibleVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!isElectronEnv()) return
    if (autoUpdate.status !== 'downloaded' || !autoUpdate.version) return

    const dismissedVersion = window.sessionStorage.getItem(DISMISSED_VERSION_KEY)
    if (dismissedVersion === autoUpdate.version) return

    setVisibleVersion(autoUpdate.version)
  }, [autoUpdate.status, autoUpdate.version])

  const releaseNotes = useMemo(
    () => formatUpdateReleaseNotes(autoUpdate.releaseNotes),
    [autoUpdate.releaseNotes],
  )

  const modalRef = useRef<HTMLDivElement>(null)
  const open = Boolean(visibleVersion && autoUpdate.status === 'downloaded')
  const close = useCallback(() => {
    if (!visibleVersion) return
    window.sessionStorage.setItem(DISMISSED_VERSION_KEY, visibleVersion)
    setVisibleVersion(null)
  }, [visibleVersion])

  useCloseOnEscape(open, close)
  usePreventBackgroundScroll(open, modalRef)
  useDialogFocusTrap(open, modalRef)

  if (!open || !visibleVersion) return null

  return createPortal(
    <div className="ds-modal-layer fixed inset-0 flex items-center justify-center p-4">
      <div className="ds-modal-scrim absolute inset-0" onClick={close} />
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="update-release-notes-title" className="ds-modal-surface relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 dark:border-white/[0.06]">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-green-600 dark:text-green-400">更新已下载</p>
            <h2 id="update-release-notes-title" className="mt-1 text-lg font-bold text-gray-900 dark:text-gray-100">v{visibleVersion} 更新内容</h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            aria-label="关闭更新内容"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 custom-scrollbar">
          <div className="whitespace-pre-wrap text-sm leading-6 text-gray-600 dark:text-gray-300">
            {releaseNotes}
          </div>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-gray-100 px-5 py-4 dark:border-white/[0.06] sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={close}
            className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]"
          >
            稍后安装
          </button>
          <button
            type="button"
            onClick={autoUpdate.install}
            className="rounded-xl bg-green-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-600"
          >
            立即重启安装
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
