import { useState } from 'react'
import { BatchExportTab } from './components/BatchExportTab'
import { PresetManagementTab } from './components/PresetManagementTab'

type CompositeTab = 'batch' | 'presets'

export default function CompositeWorkspace() {
  const [tab, setTab] = useState<CompositeTab>('batch')

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
