import { useEffect, useMemo, useState } from 'react'
import {
  BookOpenCheckIcon as BookOpenCheck,
  ChevronDownIcon as ChevronDown,
  CloseIcon as X,
  FileImageIcon as FileImage,
  FileTextIcon as FileText,
  FolderOpenIcon as FolderOpen,
  ImageIcon,
  Layers3Icon as Layers3,
  LoaderCircleIcon as LoaderCircle,
  PlayIcon as Play,
  SaveIcon as Save,
  SlidersHorizontalIcon as SlidersHorizontal,
  WandSparklesIcon as WandSparkles,
} from '../../design-system/icons'
import type {
  StrategyCatalog as RequirementCatalog,
  StrategyKnowledgeBatch as KnowledgeBatch,
  StrategyKnowledgeInsight as KnowledgeInsight,
  StrategyRole as RequirementRole,
  StrategyTestOrder as RequirementOrder,
} from './contracts'
import { isModalBackdropEvent } from '../../lib/modalBackdrop'
import type {
  StrategyAsset,
  StrategyPreset,
  StrategyReferenceConfig,
  SopGroup,
  SopLibraryItem,
} from './types'
import { normalizeStrategyAsset, validateStrategyForTest } from './model'

function OptionalSection({
  title,
  summary,
  children,
}: {
  title: string
  summary: string
  children: React.ReactNode
}) {
  return (
    <details className="group rounded-2xl border border-gray-200/80 bg-white dark:border-white/[0.08] dark:bg-white/[0.03]">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-300"><SlidersHorizontal size={15} /></span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{title}</span><span className="mt-0.5 block truncate text-xs text-gray-500">{summary}</span></span>
        <ChevronDown size={16} className="text-gray-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-gray-200/80 p-4 dark:border-white/[0.08]">{children}</div>
    </details>
  )
}

function EnableRow({
  checked,
  disabled = false,
  title,
  description,
  onChange,
  children,
}: {
  checked: boolean
  disabled?: boolean
  title: string
  description: string
  onChange: (checked: boolean) => void
  children: React.ReactNode
}) {
  return (
    <div className={`rounded-xl border p-3.5 transition ${checked ? 'border-blue-300 bg-blue-50/60 dark:border-blue-500/30 dark:bg-blue-500/10' : 'border-gray-200/80 bg-gray-50/60 dark:border-white/[0.08] dark:bg-white/[0.02]'} ${disabled ? 'opacity-60' : ''}`}>
      <label className={`flex min-h-11 items-start gap-3 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs leading-5 text-gray-500">{description}</span></span>
        <span className={`rounded-lg px-2 py-1 text-xs ${checked ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06]'}`}>{checked ? '已启用' : '未启用'}</span>
      </label>
      {checked && <div className="mt-3">{children}</div>}
    </div>
  )
}

export function snapshotSelectedFiles<T>(files: ArrayLike<T> | null) {
  return files ? Array.from(files) : []
}

export default function StrategyEditor({
  strategy,
  catalog,
  presets,
  sopItems,
  sopGroups,
  versions,
  knowledgeBatches,
  knowledgeInsights,
  generatedImageIds,
  testOrders,
  role,
  onSave,
  onTest,
  onPickLocalReference,
  onPickKnowledgeMaterial,
  onRollback,
}: {
  strategy?: StrategyAsset
  catalog: RequirementCatalog
  presets: StrategyPreset[]
  sopItems: SopLibraryItem[]
  sopGroups: SopGroup[]
  versions: StrategyAsset[]
  knowledgeBatches: KnowledgeBatch[]
  knowledgeInsights: KnowledgeInsight[]
  generatedImageIds: string[]
  testOrders: RequirementOrder[]
  role: RequirementRole
  onSave: (strategy: StrategyAsset) => void
  onTest: (strategyId: string, quantity: number) => { error?: string }
  onPickLocalReference: () => Promise<string[]>
  onPickKnowledgeMaterial: (batchId: string) => Promise<string[]>
  onRollback: (version: number) => void
}) {
  const normalizedStrategy = useMemo(() => strategy ? normalizeStrategyAsset(strategy) : null, [strategy])
  const [draft, setDraft] = useState<StrategyAsset | null>(normalizedStrategy)
  const [testQuantity, setTestQuantity] = useState(normalizedStrategy?.quantity ?? 10)
  const [message, setMessage] = useState('')
  const [loadingReference, setLoadingReference] = useState(false)
  const [knowledgeBatchId, setKnowledgeBatchId] = useState('')
  const [showSopPicker, setShowSopPicker] = useState(false)
  const [sopSearch, setSopSearch] = useState('')
  const [collapsedSopGroups, setCollapsedSopGroups] = useState<string[]>([])
  const [expandedSopId, setExpandedSopId] = useState('')

  useEffect(() => {
    setDraft(normalizedStrategy)
    setTestQuantity(normalizedStrategy?.quantity ?? 10)
    setMessage('')
    setShowSopPicker(false)
    setSopSearch('')
    setCollapsedSopGroups([])
    setExpandedSopId('')
  }, [normalizedStrategy?.id, normalizedStrategy?.updatedAt])

  const visibleSopGroups = useMemo(() => {
    const query = sopSearch.trim().toLocaleLowerCase()
    const matches = (item: SopLibraryItem) => !query || `${item.name} ${item.description} ${item.content}`.toLocaleLowerCase().includes(query)
    const groups = sopGroups
      .map((group) => ({ id: group.id, name: group.name, items: sopItems.filter((item) => item.groupId === group.id && matches(item)) }))
      .filter((group) => group.items.length)
    const ungrouped = sopItems.filter((item) => !item.groupId && matches(item))
    return ungrouped.length ? [...groups, { id: 'ungrouped', name: '未分组', items: ungrouped }] : groups
  }, [sopGroups, sopItems, sopSearch])

  if (!strategy || !draft) {
    return (
      <aside className="flex h-full items-center justify-center border-l border-gray-200/80 bg-white/70 p-6 text-center dark:border-white/[0.08] dark:bg-gray-950/70">
        <div><WandSparkles size={28} className="mx-auto text-gray-400" /><h2 className="mt-3 text-sm font-semibold">选择一个策略</h2><p className="mt-1 text-xs leading-5 text-gray-500">在这里选择、编辑并应用 SOP。</p></div>
      </aside>
    )
  }

  const update = (next: StrategyAsset) => setDraft({ ...next, status: next.status === 'published' ? 'draft' : next.status })
  const updateWorkflow = (patch: Partial<StrategyAsset['workflow']>) => update({ ...draft, workflow: { ...draft.workflow, ...patch } })
  const updateOutputs = (patch: Partial<StrategyAsset['outputs']>) => update({ ...draft, outputs: { ...draft.outputs, ...patch } })
  const validationErrors = validateStrategyForTest(draft)
  const sopReady = validationErrors.length === 0
  const testing = testOrders[0]?.status === 'queued' || testOrders[0]?.status === 'running'
  const activeKnowledgeBatches = knowledgeBatches.filter((item) => item.status === 'completed' || item.status === 'review')
  const activeKnowledgeInsights = knowledgeInsights
    .filter((item) => !knowledgeBatches.find((batch) => batch.id === item.batchId)?.error)
    .slice(0, 20)

  const chooseSop = (item: SopLibraryItem) => {
    updateWorkflow({
      sop: {
        resolved: true,
        mode: 'preset',
        presetId: item.id,
        name: item.name,
        description: item.description,
        content: item.content,
      },
    })
  }
  const updateSop = (patch: Partial<StrategyAsset['workflow']['sop']>) => updateWorkflow({
    sop: {
      ...draft.workflow.sop,
      resolved: true,
      mode: 'custom',
      ...patch,
    },
  })
  const setMode = (mode: NonNullable<StrategyAsset['generationMode']> | null) => update({
    ...draft,
    generationMode: mode,
    workflow: { ...draft.workflow, reference: mode === 'image-to-image' ? draft.workflow.reference : undefined },
  })
  const setReference = (reference: StrategyReferenceConfig) => updateWorkflow({ reference })
  const toggleInsight = (insightId: string) => {
    const selected = draft.workflow.knowledge.insightIds.includes(insightId)
    updateWorkflow({
      knowledge: {
        resolved: true,
        insightIds: selected
          ? draft.workflow.knowledge.insightIds.filter((id) => id !== insightId)
          : [...draft.workflow.knowledge.insightIds, insightId],
      },
    })
  }
  const runTest = () => {
    if (validationErrors.length) { setMessage(validationErrors[0]); return }
    const quantity = Math.max(1, Math.trunc(testQuantity || 10))
    const next = { ...draft, quantity }
    setDraft(next)
    onSave(next)
    const result = onTest(next.id, quantity)
    setMessage(result.error ?? '测试任务已加入当前策略')
  }

  const outputSummary = [
    draft.outputs.channels.enabled ? `${draft.outputs.channels.channelIds.length} 个渠道` : '',
    draft.outputs.sizes.enabled ? `${draft.outputs.sizes.ratios.length} 个尺寸` : '',
    draft.outputs.export.enabled ? '导出' : '',
    draft.outputs.allocation.enabled ? '分配' : '',
  ].filter(Boolean).join(' · ') || '使用系统默认输出'

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-gray-200/80 bg-gray-50/70 dark:border-white/[0.08] dark:bg-gray-950/70">
      <div className="border-b border-gray-200/80 bg-white/90 p-4 backdrop-blur dark:border-white/[0.08] dark:bg-gray-900/90">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><p className="text-xs font-medium text-violet-600 dark:text-violet-400">SOP 驱动策略</p><h2 className="mt-1 truncate text-base font-semibold">{draft.name}</h2><p className="mt-1 text-xs text-gray-500">{draft.status === 'published' ? `已发布 · v${draft.version}` : draft.status === 'review' ? '待管理员审核' : '本地草稿 · 修改后请保存'}</p></div>
          <button onClick={() => onSave(draft)} className="flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl border border-gray-200/80 bg-white px-3 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]"><Save size={15} />保存</button>
        </div>
        <div className="mt-3 flex gap-2">
          <button disabled={!sopReady} onClick={() => { const next = { ...draft, status: 'review' as const }; setDraft(next); onSave(next) }} className="h-10 flex-1 cursor-pointer rounded-xl border border-gray-200/80 bg-white text-xs font-medium transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.08] dark:bg-white/[0.04] dark:hover:bg-white/[0.08]">提交审核</button>
          {role === 'admin' && <button disabled={!sopReady} onClick={() => { const next = { ...draft, status: 'published' as const, version: draft.version + 1 }; setDraft(next); onSave(next) }} className="h-10 flex-1 cursor-pointer rounded-xl bg-emerald-600 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700">审核发布</button>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <section className="rounded-2xl border border-gray-200/80 bg-white p-4 dark:border-white/[0.08] dark:bg-white/[0.03]">
          <p className="text-xs font-medium text-gray-500">策略基本信息</p>
          <div className="mt-3 space-y-3"><label className="block"><span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">策略名称</span><input value={draft.name} onChange={(event) => update({ ...draft, name: event.target.value })} className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-950 dark:focus:ring-blue-950" /></label><div className="grid grid-cols-2 gap-3 text-xs"><div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-black/20"><p className="text-gray-400">所属产品</p><p className="mt-1 truncate font-medium text-gray-800 dark:text-gray-100">{catalog.products.find((item) => item.id === draft.productId)?.name ?? '未设置'}</p></div><div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-black/20"><p className="text-gray-400">素材类型</p><p className="mt-1 truncate font-medium text-gray-800 dark:text-gray-100">{catalog.materialTypes.find((item) => item.id === draft.materialTypeId)?.name ?? '未设置'}</p></div></div><label className="block"><span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">策略说明</span><textarea value={draft.description} onChange={(event) => update({ ...draft, description: event.target.value })} placeholder="补充适用的商品、场景或业务目标" className="min-h-20 w-full rounded-xl border border-gray-300 bg-white p-3 text-sm leading-6 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-950 dark:focus:ring-blue-950" /></label></div>
        </section>

        <section className="mt-3 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.03]">
          <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">SOP 名称</span><input value={draft.workflow.sop.name ?? ''} onChange={(event) => updateSop({ name: event.target.value })} placeholder="例如：商品场景主图 SOP" className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 dark:border-gray-700 dark:bg-gray-950 dark:focus:ring-violet-950" /></label>
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between gap-2"><span className="text-xs font-medium text-gray-600 dark:text-gray-300">SOP 内容</span><button type="button" onClick={() => setShowSopPicker(true)} aria-haspopup="dialog" className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]"><BookOpenCheck size={13} />选择已有 SOP 预设</button></div>
            <textarea value={draft.workflow.sop.content} onChange={(event) => updateSop({ content: event.target.value })} placeholder="写明执行顺序、画面规则、提示词约束和输出要求。" className="min-h-48 w-full rounded-xl border border-gray-300 bg-white p-3 text-sm leading-6 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 dark:border-gray-700 dark:bg-gray-950 dark:focus:ring-violet-950" />
          </div>
          <label className="mt-3 block"><span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">SOP 说明</span><input value={draft.workflow.sop.description ?? ''} onChange={(event) => updateSop({ description: event.target.value })} placeholder="说明适用场景或注意事项" className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 dark:border-gray-700 dark:bg-gray-950 dark:focus:ring-violet-950" /></label>
        </section>

        <div className="mt-3 space-y-3">
          <OptionalSection title="生图参数" summary={draft.generationMode ? `${draft.generationMode === 'image-to-image' ? '图生图' : '文生图'}${draft.workflow.reference?.imageIds.length ? ` · ${draft.workflow.reference.imageIds.length} 张参考图` : ''}` : '使用系统默认生成方式'}>
            <div className="grid grid-cols-3 gap-2"><button type="button" onClick={() => setMode(null)} aria-pressed={!draft.generationMode} className={`min-h-16 cursor-pointer rounded-xl border px-2 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${!draft.generationMode ? 'border-blue-500 bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/30 dark:text-blue-300' : 'border-gray-200 hover:border-blue-300 dark:border-gray-700'}`}>系统默认</button>{([['text-to-image', FileText, '文生图'], ['image-to-image', ImageIcon, '图生图']] as const).map(([mode, Icon, label]) => <button key={mode} type="button" onClick={() => setMode(mode)} aria-pressed={draft.generationMode === mode} className={`flex min-h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${draft.generationMode === mode ? 'border-blue-500 bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/30 dark:text-blue-300' : 'border-gray-200 hover:border-blue-300 dark:border-gray-700'}`}><Icon size={17} />{label}</button>)}</div>
            {draft.generationMode === 'image-to-image' && <div className="mt-3"><p className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-300">参考素材（可选）</p><div className="grid grid-cols-3 gap-1.5"><div className={`rounded-xl border p-2 ${draft.workflow.reference?.source === 'knowledge-material' ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 dark:border-gray-700'}`}><div className="flex items-center gap-1 text-xs font-medium"><Layers3 size={14} />素材批次</div><select value={knowledgeBatchId} onChange={(event) => setKnowledgeBatchId(event.target.value)} className="mt-2 h-8 w-full rounded-md border border-gray-300 bg-white px-1 text-xs dark:border-gray-700 dark:bg-gray-950"><option value="">选择素材集</option>{activeKnowledgeBatches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</select><button type="button" disabled={!knowledgeBatchId || loadingReference} onClick={async () => { setLoadingReference(true); try { const ids = await onPickKnowledgeMaterial(knowledgeBatchId); if (ids.length) setReference({ source: 'knowledge-material', label: activeKnowledgeBatches.find((batch) => batch.id === knowledgeBatchId)?.name ?? '素材批次', value: knowledgeBatchId, imageIds: ids }) } finally { setLoadingReference(false) } }} className="mt-1 flex h-8 w-full cursor-pointer items-center justify-center rounded-md bg-blue-600 text-xs text-white disabled:cursor-not-allowed disabled:bg-gray-300">{loadingReference ? <LoaderCircle size={12} className="animate-spin motion-reduce:animate-none" /> : '使用素材集'}</button></div><button type="button" onClick={async () => { const ids = await onPickLocalReference(); if (ids.length) setReference({ source: 'local-image', label: '本地参考图片', value: ids[0], imageIds: ids }) }} className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${draft.workflow.reference?.source === 'local-image' ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300' : 'border-gray-200 hover:border-blue-300 dark:border-gray-700'}`}><FolderOpen size={17} />本地图片</button><button type="button" disabled={!generatedImageIds.length} onClick={() => { const imageId = generatedImageIds[0]; if (imageId) setReference({ source: 'generated-image', label: '历史测试结果', value: imageId, imageIds: [imageId] }) }} className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40 ${draft.workflow.reference?.source === 'generated-image' ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300' : 'border-gray-200 hover:border-blue-300 dark:border-gray-700'}`}><FileImage size={17} />历史测试图</button></div>{draft.workflow.reference && <p className="mt-2 rounded-lg bg-gray-100 px-2 py-1.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">当前：{draft.workflow.reference.label} · {draft.workflow.reference.imageIds.length} 张</p>}</div>}
            <label className="mt-3 block"><span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">补充生成要求（可选）</span><textarea value={draft.workflow.instruction} onChange={(event) => updateWorkflow({ instruction: event.target.value })} placeholder="仅填写本次策略需要覆盖 SOP 的特殊要求" className="min-h-24 w-full rounded-xl border border-gray-300 bg-white p-3 text-sm leading-6 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-950 dark:focus:ring-blue-950" /></label>
          </OptionalSection>

          <OptionalSection title="知识词条" summary={draft.workflow.knowledge.insightIds.length ? `已选择 ${draft.workflow.knowledge.insightIds.length} 条` : '未选择，生成时不附加知识词条'}>
            <div className="max-h-44 space-y-1 overflow-y-auto">{activeKnowledgeInsights.map((insight) => { const selected = draft.workflow.knowledge.insightIds.includes(insight.id); return <button key={insight.id} type="button" onClick={() => toggleInsight(insight.id)} aria-pressed={selected} className={`flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-xl border px-3 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${selected ? 'border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300' : 'border-gray-200 hover:border-blue-300 dark:border-gray-700'}`}><span className={`h-2 w-2 shrink-0 rounded-full ${insight.category === 'stable' ? 'bg-blue-500' : 'bg-violet-500'}`} /><span className="min-w-0 flex-1 truncate">{insight.title}</span><span className="text-xs text-gray-400">{insight.category === 'stable' ? '稳定' : '探索'}</span></button> })}{!activeKnowledgeInsights.length && <p className="rounded-xl bg-gray-50 p-3 text-center text-xs text-gray-500 dark:bg-gray-950">知识库暂无可用词条。</p>}</div>
          </OptionalSection>

          <OptionalSection title="输出设置" summary={outputSummary}>
            <div className="space-y-2"><EnableRow checked={draft.outputs.channels.enabled} title="输出渠道" description="未启用时继承订单或系统默认渠道。" onChange={(enabled) => updateOutputs({ channels: { ...draft.outputs.channels, enabled }, export: enabled ? draft.outputs.export : { ...draft.outputs.export, enabled: false }, allocation: enabled || draft.outputs.sizes.enabled ? draft.outputs.allocation : { ...draft.outputs.allocation, enabled: false } })}><div className="flex flex-wrap gap-1.5">{catalog.channels.filter((item) => item.published && !item.archived).map((channel) => { const selected = draft.outputs.channels.channelIds.includes(channel.id); return <button key={channel.id} type="button" onClick={() => updateOutputs({ channels: { enabled: true, channelIds: selected ? draft.outputs.channels.channelIds.filter((id) => id !== channel.id) : [...draft.outputs.channels.channelIds, channel.id] } })} className={`min-h-9 cursor-pointer rounded-lg border px-3 text-xs ${selected ? 'border-blue-500 bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'}`}>{channel.name}</button> })}</div></EnableRow><EnableRow checked={draft.outputs.sizes.enabled} title="输出尺寸" description="未启用时继承订单或系统默认尺寸。" onChange={(enabled) => updateOutputs({ sizes: { ...draft.outputs.sizes, enabled }, allocation: enabled || draft.outputs.channels.enabled ? draft.outputs.allocation : { ...draft.outputs.allocation, enabled: false } })}><div className="grid grid-cols-2 gap-2">{(['16:9', '9:16'] as const).map((ratio) => { const selected = draft.outputs.sizes.ratios.includes(ratio); return <button key={ratio} type="button" onClick={() => updateOutputs({ sizes: { enabled: true, ratios: selected ? draft.outputs.sizes.ratios.filter((item) => item !== ratio) : [...draft.outputs.sizes.ratios, ratio] } })} className={`min-h-10 cursor-pointer rounded-lg border text-xs ${selected ? 'border-blue-500 bg-blue-100 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'}`}>{ratio === '16:9' ? '横版 16:9' : '竖版 9:16'}</button> })}</div></EnableRow><EnableRow checked={draft.outputs.export.enabled} disabled={!draft.outputs.channels.enabled || !draft.outputs.channels.channelIds.length} title="渠道导出" description="仅在已配置输出渠道时生效。" onChange={(enabled) => updateOutputs({ export: { ...draft.outputs.export, enabled } })}><select value={draft.outputs.export.presetId ?? ''} onChange={(event) => updateOutputs({ export: { enabled: true, presetId: event.target.value || undefined } })} className="h-9 w-full rounded-lg border border-gray-300 bg-white px-2 text-xs dark:border-gray-700 dark:bg-gray-950"><option value="">选择导出预设</option>{presets.filter((preset) => preset.type === 'export' && !preset.archived).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></EnableRow><EnableRow checked={draft.outputs.allocation.enabled} disabled={!draft.outputs.channels.enabled && !draft.outputs.sizes.enabled} title="输出分配" description="仅在已配置渠道或尺寸时生效。" onChange={(enabled) => updateOutputs({ allocation: { ...draft.outputs.allocation, enabled } })}><select value={draft.outputs.allocation.presetId ?? ''} onChange={(event) => updateOutputs({ allocation: { enabled: true, presetId: event.target.value || undefined } })} className="h-9 w-full rounded-lg border border-gray-300 bg-white px-2 text-xs dark:border-gray-700 dark:bg-gray-950"><option value="">选择分配预设</option>{presets.filter((preset) => preset.type === 'allocation' && !preset.archived).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></EnableRow></div>
          </OptionalSection>

          {role === 'admin' && versions.length > 0 && <OptionalSection title="版本历史" summary={`保留 ${versions.length} 个可回滚版本`}><div className="space-y-1">{versions.map((version) => <div key={`${version.id}:${version.version}`} className="flex min-h-9 items-center gap-2 rounded-lg bg-gray-50 px-2.5 text-xs dark:bg-gray-950"><span className="min-w-0 flex-1 truncate">v{version.version} · {version.name}</span><button type="button" onClick={() => onRollback(version.version)} className="h-7 cursor-pointer rounded-md px-2 text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/30">回滚</button></div>)}</div></OptionalSection>}
        </div>
      </div>

      <div className="border-t border-gray-200/80 bg-white/95 p-4 backdrop-blur dark:border-white/[0.08] dark:bg-gray-900/95">
        {(message || validationErrors.length > 0) && <p role="status" className={`mb-2 rounded-lg px-2.5 py-2 text-xs ${message === '测试任务已加入当前策略' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'}`}>{message || validationErrors[0]}</p>}
        <div className="flex items-end gap-2"><label className="min-w-0 flex-1"><span className="mb-1 block text-xs font-medium text-gray-500">测试生成数量</span><input type="number" inputMode="numeric" min={1} value={testQuantity} onChange={(event) => setTestQuantity(Number(event.target.value))} className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm tabular-nums outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-950 dark:focus:ring-blue-950" /></label><button type="button" onClick={runTest} disabled={testing || validationErrors.length > 0} className="flex h-10 flex-[1.5] cursor-pointer items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700">{testing ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" /> : <Play size={16} />}{testing ? '测试生成中' : `一键测试 ${Math.max(1, testQuantity || 10)} 张`}</button></div>
      </div>
      {showSopPicker && <div className="fixed inset-0 z-[var(--ds-z-overlay)] flex items-center justify-center bg-black/40 p-4 animate-overlay-in motion-reduce:animate-none" role="dialog" aria-modal="true" aria-labelledby="sop-preset-dialog-title" onMouseDown={(event) => {
        if (isModalBackdropEvent(event)) setShowSopPicker(false)
      }}>
        <div className="flex h-[min(82vh,760px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl animate-modal-in motion-reduce:animate-none dark:border-white/[0.1] dark:bg-gray-900">
          <div className="flex items-start justify-between gap-4 border-b border-gray-200/80 p-5 dark:border-white/[0.08]"><div><h3 id="sop-preset-dialog-title" className="text-lg font-semibold">选择 SOP 预设</h3><p className="mt-1 text-sm leading-5 text-gray-500">选择后将替换当前 SOP 的名称、内容和说明。</p></div><button type="button" onClick={() => setShowSopPicker(false)} aria-label="关闭 SOP 预设弹窗" className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-gray-300 dark:hover:bg-white/[0.06]"><X size={18} /></button></div>
          <div className="flex flex-col gap-3 border-b border-gray-200/80 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-white/[0.08]"><p className="text-sm font-medium text-gray-700 dark:text-gray-200">共 {sopItems.length} 个 SOP 预设</p><label className="w-full sm:max-w-sm"><span className="sr-only">搜索 SOP 预设</span><input value={sopSearch} onChange={(event) => setSopSearch(event.target.value)} placeholder="搜索 SOP 名称或说明" className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 dark:border-gray-700 dark:bg-gray-950 dark:focus:ring-violet-950" /></label></div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{visibleSopGroups.map((group) => { const collapsed = collapsedSopGroups.includes(group.id); return <section key={group.id} className="overflow-hidden rounded-xl border border-gray-200/80 dark:border-white/[0.08]"><button type="button" onClick={() => setCollapsedSopGroups((groups) => collapsed ? groups.filter((id) => id !== group.id) : [...groups, group.id])} aria-expanded={!collapsed} className="flex min-h-11 w-full cursor-pointer items-center gap-2 bg-gray-50 px-3 text-left text-sm font-semibold transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"><ChevronDown size={15} className={`shrink-0 text-gray-400 transition-transform ${collapsed ? '-rotate-90' : ''}`} /><span className="min-w-0 flex-1 truncate">{group.name}</span><span className="text-xs font-medium text-gray-400">{group.items.length}</span></button>{!collapsed && <div className="space-y-2 p-2">{group.items.map((item) => { const selected = draft.workflow.sop.presetId === item.id; const expanded = expandedSopId === item.id; return <article key={item.id} className={`rounded-xl border transition ${selected ? 'border-violet-400 bg-violet-50/60 dark:border-violet-400/50 dark:bg-violet-500/10' : 'border-gray-200/80 bg-white dark:border-white/[0.08] dark:bg-white/[0.02]'}`}><div className="flex items-center gap-3 p-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-sm font-semibold text-gray-600 dark:bg-white/[0.06] dark:text-gray-200">{item.name.trim().slice(0, 1) || 'S'}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.name}</p><p className="mt-1 line-clamp-1 text-xs leading-5 text-gray-500">{item.description || item.content || '未填写说明'}</p></div><div className="flex shrink-0 items-center gap-1.5"><button type="button" onClick={() => setExpandedSopId(expanded ? '' : item.id)} aria-expanded={expanded} className="h-8 cursor-pointer rounded-lg px-2.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-gray-300 dark:hover:bg-white/[0.08]">{expanded ? '收起' : '预览'}</button><button type="button" disabled={selected} onClick={() => { chooseSop(item); setShowSopPicker(false) }} className={`h-8 rounded-lg px-2.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${selected ? 'cursor-default bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300' : 'cursor-pointer bg-violet-600 text-white hover:bg-violet-700'}`}>{selected ? '已选' : '选择'}</button></div></div>{expanded && <div className="border-t border-gray-200/80 px-3 py-3 dark:border-white/[0.08]"><p className="whitespace-pre-wrap text-xs leading-5 text-gray-600 dark:text-gray-300">{item.content || '该预设未填写 SOP 内容。'}</p></div>}</article> })}</div>}</section> })}{!visibleSopGroups.length && <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-white/[0.12]">{sopSearch ? '没有匹配的 SOP 预设' : '暂无可用 SOP 预设'}</p>}</div>
        </div>
      </div>}
    </aside>
  )
}
