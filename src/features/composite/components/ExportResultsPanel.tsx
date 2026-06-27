import type { CompositeV2ExportStatus, CompositeV2FailureItem, CompositeV2HistoryRecord, CompositeV2SuccessItem } from '../lib/compositeV2Types'
import { useCompositeV2Store } from '../storeV2'

type ExportResultsPanelProps = {
  status: CompositeV2ExportStatus
  completed: number
  total: number
  history: CompositeV2HistoryRecord[]
  successes: CompositeV2SuccessItem[]
  failures: CompositeV2FailureItem[]
}

const STATUS_LABELS: Record<CompositeV2ExportStatus, string> = {
  idle: '待开始',
  running: '导出中',
  paused: '已暂停',
  canceling: '正在取消',
  completed: '已完成',
  canceled: '已取消',
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString()
}

export function ExportResultsPanel({ status, completed, total, history, successes, failures }: ExportResultsPanelProps) {
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0
  const latestHistory = history.slice(0, 3)
  const historyRetention = useCompositeV2Store((state) => state.historyRetention)
  const setHistoryRetention = useCompositeV2Store((state) => state.setHistoryRetention)

  return (
    <section className="rounded-md border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-950">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">导出结果</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">进度、成功警告、失败原因与历史记录。</p>
        </div>
        <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 dark:border-white/[0.08] dark:text-gray-300">
          {STATUS_LABELS[status]}
        </span>
      </div>

      {(successes.length > 0 || failures.length > 0) && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div>
            <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-300">成功 {successes.length}</h4>
            <div className="mt-2 max-h-36 space-y-1 overflow-auto">
              {successes.map((item) => (
                <div key={item.path} className="rounded border border-gray-200 px-2 py-1 text-xs dark:border-white/[0.08]">
                  <div className="truncate" title={item.path}>{item.path}</div>
                  {item.warning && <div className="mt-1 text-amber-600">警告：{item.warning}</div>}
                </div>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-300">失败 {failures.length}</h4>
            <div className="mt-2 max-h-36 space-y-1 overflow-auto">
              {failures.map((item, index) => (
                <div key={`${item.backgroundPath}-${item.presetId}-${index}`} className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 dark:border-red-500/30 dark:text-red-300">
                  <div className="truncate">{item.backgroundPath}</div>
                  <div>{item.presetName} / {item.channel} / {item.size}：{item.reason}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div className="h-full rounded-full bg-blue-500 transition-[width]" style={{ width: `${progress}%` }} />
      </div>

      <div className="mt-3 grid gap-3 text-sm text-gray-600 dark:text-gray-300 sm:grid-cols-3">
        <div className="rounded-md bg-gray-50 px-3 py-2 dark:bg-white/[0.04]">
          <div className="text-[11px] text-gray-400 dark:text-gray-500">已处理</div>
          <div className="mt-1 font-medium">{completed} / {total}</div>
        </div>
        <div className="rounded-md bg-gray-50 px-3 py-2 dark:bg-white/[0.04]">
          <div className="text-[11px] text-gray-400 dark:text-gray-500">进度</div>
          <div className="mt-1 font-medium">{progress}%</div>
        </div>
        <div className="rounded-md bg-gray-50 px-3 py-2 dark:bg-white/[0.04]">
          <div className="text-[11px] text-gray-400 dark:text-gray-500">历史</div>
          <div className="mt-1 font-medium">{history.length} 次</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">最近记录</h4>
          <label className="flex items-center gap-2 text-xs text-gray-400">
            保留
            <input type="number" min={1} value={historyRetention} onChange={(event) => setHistoryRetention(Number(event.target.value))} className="w-16 rounded border border-gray-200 px-2 py-1 dark:border-white/[0.08] dark:bg-gray-900" />
            次
          </label>
        </div>
        <div className="mt-2 space-y-2">
          {latestHistory.length ? latestHistory.map((item) => (
            <div key={item.id} className="rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-600 dark:border-white/[0.08] dark:text-gray-300">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-gray-800 dark:text-gray-100">{item.presetGroupName}</span>
                <span className="text-gray-400 dark:text-gray-500">{formatTimestamp(item.endedAt)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-gray-500 dark:text-gray-400">
                <span>{item.backgroundCount} 张背景</span>
                <span>{item.successCount} 成功</span>
                <span>{item.failureCount} 失败</span>
              </div>
            </div>
          )) : (
            <div className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-xs text-gray-400 dark:border-white/[0.08] dark:text-gray-500">
              完成导出后会在这里保存结果与历史记录。
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
