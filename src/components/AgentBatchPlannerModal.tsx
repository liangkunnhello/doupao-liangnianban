import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import type { TaskRecord } from '../types'
import { parseBatchTaskFile } from '../lib/agentBatchImport'
import { createAgentBatchPlan, parseDirectionCell, type AgentBatchPlan, type BatchDirectionInput, type BatchExecutionMode, type BatchTaskInput } from '../lib/agentBatchPlanner'
import { groupBatchValidationIssues, validateBatchTaskRows, type BatchTaskField } from '../lib/agentBatchValidation'
import { submitPlannedBatchUnit } from '../lib/agentBatchExecution'
import { getAgentImageApiProfile } from '../lib/apiProfiles'
import { AGENT_BATCH_QUEUE_UPDATED_EVENT, createAgentBatchQueue, getAgentBatchQueueStatusLabel, getBatchQueueProgress, loadAgentBatchQueues, saveAgentBatchQueues, type AgentBatchQueue } from '../lib/agentBatchQueue'
import { applyAgentBatchPreset, createAgentBatchPreset, loadAgentBatchDraft, loadAgentBatchPresets, saveAgentBatchDraft, saveAgentBatchPresets, type AgentBatchStrategyPreset } from '../lib/agentBatchWorkspace'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useDialogFocusTrap } from '../design-system'
import { isModalBackdropEvent } from '../lib/modalBackdrop'

type SortKey = 'source' | 'sku' | 'product' | 'channel' | 'quantity'

const INPUT_CLASS = 'w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-white/5 dark:text-white'
const ERROR_INPUT_CLASS = 'border-red-400 focus:border-red-500 dark:border-red-400/70'

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

function directionsToText(directions: BatchDirectionInput[]) {
  return directions.map((direction) => {
    if (direction.count != null) return `${direction.name}:${direction.count}张`
    if (direction.weight != null) return `${direction.name}:${direction.weight}%`
    return direction.name
  }).join('; ')
}

function splitSelections(value: string) {
  return value.split(/[、,，;；|]/).map((item) => item.trim()).filter(Boolean)
}

function resizeTextareaElement(textarea: HTMLTextAreaElement) {
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.max(36, textarea.scrollHeight)}px`
}

function resizeTextarea(event: { currentTarget: HTMLTextAreaElement }) {
  resizeTextareaElement(event.currentTarget)
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

function rowMatchesQuery(row: BatchTaskInput, query: string) {
  if (!query) return true
  const source = [row.sourceId, row.sku, row.product, row.channel, row.specification, row.department, row.owner, row.strategy, directionsToText(row.directions)]
    .filter(Boolean)
    .join('\n')
    .toLocaleLowerCase()
  return source.includes(query.toLocaleLowerCase())
}

export default function AgentBatchPlannerModal({ onClose }: { onClose: () => void }) {
  const modalRef = useRef<HTMLDivElement>(null)
  useCloseOnEscape(true, onClose)
  usePreventBackgroundScroll(true, modalRef)
  useDialogFocusTrap(true, modalRef)
  const settings = useStore((state) => state.settings)
  const params = useStore((state) => state.params)
  const tasks = useStore((state) => state.tasks)
  const showToast = useStore((state) => state.showToast)
  const [rows, setRows] = useState<BatchTaskInput[]>([])
  const [draftId, setDraftId] = useState(() => `agent-batch-draft-${Date.now().toString(36)}`)
  const [draftName, setDraftName] = useState('未命名批量任务')
  const [filePath, setFilePath] = useState('')
  const [outputRoot, setOutputRoot] = useState('')
  const [referenceRoot, setReferenceRoot] = useState('')
  const [startDate, setStartDate] = useState(todayKey())
  const [dailyLimit, setDailyLimit] = useState('2000')
  const [redundancyPercent, setRedundancyPercent] = useState('10')
  const [copyPercent, setCopyPercent] = useState('50')
  const [executionMode, setExecutionMode] = useState<BatchExecutionMode>('task-first')
  const [presets, setPresets] = useState<AgentBatchStrategyPreset[]>(() => loadAgentBatchPresets())
  const [activePresetId, setActivePresetId] = useState('')
  const [presetName, setPresetName] = useState('')
  const [presetStrategy, setPresetStrategy] = useState('')
  const [overwritePreset, setOverwritePreset] = useState(false)
  const [showPlanDetails, setShowPlanDetails] = useState(false)
  const [query, setQuery] = useState('')
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('source')
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [bulkStrategy, setBulkStrategy] = useState('')
  const [bulkCopyRatio, setBulkCopyRatio] = useState('')
  const [error, setError] = useState('')
  const [executing, setExecuting] = useState(false)
  const [submitted, setSubmitted] = useState(0)
  const [pendingExecution, setPendingExecution] = useState<'immediate' | 'scheduled' | null>(null)
  const [queues, setQueues] = useState<AgentBatchQueue[]>(() => loadAgentBatchQueues())

  useEffect(() => {
    const draft = loadAgentBatchDraft()
    if (!draft) return
    setDraftId(draft.id)
    setDraftName(draft.name)
    setFilePath(draft.filePath ?? '')
    setRows(draft.rows)
    setOutputRoot(draft.outputRoot ?? '')
    setReferenceRoot(draft.referenceRoot ?? '')
    setStartDate(draft.startDate ?? todayKey())
    setDailyLimit(draft.dailyLimit ?? '2000')
    setRedundancyPercent(draft.redundancyPercent ?? '10')
    setCopyPercent(draft.copyPercent ?? '50')
    setExecutionMode(draft.executionMode ?? 'task-first')
    setActivePresetId(draft.activePresetId ?? '')
  }, [])

  useEffect(() => {
    const refresh = () => setQueues(loadAgentBatchQueues())
    window.addEventListener(AGENT_BATCH_QUEUE_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(AGENT_BATCH_QUEUE_UPDATED_EVENT, refresh)
  }, [])

  useEffect(() => {
    document.querySelectorAll<HTMLTextAreaElement>('[data-batch-auto-resize]').forEach(resizeTextareaElement)
  }, [rows])

  const validationIssues = useMemo(() => validateBatchTaskRows(rows), [rows])
  const issuesByRow = useMemo(() => groupBatchValidationIssues(validationIssues), [validationIssues])
  const visibleRows = useMemo(() => rows
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => rowMatchesQuery(row, query) && (!onlyErrors || issuesByRow.has(index)))
    .sort((a, b) => {
      if (sortKey === 'source') return a.index - b.index
      if (sortKey === 'quantity') return a.row.quantity - b.row.quantity || a.index - b.index
      return a.row[sortKey].localeCompare(b.row[sortKey], 'zh-CN') || a.index - b.index
    }), [issuesByRow, onlyErrors, query, rows, sortKey])

  const planResult = useMemo<{ plan: AgentBatchPlan | null; error: string }>(() => {
    if (rows.length === 0 || !outputRoot.trim() || validationIssues.length > 0) return { plan: null, error: '' }
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
  }, [copyPercent, dailyLimit, executionMode, outputRoot, redundancyPercent, referenceRoot, rows, startDate, validationIssues.length])
  const plan = planResult.plan
  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? null
  const channelOptions = useMemo(() => [...new Set(rows.flatMap((row) => splitSelections(row.channel)))], [rows])
  const specificationOptions = useMemo(() => [...new Set(rows.flatMap((row) => splitSelections(row.specification)))], [rows])

  const updateRow = (index: number, patch: Partial<BatchTaskInput>) => {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  }

  const hasFieldIssue = (index: number, field: BatchTaskField) => issuesByRow.get(index)?.some((issue) => issue.field === field) ?? false
  const inputClass = (index: number, field: BatchTaskField) => `${INPUT_CLASS} ${hasFieldIssue(index, field) ? ERROR_INPUT_CLASS : ''}`

  const handleImport = async () => {
    setError('')
    try {
      const selected = await readSelectedTextFile()
      if (!selected) return
      const parsedRows = parseBatchTaskFile(selected.text, getExtension(selected.path))
      if (parsedRows.length === 0) throw new Error('任务文件中没有可识别的数据行')
      setRows(parsedRows)
      setSelectedRows(new Set())
      setFilePath(selected.path)
      setDraftName(selected.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || '未命名批量任务')
      showToast(`已导入 ${parsedRows.length} 行任务，请在表格中确认参数`, 'success')
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

  const toggleRow = (index: number) => {
    setSelectedRows((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const toggleVisibleRows = () => {
    const visibleIndexes = visibleRows.map(({ index }) => index)
    const everyVisibleSelected = visibleIndexes.length > 0 && visibleIndexes.every((index) => selectedRows.has(index))
    setSelectedRows((current) => {
      const next = new Set(current)
      for (const index of visibleIndexes) {
        if (everyVisibleSelected) next.delete(index)
        else next.add(index)
      }
      return next
    })
  }

  const applyBulkEdits = () => {
    if (selectedRows.size === 0) return
    const copyRatio = bulkCopyRatio.trim() === '' ? undefined : Number(bulkCopyRatio) / 100
    if (copyRatio !== undefined && (!Number.isFinite(copyRatio) || copyRatio < 0 || copyRatio > 1)) {
      setError('批量文案占比必须是 0 到 100 之间的数字')
      return
    }
    if (!bulkStrategy.trim() && copyRatio === undefined) return
    setRows((current) => current.map((row, index) => selectedRows.has(index) ? {
      ...row,
      ...(bulkStrategy.trim() ? { strategy: bulkStrategy.trim() } : {}),
      ...(copyRatio !== undefined ? { copyRatio } : {}),
    } : row))
    setError('')
    showToast(`已更新 ${selectedRows.size} 行任务`, 'success')
  }

  const saveDraft = () => {
    saveAgentBatchDraft({
      version: 1,
      id: draftId,
      name: draftName.trim() || '未命名批量任务',
      filePath,
      rows,
      outputRoot,
      referenceRoot,
      startDate,
      dailyLimit,
      redundancyPercent,
      copyPercent,
      executionMode,
      ...(activePresetId ? { activePresetId } : {}),
      updatedAt: Date.now(),
    })
    showToast('批量任务草稿已保存，本次编辑可在下次打开时恢复', 'success')
  }

  const applyPreset = () => {
    if (!activePreset) return
    const targetIndexes = selectedRows.size > 0 ? selectedRows : new Set(rows.map((_, index) => index))
    setRows((current) => current.map((row, index) => targetIndexes.has(index)
      ? applyAgentBatchPreset([row], activePreset, overwritePreset)[0]
      : row))
    setDailyLimit(String(activePreset.dailyLimit))
    setRedundancyPercent(String(activePreset.redundancyPercent))
    setCopyPercent(String(Math.round(activePreset.defaultCopyRatio * 100)))
    setExecutionMode(activePreset.executionMode)
    showToast(`已将预设「${activePreset.name}」应用到 ${targetIndexes.size} 行任务`, 'success')
  }

  const savePreset = () => {
    const name = presetName.trim()
    const strategyText = presetStrategy.trim()
    if (!name || !strategyText) {
      setError('保存预设前请填写预设名称和默认生成策略')
      return
    }
    const preset = createAgentBatchPreset({
      name,
      strategyText,
      defaultCopyRatio: Math.min(1, Math.max(0, safeNumber(copyPercent, 50) / 100)),
      redundancyPercent: Math.max(0, safeNumber(redundancyPercent, 0)),
      dailyLimit: Math.max(1, Math.trunc(safeNumber(dailyLimit, 2000))),
      executionMode,
    })
    const next = [...presets, preset]
    setPresets(next)
    saveAgentBatchPresets(next)
    setActivePresetId(preset.id)
    setError('')
    showToast(`生成策略预设「${preset.name}」已保存`, 'success')
  }

  const deleteActivePreset = () => {
    if (!activePreset) return
    const next = presets.filter((preset) => preset.id !== activePreset.id)
    setPresets(next)
    saveAgentBatchPresets(next)
    setActivePresetId('')
    showToast(`已删除预设「${activePreset.name}」`, 'success')
  }

  const createQueue = (execution: 'immediate' | 'scheduled') => {
    if (!plan) return null
    const profile = getAgentImageApiProfile(settings)
    const queue = createAgentBatchQueue(plan, {
      planName: draftName.trim() || '未命名批量任务',
      outputRoot,
      apiProfileName: profile.name,
      apiModel: profile.model,
      maxConcurrent: profile.maxConcurrent ?? 0,
      execution,
    })
    const next = [...loadAgentBatchQueues(), queue]
    saveAgentBatchQueues(next)
    setQueues(next)
    window.dispatchEvent(new Event(AGENT_BATCH_QUEUE_UPDATED_EVENT))
    return queue
  }

  const executeFirstDay = async (queue: AgentBatchQueue) => {
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
        queue.receipt.manifestPath = manifestPath
      }
      let count = 0
      for (const unit of firstDay.units) {
        const taskId = await submitPlannedBatchUnit(unit, settings, params)
        if (!taskId) throw new Error('批量任务未成功提交，请检查 API 配置')
        queue.submitted[unit.id] = { taskId, submittedAt: Date.now(), plannedCount: unit.plannedCount }
        count += unit.plannedCount
        setSubmitted(count)
      }
      queue.lastRunDate = firstDay.date
      queue.status = getBatchQueueProgress(queue).completed ? 'completed' : 'waiting'
      saveAgentBatchQueues(loadAgentBatchQueues().map((item) => item.id === queue.id ? queue : item))
      window.dispatchEvent(new Event(AGENT_BATCH_QUEUE_UPDATED_EVENT))
      showToast(`已提交 ${firstDay.plannedCount} 张的首日批次`, 'success')
    } catch (reason) {
      queue.status = 'failed'
      queue.lastError = reason instanceof Error ? reason.message : String(reason)
      saveAgentBatchQueues(loadAgentBatchQueues().map((item) => item.id === queue.id ? queue : item))
      window.dispatchEvent(new Event(AGENT_BATCH_QUEUE_UPDATED_EVENT))
      setError(queue.lastError)
    } finally {
      setExecuting(false)
    }
  }

  const startAutomaticQueue = async (queue: AgentBatchQueue) => {
    if (!plan) return
    setError('')
    try {
      const api = window.electronAPI
      if (api) {
        await api.ensureDir(outputRoot)
        const manifestPath = await api.pathJoin(outputRoot, `agent-batch-plan-${startDate}.json`)
        await api.saveJson(manifestPath, { ...plan, queueId: queue.id, execution: 'automatic-while-app-running' })
        queue.receipt.manifestPath = manifestPath
        saveAgentBatchQueues(loadAgentBatchQueues().map((item) => item.id === queue.id ? queue : item))
      }
      showToast(`自动队列已启动：首日 ${plan.days[0]?.date ?? startDate}，应用保持运行时会按日期提交`, 'success')
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const confirmExecution = () => {
    if (!pendingExecution) return
    const execution = pendingExecution
    setPendingExecution(null)
    const queue = createQueue(execution)
    if (!queue) return
    if (execution === 'immediate') void executeFirstDay(queue)
    else void startAutomaticQueue(queue)
  }

  const changeQueueStatus = (id: string, status: AgentBatchQueue['status']) => {
    const next = loadAgentBatchQueues().map((queue) => queue.id === id ? { ...queue, status, ...(status === 'waiting' ? { lastError: undefined } : {}) } : queue)
    saveAgentBatchQueues(next)
    setQueues(next)
    window.dispatchEvent(new Event(AGENT_BATCH_QUEUE_UPDATED_EVENT))
  }

  const deleteQueueRecord = (id: string) => {
    const next = loadAgentBatchQueues().filter((queue) => queue.id !== id)
    saveAgentBatchQueues(next)
    setQueues(next)
    window.dispatchEvent(new Event(AGENT_BATCH_QUEUE_UPDATED_EVENT))
  }

  const canRun = Boolean(plan && !executing)
  const visibleSelected = visibleRows.length > 0 && visibleRows.every(({ index }) => selectedRows.has(index))

  return (
    <div className="ds-modal-layer fixed inset-0 flex items-center justify-center p-2" onMouseDown={(event) => {
      if (isModalBackdropEvent(event)) onClose()
    }}>
      <div className="ds-modal-scrim pointer-events-none absolute inset-0" />
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="agent-batch-planner-title" className="ds-modal-surface relative z-10 flex h-[94vh] w-[min(1680px,99vw)] flex-col overflow-hidden rounded-2xl border">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 dark:border-white/10">
          <div>
            <h2 id="agent-batch-planner-title" className="text-base font-semibold tracking-tight text-slate-950 dark:text-white">批量任务工作台</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-gray-400">导入、校验、排程与执行均在此完成。</p>
          </div>
          <div className="flex items-center gap-2">
            <input value={draftName} onChange={(event) => setDraftName(event.target.value)} aria-label="草稿名称" className="w-48 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:ring-blue-500/20" />
            <button type="button" onClick={saveDraft} className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-blue-500/30 dark:text-blue-300 dark:hover:bg-blue-500/10">保存草稿</button>
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-slate-500 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300 dark:hover:bg-white/10">关闭</button>
          </div>
        </div>

        <nav aria-label="批量任务流程" className="grid shrink-0 grid-cols-4 border-b border-slate-200 bg-slate-50/80 px-5 dark:border-white/10 dark:bg-white/[0.03]">
          {[
            ['1', '导入数据', rows.length > 0 ? `${rows.length} 行` : 'CSV / JSON'],
            ['2', '校验修正', rows.length > 0 ? validationIssues.length > 0 ? `${validationIssues.length} 个问题` : '已通过' : '待导入'],
            ['3', '生成计划', plan ? `${plan.plannedCount} 张` : '待就绪'],
            ['4', '执行队列', queues.length > 0 ? `${queues.length} 个队列` : '待创建'],
          ].map(([step, title, description], index) => {
            const complete = index === 0 ? rows.length > 0 : index === 1 ? rows.length > 0 && validationIssues.length === 0 : index === 2 ? Boolean(plan) : queues.length > 0
            const attention = index === 1 && validationIssues.length > 0
            return <div key={step} className={`flex min-w-0 items-center gap-2 py-2.5 ${index > 0 ? 'border-l border-slate-200 pl-4 dark:border-white/10' : ''}`}>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${attention ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' : complete ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-300'}`}>{complete ? '✓' : step}</span>
              <span className="min-w-0"><span className="block truncate text-[11px] font-semibold text-slate-800 dark:text-slate-100">{title}</span><span className={`block truncate text-[10px] ${attention ? 'text-red-600 dark:text-red-300' : 'text-slate-500 dark:text-slate-400'}`}>{description}</span></span>
            </div>
          })}
        </nav>

        <div id="batch-workbench-main" className="min-h-0 flex-1 overflow-y-auto p-4">
          <section className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50/50 p-3 md:grid-cols-12 dark:border-white/10 dark:bg-white/[0.02]">
            <label className="md:col-span-12">
              <span className="sr-only">任务文件</span>
              <div className="flex gap-2">
                <span className="flex shrink-0 items-center text-xs font-medium text-gray-500">任务文件</span>
                <input readOnly value={filePath} placeholder="支持 CSV、JSON" className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-white" />
                <button type="button" onClick={() => void handleImport()} className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40">导入任务</button>
              </div>
              <span className="mt-0.5 block pl-14 text-[10px] leading-3 text-gray-400">必填：SKU、产品、渠道、规格、数量、方向；导入不会直接提交生图。</span>
            </label>
            <label className="md:col-span-5">
              <span className="mb-0.5 block text-[11px] font-medium text-gray-500">输出目录</span>
              <div className="flex gap-1.5"><input readOnly value={outputRoot} className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5" /><button type="button" onClick={() => void chooseOutputRoot()} className="rounded-lg border border-gray-200 px-2.5 text-xs dark:border-white/10">选择</button></div>
            </label>
            <label className="md:col-span-5">
              <span className="mb-0.5 block text-[11px] font-medium text-gray-500">参考图目录（可选）</span>
              <div className="flex gap-1.5"><input readOnly value={referenceRoot} placeholder="未选择：按任务文生图" className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5" /><button type="button" onClick={() => void chooseReferenceRoot()} className="rounded-lg border border-gray-200 px-2.5 text-xs dark:border-white/10">选择</button></div>
              <span className="mt-0.5 block text-[10px] leading-3 text-gray-400">{referenceRoot ? '已启用：该目录内图片将用于本工作台的全部任务。' : '未启用：将根据任务参数直接文生图。'}</span>
            </label>
          </section>

          <details className="group mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.02]">
            <summary className="cursor-pointer list-none text-xs font-medium text-gray-600 marker:hidden dark:text-gray-300">高级设置 <span className="ml-1 font-normal text-gray-400">{startDate} · 每日 {dailyLimit} 张 · 冗余 {redundancyPercent}% · {executionMode === 'task-first' ? '顺序执行' : '均衡排队'}</span></summary>
            <div className="mt-2 grid gap-2 md:grid-cols-5">
              <label><span className="mb-0.5 block text-[11px] text-gray-500">开始日期</span><input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5" /></label>
              <label><span className="mb-0.5 block text-[11px] text-gray-500">每日上限</span><input type="number" min="1" value={dailyLimit} onChange={(event) => setDailyLimit(event.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5" /></label>
              <label><span className="mb-0.5 block text-[11px] text-gray-500">冗余 %</span><input type="number" min="0" value={redundancyPercent} onChange={(event) => setRedundancyPercent(event.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5" /></label>
              <label><span className="mb-0.5 block text-[11px] text-gray-500">混合文案 %</span><input type="number" min="0" max="100" value={copyPercent} onChange={(event) => setCopyPercent(event.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5" /></label>
              <label><span className="mb-0.5 block text-[11px] text-gray-500">执行顺序</span><select value={executionMode} onChange={(event) => setExecutionMode(event.target.value as BatchExecutionMode)} className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-gray-900"><option value="task-first">顺序执行</option><option value="balanced">均衡排队</option></select></label>
            </div>
          </details>

          <details className="group mt-2 rounded-lg border border-violet-200 bg-violet-50/50 px-3 py-2 dark:border-violet-500/20 dark:bg-violet-500/5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-violet-950 marker:hidden dark:text-violet-100"><span>生成策略预设 <span className="ml-1 text-xs font-normal text-violet-800/70 dark:text-violet-200/70">保存策略、占比、冗余、每日上限与执行顺序</span></span><span className="text-xs font-normal text-violet-700 group-open:hidden dark:text-violet-200">展开</span>{activePreset && <span className="rounded-full bg-violet-100 px-2 py-1 text-xs font-normal text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">当前：{activePreset.name}</span>}</summary>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-violet-800/80 dark:text-violet-200/70">预设不会保存 API Key 或输出目录。</span>
              {activePreset && <span className="rounded-full bg-violet-100 px-2 py-1 text-xs text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">当前：{activePreset.name}</span>}
            </div>
            <div className="grid gap-2 lg:grid-cols-[minmax(180px,0.8fr)_minmax(240px,1.4fr)_auto_auto]">
              <select value={activePresetId} onChange={(event) => {
                const preset = presets.find((item) => item.id === event.target.value)
                setActivePresetId(event.target.value)
                if (preset) {
                  setPresetName(preset.name)
                  setPresetStrategy(preset.strategyText)
                }
              }} className="rounded-md border border-violet-200 bg-white px-2 py-2 text-sm dark:border-violet-500/20 dark:bg-gray-900"><option value="">选择已保存预设</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select>
              <label className="flex items-center gap-2 rounded-md border border-violet-200 bg-white px-2 dark:border-violet-500/20 dark:bg-gray-900"><input type="checkbox" checked={overwritePreset} onChange={(event) => setOverwritePreset(event.target.checked)} /><span className="text-xs">覆盖任务行中已有策略和文案占比</span></label>
              <button type="button" disabled={!activePreset} onClick={applyPreset} className="rounded-md border border-violet-300 px-3 py-2 text-sm font-medium text-violet-700 disabled:opacity-40 dark:border-violet-500/40 dark:text-violet-200">应用预设</button>
              <button type="button" disabled={!activePreset} onClick={deleteActivePreset} className="rounded-md px-3 py-2 text-sm text-violet-700 hover:bg-violet-100 disabled:opacity-40 dark:text-violet-200 dark:hover:bg-violet-500/10">删除</button>
            </div>
            <div className="mt-2 grid gap-2 lg:grid-cols-[180px_minmax(260px,1fr)_auto]">
              <input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="新预设名称" className="rounded-md border border-violet-200 bg-white px-2 py-2 text-sm dark:border-violet-500/20 dark:bg-gray-900" />
              <input value={presetStrategy} onChange={(event) => setPresetStrategy(event.target.value)} placeholder="默认生成策略，例如：参考图风格提取后做同风格差异化衍生" className="rounded-md border border-violet-200 bg-white px-2 py-2 text-sm dark:border-violet-500/20 dark:bg-gray-900" />
              <button type="button" onClick={savePreset} className="rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500">保存为新预设</button>
            </div>
          </details>

          {rows.length === 0 && <section className="mt-3 grid gap-3 lg:grid-cols-[1.3fr_0.9fr]">
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-6 dark:border-white/15 dark:bg-white/[0.02]">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">从任务文件开始</p>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500 dark:text-slate-400">导入 CSV 或 JSON 后，系统会在表格中标出缺失字段；修正完成即可生成按日执行计划，不会直接提交生图任务。</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {['导入任务文件', '修正红框字段', '确认计划并执行'].map((item, index) => <div key={item} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:bg-white/5 dark:text-slate-200"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600 dark:bg-white/10 dark:text-slate-300">{index + 1}</span>{item}</div>)}
              </div>
            </div>
            <aside className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-4 dark:border-blue-500/20 dark:bg-blue-500/[0.06]">
              <p className="text-xs font-semibold text-blue-950 dark:text-blue-100">导入前检查</p>
              <ul className="mt-2 space-y-1 text-[11px] leading-5 text-blue-900/75 dark:text-blue-200/80">
                <li>必填：SKU、产品、渠道、规格、数量、方向</li>
                <li>请先选择执行产物的输出目录</li>
                <li>参考图目录为可选的全局设置</li>
              </ul>
            </aside>
          </section>}

          {rows.length > 0 && <section className="mt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">任务数据表</h3>
                <p className="mt-1 text-xs text-gray-500">共 {rows.length} 行，{validationIssues.length} 个校验问题。红框字段需要修正后才能执行。</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 SKU、产品、渠道、方向…" className="w-56 rounded-lg border border-gray-200 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/5" />
                <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={onlyErrors} onChange={(event) => setOnlyErrors(event.target.checked)} />仅看错误</label>
                <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} className="rounded-lg border border-gray-200 px-2 py-2 text-xs dark:border-white/10 dark:bg-white/5"><option value="source">源文件顺序</option><option value="sku">SKU</option><option value="product">产品</option><option value="channel">渠道</option><option value="quantity">数量</option></select>
              </div>
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs dark:border-blue-500/20 dark:bg-blue-500/5">
              <span className="font-medium text-blue-700 dark:text-blue-200">已选 {selectedRows.size} 行</span>
              <input value={bulkStrategy} onChange={(event) => setBulkStrategy(event.target.value)} placeholder="批量生成策略（留空不修改）" className="min-w-[220px] flex-1 rounded-md border border-blue-200 bg-white px-2 py-1.5 dark:border-blue-500/20 dark:bg-gray-900" />
              <input value={bulkCopyRatio} onChange={(event) => setBulkCopyRatio(event.target.value)} placeholder="文案占比 %" className="w-28 rounded-md border border-blue-200 bg-white px-2 py-1.5 dark:border-blue-500/20 dark:bg-gray-900" />
              <button type="button" disabled={selectedRows.size === 0} onClick={applyBulkEdits} className="rounded-md border border-blue-300 px-3 py-1.5 font-medium text-blue-700 disabled:opacity-40 dark:border-blue-500/40 dark:text-blue-200">应用到已选行</button>
            </div>

            <div className="max-h-[42vh] overflow-auto rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-gray-900">
              <table className="min-w-[1180px] w-full table-fixed border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600 shadow-[0_1px_0_0_rgb(226_232_240)] dark:bg-gray-800 dark:text-gray-300">
                  <tr>
                    <th className="w-8 border-b border-gray-200 px-2 py-2 dark:border-white/10"><input type="checkbox" checked={visibleSelected} onChange={toggleVisibleRows} aria-label="选择当前筛选结果" /></th>
                    <th className="w-[68px] border-b border-gray-200 px-1.5 py-2 dark:border-white/10">状态</th><th className="w-[140px] border-b border-gray-200 px-1.5 py-2 dark:border-white/10">任务名称</th><th className="w-[120px] border-b border-gray-200 px-1.5 py-2 dark:border-white/10">渠道</th><th className="w-[120px] border-b border-gray-200 px-1.5 py-2 dark:border-white/10">规格</th><th className="w-[88px] border-b border-gray-200 px-1.5 py-2 dark:border-white/10">数量</th><th className="w-[104px] border-b border-gray-200 px-1.5 py-2 dark:border-white/10">图文</th><th className="w-[150px] border-b border-gray-200 px-1.5 py-2 dark:border-white/10">方向</th><th className="w-[170px] border-b border-gray-200 px-1.5 py-2 dark:border-white/10">生成策略</th><th className="w-[170px] border-b border-gray-200 px-1.5 py-2 dark:border-white/10">备注</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(({ row, index }) => {
                    const rowIssues = issuesByRow.get(index) ?? []
                    const errorTitle = rowIssues.map((issue) => issue.message).join('\n')
                    return <tr key={`${row.sourceId}-${index}`} className={`border-b border-slate-100 align-top last:border-b-0 transition-colors hover:bg-blue-50/40 dark:border-white/5 dark:hover:bg-blue-500/[0.04] ${rowIssues.length > 0 ? 'bg-red-50/40 dark:bg-red-500/[0.04]' : ''}`}>
                      <td className="px-2 py-1.5"><input type="checkbox" checked={selectedRows.has(index)} onChange={() => toggleRow(index)} aria-label={`选择第 ${index + 1} 行`} /></td>
                      <td className="px-1.5 py-1.5"><span title={errorTitle} className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] ${rowIssues.length > 0 ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'}`}>{rowIssues.length > 0 ? `${rowIssues.length} 个问题` : '可运行'}</span></td>
                      <td className="px-1.5 py-1.5"><input value={row.product || row.sku} onChange={(event) => updateRow(index, { product: event.target.value, sku: row.sku || event.target.value })} className={inputClass(index, 'product')} /></td>
                      <td className="px-1.5 py-1.5"><textarea data-batch-auto-resize value={row.channel} onChange={(event) => updateRow(index, { channel: event.target.value })} onInput={resizeTextarea} rows={1} aria-label={`第 ${index + 1} 行渠道`} className={`${inputClass(index, 'channel')} min-h-9 resize-none overflow-hidden leading-5`} placeholder="多个渠道用、或换行分隔" /></td>
                      <td className="px-1.5 py-1.5"><textarea data-batch-auto-resize value={row.specification} onChange={(event) => updateRow(index, { specification: event.target.value })} onInput={resizeTextarea} rows={1} aria-label={`第 ${index + 1} 行规格`} className={`${inputClass(index, 'specification')} min-h-9 resize-none overflow-hidden leading-5`} placeholder="多个规格用、或换行分隔" /></td>
                      <td className="px-1.5 py-1.5"><input type="number" min="1" value={Number.isFinite(row.quantity) ? row.quantity : ''} onChange={(event) => updateRow(index, { quantity: Number(event.target.value) })} className={inputClass(index, 'quantity')} /></td>
                      <td className="px-1.5 py-1.5"><select value={row.copyChoice ?? 'mixed'} onChange={(event) => updateRow(index, { copyChoice: event.target.value as BatchTaskInput['copyChoice'] })} className={INPUT_CLASS}><option value="without-copy">无文案</option><option value="with-copy">有文案</option><option value="derived-copy">衍生文案</option><option value="mixed">混合</option></select></td>
                      <td className="px-1.5 py-1.5"><textarea data-batch-auto-resize value={directionsToText(row.directions)} onChange={(event) => updateRow(index, { directions: parseDirectionCell(event.target.value) })} onInput={resizeTextarea} rows={1} aria-label={`第 ${index + 1} 行方向`} className={`${inputClass(index, 'directions')} min-h-9 resize-none overflow-hidden leading-5`} placeholder="旅游:50%; 美食:30%" /></td>
                      <td className="px-1.5 py-1.5"><textarea data-batch-auto-resize value={row.strategy ?? ''} onChange={(event) => updateRow(index, { strategy: event.target.value || undefined })} onInput={resizeTextarea} rows={1} aria-label={`第 ${index + 1} 行生成策略`} className={`${INPUT_CLASS} min-h-9 resize-none overflow-hidden leading-5`} placeholder="可选" /></td>
                      <td className="px-1.5 py-1.5"><textarea data-batch-auto-resize value={row.notes ?? ''} onChange={(event) => updateRow(index, { notes: event.target.value || undefined })} onInput={resizeTextarea} rows={1} aria-label={`第 ${index + 1} 行备注`} className={`${INPUT_CLASS} min-h-9 resize-none overflow-hidden leading-5`} placeholder="可选" /></td>
                    </tr>
                  })}
                  {visibleRows.length === 0 && <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-gray-500">没有匹配的任务行</td></tr>}
                </tbody>
              </table>
            </div>
          </section>}

          {(error || planResult.error) && <div className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-300">{error || planResult.error}</div>}
          {validationIssues.length > 0 && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">发现 {validationIssues.length} 个问题：{validationIssues.slice(0, 3).map((issue) => issue.message).join('；')}{validationIssues.length > 3 ? '；…' : ''}</div>}

          {rows.length > 0 && !outputRoot && validationIssues.length === 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">数据校验已通过。选择“输出母文件夹”后即可生成执行计划。</div>}

          {plan && <section className="mt-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div><h3 className="text-sm font-semibold text-gray-900 dark:text-white">任务中心</h3><p className="mt-1 text-xs text-gray-500">查看本次拆解、执行进度与历史运行记录；明细默认收起。</p></div>
              <button type="button" onClick={() => setShowPlanDetails((visible) => !visible)} className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5">{showPlanDetails ? '收起方向与提示词明细' : '查看方向与提示词明细'}</button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['有效任务行', rows.length],
                ['目标数量', plan.targetCount],
                ['含冗余', plan.plannedCount],
                ['预计天数', plan.days.length],
              ].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-gray-50 p-3 dark:bg-white/5"><div className="text-xs text-gray-500">{label}</div><div className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{value}</div></div>)}
            </div>
            <div className="mt-4 max-h-52 overflow-y-auto rounded-xl border border-gray-200 dark:border-white/10">
              {plan.days.map((day) => <div key={day.date} className="flex items-center justify-between border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 dark:border-white/5"><span>{day.date}</span><span className="text-gray-500">{day.units.length} 个方向批次 · {day.plannedCount} 张</span></div>)}
            </div>
            {showPlanDetails && <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 dark:border-white/10">
              <table className="min-w-[1180px] w-full border-collapse text-left text-xs">
                <thead className="bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-300"><tr><th className="border-b border-gray-200 px-3 py-2 dark:border-white/10">日期</th><th className="border-b border-gray-200 px-3 py-2 dark:border-white/10">SKU / 方向</th><th className="border-b border-gray-200 px-3 py-2 dark:border-white/10">文案模式</th><th className="border-b border-gray-200 px-3 py-2 dark:border-white/10">目标 / 计划</th><th className="border-b border-gray-200 px-3 py-2 dark:border-white/10">策略</th><th className="border-b border-gray-200 px-3 py-2 dark:border-white/10">输出目录</th><th className="border-b border-gray-200 px-3 py-2 dark:border-white/10">提示词</th></tr></thead>
                <tbody>{plan.days.flatMap((day) => day.units).map((unit) => <tr key={unit.id} className="border-b border-gray-100 align-top last:border-b-0 dark:border-white/5"><td className="px-3 py-2">{unit.date}</td><td className="px-3 py-2"><div className="font-medium">{unit.sku}</div><div className="mt-1 text-gray-500">{unit.direction}</div></td><td className="px-3 py-2">{unit.copyMode === 'with-copy' ? '有文案' : '无文案'}</td><td className="px-3 py-2">{unit.targetCount} / {unit.plannedCount}</td><td className="max-w-56 whitespace-pre-wrap px-3 py-2">{unit.strategy}</td><td className="max-w-64 break-all px-3 py-2 text-gray-500">{unit.outputFolder}</td><td className="max-w-96 whitespace-pre-wrap px-3 py-2 text-gray-500">{unit.prompt}</td></tr>)}</tbody>
              </table>
            </div>}
          </section>}

          {queues.length > 0 && <section className="mt-5 rounded-xl border border-gray-200 p-4 dark:border-white/10">
            <div className="mb-3"><h3 className="text-sm font-semibold text-gray-900 dark:text-white">任务中心 · 运行记录</h3><p className="mt-1 text-xs text-gray-500">队列保存在本机；定时队列仅在应用保持运行时按日期提交。</p></div>
            <div className="space-y-2">
              {queues.slice().reverse().map((queue) => {
                const progress = getBatchQueueProgress(queue)
                const submissions = Object.values(queue.submitted)
                const generatedTasks = submissions.map((submission) => tasks.find((task) => task.id === submission.taskId)).filter((task): task is TaskRecord => Boolean(task))
                const generatingImages = generatedTasks.filter((task) => task.status === 'running').reduce((sum, task) => sum + (submissions.find((item) => item.taskId === task.id)?.plannedCount ?? 0), 0)
                const successfulImages = generatedTasks.reduce((sum, task) => sum + (task.status === 'done' ? task.outputImages.length : 0), 0)
                const failedImages = generatedTasks.filter((task) => task.status === 'error').reduce((sum, task) => sum + Math.max(0, (submissions.find((item) => item.taskId === task.id)?.plannedCount ?? 0) - task.outputImages.length), 0)
                const generationLabel = submissions.length === 0 ? '尚未提交图片任务' : generatingImages > 0 ? `生成中 ${generatingImages} 张` : failedImages > 0 ? `已生成 ${successfulImages} 张，失败 ${failedImages} 张` : successfulImages > 0 ? `已生成 ${successfulImages} 张` : '已提交，等待任务状态同步'
                return <div key={queue.id} className="rounded-lg bg-gray-50 p-3 text-xs dark:bg-white/5">
                  <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-medium text-gray-900 dark:text-white">{queue.receipt.planName} · {getAgentBatchQueueStatusLabel(queue.status)}</div><div className="text-gray-500">{new Date(queue.createdAt).toLocaleString('zh-CN')}</div></div>
                  <div className="mt-2 grid gap-1 text-gray-600 dark:text-gray-300 sm:grid-cols-3"><span>已提交 {progress.submittedImages} / {progress.totalImages} 张</span><span className={generatingImages > 0 ? 'font-medium text-blue-600 dark:text-blue-300' : ''}>{generationLabel}</span><span>{queue.receipt.apiProfileName} / {queue.receipt.apiModel} · 并发 {queue.receipt.maxConcurrent || '未知'}</span><span className="sm:col-span-3">输出：{queue.receipt.outputRoot || '未记录'}</span></div>
                  {queue.lastError && <div className="mt-2 text-red-600 dark:text-red-300">失败原因：{queue.lastError}</div>}
                  <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => changeQueueStatus(queue.id, queue.status === 'paused' || queue.status === 'failed' ? 'waiting' : 'paused')} disabled={queue.status === 'completed' || queue.status === 'cancelled'} className="rounded border border-gray-200 px-2 py-1 disabled:opacity-40 dark:border-white/15">{queue.status === 'paused' || queue.status === 'failed' ? '恢复队列' : '暂停队列'}</button><button type="button" onClick={() => changeQueueStatus(queue.id, 'cancelled')} disabled={queue.status === 'completed' || queue.status === 'cancelled'} className="rounded border border-gray-200 px-2 py-1 disabled:opacity-40 dark:border-white/15">取消队列</button><button type="button" onClick={() => deleteQueueRecord(queue.id)} className="rounded border border-gray-200 px-2 py-1 text-red-600 dark:border-white/15 dark:text-red-300">删除记录</button>{queue.receipt.manifestPath && <span className="px-2 py-1 text-gray-500">清单：{queue.receipt.manifestPath}</span>}</div>
                </div>
              })}
            </div>
          </section>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-5 py-3 dark:border-white/10">
          <div className="text-xs text-gray-500">{executing ? `正在提交 ${submitted} 张` : validationIssues.length > 0 ? '修正红框字段后才能运行' : plan ? '计划已就绪，可选择立即执行或按日自动执行' : rows.length > 0 ? '请先选择输出母文件夹' : '请导入任务文件'}</div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={!canRun} onClick={() => setPendingExecution('scheduled')} className="rounded-xl border border-blue-200 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-blue-500/30 dark:text-blue-300 dark:hover:bg-blue-500/10">启动按日自动队列</button>
            <button type="button" disabled={!canRun || !plan?.days[0]} onClick={() => setPendingExecution('immediate')} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-45">{executing ? '正在提交…' : `执行首日批次（${plan?.days[0]?.plannedCount ?? 0} 张）`}</button>
          </div>
        </div>
      </div>
      {pendingExecution && plan && <div className="absolute inset-0 flex items-center justify-center bg-[hsl(var(--ds-color-scrim)/0.48)] p-4">
        <div className="ds-modal-surface w-full max-w-lg rounded-2xl p-5"><h3 className="text-lg font-semibold text-gray-900 dark:text-white">确认{pendingExecution === 'immediate' ? '立即执行' : '按日自动执行'}</h3><div className="mt-3 space-y-1 text-sm text-gray-600 dark:text-gray-300"><p>计划：{draftName || '未命名批量任务'}</p><p>有效任务：{rows.length} 行；目标 {plan.targetCount} 张；冗余后 {plan.plannedCount} 张。</p><p>执行方式：{pendingExecution === 'immediate' ? `立即提交首日 ${plan.days[0]?.plannedCount ?? 0} 张，后续日期保留在队列中。` : `${startDate} 起按日提交，应用必须保持运行。`}</p><p>每日上限：{dailyLimit} 张；预计 {plan.days.length} 天。</p><p>API：{getAgentImageApiProfile(settings).name} / {getAgentImageApiProfile(settings).model}；最大并发 {getAgentImageApiProfile(settings).maxConcurrent}。</p><p>输出目录：{outputRoot}</p></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setPendingExecution(null)} className="rounded-lg px-3 py-2 text-sm text-gray-600 dark:text-gray-300">返回修改</button><button type="button" onClick={confirmExecution} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white">确认并创建队列</button></div></div>
      </div>}
    </div>
  )
}
