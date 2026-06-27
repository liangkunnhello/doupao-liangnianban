import type { CompositeV2ExportStatus, CompositeV2HistoryRecord } from '../lib/compositeV2Types'

type ExportResultsPanelProps = {
  status: CompositeV2ExportStatus
  completed: number
  total: number
  history: CompositeV2HistoryRecord[]
}

const STATUS_LABELS: Record<CompositeV2ExportStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  paused: 'Paused',
  canceling: 'Canceling',
  completed: 'Completed',
  canceled: 'Canceled',
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString()
}

export function ExportResultsPanel({ status, completed, total, history }: ExportResultsPanelProps) {
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0
  const latestHistory = history.slice(0, 3)

  return (
    <section className="rounded-md border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-950">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Export Results</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Progress and recent batch history stay visible here.</p>
        </div>
        <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 dark:border-white/[0.08] dark:text-gray-300">
          {STATUS_LABELS[status]}
        </span>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div className="h-full rounded-full bg-blue-500 transition-[width]" style={{ width: `${progress}%` }} />
      </div>

      <div className="mt-3 grid gap-3 text-sm text-gray-600 dark:text-gray-300 sm:grid-cols-3">
        <div className="rounded-md bg-gray-50 px-3 py-2 dark:bg-white/[0.04]">
          <div className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Completed</div>
          <div className="mt-1 font-medium">{completed} / {total}</div>
        </div>
        <div className="rounded-md bg-gray-50 px-3 py-2 dark:bg-white/[0.04]">
          <div className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Progress</div>
          <div className="mt-1 font-medium">{progress}%</div>
        </div>
        <div className="rounded-md bg-gray-50 px-3 py-2 dark:bg-white/[0.04]">
          <div className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">History</div>
          <div className="mt-1 font-medium">{history.length} runs</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Recent</h4>
          <span className="text-xs text-gray-400 dark:text-gray-500">{history.length ? 'Newest first' : 'No history yet'}</span>
        </div>
        <div className="mt-2 space-y-2">
          {latestHistory.length ? latestHistory.map((item) => (
            <div key={item.id} className="rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-600 dark:border-white/[0.08] dark:text-gray-300">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-gray-800 dark:text-gray-100">{item.presetGroupName}</span>
                <span className="text-gray-400 dark:text-gray-500">{formatTimestamp(item.endedAt)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-gray-500 dark:text-gray-400">
                <span>{item.backgroundCount} backgrounds</span>
                <span>{item.successCount} success</span>
                <span>{item.failureCount} failed</span>
              </div>
            </div>
          )) : (
            <div className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-xs text-gray-400 dark:border-white/[0.08] dark:text-gray-500">
              Batch progress will collect here after export runtime is connected.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
