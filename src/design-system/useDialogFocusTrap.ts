import { useEffect, useRef, type RefObject } from 'react'

const dialogStack: number[] = []
let nextDialogId = 0

const FOCUSABLE_SELECTOR = [
  '[data-autofocus]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'textarea:not(:disabled)',
  'select:not(:disabled)',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useDialogFocusTrap(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  const dialogIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active) return

    const dialogId = nextDialogId++
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogIdRef.current = dialogId
    dialogStack.push(dialogId)

    const frame = requestAnimationFrame(() => {
      const container = containerRef.current
      if (!container) return
      const currentFocus = document.activeElement
      if (currentFocus instanceof HTMLElement && container.contains(currentFocus)) return
      const target = initialFocusRef?.current ?? container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      target?.focus()
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || dialogStack[dialogStack.length - 1] !== dialogId) return
      const container = containerRef.current
      if (!container) return

      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true')
      if (focusable.length === 0) {
        event.preventDefault()
        container.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (!container.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
      const index = dialogStack.lastIndexOf(dialogId)
      if (index >= 0) dialogStack.splice(index, 1)
      dialogIdRef.current = null
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [active, containerRef, initialFocusRef])
}
