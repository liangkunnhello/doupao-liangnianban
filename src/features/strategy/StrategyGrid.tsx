import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import {
  ArchiveIcon as Archive,
  ArrowLeftIcon as ArrowLeft,
  CheckIcon as Check,
  CloseIcon as X,
  CopyIcon as Copy,
  Edit3Icon as Edit3,
  ExpandIcon as Expand,
  ImagePlusIcon as ImagePlus,
  ImagesIcon as Images,
  LoaderCircleIcon as LoaderCircle,
  MoreHorizontalIcon as MoreHorizontal,
  PencilIcon as Pencil,
  PlayIcon as Play,
  PlusIcon as Plus,
  SearchIcon as Search,
  SparklesIcon as Sparkles,
} from '../../design-system/icons'
import type {
  StrategyCatalog as RequirementCatalog,
  StrategyTask as TaskRecord,
  StrategyTestOrder as RequirementOrder,
} from './contracts'
import type { StrategyAsset } from './types'
import { isModalBackdropEvent } from '../../lib/modalBackdrop'

export interface StrategyImageProps {
  imageId?: string
  alt: string
  className?: string
}

type ResultDetail = {
  strategyId: string
  imageId: string
  prompt: string
}

function modeLabel(strategy: StrategyAsset) {
  if (!strategy.generationMode) return '未配置'
  const mode = strategy.generationMode === 'image-to-image' ? '图生图' : '文生图'
  return strategy.workflow?.sop?.resolved && strategy.workflow.sop.mode !== 'none' ? `${mode} · SOP` : mode
}

function statusLabel(strategy: StrategyAsset) {
  if (strategy.status === 'published') return '已发布'
  if (strategy.status === 'review') return '待审核'
  return '草稿'
}

export default function StrategyGrid({
  catalog,
  strategies,
  selectedStrategyId,
  orders,
  tasks,
  ImageComponent,
  canPaste,
  headerActions,
  onSelectStrategy,
  onCreate,
  onRename,
  onCopy,
  onPaste,
  onArchive,
  onChangeCover,
  onPickLocalCover,
  onSavePromptOverride,
  onReusePrompt,
}: {
  catalog: RequirementCatalog
  strategies: StrategyAsset[]
  selectedStrategyId?: string
  orders: RequirementOrder[]
  tasks: TaskRecord[]
  ImageComponent: ComponentType<StrategyImageProps>
  canPaste: boolean
  headerActions?: ReactNode
  onSelectStrategy: (strategyId: string) => void
  onCreate: () => void
  onRename: (strategyId: string, name: string) => void
  onCopy: (strategyId: string) => void
  onPaste: () => void
  onArchive: (strategyId: string) => void
  onChangeCover: (strategyId: string, imageId: string) => void
  onPickLocalCover: (strategyId: string) => Promise<void>
  onSavePromptOverride: (strategyId: string, imageId: string, prompt: string) => void
  onReusePrompt: (strategyId: string, prompt: string) => void
}) {
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editingName, setEditingName] = useState('')
  const [coverPickerId, setCoverPickerId] = useState('')
  const [actionMenuId, setActionMenuId] = useState('')
  const [resultsModalStrategyId, setResultsModalStrategyId] = useState('')
  const [resultDetail, setResultDetail] = useState<ResultDetail | null>(null)
  const [detailPrompt, setDetailPrompt] = useState('')
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const strategyById = useMemo(() => new Map(strategies.map((strategy) => [strategy.id, strategy])), [strategies])
  const filtered = strategies.filter((strategy) =>
    !query.trim()
    || strategy.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    || strategy.description.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )
  const tests = orders
    .filter((order) => order.isTest && order.strategyId && strategyById.has(order.strategyId))
    .sort((left, right) => right.createdAt - left.createdAt)

  const outputEntries = (strategyId: string) => tests
    .filter((order) => order.strategyId === strategyId)
    .flatMap((order) => order.units.flatMap((unit) => {
      const task = unit.taskId ? taskById.get(unit.taskId) : undefined
      return (task?.outputImages ?? []).map((imageId) => ({
        imageId,
        prompt: strategyById.get(strategyId)?.resultPromptOverrides?.[imageId] ?? task?.prompt ?? unit.prompt,
        order,
      }))
    }))

  const resultsModalStrategy = strategyById.get(resultsModalStrategyId)
  const resultsModalTests = tests.filter((order) => order.strategyId === resultsModalStrategyId)
  const resultsModalEntries = outputEntries(resultsModalStrategyId)
  useEffect(() => {
    if (!actionMenuId) return
    const closeMenu = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionMenuId('')
    }
    window.addEventListener('keydown', closeMenu)
    return () => window.removeEventListener('keydown', closeMenu)
  }, [actionMenuId])

  if (resultDetail) {
    const strategy = strategyById.get(resultDetail.strategyId)
    if (!strategy) return null
    return (
      <section className="strategy-drill-in flex h-full min-h-0 flex-col bg-white dark:bg-gray-900">
        <div className="flex h-14 items-center gap-3 border-b border-gray-200 px-4 dark:border-gray-800">
          <button onClick={() => setResultDetail(null)} className="flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-gray-600 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-300 dark:hover:bg-gray-800">
            <ArrowLeft size={16} />返回测试结果
          </button>
          <div className="h-5 w-px bg-gray-200 dark:bg-gray-700" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{strategy.name}</h2>
            <p className="text-xs text-gray-500">图片详情与提示词</p>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,.75fr)]">
          <div className="flex min-h-0 items-center justify-center overflow-auto bg-gray-950 p-6">
            <ImageComponent imageId={resultDetail.imageId} alt={`${strategy.name}测试结果`} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
          </div>
          <div className="min-h-0 overflow-y-auto border-l border-gray-200 p-5 dark:border-gray-800">
            <h3 className="text-sm font-semibold">生图提示词</h3>
            <p className="mt-1 text-xs text-gray-500">可以单独编辑当前图片提示词，或复用为策略主提示词。</p>
            <textarea
              value={detailPrompt}
              onChange={(event) => setDetailPrompt(event.target.value)}
              className="mt-4 min-h-72 w-full rounded-xl border border-gray-300 bg-white p-3 text-sm leading-6 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-950 dark:focus:ring-blue-950"
            />
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <button onClick={() => onSavePromptOverride(strategy.id, resultDetail.imageId, detailPrompt)} className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-gray-200 text-sm transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-700 dark:hover:bg-gray-800"><Check size={15} />保存编辑</button>
              <button onClick={() => onReusePrompt(strategy.id, detailPrompt)} className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-blue-200 text-sm text-blue-700 transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-950/30"><Play size={15} />复用到策略</button>
              <button onClick={() => onChangeCover(strategy.id, resultDetail.imageId)} className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"><ImagePlus size={15} />设为封面</button>
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-white/90 dark:bg-gray-900/90">
      <div className="flex min-h-16 flex-wrap items-center gap-2 border-b border-gray-200/80 bg-white/80 px-4 py-3 backdrop-blur dark:border-white/[0.08] dark:bg-gray-900/80">
        <label className="flex h-10 min-w-48 flex-1 items-center gap-2 rounded-xl border border-gray-200/80 bg-gray-50/80 px-3 transition focus-within:border-blue-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100 dark:border-white/[0.08] dark:bg-white/[0.04] dark:focus-within:border-blue-500/60 dark:focus-within:bg-white/[0.06] dark:focus-within:ring-blue-950">
          <Search size={14} className="text-gray-400" />
          <span className="sr-only">搜索当前策略</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索当前策略"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
        </label>
        {headerActions}
        <button onClick={onPaste} disabled={!canPaste} className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-gray-200/80 bg-white px-3 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]"><Copy size={14} />粘贴</button>
        <button onClick={onCreate} className="flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-blue-600 px-3.5 text-xs font-medium text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"><Plus size={14} />新建策略</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50/50 p-4 dark:bg-gray-950/40">
        <div className="mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">策略卡片</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {filtered.length} 个策略 · 双击名称重命名 · 双击封面替换
            </p>
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 text-center dark:border-gray-700">
            <Sparkles size={24} className="text-gray-400" />
            <p className="mt-3 text-sm font-medium">当前层级还没有策略</p>
            <button onClick={onCreate} className="mt-3 cursor-pointer text-sm text-blue-600 hover:underline">创建第一个策略</button>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {filtered.map((strategy) => {
              const product = catalog.products.find((item) => item.id === strategy.productId)
              const materialType = catalog.materialTypes.find((item) => item.id === strategy.materialTypeId)
              const selected = strategy.id === selectedStrategyId
              const strategyOutputs = outputEntries(strategy.id)
              return (
                <article
                  key={strategy.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('application/x-strategy-id', strategy.id)
                  }}
                  onClick={() => {
                    setActionMenuId('')
                    onSelectStrategy(strategy.id)
                  }}
                  className={`group relative cursor-pointer overflow-hidden rounded-2xl border bg-white shadow-sm transition duration-200 focus-within:ring-2 focus-within:ring-blue-500 hover:-translate-y-0.5 hover:shadow-lg motion-reduce:transform-none dark:bg-gray-900 ${selected ? 'border-blue-500 ring-2 ring-blue-100 dark:ring-blue-950' : 'border-gray-200/80 dark:border-white/[0.08]'}`}
                >
                  <button
                    onDoubleClick={(event) => {
                      event.stopPropagation()
                      setCoverPickerId(strategy.id)
                    }}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`替换${strategy.name}封面`}
                    title="双击替换封面"
                    className="relative block aspect-[16/9] w-full cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                  >
                    <ImageComponent imageId={strategy.coverImageId} alt={`${strategy.name}封面`} className="h-full w-full transition duration-300 group-hover:scale-[1.02] motion-reduce:transform-none" />
                    <span className="absolute inset-x-0 bottom-0 flex translate-y-full items-center justify-center gap-1 bg-gray-950/70 py-2 text-xs text-white transition group-hover:translate-y-0 motion-reduce:transition-none"><ImagePlus size={13} />双击替换封面</span>
                  </button>
                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      {editingId === strategy.id ? (
                        <input
                          autoFocus
                          value={editingName}
                          onChange={(event) => setEditingName(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          onBlur={() => { if (editingName.trim()) onRename(strategy.id, editingName.trim()); setEditingId('') }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') { if (editingName.trim()) onRename(strategy.id, editingName.trim()); setEditingId('') }
                            if (event.key === 'Escape') setEditingId('')
                          }}
                          className="h-7 min-w-0 flex-1 rounded border border-blue-500 px-2 text-sm outline-none ring-2 ring-blue-100 dark:bg-gray-950 dark:ring-blue-950"
                        />
                      ) : (
                        <h3 onDoubleClick={(event) => { event.stopPropagation(); setEditingId(strategy.id); setEditingName(strategy.name) }} className="min-w-0 flex-1 line-clamp-2 text-sm font-semibold leading-5">{strategy.name}</h3>
                      )}
                      <button onClick={(event) => { event.stopPropagation(); onSelectStrategy(strategy.id) }} aria-label={`编辑${strategy.name}`} title="编辑策略" className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-gray-800"><Edit3 size={14} /></button>
                    </div>
                    <p className="mt-1 line-clamp-2 min-h-8 text-xs leading-4 text-gray-500">{strategy.description}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">{product?.name}</span>
                      <span className="rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{materialType?.name}</span>
                      <span className="rounded-md bg-violet-50 px-2 py-1 text-xs text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">{modeLabel(strategy)}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2 dark:border-gray-800">
                      <span className="text-xs text-gray-400">{statusLabel(strategy)} · v{strategy.version}</span>
                      <div className="flex items-center gap-1">
                        <button onClick={(event) => { event.stopPropagation(); setResultsModalStrategyId(strategy.id) }} aria-label={`查看${strategy.name}的${strategyOutputs.length}张测试图片`} title={`测试图片（${strategyOutputs.length}）`} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-gray-400 hover:bg-blue-50 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-blue-950/30 dark:hover:text-blue-300"><Images size={13} /></button>
                        <button onClick={(event) => { event.stopPropagation(); onCopy(strategy.id) }} aria-label={`复制${strategy.name}`} title="复制" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"><Copy size={13} /></button>
                        <button onClick={(event) => { event.stopPropagation(); onArchive(strategy.id) }} aria-label={`归档${strategy.name}`} title="归档" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-950/30"><Archive size={13} /></button>
                        <button
                          onClick={(event) => {
                            event.stopPropagation()
                            setActionMenuId((current) => current === strategy.id ? '' : strategy.id)
                          }}
                          aria-expanded={actionMenuId === strategy.id}
                          aria-label={`${strategy.name}更多操作`}
                          title="更多操作"
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded text-gray-400 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-gray-800"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                  {actionMenuId === strategy.id && (
                    <div onClick={(event) => event.stopPropagation()} className="absolute bottom-11 right-3 z-20 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 text-xs shadow-xl dark:border-gray-700 dark:bg-gray-900">
                      <button onClick={() => { setActionMenuId(''); onSelectStrategy(strategy.id) }} className="flex h-9 w-full cursor-pointer items-center gap-2 px-3 text-left hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:hover:bg-gray-800"><Edit3 size={14} />编辑策略</button>
                      <button onClick={() => { setActionMenuId(''); setEditingId(strategy.id); setEditingName(strategy.name) }} className="flex h-9 w-full cursor-pointer items-center gap-2 px-3 text-left hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:hover:bg-gray-800"><Pencil size={14} />重命名</button>
                      <button onClick={() => { setActionMenuId(''); setResultsModalStrategyId(strategy.id) }} className="flex h-9 w-full cursor-pointer items-center gap-2 px-3 text-left hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:hover:bg-gray-800"><Images size={14} />测试图片</button>
                      <button onClick={() => { setActionMenuId(''); setCoverPickerId(strategy.id) }} className="flex h-9 w-full cursor-pointer items-center gap-2 px-3 text-left hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:hover:bg-gray-800"><ImagePlus size={14} />替换封面</button>
                      <button onClick={() => { setActionMenuId(''); onCopy(strategy.id) }} className="flex h-9 w-full cursor-pointer items-center gap-2 px-3 text-left hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:hover:bg-gray-800"><Copy size={14} />复制到剪贴板</button>
                      <button onClick={() => { setActionMenuId(''); onArchive(strategy.id) }} className="flex h-9 w-full cursor-pointer items-center gap-2 px-3 text-left text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500 dark:hover:bg-red-950/30"><Archive size={14} />归档策略</button>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>

      {resultsModalStrategy && (
        <div className="fixed inset-0 z-[var(--ds-z-overlay)] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-overlay-in" role="dialog" aria-modal="true" aria-labelledby="strategy-test-results-title" onMouseDown={(event) => {
          if (isModalBackdropEvent(event)) setResultsModalStrategyId('')
        }}>
          <div className="animate-modal-in flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-2xl dark:border-white/[0.1] dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div className="min-w-0">
                <h3 id="strategy-test-results-title" className="truncate font-semibold">{resultsModalStrategy.name} · 测试图片</h3>
                <p className="mt-1 text-xs text-gray-500">共 {resultsModalEntries.length} 张，点击图片查看提示词、复用或设为封面。</p>
              </div>
              <button type="button" onClick={() => setResultsModalStrategyId('')} aria-label="关闭测试结果" className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-gray-300 dark:hover:bg-white/[0.06]"><X size={18} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {resultsModalTests.some((order) => order.status === 'running' || order.status === 'queued') && (
                <div aria-live="polite" className="mb-4 flex min-h-12 items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 text-xs text-blue-700 dark:border-blue-950 dark:bg-blue-950/30 dark:text-blue-300">
                  <LoaderCircle size={17} className="animate-spin motion-reduce:animate-none" />
                  测试图片正在{resultsModalTests.some((order) => order.status === 'running') ? '生成' : '排队'}，完成后会自动显示在此弹窗中。
                </div>
              )}
              {resultsModalEntries.length > 0 && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                  {resultsModalEntries.map((entry, index) => (
                    <button
                      key={`${entry.order.id}:${entry.imageId}`}
                      type="button"
                      onClick={() => {
                        setResultDetail({ strategyId: resultsModalStrategy.id, imageId: entry.imageId, prompt: entry.prompt })
                        setDetailPrompt(entry.prompt)
                      }}
                      className="group overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transform-none dark:border-gray-700 dark:bg-gray-900"
                    >
                      <div className="relative aspect-square overflow-hidden bg-gray-100 dark:bg-gray-800">
                        <ImageComponent imageId={entry.imageId} alt={`${resultsModalStrategy.name}测试图 ${index + 1}`} className="h-full w-full transition duration-300 group-hover:scale-[1.03] motion-reduce:transform-none" />
                        <span className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg bg-gray-950/65 text-white opacity-0 transition group-hover:opacity-100"><Expand size={14} /></span>
                      </div>
                      <div className="p-3"><p className="line-clamp-2 text-xs leading-4 text-gray-500">{entry.prompt}</p></div>
                    </button>
                  ))}
                </div>
              )}
              {resultsModalEntries.length === 0 && !resultsModalTests.some((order) => order.status === 'running' || order.status === 'queued') && (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 text-center dark:border-gray-700">
                  <Images size={28} className="text-gray-400" />
                  <p className="mt-3 text-sm font-medium">该策略还没有生成图片</p>
                  <p className="mt-1 text-xs text-gray-500">请在右侧策略编辑区点击“测试生成”。</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {coverPickerId && (
        <div className="fixed inset-0 z-[var(--ds-z-overlay)] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-overlay-in" role="dialog" aria-modal="true" aria-label="替换策略封面" onMouseDown={(event) => {
          if (isModalBackdropEvent(event)) setCoverPickerId('')
        }}>
          <div className="animate-modal-in max-h-[82vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-2xl dark:border-white/[0.1] dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-800">
              <div><h3 className="font-semibold">替换策略封面</h3><p className="mt-1 text-xs text-gray-500">选择该策略之前生成的图片，或从本地导入。</p></div>
              <button onClick={() => setCoverPickerId('')} className="h-9 cursor-pointer rounded-lg px-3 text-sm hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-gray-800">关闭</button>
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-4">
              <button onClick={() => void onPickLocalCover(coverPickerId).then(() => setCoverPickerId(''))} className="mb-4 flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-blue-300 px-4 text-sm text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/30"><ImagePlus size={16} />选择本地图片</button>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                {outputEntries(coverPickerId).map((entry) => (
                  <button key={entry.imageId} onClick={() => { onChangeCover(coverPickerId, entry.imageId); setCoverPickerId('') }} className="aspect-square cursor-pointer overflow-hidden rounded-lg border border-gray-200 transition hover:border-blue-500 hover:ring-2 hover:ring-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-700 dark:hover:ring-blue-950">
                    <ImageComponent imageId={entry.imageId} alt="可选封面" className="h-full w-full" />
                  </button>
                ))}
              </div>
              {outputEntries(coverPickerId).length === 0 && <p className="py-8 text-center text-sm text-gray-500">该策略还没有历史生成图片。</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
