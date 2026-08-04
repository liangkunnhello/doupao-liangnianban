import { useEffect, useMemo, useRef, useState } from 'react'
import './styles.css'
import { Button, Dialog, IconButton, Inline, ScrollArea } from '../../design-system'
import {
  CheckCircleIcon as CheckCircle2,
  CheckIcon as Check,
  CloseIcon as X,
  CopyIcon as Copy,
  FileImageIcon as FileImage,
  FolderPlusIcon as FolderPlus,
  LibraryIcon as Library,
  ListChecksIcon as ListChecks,
  LoaderCircleIcon as LoaderCircle,
  MousePointerClickIcon as MousePointerClick,
  PencilIcon as Pencil,
  PlusIcon as Plus,
  SaveIcon as Save,
  Settings2Icon as Settings2,
  SparklesIcon as Sparkles,
  StarIcon as Star,
  TrashIcon as Trash2,
  XCircleIcon as XCircle,
} from '../../design-system/icons'
import type { SopBatchSnapshot, TaskRecord } from '../../types'
import { MAX_SOP_REFERENCE_IMAGES, type GenerateSop, type SopReferenceImage } from './sopGeneration'
import { sopLibraryId } from './sopLibrary'
import { getSopCoverCandidates } from './sopCover'
import { getAllSopBatchSnapshots } from '../../lib/db'
import SopCoverImage from './SopCoverImage'
import SopTextEditor from './SopTextEditor'
import type { SopGroup, SopLibraryItem, SopMetaInstruction } from './types'
import { isModalBackdropEvent } from '../../lib/modalBackdrop'
import { useAppDialog } from '../../hooks/useAppDialog'
import { LARGE_MODAL_SIZE_STYLE, useLargeModalMode } from '../../hooks/useLargeModalMode'
import LargeModalToggle from '../../components/LargeModalToggle'

type CenterTab = 'library' | 'meta' | 'generate'
type GenerationJob = {
  status: 'idle' | 'running' | 'success' | 'error'
  message: string
  error?: string
  startedAt?: number
  resultName?: string
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const SOP_MANAGEMENT_MODAL_MODE_STORAGE_KEY = 'doupao.sop-management-modal-mode'
const SOP_AUTO_SAVE_DELAY_MS = 800
type AutoSaveState = 'idle' | 'pending' | 'saved' | 'blocked'

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
  groups,
  items,
  tasks = [],
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
  onClose,
}: {
  groups: SopGroup[]
  items: SopLibraryItem[]
  tasks?: TaskRecord[]
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
  onClose: () => void
}) {
  const { openConfirmDialog } = useAppDialog()
  const { largeView, toggleLargeView } = useLargeModalMode(SOP_MANAGEMENT_MODAL_MODE_STORAGE_KEY)
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
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)
  const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false)
  const [snapshotsForItem, setSnapshotsForItem] = useState<SopBatchSnapshot[]>([])
  const [snapshotsLoading, setSnapshotsLoading] = useState(false)
  const [autoSaveState, setAutoSaveState] = useState<AutoSaveState>('idle')
  const autoSaveTimerRef = useRef<number | null>(null)

  const viewGeneratedPrompts = async (item: SopLibraryItem) => {
    setSnapshotDialogOpen(true)
    setSnapshotsLoading(true)
    try {
      const all = await getAllSopBatchSnapshots()
      setSnapshotsForItem(
        all
          .filter((snapshot) => snapshot.sop.id === item.id)
          .sort((a, b) => b.createdAt - a.createdAt),
      )
    } finally {
      setSnapshotsLoading(false)
    }
  }

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
      ? groupedItems.filter((item) => `${item.name} ${item.content}`.toLocaleLowerCase().includes(query))
      : groupedItems
  }, [items, search, selectedGroupId])
  const persistedItem = items.find((item) => item.id === selectedItemId)
  const itemDirty = Boolean(itemDraft && persistedItem && (
    itemDraft.name !== persistedItem.name ||
    itemDraft.description !== persistedItem.description ||
    itemDraft.content !== persistedItem.content ||
    itemDraft.groupId !== persistedItem.groupId ||
    itemDraft.coverImageId !== persistedItem.coverImageId
  ))
  const itemDraftValid = Boolean(itemDraft?.name.trim() && itemDraft?.content.trim())
  const coverCandidates = useMemo(
    () => getSopCoverCandidates(itemDraft?.id ?? '', tasks),
    [itemDraft?.id, tasks],
  )
  const itemApplied = Boolean(itemDraft && selectedSopId === itemDraft.id)
  const itemEditorHint = autoSaveState === 'saved'
    ? '修改已自动保存。'
    : itemDirty
      ? itemDraftValid
        ? itemApplied
          ? '修改将在 1 秒内自动保存，并更新当前使用的 SOP。'
          : '修改将在 1 秒内自动保存。'
        : '名称和正文不能为空，当前修改尚未保存。'
      : itemApplied
        ? '当前 SOP 已使用。'
        : '无需编辑即可直接应用。'

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

  useEffect(() => {
    setAutoSaveState('idle')
  }, [selectedItemId])

  useEffect(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    if (!itemDirty || !itemDraft) return
    if (!itemDraft.name.trim() || !itemDraft.content.trim()) {
      setAutoSaveState('blocked')
      return
    }

    const draftToSave = itemDraft
    setAutoSaveState('pending')
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null
      onSaveItem({ ...draftToSave, updatedAt: Date.now() })
      setAutoSaveState('saved')
    }, SOP_AUTO_SAVE_DELAY_MS)

    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
  }, [itemDirty, itemDraft, onSaveItem])

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

  const saveItemDraftNow = (draft = itemDraft) => {
    if (!draft?.name.trim() || !draft.content.trim()) return false
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    onSaveItem({ ...draft, updatedAt: Date.now() })
    setAutoSaveState('idle')
    return true
  }

  const runAfterDraftConfirmation = (action: () => void) => {
    if (!itemDirty) {
      action()
      return
    }
    if (saveItemDraftNow()) {
      action()
      return
    }
    openConfirmDialog({
      title: '放弃未保存的修改？',
      message: '当前 SOP 的修改尚未保存，继续操作将丢失这些修改。',
      confirmText: '放弃修改',
      tone: 'warning',
      action,
    })
  }

  const closeSafely = () => {
    if (job.status !== 'running') runAfterDraftConfirmation(onClose)
  }

  const selectItem = (item: SopLibraryItem) => {
    if (item.id === selectedItemId) {
      if (itemDirty) saveItemDraftNow()
      setCoverPickerOpen(false)
      return
    }
    const select = () => {
      setSelectedItemId(item.id)
      setItemDraft(item)
      setCoverPickerOpen(false)
    }
    runAfterDraftConfirmation(select)
  }

  const openCoverPickerForItem = (item: SopLibraryItem) => {
    if (item.id === selectedItemId) {
      setCoverPickerOpen(true)
      return
    }
    const open = () => {
      setSelectedItemId(item.id)
      setItemDraft(item)
      setCoverPickerOpen(true)
    }
    runAfterDraftConfirmation(open)
  }

  const applyItem = (item: SopLibraryItem) => {
    runAfterDraftConfirmation(() => {
      const source = item.id === selectedItemId && itemDraft ? itemDraft : item
      const applied = { ...source, lastUsedAt: Date.now() }
      onSaveItem(applied)
      onApply?.(applied)
      setSelectedItemId(applied.id)
      setItemDraft(applied)
      setCoverPickerOpen(false)
    })
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key.toLocaleLowerCase() !== 's' || (!event.ctrlKey && !event.metaKey) || !itemDraft) return
      event.preventDefault()
      saveItemDraftNow()
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

  return (
    <div className="sop-center-overlay fixed inset-0 z-[var(--ds-z-overlay)] flex items-center justify-center p-4 animate-overlay-in" role="dialog" aria-modal="true" aria-labelledby="sop-center-title" onMouseDown={(event) => {
      if (isModalBackdropEvent(event)) closeSafely()
    }}>
      <div
        style={largeView ? LARGE_MODAL_SIZE_STYLE : undefined}
        className="sop-center-dialog relative animate-modal-in flex w-full flex-col overflow-hidden transition-[width,height,max-width] duration-200 ease-out"
      >
        <header className="sop-center-header">
          <div>
            <h2 id="sop-center-title" className="text-lg font-semibold tracking-tight">SOP 管理中心</h2>
            <p className="sop-center-quiet-text mt-1 text-xs">统一管理 SOP、分组和生成元指令。</p>
          </div>
          <div className="flex items-center gap-2">
            <LargeModalToggle largeView={largeView} dialogName="SOP 管理中心" onToggle={toggleLargeView} />
            <button type="button" onClick={closeSafely} disabled={job.status === 'running'} aria-label="关闭 SOP 管理中心" className="sop-center-icon-button sop-center-icon-button--secondary"><X size={18} /></button>
          </div>
        </header>

        <nav className="sop-center-tabs" aria-label="SOP 管理中心功能">
          {([
            ['library', Library, 'SOP 库'],
            ['meta', Settings2, '生成元指令'],
            ['generate', Sparkles, '智能生成'],
          ] as const).map(([value, Icon, label]) => (
            <button key={value} type="button" onClick={() => value === 'library' ? setTab(value) : runAfterDraftConfirmation(() => setTab(value))} className="sop-center-tab" data-selected={tab === value || undefined}><Icon size={16} />{label}</button>
          ))}
        </nav>

        {tab === 'library' && (
          <div className="sop-center-library-grid grid min-h-0 flex-1">
            <aside className="sop-center-sidebar min-h-0 overflow-y-auto border-r p-4">
              <div className="flex items-center gap-2"><input value={groupName} onChange={(event) => setGroupName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addGroup()} placeholder="新分组名称" className={`${inputClassName()} h-10 min-w-0`} /><button type="button" onClick={addGroup} aria-label="新增 SOP 分组" className="sop-center-icon-button sop-center-icon-button--primary"><FolderPlus size={16} /></button></div>
              <div className="mt-4 space-y-1">
                {[{ id: 'all', name: '全部 SOP', count: items.length }, { id: 'favorites', name: '收藏', count: items.filter((item) => item.favorite).length }, { id: 'recent', name: '最近使用', count: items.filter((item) => item.lastUsedAt).length }, { id: 'ungrouped', name: '未分组', count: items.filter((item) => !item.groupId).length }].map((group) => <button key={group.id} type="button" onClick={() => runAfterDraftConfirmation(() => setSelectedGroupId(group.id))} className="sop-center-nav-item" data-selected={selectedGroupId === group.id || undefined}><span>{group.name}</span><span className="text-xs opacity-70">{group.count}</span></button>)}
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
                      <button type="button" onClick={() => runAfterDraftConfirmation(() => setSelectedGroupId(group.id))} className="min-h-10 min-w-0 flex-1 truncate px-3 text-left text-sm">{group.name}</button>
                      <button type="button" onClick={() => startRenameGroup(group)} aria-label={`重命名${group.name}`} className="p-2 text-[hsl(var(--ds-color-text-subtle))] opacity-0 group-hover:opacity-100"><Pencil size={13} /></button>
                      <button type="button" onClick={() => onDuplicateGroup(group.id)} aria-label={`复制${group.name}`} className="p-2 text-[hsl(var(--ds-color-text-subtle))] opacity-0 group-hover:opacity-100"><Copy size={13} /></button>
                      <button type="button" onClick={() => openConfirmDialog({
                        title: '删除 SOP 分组？',
                        message: `将删除分组「${group.name}」，组内 SOP 会转为未分组。`,
                        confirmText: '确认删除',
                        tone: 'danger',
                        action: () => onDeleteGroup(group.id),
                      })} aria-label={`删除${group.name}`} className="p-2 text-[hsl(var(--ds-color-danger))] opacity-0 group-hover:opacity-100"><Trash2 size={13} /></button>
                    </div>
                  )
                })}
              </div>
            </aside>

            <section className="sop-center-list-panel min-h-0 overflow-y-auto border-r p-4">
              <div className="flex items-center justify-between"><div><h3 className="font-semibold">SOP 列表</h3><p className="sop-center-quiet-text mt-1 text-xs">{filteredItems.length} 个 SOP</p></div><button type="button" onClick={addItem} className="sop-center-button sop-center-button--primary"><Plus size={15} />新建</button></div>
              <label className="mt-3 block"><span className="sr-only">搜索 SOP</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索名称或正文" className={`${inputClassName()} h-10`} /></label>
              <div className="sop-center-sop-list mt-3" role="list">
                {filteredItems.map((item) => {
                  const groupName = groups.find((group) => group.id === item.groupId)?.name ?? '未分组'
                  return (
                  <article key={item.id} className="sop-center-sop-row group" data-selected={selectedItemId === item.id || undefined} role="listitem">
                      <button
                        type="button"
                        onClick={() => selectItem(item)}
                        onDoubleClick={(event) => {
                          event.stopPropagation()
                          openCoverPickerForItem(item)
                        }}
                        aria-label={`双击选择 ${item.name} 的封面`}
                        title="双击选择封面"
                        className="sop-center-sop-cover"
                      >
                        <SopCoverImage imageId={selectedItemId === item.id ? itemDraft?.coverImageId : item.coverImageId} alt={`${item.name} 封面`} fallbackText={item.name.trim().slice(0, 1) || 'S'} className="h-12 w-12 rounded-lg" />
                      </button>
                      <button type="button" onClick={() => selectItem(item)} title={item.name} className="sop-center-sop-main">
                        <span className="block min-w-0 w-full truncate text-sm font-semibold">{item.name}</span>
                        <span className="sop-center-sop-params" aria-label="SOP 参数">
                          <span>{groupName}</span>
                          {selectedSopId === item.id && <span className="sop-center-sop-applied">使用中</span>}
                        </span>
                      </button>
                      <div className="sop-center-sop-actions" aria-label={`${item.name} 操作`}>
                        <button type="button" onClick={() => onSaveItem({ ...item, favorite: !item.favorite, updatedAt: Date.now() })} aria-label={`${item.favorite ? '取消收藏' : '收藏'} ${item.name}`} title={item.favorite ? '取消收藏' : '收藏'} className={`sop-center-row-action ${item.favorite ? 'text-amber-500' : 'text-[hsl(var(--ds-color-text-subtle))] hover:text-amber-500'}`}><Star size={14} fill={item.favorite ? 'currentColor' : 'none'} /></button>
                        {onApply && <button type="button" onClick={() => applyItem(item)} aria-label={`应用 ${item.name}`} title="应用到当前生图" className={`sop-center-row-action ${selectedSopId === item.id ? 'bg-[hsl(var(--ds-color-success-subtle))] text-[hsl(var(--ds-color-success))]' : 'text-[hsl(var(--ds-color-text-subtle))] hover:bg-[hsl(var(--ds-color-surface-subtle))] hover:text-[hsl(var(--ds-color-text))]'}`}><MousePointerClick size={14} /></button>}
                        <button type="button" onClick={() => { const id = onDuplicateItem(item.id); if (id) setSelectedItemId(id) }} aria-label={`复制${item.name}`} title="复制 SOP" className="sop-center-row-action text-[hsl(var(--ds-color-text-subtle))] hover:text-[hsl(var(--ds-color-primary))]"><Copy size={14} /></button>
                        <button type="button" onClick={() => openConfirmDialog({
                          title: '删除 SOP？',
                          message: `将永久删除「${item.name}」。`,
                          confirmText: '确认删除',
                          tone: 'danger',
                          action: () => onDeleteItem(item.id),
                        })} aria-label={`删除${item.name}`} title="删除 SOP" className="sop-center-row-action text-[hsl(var(--ds-color-text-subtle))] hover:text-[hsl(var(--ds-color-danger))]"><Trash2 size={14} /></button>
                      </div>
                  </article>
                  )
                })}
                {filteredItems.length === 0 && <div className="rounded-xl border border-dashed border-[hsl(var(--ds-color-border))] p-8 text-center text-sm text-[hsl(var(--ds-color-text-muted))]">当前分组暂无 SOP</div>}
              </div>
            </section>

            <section className="sop-center-editor-panel flex min-h-0 flex-col overflow-y-auto p-5">
              {itemDraft ? <div className="sop-center-editor-card flex min-h-0 flex-1 flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-[1_1_18rem]">
                    <h3 className="font-semibold">SOP 参数与正文</h3>
                    <p className="sop-center-quiet-text mt-1 text-xs" aria-live="polite">{itemEditorHint} Ctrl/Cmd+S 可立即保存。</p>
                  </div>
                  <Inline className="max-w-full" justify="flex-end">
                    {onApply && <Button
                      disabled={!persistedItem || itemDirty || itemApplied}
                      onClick={() => persistedItem && applyItem(persistedItem)}
                      variant={itemApplied ? 'secondary' : 'primary'}
                      leadingIcon={<MousePointerClick size={15} />}
                      className={itemApplied ? 'text-[hsl(var(--ds-color-success))]' : undefined}
                    >
                      {itemApplied ? '已使用' : '应用 SOP'}
                    </Button>}
                    <Button
                      disabled={!itemDirty || !itemDraft.name.trim() || !itemDraft.content.trim()}
                      onClick={() => saveItemDraftNow()}
                      variant={itemDirty ? 'primary' : 'secondary'}
                      leadingIcon={<Save size={15} />}
                    >
                      保存修改
                    </Button>
                    <Button
                      disabled={!persistedItem}
                      onClick={() => persistedItem && viewGeneratedPrompts(persistedItem)}
                      variant="secondary"
                      leadingIcon={<ListChecks size={15} />}
                    >
                      生成提示词
                    </Button>
                    {onClear && selectedSopId && <Button onClick={onClear} variant="secondary">取消应用</Button>}
                  </Inline>
                </div>
                <div className="sop-center-editor-fields"><label className="block text-xs font-medium text-[hsl(var(--ds-color-text-muted))]">名称<input value={itemDraft.name} onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })} className={`${inputClassName()} mt-1 h-11`} /></label><label className="block text-xs font-medium text-[hsl(var(--ds-color-text-muted))]">所属分组<select value={itemDraft.groupId ?? ''} onChange={(event) => setItemDraft({ ...itemDraft, groupId: event.target.value || undefined })} className={`${inputClassName()} mt-1 h-11`}><option value="">未分组</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label></div>
                <SopTextEditor
                  documentId={itemDraft.id}
                  value={itemDraft.content}
                  onChange={(content) => setItemDraft({ ...itemDraft, content })}
                />
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
                      <button type="button" onClick={() => openConfirmDialog({
                        title: '删除生成元指令？',
                        message: `将永久删除「${item.name}」。`,
                        confirmText: '确认删除',
                        tone: 'danger',
                        action: () => onDeleteMetaInstruction(item.id),
                      })} aria-label={`删除${item.name}`} className="p-2 text-[hsl(var(--ds-color-text-subtle))] hover:text-[hsl(var(--ds-color-danger))]"><Trash2 size={14} /></button>
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
                      {job.status === 'running' && <p className="sop-center-quiet-text mt-1 text-xs">已运行 {elapsed} 秒，请保持窗口开启</p>}
                    </div>
                  </div>
                  {job.status === 'running' && <div className="sop-center-progress-track mt-4"><div className="sop-center-progress-bar animate-pulse" /></div>}
                  {job.error && <p role="alert" className="mt-3 whitespace-pre-wrap text-xs leading-5 text-[hsl(var(--ds-color-danger))]">{job.error}</p>}
                  {job.status === 'success' && <p className="sop-center-status-copy mt-3 text-xs leading-5">结果已自动保存到 SOP 库，可立即在策略或画廊中使用。</p>}
                </div>
              </div>
            </aside>
          </div>
        )}

        {coverPickerOpen && itemDraft && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-[hsl(var(--ds-color-scrim)/0.62)] p-4"
            onMouseDown={(event) => {
              if (isModalBackdropEvent(event)) setCoverPickerOpen(false)
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="sop-cover-picker-title"
              className="flex max-h-[min(76vh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-[var(--ds-radius-xl)] border border-[hsl(var(--ds-color-border))] bg-[hsl(var(--ds-color-surface-raised))] shadow-[var(--ds-shadow-lg)]"
            >
              <header className="flex items-start justify-between gap-4 border-b border-[hsl(var(--ds-color-border))] px-5 py-4">
                <div className="min-w-0">
                  <h3 id="sop-cover-picker-title" className="truncate text-base font-semibold">选择「{itemDraft.name}」的封面</h3>
                  <p className="sop-center-quiet-text mt-1 text-xs">从该 SOP 已生成的图片中选择，保存修改后生效。</p>
                </div>
                <button type="button" onClick={() => setCoverPickerOpen(false)} aria-label="关闭 SOP 封面选择" className="sop-center-icon-button sop-center-icon-button--secondary shrink-0"><X size={17} /></button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {coverCandidates.length > 0
                  ? (
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                      {coverCandidates.map((candidate) => {
                        const selected = itemDraft.coverImageId === candidate.imageId
                        return (
                          <button
                            key={candidate.imageId}
                            type="button"
                            onClick={() => {
                              setItemDraft({ ...itemDraft, coverImageId: candidate.imageId })
                              setCoverPickerOpen(false)
                            }}
                            aria-label={`选择第 ${candidate.promptIndex} 条提示词的第 ${candidate.imageIndex} 张图片作为封面`}
                            aria-pressed={selected}
                            className="group/cover relative aspect-square overflow-hidden rounded-xl border border-[hsl(var(--ds-color-border))] bg-[hsl(var(--ds-color-surface))] transition hover:border-[hsl(var(--ds-color-border-strong))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ds-color-focus))]"
                          >
                            <SopCoverImage imageId={candidate.imageId} alt="" className="h-full w-full" />
                            <span className="absolute inset-x-1.5 bottom-1.5 rounded-md bg-black/65 px-1 py-0.5 text-[10px] font-medium text-white">提示词 {candidate.promptIndex} · 图 {candidate.imageIndex}</span>
                            {selected && <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--ds-color-primary))] text-[hsl(var(--ds-color-text-inverse))]"><Check size={13} /></span>}
                          </button>
                        )
                      })}
                    </div>
                  )
                  : (
                    <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--ds-color-border))] px-6 text-center">
                      <FileImage size={24} className="text-[hsl(var(--ds-color-text-subtle))]" />
                      <p className="mt-3 text-sm font-medium">暂无可选封面</p>
                      <p className="sop-center-quiet-text mt-1 text-xs">先使用该 SOP 完成一次生图，再双击封面选择生成结果。</p>
                    </div>
                  )}
              </div>
              {itemDraft.coverImageId && (
                <footer className="flex justify-end border-t border-[hsl(var(--ds-color-border))] px-5 py-3">
                  <button type="button" onClick={() => { setItemDraft({ ...itemDraft, coverImageId: undefined }); setCoverPickerOpen(false) }} className="sop-center-button sop-center-button--secondary text-xs">移除当前封面</button>
                </footer>
              )}
            </section>
          </div>
        )}
      </div>

      <Dialog
        open={snapshotDialogOpen}
        onOpenChange={setSnapshotDialogOpen}
        title={`「${persistedItem?.name ?? '当前 SOP'}」生成的提示词`}
        size="lg"
      >
        <div className="flex min-h-[12rem] flex-col">
          {snapshotsLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[hsl(var(--ds-color-text-muted))]">
              <LoaderCircle size={16} className="animate-spin" />
              加载中…
            </div>
          ) : snapshotsForItem.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-[hsl(var(--ds-color-border))] px-6 text-center">
              <ListChecks size={24} className="text-[hsl(var(--ds-color-text-subtle))]" />
              <p className="mt-3 text-sm font-medium">暂无生成记录</p>
              <p className="sop-center-quiet-text mt-1 text-xs">该 SOP 尚未生成过提示词。</p>
            </div>
          ) : (
            <ScrollArea maxHeight="60vh" className="space-y-5 pr-2">
              {snapshotsForItem.map((snapshot) => (
                <div key={snapshot.id} className="space-y-2 border-b border-[hsl(var(--ds-color-border))] pb-4 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">{snapshot.title || '未命名提示词集'}</h4>
                    <span className="shrink-0 text-xs text-[hsl(var(--ds-color-text-muted))]">{new Date(snapshot.createdAt).toLocaleString('zh-CN')}</span>
                  </div>
                  <ul className="space-y-2">
                    {snapshot.prompts.filter((prompt) => !prompt.deleted).map((prompt, index) => (
                      <li key={prompt.id} className="flex items-start gap-2 rounded-lg border border-[hsl(var(--ds-color-border))] p-2.5 text-sm">
                        <span className="shrink-0 pt-0.5 text-xs text-[hsl(var(--ds-color-text-muted))]">{index + 1}.</span>
                        <span className="flex-1 whitespace-pre-wrap leading-relaxed">{prompt.text}</span>
                        <IconButton
                          onClick={() => navigator.clipboard.writeText(prompt.text)}
                          aria-label="复制提示词"
                          icon={<Copy size={14} />}
                          size="sm"
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </ScrollArea>
          )}
        </div>
      </Dialog>
    </div>
  )
}
