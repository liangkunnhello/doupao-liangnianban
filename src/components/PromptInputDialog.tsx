import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useDialogFocusTrap } from '../design-system'

export default function PromptInputDialog() {
  const promptInputDialog = useStore((s) => s.promptInputDialog)
  const setPromptInputDialog = useStore((s) => s.setPromptInputDialog)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setInputValue(promptInputDialog?.initialValue ?? '')
  }, [promptInputDialog])

  useEffect(() => {
    if (promptInputDialog) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [promptInputDialog])

  const handleClose = () => {
    promptInputDialog?.onCancel?.()
    setPromptInputDialog(null)
  }

  const handleConfirm = () => {
    if (!promptInputDialog) return
    promptInputDialog.action(inputValue)
    setPromptInputDialog(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleConfirm()
    }
  }

  useCloseOnEscape(Boolean(promptInputDialog), handleClose)
  usePreventBackgroundScroll(Boolean(promptInputDialog))
  useDialogFocusTrap(Boolean(promptInputDialog), dialogRef, inputRef)

  if (!promptInputDialog) return null

  const confirmText = promptInputDialog.confirmText ?? '确认'
  const cancelText = promptInputDialog.cancelText ?? '取消'

  return (
    <div
      data-no-drag-select
      className="ds-modal-layer fixed inset-0 flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div className="ds-modal-scrim absolute inset-0 animate-overlay-in motion-reduce:animate-none" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-input-dialog-title"
        className="ds-modal-surface relative z-10 w-full max-w-sm rounded-2xl border p-6 animate-confirm-in motion-reduce:animate-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="prompt-input-dialog-title" className="mb-4 text-base font-bold text-gray-800 dark:text-gray-100">
          {promptInputDialog.title}
        </h2>
        <label className="block mb-4">
          <span className="block text-sm text-gray-500 dark:text-gray-400 mb-2">
            {promptInputDialog.label}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={promptInputDialog.placeholder}
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-300/40 dark:focus:ring-blue-500/30 transition"
          />
        </label>
        <div className="flex gap-2">
          <button
            onClick={handleClose}
            className="flex-1 py-2 rounded-lg border border-gray-200 dark:border-white/[0.08] text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.06] transition"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
