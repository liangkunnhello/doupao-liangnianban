import { useState } from 'react'
import type { CompositeV2ExportStatus, CompositeV2FailureItem, CompositeV2HistoryRecord, CompositeV2SuccessItem } from '../lib/compositeV2Types'
import { useCompositeV2Store } from '../storeV2'
import { runDistribution } from '../lib/compositeDistribution'
import { useAppDialog } from '../../../hooks/useAppDialog'

type ExportResultsPanelProps = {
  status: CompositeV2ExportStatus
  completed: number
  total: number
  history: CompositeV2HistoryRecord[]
  successes: CompositeV2SuccessItem[]
  failures: CompositeV2FailureItem[]
  distributionStatus: 'idle' | 'running' | 'completed' | 'failed' | 'canceled'
  distributionCompleted: number
  distributionTotal: number
  distributionSuccesses: import('../lib/compositeV2Types').CompositeV2DistributionSuccessItem[]
  distributionFailures: import('../lib/compositeV2Types').CompositeV2DistributionFailureItem[]
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

export function ExportResultsPanel({ status, completed, total, history, successes, failures, distributionStatus, distributionCompleted, distributionTotal, distributionSuccesses, distributionFailures }: ExportResultsPanelProps) {
  const { openConfirmDialog, openInfoDialog } = useAppDialog()
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0
  const distProgress = distributionTotal > 0 ? Math.round((distributionCompleted / distributionTotal) * 100) : 0
  const latestHistory = history.slice(0, 3)
  const historyRetention = useCompositeV2Store((state) => state.historyRetention)
  const setHistoryRetention = useCompositeV2Store((state) => state.setHistoryRetention)
  const updateHistoryRecord = useCompositeV2Store((state) => state.updateHistoryRecord)
  const distributionConfig = useCompositeV2Store((state) => state.distributionConfig)
  const presets = useCompositeV2Store((state) => state.presets)
  
  const [distributingId, setDistributingId] = useState<string | null>(null)

  function handleRedistribute(record: CompositeV2HistoryRecord) {
    if (!distributionConfig.enabled) {
      openInfoDialog({ title: '无法重新分配', message: '请先在分配设置中启用自动分配并配置规则。' })
      return
    }
    if (!distributionConfig.startDate || !/^(\d{4})(\d{2})(\d{2})$/.test(distributionConfig.startDate)) {
      openInfoDialog({ title: '起始日期格式错误', message: '请输入 YYYYMMDD 格式的日期，例如 20260701。' })
      return
    }
    const electronApi = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!electronApi) {
      openInfoDialog({ title: '当前环境不支持', message: '当前环境无法执行本地文件操作。' })
      return
    }
    if (record.successes.length === 0) {
      openInfoDialog({ title: '没有可分配文件', message: '该记录没有成功导出的文件，无法重新分配。' })
      return
    }
    openConfirmDialog({
      title: '重新分配导出文件？',
      message: `将按照当前分配规则处理 ${record.successes.length} 个文件。`,
      confirmText: '开始分配',
      action: () => void executeRedistribute(record, electronApi),
    })
  }

  async function executeRedistribute(record: CompositeV2HistoryRecord, electronApi: NonNullable<typeof window.electronAPI>) {
    setDistributingId(record.id)
    updateHistoryRecord(record.id, { distributionStatus: 'running' })
    try {
      const distSuccesses: import('../lib/compositeV2Types').CompositeV2DistributionSuccessItem[] = []
      const distFailures: import('../lib/compositeV2Types').CompositeV2DistributionFailureItem[] = []
      const result = await runDistribution(record.successes, distributionConfig, electronApi, presets, {
        onProgress: (c, t) => {
          // You could update store here, but since it's a history record we just let it show '分配中...' 
          // or we can update the history record with progress if we add progress fields to it.
          // For now, updating history record constantly might be too heavy.
        },
        onSuccess: (item) => distSuccesses.push(item),
        onFailure: (item) => distFailures.push(item)
      })
      const finalDistStatus = result.errors.length > 0 && result.success === 0 ? 'failed' : 'completed'
      updateHistoryRecord(record.id, {
        distributionStatus: finalDistStatus,
        distributionSuccessCount: result.success,
        distributionFailureCount: result.failed,
        distributionErrors: result.errors,
        distributionSuccesses: distSuccesses,
        distributionFailures: distFailures,
      })
      openInfoDialog({
        title: '重新分配完成',
        message: `成功 ${result.success} 个，失败 ${result.failed} 个。${result.errors.length > 0 ? '\n错误详情已写入控制台。' : ''}`,
      })
      if (result.errors.length > 0) {
        console.error('分发错误：', result.errors)
      }
    } catch (error: any) {
      updateHistoryRecord(record.id, { distributionStatus: 'failed', distributionErrors: [error.message] })
      openInfoDialog({ title: '重新分配失败', message: error.message })
    } finally {
      setDistributingId(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">任务与分配记录</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">导出进度、分配状态与历史记录。</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 dark:border-white/[0.08] dark:text-gray-300">
            {STATUS_LABELS[status]}
          </span>
          {distributionStatus !== 'idle' && (
            <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 dark:border-white/[0.08] dark:text-gray-300">
              分配: {distributionStatus === 'running' ? '执行中' : distributionStatus === 'completed' ? '已完成' : distributionStatus === 'failed' ? '失败' : '已取消'}
            </span>
          )}
        </div>
      </div>

      {(successes.length > 0 || failures.length > 0) && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div>
            <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-300">导出成功 {successes.length}</h4>
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
            <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-300">导出失败 {failures.length}</h4>
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

      {(distributionSuccesses.length > 0 || distributionFailures.length > 0) && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div>
            <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-300">分配成功 {distributionSuccesses.length}</h4>
            <div className="mt-2 max-h-36 space-y-1 overflow-auto">
              {distributionSuccesses.map((item, index) => (
                <div key={`dist-succ-${index}`} className="rounded border border-gray-200 px-2 py-1 text-xs dark:border-white/[0.08]">
                  <div className="truncate text-gray-400" title={item.originalPath}>{item.originalPath}</div>
                  <div className="truncate text-green-600 dark:text-green-400" title={item.targetPath}>-&gt; {item.targetPath}</div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-300">分配失败 {distributionFailures.length}</h4>
            <div className="mt-2 max-h-36 space-y-1 overflow-auto">
              {distributionFailures.map((item, index) => (
                <div key={`dist-fail-${index}`} className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 dark:border-red-500/30 dark:text-red-300">
                  <div className="truncate">{item.originalPath}</div>
                  <div>{item.error}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div className="h-full rounded-full bg-blue-500 transition-[width]" style={{ width: `${progress}%` }} />
      </div>

      {distributionStatus !== 'idle' && (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <div className="h-full rounded-full bg-green-500 transition-[width]" style={{ width: `${distProgress}%` }} />
        </div>
      )}

      <div className="mt-3 grid gap-3 text-sm text-gray-600 dark:text-gray-300 sm:grid-cols-3">
        <div className="rounded-md bg-gray-50 px-3 py-2 dark:bg-white/[0.04]">
          <div className="text-[11px] text-gray-400 dark:text-gray-500">导出已处理</div>
          <div className="mt-1 font-medium">{completed} / {total}</div>
        </div>
        <div className="rounded-md bg-gray-50 px-3 py-2 dark:bg-white/[0.04]">
          <div className="text-[11px] text-gray-400 dark:text-gray-500">导出进度</div>
          <div className="mt-1 font-medium">{progress}%</div>
        </div>
        <div className="rounded-md bg-gray-50 px-3 py-2 dark:bg-white/[0.04]">
          <div className="text-[11px] text-gray-400 dark:text-gray-500">分配进度</div>
          <div className="mt-1 font-medium">{distributionStatus !== 'idle' ? `${distributionCompleted} / ${distributionTotal}` : '-'}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between shrink-0">
          <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400">最近记录</h4>
          <label className="flex items-center gap-2 text-xs text-gray-400">
            保留
            <input type="number" min={1} value={historyRetention} onChange={(event) => setHistoryRetention(Number(event.target.value))} className="w-16 rounded border border-gray-200 px-2 py-1 dark:border-white/[0.08] dark:bg-gray-900" />
            次
          </label>
        </div>
        <div className="mt-2 space-y-2 flex-1 overflow-y-auto min-h-0">
          {latestHistory.length ? latestHistory.map((item) => (
            <div key={item.id} className="rounded-md border border-gray-200 px-3 py-2 text-xs text-gray-600 dark:border-white/[0.08] dark:text-gray-300">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-gray-800 dark:text-gray-100">{item.presetGroupName}</span>
                <span className="text-gray-400 dark:text-gray-500">{formatTimestamp(item.endedAt)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="flex flex-wrap gap-3 text-gray-500 dark:text-gray-400">
                  <span>{item.backgroundCount} 张背景</span>
                  <span>{item.successCount} 成功</span>
                  <span>{item.failureCount} 失败</span>
                  {item.distributionStatus && (
                    <span className="flex items-center gap-1">
                      <span className="w-[1px] h-3 bg-gray-300 dark:bg-gray-700 mx-1"></span>
                      <span>分配: </span>
                      {item.distributionStatus === 'running' ? (
                        <span className="text-blue-500">进行中...</span>
                      ) : item.distributionStatus === 'failed' ? (
                        <span className="text-red-500" title={item.distributionErrors?.join('\n')}>失败</span>
                      ) : (
                        <span>{item.distributionSuccessCount ?? 0} 成功, {item.distributionFailureCount ?? 0} 失败</span>
                      )}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  disabled={distributingId === item.id || item.successCount === 0}
                  onClick={() => handleRedistribute(item)}
                  className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-600 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20"
                >
                  {distributingId === item.id ? '分配中...' : '重新分配'}
                </button>
              </div>
            </div>
          )) : (
            <div className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-xs text-gray-400 dark:border-white/[0.08] dark:text-gray-500">
              完成导出后会在这里保存结果与历史记录。
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
