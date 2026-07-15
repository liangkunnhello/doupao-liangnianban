import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { parseBatchTaskFile } from '../lib/agentBatchImport'
import { createAgentBatchPlan, type AgentBatchPlan, type BatchExecutionMode, type BatchTaskInput } from '../lib/agentBatchPlanner'
import { submitPlannedBatchUnit } from '../lib/agentBatchExecution'
import { AGENT_BATCH_QUEUE_UPDATED_EVENT, createAgentBatchQueue, saveAgentBatchQueue } from '../lib/agentBatchQueue'

function todayKey() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getExtension(path: string) {
  return path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() ?? 'csv'
}

function safeNumber(value: string, fallback: number) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

async function readSelectedTextFile() {
  const api = window.electronAPI
  if (!api?.selectFile || !api.readFileBuffer) throw new Error('当前环境不支持读取本地任务文件')
  const path = await api.selectFile([{ name: '任务表格', extensions: ['csv', 'json'] }])
  if (!path) return null
  const payload = await api.readFileBuffer(path)
  if (!payload) throw new Error('读取任务文件失败')
  return { path, text: new TextDecoder('utf-8').decode(payload.data) }
}

export default function AgentBatchPlannerModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((state) => state.settings)
  const params = useStore((state) => state.params)
  const showToast = useStore((state) => state.showToast)
  const [rows, setRows] = useState<BatchTaskInput[]>([])
  const [filePath, setFilePath] = useState('')
  const [outputRoot, setOutputRoot] = useState('')
  const [referenceRoot, setReferenceRoot] = useState('')
  const [startDate, setStartDate] = useState(todayKey())
  const [dailyLimit, setDailyLimit] = useState('2000')
  const [redundancyPercent, setRedundancyPercent] = useState('10')
  const [copyPercent, setCopyPercent] = useState('50')
  const [executionMode, setExecutionMode] = useState<BatchExecutionMode>('task-first')
  const [error, setError] = useState('')
  const [executing, setExecuting] = useState(false)
  const [submitted, setSubmitted] = useState(0)

  const planResult = useMemo<{ plan: AgentBatchPlan | null; error: string }>(() => {
    if (rows.length === 0 || !outputRoot.trim()) return { plan: null, error: '' }
    try {
      return { plan: createAgentBatchPlan(rows, {
        startDate,
        dailyLimit: safeNumber(dailyLimit, 2000),
        redundancyRate: safeNumber(redundancyPercent, 0) / 100,
        defaultCopyRatio: safeNumber(copyPercent, 50) / 100,
        executionMode,
        outputRoot,
        referenceRoot: referenceRoot.trim() || undefined,
      }), error: '' }
    } catch (reason) {
      return { plan: null, error: reason instanceof Error ? reason.message : String(reason) }
    }
  }, [copyPercent, dailyLimit, executionMode, outputRoot, redundancyPercent, referenceRoot, rows, startDate])
  const plan = planResult.plan

  const handleImport = async () => {
    setError('')
    try {
      const selected = await readSelectedTextFile()
      if (!selected) return
      const parsedRows = parseBatchTaskFile(selected.text, getExtension(selected.path))
      if (parsedRows.length === 0) throw new Error('任务文件中没有可识别的数据行')
      setRows(parsedRows)
      setFilePath(selected.path)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const chooseOutputRoot = async () => {
    const path = await window.electronAPI?.selectDirectory?.()
    if (path) setOutputRoot(path)
  }

  const chooseReferenceRoot = async () => {
    const path = await window.electronAPI?.selectDirectory?.()
    if (path) setReferenceRoot(path)
  }

  const executeFirstDay = async () => {
    if (!plan?.days[0]) return
    setExecuting(true)
    setSubmitted(0)
    setError('')
    try {
      const firstDay = plan.days[0]
      const api = window.electronAPI
      if (api) {
        await api.ensureDir(outputRoot)
        const manifestPath = await api.pathJoin(outputRoot, `agent-batch-plan-${firstDay.date}.json`)
        await api.saveJson(manifestPath, plan)
      }
      let count = 0
      for (const unit of firstDay.units) {
        await submitPlannedBatchUnit(unit, settings, params)
        count += unit.plannedCount
        setSubmitted(count)
      }
      showToast(`已提交 ${firstDay.plannedCount} 张的首日批次`, 'success')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setExecuting(false)
    }
  }

  const startAutomaticQueue = async () => {
    if (!plan) return
    setError('')
    try {
      const queue = createAgentBatchQueue(plan)
      saveAgentBatchQueue(queue)
      window.dispatchEvent(new Event(AGENT_BATCH_QUEUE_UPDATED_EVENT))
      const api = window.electronAPI
      if (api) {
        await api.ensureDir(outputRoot)
        const manifestPath = await api.pathJoin(outputRoot, `agent-batch-plan-${startDate}.json`)
        await api.saveJson(manifestPath, { ...plan, queueId: queue.id, execution: 'automatic-while-app-running' })
      }
      showToast('自动批量队列已启动；应用运行时会按日期自动提交', 'success')
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-gray-900">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">批量任务规划</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">先用 CSV / JSON 跑通拆分、参考图、数量、冗余、限额与目录；飞书同步最后接入。</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10">关闭</button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-gray-500">任务文件</span>
            <div className="flex gap-2">
              <input readOnly value={filePath} placeholder="支持 CSV、JSON" className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5" />
              <button type="button" onClick={handleImport} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">导入</button>
            </div>
            <span className="mt-1 block text-[11px] text-gray-400">必填列：SKU、产品、渠道、素材规格/需求类型、数量、方向。方向支持“旅游:50%;美食:30%;头像:20%”或“人物:30张”。</span>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-gray-500">输出母文件夹</span>
            <div className="flex gap-2"><input readOnly value={outputRoot} className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5" /><button type="button" onClick={chooseOutputRoot} className="rounded-xl border border-gray-200 px-3 text-sm dark:border-white/10">选择</button></div>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-gray-500">参考图母文件夹（可选）</span>
            <div className="flex gap-2"><input readOnly value={referenceRoot} className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5" /><button type="button" onClick={chooseReferenceRoot} className="rounded-xl border border-gray-200 px-3 text-sm dark:border-white/10">选择</button></div>
          </label>
          <label><span className="mb-1 block text-xs font-medium text-gray-500">开始日期</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5" /></label>
          <label><span className="mb-1 block text-xs font-medium text-gray-500">每日 API 图片上限</span><input type="number" min="1" value={dailyLimit} onChange={(event) => setDailyLimit(event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5" /></label>
          <label><span className="mb-1 block text-xs font-medium text-gray-500">冗余比例（%）</span><input type="number" min="0" value={redundancyPercent} onChange={(event) => setRedundancyPercent(event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5" /></label>
          <label><span className="mb-1 block text-xs font-medium text-gray-500">默认有文案占比（%）</span><input type="number" min="0" max="100" value={copyPercent} onChange={(event) => setCopyPercent(event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5" /></label>
          <label className="sm:col-span-2"><span className="mb-1 block text-xs font-medium text-gray-500">执行顺序</span><select value={executionMode} onChange={(event) => setExecutionMode(event.target.value as BatchExecutionMode)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-900"><option value="task-first">一个任务完成后再处理下一个</option><option value="balanced">所有任务按日均衡排队</option></select></label>
        </div>

        {(error || planResult.error) && <div className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-300">{error || planResult.error}</div>}
        {plan && (
          <div className="mt-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['任务行', rows.length],
                ['目标数量', plan.targetCount],
                ['含冗余', plan.plannedCount],
                ['预计天数', plan.days.length],
              ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-gray-50 p-3 dark:bg-white/5"><div className="text-xs text-gray-500">{label}</div><div className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{value}</div></div>)}
            </div>
            <div className="mt-4 max-h-52 overflow-y-auto rounded-xl border border-gray-200 dark:border-white/10">
              {plan.days.map((day) => <div key={day.date} className="flex items-center justify-between border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 dark:border-white/5"><span>{day.date}</span><span className="text-gray-500">{day.units.length} 个方向批次 · {day.plannedCount} 张</span></div>)}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              {executing && <span className="text-sm text-gray-500">已提交 {submitted} 张</span>}
              <button type="button" disabled={executing} onClick={startAutomaticQueue} className="rounded-xl border border-blue-200 px-5 py-2.5 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-500/30 dark:text-blue-300 dark:hover:bg-blue-500/10">启动按日自动队列</button>
              <button type="button" disabled={executing || !plan.days[0]} onClick={executeFirstDay} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">{executing ? '正在提交…' : `执行首日批次（${plan.days[0]?.plannedCount ?? 0} 张）`}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
