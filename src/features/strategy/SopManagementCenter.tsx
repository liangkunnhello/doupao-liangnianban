import { useEffect, useMemo, useRef, useState } from 'react'
import './styles.css'
import { Button, Inline } from '../../design-system'
import {
  CheckCircleIcon as CheckCircle2,
  CheckIcon as Check,
  CloseIcon as X,
  CopyIcon as Copy,
  FileImageIcon as FileImage,
  FolderPlusIcon as FolderPlus,
  LibraryIcon as Library,
  LoaderCircleIcon as LoaderCircle,
  MousePointerClickIcon as MousePointerClick,
  MinusIcon as Minus,
  PencilIcon as Pencil,
  PlusIcon as Plus,
  SaveIcon as Save,
  Settings2Icon as Settings2,
  SparklesIcon as Sparkles,
  StarIcon as Star,
  TrashIcon as Trash2,
  XCircleIcon as XCircle,
} from '../../design-system/icons'
import { MAX_SOP_REFERENCE_IMAGES, type GenerateSop, type SopReferenceImage } from './sopGeneration'
import { sopLibraryId } from './sopLibrary'
import type { SopGroup, SopLibraryItem, SopMetaInstruction } from './types'
import { isModalBackdropEvent } from '../../lib/modalBackdrop'

type CenterTab = 'library' | 'meta' | 'generate'
type GenerationJob = {
  status: 'idle' | 'running' | 'success' | 'error'
  message: string
  error?: string
  startedAt?: number
  resultName?: string
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

function readImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败'))
    reader.onerror = () => reject(new Error(`无法读取图片「${file.name}」`))
    reader.readAsDataURL(file)
  })
}

function inputClassName() {
  return 'sop-center-input'
}

export default function SopManagementCenter({
  minimized,
  groups,
  items,
  metaInstructions,
  currentUserId,
  onSaveGroup,
  onDuplicateGroup,
  onDeleteGroup,
  onSaveItem,
  onDuplicateItem,
  onDeleteItem,
  onSaveMetaInstruction,
  onDuplicateMetaInstruction,
  onDeleteMetaInstruction,
  onGenerateSop,
  selectedSopId,
  onApply,
  onClear,
  onMinimize,
  onRestore,
  onClose,
}: {
  minimized: boolean
  groups: SopGroup[]
  items: SopLibraryItem[]
  metaInstructions: SopMetaInstruction[]
  currentUserId: string
  onSaveGroup: (group: SopGroup) => void
  onDuplicateGroup: (groupId: string) => string | null
  onDeleteGroup: (groupId: string) => void
  onSaveItem: (item: SopLibraryItem) => void
  onDuplicateItem: (itemId: string) => string | null
  onDeleteItem: (itemId: string) => void
  onSaveMetaInstruction: (item: SopMetaInstruction) => void
  onDuplicateMetaInstruction: (itemId: string) => string | null
  onDeleteMetaInstruction: (itemId: string) => void
  onGenerateSop: GenerateSop
  selectedSopId?: string
  onApply?: (item: SopLibraryItem) => void
  onClear?: () => void
  onMinimize: () => void
  onRestore: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<CenterTab>('library')
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all')
  const [search, setSearch] = useState('')
  const initiallySelectedItem = items.find((item) => item.id === selectedSopId) ?? items[0]
  const [selectedItemId, setSelectedItemId] = useState(initiallySelectedItem?.id ?? '')
  const [selectedMetaId, setSelectedMetaId] = useState(metaInstructions[0]?.id ?? '')
  const [itemDraft, setItemDraft] = useState<SopLibraryItem | null>(initiallySelectedItem ?? null)
  const [metaDraft, setMetaDraft] = useState<SopMetaInstruction | null>(metaInstructions[0] ?? null)
  const [groupName, setGroupName] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [generatorMetaId, setGeneratorMetaId] = useState(metaInstructions[0]?.id ?? '')
  const [generatorGroupId, setGeneratorGroupId] = useState(groups[0]?.id ?? '')
  const [generatorBrief, setGeneratorBrief] = useState('')
  const [referenceImages, setReferenceImages] = useState<Array<SopReferenceImage & { id: string }>>([])
  const [job, setJob] = useState<GenerationJob>({ status: 'idle', message: '等待生成' })
  const [elapsed, setElapsed] = useState(0)

  const filteredItems = useMemo(() => {
    const groupedItems = selectedGroupId === 'favorites'
      ? items.filter((item) => item.favorite)
      : selectedGroupId === 'recent'
        ? [...items].filter((item) => item.lastUsedAt).sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
        : selectedGroupId === 'all'
      ? items
      : selectedGroupId === 'ungrouped'
        ? items.filter((item) => !item.groupId)
        : items.filter((item) => item.groupId === selectedGroupId)
    const query = search.trim().toLocaleLowerCase()
    return query
      ? groupedItems.filter((item) => `${item.name} ${item.description} ${item.content}`.toLocaleLowerCase().includes(query))
      : groupedItems
  }, [items, search, selectedGroupId])
  const persistedItem = items.find((item) => item.id === selectedItemId)
  const itemDirty = Boolean(itemDraft && persistedItem && (
    itemDraft.name !== persistedItem.name ||
    itemDraft.description !== persistedItem.description ||
    itemDraft.content !== persistedItem.content ||
    itemDraft.groupId !== persistedItem.groupId
  ))
  const itemApplied = Boolean(itemDraft && selectedSopId === itemDraft.id)
  const itemEditorHint = itemDirty
    ? itemApplied
      ? '有未保存修改；保存后会更新当前已应用的 SOP。'
      : '有未保存修改；保存后才能应用这个版本。'
    : itemApplied
      ? '当前 SOP 已应用。只有修改内容后才需要保存。'
      : '无需编辑即可直接应用；只有修改内容后才需要保存。'

  useEffect(() => {
    if (job.status !== 'running' || !job.startedAt) return
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - job.startedAt!) / 1000)))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [job.startedAt, job.status])

  useEffect(() => {
    const selected = filteredItems.find((item) => item.id === selectedItemId)
    if (selected) {
      setItemDraft(selected)
      return
    }
    const next = filteredItems[0] ?? null
    setSelectedItemId(next?.id ?? '')
    setItemDraft(next)
  }, [filteredItems, selectedItemId])

  useEffect(() => {
    const selected = metaInstructions.find((item) => item.id === selectedMetaId)
    if (selected) {
      setMetaDraft(selected)
      return
    }
    const next = metaInstructions[0] ?? null
    setSelectedMetaId(next?.id ?? '')
    setMetaDraft(next)
  }, [metaInstructions, selectedMetaId])

  useEffect(() => {
    if (!['all', 'ungrouped', 'favorites', 'recent'].includes(selectedGroupId) && !groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId('all')
    }
    if ((!generatorGroupId && groups[0]) || (generatorGroupId && !groups.some((group) => group.id === generatorGroupId))) {
      setGeneratorGroupId(groups[0]?.id ?? '')
    }
  }, [generatorGroupId, groups, selectedGroupId])

  useEffect(() => {
    if ((!generatorMetaId && metaInstructions[0]) || (generatorMetaId && !metaInstructions.some((item) => item.id === generatorMetaId))) {
      setGeneratorMetaId(metaInstructions[0]?.id ?? '')
    }
  }, [generatorMetaId, metaInstructions])

  useEffect(() => {
    if (editingGroupId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [editingGroupId])

  const startRenameGroup = (group: SopGroup) => {
    setEditingGroupId(group.id)
    setEditingGroupName(group.name)
  }

  const commitRenameGroup = () => {
    if (!editingGroupId) return
    const name = editingGroupName.trim()
    const group = groups.find((item) => item.id === editingGroupId)
    if (!group) {
      setEditingGroupId(null)
      return
    }
    if (name && name !== group.name) onSaveGroup({ ...group, name, updatedAt: Date.now() })
    setEditingGroupId(null)
  }

  const cancelRenameGroup = () => setEditingGroupId(null)

  const confirmDraftChange = () => !itemDirty || window.confirm('当前 SOP 有未保存修改，确认放弃这些修改吗？')
  const closeSafely = () => {
    if (job.status !== 'running' && confirmDraftChange()) onClose()
  }

  const selectItem = (item: SopLibraryItem) => {
    if (item.id !== selectedItemId && !confirmDraftChange()) return
    setSelectedItemId(item.id)
    setItemDraft(item)
  }

  const applyItem = (item: SopLibraryItem) => {
    const applied = { ...item, lastUsedAt: Date.now() }
    onSaveItem(applied)
    onApply?.(applied)
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key.toLocaleLowerCase() !== 's' || (!event.ctrlKey && !event.metaKey) || !itemDraft) return
      event.preventDefault()
      if (itemDraft.name.trim() && itemDraft.content.trim()) onSaveItem({ ...itemDraft, updatedAt: Date.now() })
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [itemDraft, onSaveItem])

  const selectMeta = (item: SopMetaInstruction) => {
    setSelectedMetaId(item.id)
    setMetaDraft(item)
  }

  const addGroup = () => {
    const name = groupName.trim() || '新建分组'
    const now = Date.now()
    const group = { id: sopLibraryId('group'), name, createdAt: now, updatedAt: now }
    onSaveGroup(group)
    setSelectedGroupId(group.id)
    setGroupName('')
    setEditingGroupId(group.id)
    setEditingGroupName(name)
  }

  const addItem = () => {
    const now = Date.now()
    const item: SopLibraryItem = {
      id: sopLibraryId('sop'),
      groupId: selectedGroupId !== 'all' && selectedGroupId !== 'ungrouped' ? selectedGroupId : undefined,
      name: '未命名 SOP',
      description: '',
      content: '',
      source: 'manual',
      createdBy: currentUserId,
      createdAt: now,
      updatedAt: now,
    }
    onSaveItem(item)
    selectItem(item)
  }

  const addMeta = () => {
    const now = Date.now()
    const item: SopMetaInstruction = {
      id: sopLibraryId('meta'),
      name: '未命名生成元指令',
      description: '',
      instruction: '',
      kind: 'custom',
      createdAt: now,
      updatedAt: now,
    }
    onSaveMetaInstruction(item)
    selectMeta(item)
  }

  const addReferenceImages = async (files: File[]) => {
    const available = MAX_SOP_REFERENCE_IMAGES - referenceImages.length
    const selected = files.slice(0, available)
    const invalid = selected.find((file) => !file.type.startsWith('image/'))
    if (invalid) {
      setJob({ status: 'error', message: '参考图片校验失败', error: `「${invalid.name}」不是图片文件` })
      return
    }
    const oversized = selected.find((file) => file.size > MAX_IMAGE_BYTES)
    if (oversized) {
      setJob({ status: 'error', message: '参考图片校验失败', error: `「${oversized.name}」超过 10 MiB` })
      return
    }
    try {
      const loaded = await Promise.all(selected.map(async (file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
        dataUrl: await readImage(file),
      })))
      setReferenceImages((current) => [...current, ...loaded])
      setJob({ status: 'idle', message: files.length > available ? `已保留前 ${MAX_SOP_REFERENCE_IMAGES} 张图片` : '参考图片已就绪' })
    } catch (error) {
      setJob({ status: 'error', message: '图片读取失败', error: error instanceof Error ? error.message : String(error) })
    }
  }

  const runGeneration = async () => {
    const meta = metaInstructions.find((item) => item.id === generatorMetaId)
    if (!meta) {
      setJob({ status: 'error', message: '无法开始生成', error: '请选择一个 SOP 生成元指令' })
      return
    }
    if (meta.kind === 'image-prompt' && referenceImages.length === 0) {
      setJob({ status: 'error', message: '无法开始生成', error: '图片生成 SOP 至少需要一张画风参考图片' })
      return
    }
    if (!generatorBrief.trim() && referenceImages.length === 0) {
      setJob({ status: 'error', message: '无法开始生成', error: '请填写生成说明或添加参考图片' })
      return
    }
    const startedAt = Date.now()
    setJob({ status: 'running', message: '正在分析输入并编译 SOP', startedAt })
    try {
      const generated = await onGenerateSop(
        generatorBrief,
        {},
        referenceImages,
        meta.kind === 'image-prompt' ? 'image-prompt' : 'general',
        meta.instruction,
      )
      const now = Date.now()
      const item: SopLibraryItem = {
        id: sopLibraryId('sop'),
        groupId: generatorGroupId || undefined,
        name: generated.name,
        description: generated.description,
        content: generated.sop,
        source: 'generated',
        metaInstructionId: meta.id,
        createdBy: currentUserId,
        createdAt: now,
        updatedAt: now,
      }
      onSaveItem(item)
      setSelectedGroupId(item.groupId ?? 'ungrouped')
      selectItem(item)
      setJob({ status: 'success', message: `SOP「${item.name}」生成并保存成功`, resultName: item.name, startedAt })
      setTab('library')
    } catch (error) {
      setJob({
        status: 'error',
        message: 'SOP 生成失败',
        error: error instanceof Error ? error.message : '未知错误，请检查 API 配置后重试',
        startedAt,
      })
    }
  }

  if (minimized) {
    return (
      <button
        type="button"
        onClick={onRestore}
        className="fixed bottom-6 right-6 z-[var(--ds-z-modal)] flex min-w-80 items-center gap-3 rounded-2xl border border-[hsl(var(--ds-color-border))] bg-[hsl(var(--ds-color-surface-raised)/0.96)] p-4 text-left shadow-2xl backdrop-blur transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ds-color-focus))] motion-reduce:transform-none"
      >
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${job.status === 'running' ? 'bg-[hsl(var(--ds-color-primary-subtle))] text-[hsl(var(--ds-color-primary))]' : job.status === 'success' ? 'bg-[hsl(var(--ds-color-success-subtle))] text-[hsl(var(--ds-color-success))]' : job.status === 'error' ? 'bg-[hsl(var(--ds-color-danger-subtle))] text-[hsl(var(--ds-color-danger))]' : 'bg-[hsl(var(--ds-color-surface-subtle))] text-[hsl(var(--ds-color-text-muted))]'}`}>
          {job.status === 'running' ? <LoaderCircle className="animate-spin" size={20} /> : job.status === 'success' ? <CheckCircle2 size={20} /> : job.status === 'error' ? <XCircle size={20} /> : <Library size={20} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">SOP 管理中心</span>
          <span className="sop-center-quiet-text mt-1 block truncate text-xs">{job.message}{job.status === 'running' ? ` · ${elapsed} 秒` : ''}</span>
          {job.status === 'running' && <span className="mt-2 block h-1 overflow-hidden rounded-full bg-[hsl(var(--ds-color-surface-subtle))]"><span className="block h-full w-1/2 animate-pulse rounded-full bg-[hsl(var(--ds-color-primary))]" /></span>}
        </span>
        <span className="text-xs font-medium text-[hsl(var(--ds-color-primary))]">展开</span>
      </button>
    )
  }

  return (
    <div className="sop-center-overlay fixed inset-0 z-[var(--ds-z-overlay)] flex items-center justify-center p-4 animate-overlay-in" role="dialog" aria-modal="true" aria-labelledby="sop-center-title" onMouseDown={(event) => {
      if (isModalBackdropEvent(event)) closeSafely()
    }}>
      <div className="sop-center-dialog animate-modal-in flex w-full flex-col overflow-hidden">
        <header className="sop-center-header">
          <div>
            <h2 id="sop-center-title" className="text-lg font-semibold tracking-tight">SOP 管理中心</h2>
            <p className="sop-center-quiet-text mt-1 text-xs">统一管理 SOP、分组和生成元指令；生成任务可最小化到后台继续执行。</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onMinimize} className="sop-center-button sop-center-button--secondary"><Minus size={16} />最小化</button>
            <button type="button" onClick={closeSafely} disabled={job.status === 'running'} aria-label="关闭 SOP 管理中心" className="sop-center-icon-button sop-center-icon-button--secondary"><X size={18} /></button>
          </div>
        </header>

        <nav className="sop-center-tabs" aria-label="SOP 管理中心功能">
          {([
            ['library', Library, 'SOP 库'],
            ['meta', Settings2, '生成元指令'],
            ['generate', Sparkles, '智能生成'],
          ] as const).map(([value, Icon, label]) => (
            <button key={value} type="button" onClick={() => (value === 'library' || confirmDraftChange()) && setTab(value)} className="sop-center-tab" data-selected={tab === value || undefined}><Icon size={16} />{label}</button>
          ))}
        </nav>

        {tab === 'library' && (
          <div className="sop-center-library-grid grid min-h-0 flex-1">
            <aside className="sop-center-sidebar min-h-0 overflow-y-auto border-r p-4">
              <div className="flex items-center gap-2"><input value={groupName} onChange={(event) => setGroupName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addGroup()} placeholder="新分组名称" className={`${inputClassName()} h-10 min-w-0`} /><button type="button" onClick={addGroup} aria-label="新增 SOP 分组" className="sop-center-icon-button sop-center-icon-button--primary"><FolderPlus size={16} /></button></div>
              <div className="mt-4 space-y-1">
                {[{ id: 'all', name: '全部 SOP', count: items.length }, { id: 'favorites', name: '收藏', count: items.filter((item) => item.favorite).length }, { id: 'recent', name: '最近使用', count: items.filter((item) => item.lastUsedAt).length }, { id: 'ungrouped', name: '未分组', count: items.filter((item) => !item.groupId).length }].map((group) => <button key={group.id} type="button" onClick={() => confirmDraftChange() && setSelectedGroupId(group.id)} className="sop-center-nav-item" data-selected={selectedGroupId === group.id || undefined}><span>{group.name}</span><span className="text-xs opacity-70">{group.count}</span></button>)}
                {groups.map((group) => {
                  const isEditing = editingGroupId === group.id
                  if (isEditing) {
                    return (
                      <div key={group.id} className="sop-center-group-row sop-center-group-row--editing flex items-center gap-1" data-selected={selectedGroupId === group.id || undefined}>
                        <input
                          ref={renameInputRef}
                          value={editingGroupName}
                          onChange={(event) => setEditingGroupName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') commitRenameGroup()
                            if (event.key === 'Escape') cancelRenameGroup()
                          }}
                          onBlur={commitRenameGroup}
                          placeholder="分组名称"
                          className="sop-center-input h-10 min-w-0 flex-1 px-3 text-sm"
                          aria-label="重命名分组"
                        />
                        <button type="button" onClick={commitRenameGroup} aria-label="保存分组名称" className="sop-center-icon-button sop-center-icon-button--primary"><Check size={14} /></button>
                        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={cancelRenameGroup} aria-label="取消重命名" className="sop-center-icon-button sop-center-icon-button--secondary"><X size={14} /></button>
                      </div>
                    )
                  }
                  return (
                    <div key={group.id} className="sop-center-group-row group flex items-center" data-selected={selectedGroupId === group.id || undefined}>
                      <button type="button" onClick={() => confirmDraftChange() && setSelectedGroupId(group.id)} className="min-h-10 min-w-0 flex-1 truncate px-3 text-left text-sm">{group.name}</button>
                      <button type="button" onClick={() => startRenameGroup(group)} aria-label={`重命名${group.name}`} className="p-2 text-[hsl(var(--ds-color-text-subtle))] opacity-0 group-hover:opacity-100"><Pencil size={13} /></button>
                      <button type="button" onClick={() => onDuplicateGroup(group.id)} aria-label={`复制${group.name}`} className="p-2 text-[hsl(var(--ds-color-text-subtle))] opacity-0 group-hover:opacity-100"><Copy size={13} /></button>
                      <button type="button" onClick={() => window.confirm(`删除分组「${group.name}」？组内 SOP 将转为未分组。`) && onDeleteGroup(group.id)} aria-label={`删除${group.name}`} className="p-2 text-[hsl(var(--ds-color-danger))] opacity-0 group-hover:opacity-100"><Trash2 size={13} /></button>
                    </div>
                  )
                })}
              </div>
            </aside>

            <section className="sop-center-list-panel min-h-0 overflow-y-auto border-r p-4">
              <div className="flex items-center justify-between"><div><h3 className="font-semibold">SOP 列表</h3><p className="sop-center-quiet-text mt-1 text-xs">{filteredItems.length} 个 SOP</p></div><button type="button" onClick={addItem} className="sop-center-button sop-center-button--primary"><Plus size={15} />新建</button></div>
              <label className="mt-3 block"><span className="sr-only">搜索 SOP</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称、说明或正文" className={`${inputClassName()} h-10`} /></label>
              <div className="mt-4 space-y-2">
                {filteredItems.map((item) => (
                  <div key={item.id} className="sop-center-card group" data-selected={selectedItemId === item.id || undefined}>
                    <button type="button" onClick={() => selectItem(item)} className="w-full text-left"><h4 className="truncate text-sm font-semibold">{item.name}</h4><p className="sop-center-quiet-text mt-1 line-clamp-2 text-xs leading-5">{item.description || '暂无说明'}</p></button>
                    <div className="mt-3 flex items-center justify-between"><span className="sop-center-badge">{item.source === 'generated' ? 'AI 生成' : item.source === 'legacy-preset' ? '历史预设' : '手动'}</span><span className="flex gap-1"><button type="button" onClick={() => onSaveItem({ ...item, favorite: !item.favorite, updatedAt: Date.now() })} aria-label={`${item.favorite ? '取消收藏' : '收藏'} ${item.name}`} title={item.favorite ? '取消收藏' : '收藏'} className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${item.favorite ? 'text-amber-500' : 'text-[hsl(var(--ds-color-text-subtle))] hover:text-amber-500'}`}><Star size={14} fill={item.favorite ? 'currentColor' : 'none'} /></button>{onApply && <button type="button" onClick={() => applyItem(item)} aria-label={`应用 ${item.name}`} title="应用到当前生图" className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${selectedSopId === item.id ? 'bg-[hsl(var(--ds-color-success-subtle))] text-[hsl(var(--ds-color-success))]' : 'text-[hsl(var(--ds-color-text-subtle))] hover:bg-[hsl(var(--ds-color-surface-subtle))] hover:text-[hsl(var(--ds-color-text))]'}`}><MousePointerClick size={14} /></button>}<button type="button" onClick={() => { const id = onDuplicateItem(item.id); if (id) setSelectedItemId(id) }} aria-label={`复制${item.name}`} className="p-2 text-[hsl(var(--ds-color-text-subtle))] hover:text-[hsl(var(--ds-color-primary))]"><Copy size={14} /></button><button type="button" onClick={() => window.confirm(`删除 SOP「${item.name}」？`) && onDeleteItem(item.id)} aria-label={`删除${item.name}`} className="p-2 text-[hsl(var(--ds-color-text-subtle))] hover:text-[hsl(var(--ds-color-danger))]"><Trash2 size={14} /></button></span></div>
                  </div>
                ))}
                {filteredItems.length === 0 && <div className="rounded-xl border border-dashed border-[hsl(var(--ds-color-border))] p-8 text-center text-sm text-[hsl(var(--ds-color-text-muted))]">当前分组暂无 SOP</div>}
              </div>
            </section>

            <section className="sop-center-editor-panel min-h-0 overflow-y-auto p-5">
              {itemDraft ? <div className="sop-center-editor-card space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-[1_1_18rem]">
                    <h3 className="font-semibold">预览与编辑 SOP</h3>
                    <p className="sop-center-quiet-text mt-1 text-xs">{itemEditorHint} Ctrl/Cmd+S 可快捷保存。</p>
                  </div>
                  <Inline className="max-w-full" justify="flex-end">
                    {onApply && <Button
                      disabled={!persistedItem || itemDirty || itemApplied}
                      onClick={() => persistedItem && applyItem(persistedItem)}
                      variant={itemApplied ? 'secondary' : 'primary'}
                      leadingIcon={<MousePointerClick size={15} />}
                      className={itemApplied ? 'text-[hsl(var(--ds-color-success))]' : undefined}
                    >
                      {itemApplied ? '已应用' : '应用 SOP'}
                    </Button>}
                    <Button
                      disabled={!itemDirty || !itemDraft.name.trim() || !itemDraft.content.trim()}
                      onClick={() => onSaveItem({ ...itemDraft, updatedAt: Date.now() })}
                      variant={itemDirty ? 'primary' : 'secondary'}
                      leadingIcon={<Save size={15} />}
                    >
                      保存修改
                    </Button>
                    {onClear && selectedSopId && <Button onClick={onClear} variant="secondary">取消应用</Button>}
                  </Inline>
                </div>
                <label className="block text-xs font-medium text-[hsl(var(--ds-color-text-muted))]">名称<input value={itemDraft.name} onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })} className={`${inputClassName()} mt-1 h-11`} /></label><label className="block text-xs font-medium text-[hsl(var(--ds-color-text-muted))]">所属分组<select value={itemDraft.groupId ?? ''} onChange={(event) => setItemDraft({ ...itemDraft, groupId: event.target.value || undefined })} className={`${inputClassName()} mt-1 h-11`}><option value="">未分组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label className="block text-xs font-medium text-[hsl(var(--ds-color-text-muted))]">说明<textarea value={itemDraft.description} onChange={(event) => setItemDraft({ ...itemDraft, description: event.target.value })} className={`${inputClassName()} mt-1 min-h-24 py-3 leading-6`} /></label><label className="block text-xs font-medium text-[hsl(var(--ds-color-text-muted))]">SOP 正文<textarea value={itemDraft.content} onChange={(event) => setItemDraft({ ...itemDraft, content: event.target.value })} className={`${inputClassName()} mt-1 min-h-[360px] py-3 font-mono text-xs leading-6`} /></label>
              </div> : <div className="flex h-full items-center justify-center text-sm text-[hsl(var(--ds-color-text-muted))]">选择或新建一个 SOP</div>}
            </section>
          </div>
        )}

        {tab === 'meta' && (
          <div className="sop-center-meta-grid grid min-h-0 flex-1">
            <aside className="sop-center-list-panel min-h-0 overflow-y-auto border-r p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">生成元指令</h3>
                  <p className="sop-center-quiet-text mt-1 text-xs">控制 AI 如何编译 SOP。</p>
                </div>
                <button type="button" onClick={addMeta} className="sop-center-button sop-center-button--primary"><Plus size={15} />新建</button>
              </div>
              <div className="mt-4 space-y-2">
                {metaInstructions.map((item) => (
                  <div key={item.id} className="sop-center-card group" data-selected={selectedMetaId === item.id || undefined}>
                    <button type="button" onClick={() => selectMeta(item)} className="w-full text-left">
                      <h4 className="truncate text-sm font-semibold">{item.name}</h4>
                      <p className="sop-center-quiet-text mt-1 line-clamp-2 text-xs leading-5">{item.description || '暂无说明'}</p>
                    </button>
                    <div className="mt-2 flex justify-end gap-1">
                      <button type="button" onClick={() => { const id = onDuplicateMetaInstruction(item.id); if (id) setSelectedMetaId(id) }} aria-label={`复制${item.name}`} className="p-2 text-[hsl(var(--ds-color-text-subtle))] hover:text-[hsl(var(--ds-color-primary))]"><Copy size={14} /></button>
                      <button type="button" onClick={() => window.confirm(`删除元指令「${item.name}」？`) && onDeleteMetaInstruction(item.id)} aria-label={`删除${item.name}`} className="p-2 text-[hsl(var(--ds-color-text-subtle))] hover:text-[hsl(var(--ds-color-danger))]"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
            <section className="sop-center-editor-panel min-h-0 overflow-y-auto p-5">
              {metaDraft ? (
                <div className="sop-center-editor-card space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">编辑生成元指令</h3>
                      <p className="sop-center-quiet-text mt-1 text-xs">重命名或修改后，新生成任务立即使用最新内容。</p>
                    </div>
                    <button type="button" disabled={!metaDraft.name.trim() || !metaDraft.instruction.trim()} onClick={() => onSaveMetaInstruction({ ...metaDraft, updatedAt: Date.now() })} className="sop-center-button sop-center-button--primary"><Save size={15} />保存</button>
                  </div>
                  <label className="block text-xs font-medium text-[hsl(var(--ds-color-text-muted))]">名称<input value={metaDraft.name} onChange={(event) => setMetaDraft({ ...metaDraft, name: event.target.value })} className={`${inputClassName()} mt-1 h-11`} /></label>
                  <label className="block text-xs font-medium text-[hsl(var(--ds-color-text-muted))]">类型<select value={metaDraft.kind} onChange={(event) => setMetaDraft({ ...metaDraft, kind: event.target.value as SopMetaInstruction['kind'] })} className={`${inputClassName()} mt-1 h-11`}><option value="general">通用 SOP</option><option value="image-prompt">图片提示词 SOP</option><option value="custom">自定义</option></select></label>
                  <label className="block text-xs font-medium text-[hsl(var(--ds-color-text-muted))]">说明<textarea value={metaDraft.description} onChange={(event) => setMetaDraft({ ...metaDraft, description: event.target.value })} className={`${inputClassName()} mt-1 min-h-24 py-3 leading-6`} /></label>
                  <label className="block text-xs font-medium text-[hsl(var(--ds-color-text-muted))]">元指令正文<textarea value={metaDraft.instruction} onChange={(event) => setMetaDraft({ ...metaDraft, instruction: event.target.value })} className={`${inputClassName()} mt-1 min-h-[420px] py-3 font-mono text-xs leading-6`} /></label>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-[hsl(var(--ds-color-text-muted))]">选择或新建一个生成元指令</div>
              )}
            </section>
          </div>
        )}

        {tab === 'generate' && (
          <div className="sop-center-generate-grid grid min-h-0 flex-1">
            <section className="sop-center-editor-panel min-h-0 overflow-y-auto border-r p-5">
              <div className="sop-center-editor-card space-y-4">
                <div>
                  <h3 className="font-semibold">生成新 SOP</h3>
                  <p className="sop-center-quiet-text mt-1 text-xs">选择元指令、目标分组并提供文字或图片输入。</p>
                </div>
                <label className="block text-xs font-medium text-[hsl(var(--ds-color-text-muted))]">生成元指令<select value={generatorMetaId} onChange={(event) => setGeneratorMetaId(event.target.value)} className={`${inputClassName()} mt-1 h-11`}><option value="">请选择</option>{metaInstructions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label className="block text-xs font-medium text-[hsl(var(--ds-color-text-muted))]">保存到分组<select value={generatorGroupId} onChange={(event) => setGeneratorGroupId(event.target.value)} className={`${inputClassName()} mt-1 h-11`}><option value="">未分组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
                <label className="block text-xs font-medium text-[hsl(var(--ds-color-text-muted))]">生成说明<textarea value={generatorBrief} onChange={(event) => setGeneratorBrief(event.target.value)} placeholder="说明 SOP 的目标、输入、输出格式和禁止项" className={`${inputClassName()} mt-1 min-h-32 py-3 leading-6`} /></label>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-[hsl(var(--ds-color-text-muted))]">参考图片</span>
                    <span className="text-xs text-[hsl(var(--ds-color-text-subtle))]">{referenceImages.length}/{MAX_SOP_REFERENCE_IMAGES}</span>
                  </div>
                  <label className="sop-center-upload">
                    <input type="file" accept="image/*" multiple className="sr-only" disabled={job.status === 'running' || referenceImages.length >= MAX_SOP_REFERENCE_IMAGES} onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void addReferenceImages(files) }} />
                    <span><FileImage size={22} className="mx-auto" /><span className="mt-2 block text-xs font-medium">添加参考图片</span></span>
                  </label>
                  {referenceImages.length > 0 && (
                    <div className="mt-3 grid grid-cols-6 gap-2">
                      {referenceImages.map((image) => (
                        <div key={image.id} className="sop-center-thumb group relative aspect-square">
                          <img src={image.dataUrl} alt={image.name} className="h-full w-full object-cover" />
                          <button type="button" onClick={() => setReferenceImages((current) => current.filter((item) => item.id !== image.id))} aria-label={`移除${image.name}`} className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-md bg-[hsl(var(--ds-color-scrim)/0.72)] text-[hsl(var(--ds-color-text-inverse))] opacity-0 group-hover:opacity-100"><X size={13} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => void runGeneration()} disabled={job.status === 'running'} className="sop-center-button sop-center-button--primary h-12 w-full">{job.status === 'running' ? <LoaderCircle size={17} className="animate-spin" /> : <Sparkles size={17} />}{job.status === 'running' ? '正在生成 SOP' : '开始生成并保存'}</button>
              </div>
            </section>
            <aside className="sop-center-editor-panel min-h-0 overflow-y-auto p-5">
              <div className="sop-center-editor-card space-y-4">
                <h3 className="font-semibold">生成状态</h3>
                <div aria-live="polite" className="sop-center-status" data-status={job.status}>
                  <div className="flex items-center gap-3">
                    {job.status === 'running' ? <LoaderCircle className="sop-center-status-icon animate-spin" size={22} /> : job.status === 'success' ? <CheckCircle2 className="sop-center-status-icon" size={22} /> : job.status === 'error' ? <XCircle className="sop-center-status-icon" size={22} /> : <Sparkles className="sop-center-status-icon" size={22} />}
                    <div>
                      <p className="text-sm font-semibold">{job.message}</p>
                      {job.status === 'running' && <p className="sop-center-quiet-text mt-1 text-xs">已运行 {elapsed} 秒，可最小化继续处理</p>}
                    </div>
                  </div>
                  {job.status === 'running' && <div className="sop-center-progress-track mt-4"><div className="sop-center-progress-bar animate-pulse" /></div>}
                  {job.error && <p role="alert" className="mt-3 whitespace-pre-wrap text-xs leading-5 text-[hsl(var(--ds-color-danger))]">{job.error}</p>}
                  {job.status === 'success' && <p className="sop-center-status-copy mt-3 text-xs leading-5">结果已自动保存到 SOP 库，可立即在策略或画廊中使用。</p>}
                </div>
                <div className="mt-4 rounded-xl bg-[hsl(var(--ds-color-surface-subtle))] p-4 text-xs leading-6 text-[hsl(var(--ds-color-text-muted))]">
                  <p className="font-medium text-[hsl(var(--ds-color-text))]">运行说明</p>
                  <p>生成中可以点击右上角“最小化”。后台状态条会持续显示运行时间；完成或失败后会保留具体结果。</p>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}
