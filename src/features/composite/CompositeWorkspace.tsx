import { useEffect, useState } from 'react'
import { BatchExportTab } from './components/BatchExportTab'
import { PresetManagementTab } from './components/PresetManagementTab'
import { useCompositeV2Store } from './storeV2'

type CompositeTab = 'batch' | 'presets'

export default function CompositeWorkspace() {
  const [tab, setTab] = useState<CompositeTab>('batch')
  const canUndo = useCompositeV2Store((state) => state.canUndo)
  const undo = useCompositeV2Store((state) => state.undo)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return
      if (event.key.toLowerCase() !== 'z' || !canUndo) return
      const target = event.target as HTMLElement | null
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || Boolean(target?.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      undo()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [canUndo, undo])

  return (
    <main className="flex h-[calc(100vh-var(--app-header-offset))] min-h-0 flex-col overflow-hidden bg-gray-50 p-4 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <nav aria-label="后期处理工作区" className="mb-4 flex shrink-0 items-center gap-1 border-b border-gray-200 dark:border-white/[0.08]">
        <button
          type="button"
          aria-pressed={tab === 'batch'}
          onClick={() => setTab('batch')}
          className={`border-b-2 px-4 py-2.5 text-sm font-medium ${
            tab === 'batch'
              ? 'border-blue-600 text-blue-700 dark:text-blue-300'
              : 'border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-100'
          }`}
        >
          批量导出
        </button>
        <button
          type="button"
          aria-pressed={tab === 'presets'}
          onClick={() => setTab('presets')}
          className={`border-b-2 px-4 py-2.5 text-sm font-medium ${
            tab === 'presets'
              ? 'border-blue-600 text-blue-700 dark:text-blue-300'
              : 'border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-100'
          }`}
        >
          预设管理
        </button>
      </nav>
      {tab === 'batch' ? <BatchExportTab /> : <PresetManagementTab />}
    </main>
  )
}
