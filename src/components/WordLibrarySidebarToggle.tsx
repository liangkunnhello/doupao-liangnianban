import { useStore } from '../store'
import { useTooltip } from '../hooks/useTooltip'
import ViewportTooltip from './ViewportTooltip'

export default function WordLibrarySidebarToggle() {
  const wordLibrarySidebarOpen = useStore((s) => s.wordLibrarySidebarOpen)
  const setWordLibrarySidebarOpen = useStore((s) => s.setWordLibrarySidebarOpen)
  const tooltip = useTooltip()

  return (
    <div className="relative" {...tooltip.handlers}>
      <button
        type="button"
        onClick={() => setWordLibrarySidebarOpen(!wordLibrarySidebarOpen)}
        className={`p-2.5 rounded-xl transition-all shadow-sm ${
          wordLibrarySidebarOpen
            ? 'bg-blue-500 text-white hover:bg-blue-600'
            : 'bg-gray-200 dark:bg-white/[0.06] text-gray-500 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-white/[0.1]'
        }`}
        aria-label="词条库"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      </button>
      <ViewportTooltip visible={tooltip.visible} className="whitespace-nowrap">
        词条库
      </ViewportTooltip>
    </div>
  )
}
