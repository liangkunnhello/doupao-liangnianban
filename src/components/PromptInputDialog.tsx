import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'

export default function PromptInputDialog() {
  const promptInputDialog = useStore((s) => s.promptInputDialog)
  const setPromptInputDialog = useStore((s) => s.setPromptInputDialog)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

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

  if (!promptInputDialog) return null

  const confirmText = promptInputDialog.confirmText ?? '确认'
  const cancelText = promptInputDialog.cancelText ?? '取消'

  return (
    <div
      data-no-drag-select
      className="fixed inset-0 z-[110] flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-md animate-overlay-in" />
      <div
        className="relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border border-white/50 dark:border-white/[0.08] rounded-3xl shadow-[0_8px_40px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_40px_rgb(0,0,0,0.4)] max-w-sm w-full p-6 z-10 ring-1 ring-black/5 dark:ring-white/10 animate-confirm-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-base font-bold text-gray-800 dark:text-gray-100">
          {promptInputDialog.title}
        </h3>
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
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-300/40 dark:focus:ring-blue-500/30 transition-all"
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