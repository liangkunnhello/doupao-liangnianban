import { useStore } from '../store'
import { ToastMessage } from '../design-system'

const TOAST_TONE = {
  success: 'success',
  error: 'danger',
  info: 'info',
} as const

export default function Toast() {
  const toast = useStore((s) => s.toast)

  if (!toast) return null

  const tone = TOAST_TONE[toast.type] ?? 'info'

  return (
    <div className="fixed bottom-24 left-1/2 z-[var(--ds-z-toast)] -translate-x-1/2 pointer-events-none toast-enter">
      <ToastMessage tone={tone}>{toast.message}</ToastMessage>
    </div>
  )
}
