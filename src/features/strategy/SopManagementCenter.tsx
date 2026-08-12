import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import './styles.css'
import {
  Badge,
  Button,
  Dialog,
  DialogPane,
  DialogWorkspace,
  EmptyState,
  IconButton,
  Inline,
  ListRow,
  ScrollArea,
  SearchField,
  SelectField,
  Tabs,
  TextArea,
  TextField,
  Tooltip,
} from '../../design-system'
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
import {
  MAX_SOP_REFERENCE_IMAGES,
  type GenerateSop,
  type SopGenerationProgress,
  type SopGenerationProgressStage,
  type SopReferenceImage,
} from './sopGeneration'
import { sopLibraryId } from './sopLibrary'
import { getSopCoverCandidates } from './sopCover'
import { getAllSopBatchSnapshots } from '../../lib/db'
import SopCoverImage from './SopCoverImage'
import SopTextEditor from './SopTextEditor'
import { getSopExecutionMode, type SopGroup, type SopLibraryItem, type SopMetaInstruction } from './types'
import { isModalBackdropEvent } from '../../lib/modalBackdrop'
import { useAppDialog } from '../../hooks/useAppDialog'
import { LARGE_MODAL_SIZE_STYLE, useLargeModalMode } from '../../hooks/useLargeModalMode'
import LargeModalToggle from '../../components/LargeModalToggle'
import { parseVariablePrompt } from '../../lib/variablePrompt'

type CenterTab = 'library' | 'meta' | 'generate'
type GenerationStepId = Exclude<SopGenerationProgressStage, 'repair'> | 'save'
type GenerationJob = {
  status: 'idle' | 'running' | 'success' | 'error'
  message: string
  error?: string
  startedAt?: number
  resultName?: string
  resultId?: string
  currentStep?: GenerationStepId
  completedSteps?: GenerationStepId[]
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const SOP_MANAGEMENT_MODAL_MODE_STORAGE_KEY = 'doupao.sop-management-modal-mode'
const SOP_AUTO_SAVE_DELAY_MS = 800
type AutoSaveState = 'idle' | 'pending' | 'saved' | 'blocked'

const SOP_GENERATION_STEPS: Array<{
  id: GenerationStepId
  label: string
  description: string
}> = [
  { id: 'validate', label: '校验生成条件', description: '检查元指令、说明和参考图片' },
  { id: 'prepare', label: '整理参考输入', description: '按顺序标记并组织全部参考图' },
  { id: 'request', label: '调用 AI 生成资产', description: '按元指令分析并生成目标内容' },
  { id: 'parse', label: '校验生成结构', description: '检查名称、说明和正文格式' },
  { id: 'save', label: '保存到资产库', description: '写入目标分组并准备立即使用' },
]

function readImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片读取失败'))
    reader.onerror = () => reject(new Error(`无法读取图片「${file.name}」`))
    reader.readAsDataURL(file)
  })
}

function generationStepsBefore(step: GenerationStepId) {
  const stepIndex = SOP_GENERATION_STEPS.findIndex((item) => item.id === step)
  return SOP_GENERATION_STEPS.slice(0, Math.max(0, stepIndex)).map((item) => item.id)
}

function getGenerationErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '未知错误，请检查 API 配置后重试'
  if (/缺少名称、说明或 SOP 正文|缺少可用的 SOP 正文|返回不完整内容/.test(message)) {
    return 'AI 返回内容不完整，系统已自动尝试修复。请重新生成；若仍失败，请切换文本模型或简化生成元指令。'
  }
  return message
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
  onTestSopRevision,
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
  onTestSopRevision?: (item: SopLibraryItem) => Promise<void>
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
  const [referenceDragActive, setReferenceDragActive] = useState(false)
  const [job, setJob] = useState<GenerationJob>({ status: 'idle', message: '等待生成' })
  const [elapsed, setElapsed] = useState(0)
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)
  const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false)
  const [snapshotsForItem, setSnapshotsForItem] = useState<SopBatchSnapshot[]>([])
  const [snapshotsLoading, setSnapshotsLoading] = useState(false)
  const [autoSaveState, setAutoSaveState] = useState<AutoSaveState>('idle')
  const autoSaveTimerRef = useRef<number | null>(null)
  const referenceDragDepthRef = useRef(0)

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
    itemDraft.executionMode !== persistedItem.executionMode ||
    itemDraft.groupId !== persistedItem.groupId ||
    itemDraft.coverImageId !== persistedItem.coverImageId
  ))
  const itemDraftContentValid = Boolean(
    itemDraft?.content.trim()
    && (getSopExecutionMode(itemDraft) !== 'variable-prompt' || parseVariablePrompt(itemDraft.content).enabled),
  )
  const itemDraftValid = Boolean(itemDraft?.name.trim() && itemDraftContentValid)
  const coverCandidates = useMemo(
    () => getSopCoverCandidates(itemDraft?.id ?? '', tasks),
    [itemDraft?.id, tasks],
  )
  const itemApplied = Boolean(itemDraft && selectedSopId === itemDraft.id)
  const itemVariablePromptMode = Boolean(itemDraft && getSopExecutionMode(itemDraft) === 'variable-prompt')
  const itemVariablePromptValidation = itemVariablePromptMode && itemDraft ? parseVariablePrompt(itemDraft.content) : null
  const generatorMeta = metaInstructions.find((item) => item.id === generatorMetaId)
  const generatingVariablePrompt = generatorMeta?.kind === 'variable-prompt-skill'
  const itemEditorHint = autoSaveState === 'saved'
    ? '修改已自动保存。'
    : itemDirty
      ? itemDraftValid
        ? itemApplied
          ? `修改将在 1 秒内自动保存，并更新当前使用的${itemVariablePromptMode ? '变量提示词' : ' SOP'}。`
          : '修改将在 1 秒内自动保存。'
        : itemVariablePromptMode
          ? '名称不能为空，且变量提示词必须通过格式校验。'
          : '名称和正文不能为空，当前修改尚未保存。'
      : itemApplied
        ? `当前${itemVariablePromptMode ? '变量提示词' : ' SOP'}已使用。`
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
    if (!itemDraft.name.trim() || !itemDraftContentValid) {
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
  }, [itemDirty, itemDraft, itemDraftContentValid, onSaveItem])

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
    if (getSopExecutionMode(draft) === 'variable-prompt' && !parseVariablePrompt(draft.content).enabled) return false
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
      executionMode: 'prompt-generator',
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
    if (job.status === 'running') return
    const available = MAX_SOP_REFERENCE_IMAGES - referenceImages.length
    if (available <= 0) {
      setJob({ status: 'error', message: '参考图片已达上限', error: `最多添加 ${MAX_SOP_REFERENCE_IMAGES} 张图片，请先移除一张再继续。` })
      return
    }
    const validFiles = files.filter((file) => file.type.startsWith('image/') && file.size <= MAX_IMAGE_BYTES)
    const selected = validFiles.slice(0, available)
    const skipped = files.length - selected.length
    if (selected.length === 0) {
      setJob({
        status: 'error',
        message: '没有可添加的图片',
        error: '请拖入 PNG、JPG、WEBP 等图片文件，单张大小不超过 10 MiB。',
      })
      return
    }
    try {
      const settled = await Promise.allSettled(selected.map(async (file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
        dataUrl: await readImage(file),
      })))
      const loaded = settled
        .filter((result): result is PromiseFulfilledResult<SopReferenceImage & { id: string }> => result.status === 'fulfilled')
        .map((result) => result.value)
      const failed = settled.length - loaded.length
      if (loaded.length === 0) throw new Error('图片读取失败，请重新选择文件')
      setReferenceImages((current) => [...current, ...loaded])
      const omitted = skipped + failed
      setJob({
        status: 'idle',
        message: omitted > 0
          ? `已添加 ${loaded.length} 张参考图片，另有 ${omitted} 张因格式、大小或数量限制被跳过`
          : `已添加 ${loaded.length} 张参考图片`,
      })
    } catch (error) {
      setJob({ status: 'error', message: '图片读取失败', error: error instanceof Error ? error.message : String(error) })
    }
  }

  const hasDraggedFiles = (event: ReactDragEvent<HTMLElement>) => event.dataTransfer.types.includes('Files')

  const handleReferenceDragEnter = (event: ReactDragEvent<HTMLLabelElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    referenceDragDepthRef.current += 1
    if (job.status !== 'running' && referenceImages.length < MAX_SOP_REFERENCE_IMAGES) setReferenceDragActive(true)
  }

  const handleReferenceDragOver = (event: ReactDragEvent<HTMLLabelElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = job.status === 'running' ? 'none' : 'copy'
  }

  const handleReferenceDragLeave = (event: ReactDragEvent<HTMLLabelElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    referenceDragDepthRef.current = Math.max(0, referenceDragDepthRef.current - 1)
    if (referenceDragDepthRef.current === 0) setReferenceDragActive(false)
  }

  const handleReferenceDrop = async (event: ReactDragEvent<HTMLLabelElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    referenceDragDepthRef.current = 0
    setReferenceDragActive(false)
    await addReferenceImages(Array.from(event.dataTransfer.files ?? []))
  }

  const blockUnscopedImageDrop = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
  }

  const updateGenerationProgress = (progress: SopGenerationProgress) => {
    const step: GenerationStepId = progress.stage === 'repair' ? 'parse' : progress.stage
    setJob((current) => ({
      ...current,
      status: 'running',
      message: progress.message,
      error: undefined,
      currentStep: step,
      completedSteps: generationStepsBefore(step),
    }))
  }

  const runGeneration = async () => {
    const meta = metaInstructions.find((item) => item.id === generatorMetaId)
    if (!meta) {
      setJob({ status: 'error', message: '无法开始生成', error: '请选择一个 SOP 生成元指令' })
      return
    }
    if ((meta.kind === 'image-prompt' || meta.kind === 'variable-prompt-skill') && referenceImages.length === 0) {
      setJob({ status: 'error', message: '无法开始生成', error: meta.kind === 'variable-prompt-skill' ? '变量提示词技能至少需要一张参考图片' : '图片生成 SOP 至少需要一张画风参考图片' })
      return
    }
    if (!generatorBrief.trim() && referenceImages.length === 0) {
      setJob({ status: 'error', message: '无法开始生成', error: '请填写生成说明或添加参考图片' })
      return
    }
    const startedAt = Date.now()
    setElapsed(0)
    setJob({
      status: 'running',
      message: '正在校验生成条件',
      startedAt,
      currentStep: 'validate',
      completedSteps: [],
    })
    try {
      const generated = await onGenerateSop(
        generatorBrief,
        {},
        referenceImages,
        meta.kind === 'variable-prompt-skill' ? 'variable-prompt-skill' : meta.kind === 'image-prompt' ? 'image-prompt' : 'general',
        meta.instruction,
        { onProgress: updateGenerationProgress },
      )
      setJob((current) => ({
        ...current,
        status: 'running',
        message: generated.executionMode === 'variable-prompt' ? '正在保存变量提示词资产' : '正在保存到 SOP 库',
        currentStep: 'save',
        completedSteps: generationStepsBefore('save'),
      }))
      const now = Date.now()
      const item: SopLibraryItem = {
        id: sopLibraryId('sop'),
        groupId: generatorGroupId || undefined,
        name: generated.name,
        description: generated.description,
        content: generated.content,
        executionMode: generated.executionMode,
        source: 'generated',
        metaInstructionId: meta.id,
        createdBy: currentUserId,
        createdAt: now,
        updatedAt: now,
      }
      onSaveItem(item)
      setSelectedGroupId(item.groupId ?? 'ungrouped')
      selectItem(item)
      setJob({
        status: 'success',
        message: `${generated.executionMode === 'variable-prompt' ? '变量提示词' : 'SOP'}「${item.name}」生成并保存成功`,
        resultName: item.name,
        resultId: item.id,
        startedAt,
        currentStep: 'save',
        completedSteps: SOP_GENERATION_STEPS.map((step) => step.id),
      })
    } catch (error) {
      setJob((current) => ({
        ...current,
        status: 'error',
        message: `${meta.kind === 'variable-prompt-skill' ? '变量提示词' : 'SOP'}生成失败`,
        error: getGenerationErrorMessage(error),
        startedAt,
      }))
    }
  }

  const completedGenerationSteps = new Set(job.completedSteps ?? [])
  const activeGenerationStepIndex = job.currentStep
    ? SOP_GENERATION_STEPS.findIndex((step) => step.id === job.currentStep)
    : -1
  const generationProgress = job.status === 'success'
    ? 100
    : job.status === 'idle'
      ? 0
      : Math.round(((Math.max(0, activeGenerationStepIndex) + 0.5) / SOP_GENERATION_STEPS.length) * 100)

  return (
    <div
      className="sop-center-overlay fixed inset-0 z-[var(--ds-z-overlay)] flex items-center justify-center p-4 animate-overlay-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sop-center-title"
      data-block-global-image-input="true"
      onDragOver={blockUnscopedImageDrop}
      onDrop={blockUnscopedImageDrop}
      onMouseDown={(event) => {
        if (isModalBackdropEvent(event)) closeSafely()
      }}
    >
      <div
        style={largeView ? LARGE_MODAL_SIZE_STYLE : undefined}
        className="sop-center-dialog relative animate-modal-in flex w-full flex-col overflow-hidden transition-[width,height,max-width] duration-200 ease-out"
      >
        <header className="sop-center-header">
          <div>
            <h2 id="sop-center-title" className="text-lg font-semibold tracking-tight">提示词与 SOP 管理</h2>
            <p className="sop-center-quiet-text mt-1 text-xs">分别管理可直接生图的变量提示词与生成型 SOP。</p>
          </div>
          <div className="flex items-center gap-2">
            <LargeModalToggle largeView={largeView} dialogName="提示词与 SOP 管理" onToggle={toggleLargeView} />
            <IconButton onClick={closeSafely} disabled={job.status === 'running'} aria-label="关闭提示词与 SOP 管理" icon={<X size={18} />} />
          </div>
        </header>

        <Tabs
          aria-label="提示词与 SOP 管理功能"
          value={tab}
          onValueChange={(value) => value === 'library' ? setTab(value) : runAfterDraftConfirmation(() => setTab(value))}
          className="sop-center-tabs"
          items={[
            { value: 'library', label: '提示词与 SOP 库', icon: <Library size={16} /> },
            { value: 'meta', label: '生成元指令', icon: <Settings2 size={16} /> },
            { value: 'generate', label: '智能生成', icon: <Sparkles size={16} /> },
          ]}
        />

        {tab === 'library' && (
          <DialogWorkspace layout="triple" className="sop-center-library-grid min-h-0 flex-1">
            <DialogPane as="aside" tone="sidebar" className="sop-center-sidebar">
              <div className="flex items-end gap-2">
                <TextField
                  label="创建分组"
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && addGroup()}
                  placeholder="输入分组名称"
                  containerClassName="sop-center-new-group-field min-w-0 flex-1"
                />
                <Tooltip content="新增分组" side="bottom">
                  <IconButton onClick={addGroup} aria-label="新增 SOP 分组" icon={<FolderPlus size={16} />} />
                </Tooltip>
              </div>
              <div className="mt-4 space-y-1">
                {[{ id: 'all', name: '全部资产', count: items.length }, { id: 'favorites', name: '收藏', count: items.filter((item) => item.favorite).length }, { id: 'recent', name: '最近使用', count: items.filter((item) => item.lastUsedAt).length }, { id: 'ungrouped', name: '未分组', count: items.filter((item) => !item.groupId).length }].map((group) => <button key={group.id} type="button" onClick={() => runAfterDraftConfirmation(() => setSelectedGroupId(group.id))} className="sop-center-nav-item" data-selected={selectedGroupId === group.id || undefined}><span>{group.name}</span><span className="text-xs opacity-70">{group.count}</span></button>)}
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
                          className="ds-input h-10 min-w-0 flex-1 px-3 text-sm"
                          aria-label="重命名分组"
                        />
                        <IconButton size="sm" onClick={commitRenameGroup} aria-label="保存分组名称" icon={<Check size={14} />} />
                        <IconButton size="sm" onMouseDown={(event) => event.preventDefault()} onClick={cancelRenameGroup} aria-label="取消重命名" icon={<X size={14} />} />
                      </div>
                    )
                  }
                  return (
                    <div key={group.id} className="sop-center-group-row group flex items-center" data-selected={selectedGroupId === group.id || undefined}>
                      <button type="button" onClick={() => runAfterDraftConfirmation(() => setSelectedGroupId(group.id))} className="min-h-10 min-w-0 flex-1 truncate px-3 text-left text-sm">{group.name}</button>
                      <IconButton size="sm" onClick={() => startRenameGroup(group)} aria-label={`重命名${group.name}`} title="重命名分组" icon={<Pencil size={13} />} className="sop-center-group-action" />
                      <IconButton size="sm" onClick={() => onDuplicateGroup(group.id)} aria-label={`复制${group.name}`} title="复制分组" icon={<Copy size={13} />} className="sop-center-group-action" />
                      <IconButton size="sm" onClick={() => openConfirmDialog({
                        title: '删除 SOP 分组？',
                        message: `将删除分组「${group.name}」，组内 SOP 会转为未分组。`,
                        confirmText: '确认删除',
                        tone: 'danger',
                        action: () => onDeleteGroup(group.id),
                      })} aria-label={`删除${group.name}`} title="删除分组" icon={<Trash2 size={13} />} className="sop-center-group-action sop-center-action--danger" />
                    </div>
                  )
                })}
              </div>
            </DialogPane>

            <DialogPane className="sop-center-list-panel">
              <div className="flex items-center justify-between"><div><h3 className="font-semibold">资产列表</h3><p className="sop-center-quiet-text mt-1 text-xs">{filteredItems.length} 个资产</p></div><Button size="sm" variant="secondary" onClick={addItem} leadingIcon={<Plus size={15} />}>新建</Button></div>
              <SearchField className="mt-3" label="搜索提示词或 SOP" value={search} onChange={setSearch} onClear={() => setSearch('')} placeholder="搜索名称或正文" />
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
                          <Badge tone={getSopExecutionMode(item) === 'variable-prompt' ? 'success' : 'neutral'}>{getSopExecutionMode(item) === 'variable-prompt' ? '变量提示词' : '生成型 SOP'}</Badge>
                          {selectedSopId === item.id && <Badge tone="success">使用中</Badge>}
                        </span>
                      </button>
                      <div className="sop-center-sop-actions" aria-label={`${item.name} 操作`}>
                        <IconButton size="sm" onClick={() => onSaveItem({ ...item, favorite: !item.favorite, updatedAt: Date.now() })} aria-label={`${item.favorite ? '取消收藏' : '收藏'} ${item.name}`} title={item.favorite ? '取消收藏' : '收藏'} icon={<Star size={14} fill={item.favorite ? 'currentColor' : 'none'} />} className={`sop-center-row-action ${item.favorite ? 'sop-center-action--favorite' : ''}`} />
                        {onApply && <IconButton size="sm" onClick={() => applyItem(item)} aria-label={`应用 ${item.name}`} title={getSopExecutionMode(item) === 'variable-prompt' ? '填入生图输入框' : '使用 SOP'} icon={<MousePointerClick size={14} />} className={`sop-center-row-action ${selectedSopId === item.id ? 'sop-center-action--applied' : ''}`} />}
                        <IconButton size="sm" onClick={() => { const id = onDuplicateItem(item.id); if (id) setSelectedItemId(id) }} aria-label={`复制${item.name}`} title="复制 SOP" icon={<Copy size={14} />} className="sop-center-row-action" />
                        <IconButton size="sm" onClick={() => openConfirmDialog({
                          title: '删除 SOP？',
                          message: `将永久删除「${item.name}」。`,
                          confirmText: '确认删除',
                          tone: 'danger',
                          action: () => onDeleteItem(item.id),
                        })} aria-label={`删除${item.name}`} title="删除 SOP" icon={<Trash2 size={14} />} className="sop-center-row-action sop-center-action--danger" />
                      </div>
                  </article>
                  )
                })}
                {filteredItems.length === 0 && <EmptyState title="当前分组暂无资产" description="新建变量提示词或 SOP，或切换到其他分组查看。" />}
              </div>
            </DialogPane>

            <DialogPane tone="canvas" className="sop-center-editor-panel flex min-h-0 flex-col">
              {itemDraft ? <div className="sop-center-editor-card flex min-h-0 flex-1 flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-[1_1_18rem]">
                    <h3 className="font-semibold">资产参数与正文</h3>
                    <p className="sop-center-quiet-text mt-1 text-xs" aria-live="polite">{itemEditorHint} Ctrl/Cmd+S 可立即保存。</p>
                  </div>
                  <Inline className="max-w-full" justify="flex-end">
                    {onApply && <Button
                      disabled={!persistedItem || itemDirty || itemApplied}
                      onClick={() => persistedItem && applyItem(persistedItem)}
                      variant={itemApplied || itemDirty ? 'secondary' : 'primary'}
                      leadingIcon={<MousePointerClick size={15} />}
                      className={itemApplied ? 'text-[hsl(var(--ds-color-success))]' : undefined}
                    >
                      {itemApplied ? '已使用' : itemVariablePromptMode ? '填入生图输入框' : '使用 SOP'}
                    </Button>}
                    <Button
                      disabled={!itemDirty || !itemDraftValid}
                      onClick={() => saveItemDraftNow()}
                      variant={itemDirty ? 'primary' : 'secondary'}
                      leadingIcon={<Save size={15} />}
                    >
                      保存修改
                    </Button>
                    {!itemVariablePromptMode && <Button
                      disabled={!persistedItem}
                      onClick={() => persistedItem && viewGeneratedPrompts(persistedItem)}
                      variant="secondary"
                      leadingIcon={<ListChecks size={15} />}
                    >
                      生成提示词
                    </Button>}
                    {onClear && selectedSopId && <Button onClick={onClear} variant="secondary">取消应用</Button>}
                  </Inline>
                </div>
                <div className="sop-center-editor-fields">
                  <TextField label="名称" value={itemDraft.name} onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })} />
                  <SelectField label="所属分组" value={itemDraft.groupId ?? ''} onChange={(event) => setItemDraft({ ...itemDraft, groupId: event.target.value || undefined })} options={[{ value: '', label: '未分组' }, ...groups.map((group) => ({ value: group.id, label: group.name }))]} />
                  <SelectField label="资产类型" value={getSopExecutionMode(itemDraft)} onChange={(event) => setItemDraft({ ...itemDraft, executionMode: event.target.value as SopLibraryItem['executionMode'] })} options={[{ value: 'prompt-generator', label: '生成型 SOP' }, { value: 'variable-prompt', label: '变量提示词' }]} />
                </div>
                {itemVariablePromptMode ? (
                  <div className="flex min-h-0 flex-1 flex-col gap-2">
                    <TextArea
                      label="变量提示词正文"
                      aria-label="变量提示词正文"
                      value={itemDraft.content}
                      onChange={(event) => setItemDraft({ ...itemDraft, content: event.target.value })}
                      className="min-h-[420px] flex-1 font-mono text-xs leading-6"
                    />
                    <p className={`text-xs ${itemVariablePromptValidation?.enabled ? 'text-[hsl(var(--ds-color-success))]' : 'text-[hsl(var(--ds-color-danger))]'}`}>
                      {itemVariablePromptValidation?.enabled
                        ? `已识别 ${itemVariablePromptValidation.variables.length} 个变量，共 ${itemVariablePromptValidation.combinationCount.toLocaleString()} 种组合。应用后将直接填入生图输入框。`
                        : `格式尚未启用：${itemVariablePromptValidation?.errors[0] ?? '请填写正文、单独一行的“可变项：”及逐行变量定义。'}`}
                    </p>
                  </div>
                ) : (
                  <SopTextEditor
                    documentId={itemDraft.id}
                    value={itemDraft.content}
                    onChange={(content) => setItemDraft({ ...itemDraft, content })}
                    onTestRevision={onTestSopRevision
                      ? (content) => onTestSopRevision({ ...itemDraft, content })
                      : undefined}
                  />
                )}
              </div> : <EmptyState className="h-full" title="选择或新建一个资产" description="从左侧列表选择内容后即可编辑。" />}
            </DialogPane>
          </DialogWorkspace>
        )}

        {tab === 'meta' && (
          <DialogWorkspace layout="split" className="sop-center-meta-grid min-h-0 flex-1">
            <DialogPane as="aside" className="sop-center-list-panel">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">生成元指令</h3>
                  <p className="sop-center-quiet-text mt-1 text-xs">SOP 元指令生成 SOP；变量提示词技能直接反推可执行模板。</p>
                </div>
                <Button size="sm" variant="secondary" onClick={addMeta} leadingIcon={<Plus size={15} />}>新建</Button>
              </div>
              <div className="mt-4 space-y-2">
                {metaInstructions.map((item) => (
                  <ListRow
                    key={item.id}
                    className="sop-center-meta-row"
                    selected={selectedMetaId === item.id}
                    title={item.name}
                    description={item.description || '暂无说明'}
                    interactive={{ onClick: () => selectMeta(item), 'aria-label': `编辑${item.name}` }}
                    actions={(
                      <div className="flex gap-1">
                      <IconButton size="sm" onClick={() => { const id = onDuplicateMetaInstruction(item.id); if (id) setSelectedMetaId(id) }} aria-label={`复制${item.name}`} title="复制元指令" icon={<Copy size={14} />} />
                      <IconButton size="sm" onClick={() => openConfirmDialog({
                        title: '删除生成元指令？',
                        message: `将永久删除「${item.name}」。`,
                        confirmText: '确认删除',
                        tone: 'danger',
                        action: () => onDeleteMetaInstruction(item.id),
                      })} aria-label={`删除${item.name}`} title="删除元指令" icon={<Trash2 size={14} />} className="sop-center-action--danger" />
                      </div>
                    )}
                  />
                ))}
              </div>
            </DialogPane>
            <DialogPane tone="canvas" className="sop-center-editor-panel">
              {metaDraft ? (
                <div className="sop-center-editor-card space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">编辑生成元指令</h3>
                      <p className="sop-center-quiet-text mt-1 text-xs">重命名或修改后，新生成任务立即使用最新内容。</p>
                    </div>
                    <Button disabled={!metaDraft.name.trim() || !metaDraft.instruction.trim()} onClick={() => onSaveMetaInstruction({ ...metaDraft, updatedAt: Date.now() })} leadingIcon={<Save size={15} />}>保存</Button>
                  </div>
                  <TextField label="名称" value={metaDraft.name} onChange={(event) => setMetaDraft({ ...metaDraft, name: event.target.value })} />
                  <SelectField label="类型" value={metaDraft.kind} onChange={(event) => setMetaDraft({ ...metaDraft, kind: event.target.value as SopMetaInstruction['kind'] })} options={[{ value: 'general', label: '通用 SOP' }, { value: 'image-prompt', label: '图片提示词 SOP' }, { value: 'variable-prompt-skill', label: '变量提示词技能' }, { value: 'custom', label: '自定义' }]} />
                  <TextArea label="说明" value={metaDraft.description} onChange={(event) => setMetaDraft({ ...metaDraft, description: event.target.value })} className="min-h-24 leading-6" />
                  <TextArea label="元指令正文" value={metaDraft.instruction} onChange={(event) => setMetaDraft({ ...metaDraft, instruction: event.target.value })} className="min-h-[420px] font-mono text-xs leading-6" />
                </div>
              ) : (
                <EmptyState className="h-full" title="选择或新建一个生成元指令" description="从左侧列表选择内容后即可编辑。" />
              )}
            </DialogPane>
          </DialogWorkspace>
        )}

        {tab === 'generate' && (
          <DialogWorkspace layout="split" className="sop-center-generate-grid min-h-0 flex-1">
            <DialogPane tone="canvas" className="sop-center-editor-panel">
              <div className="sop-center-editor-card space-y-4">
                <div>
                  <h3 className="font-semibold">{generatingVariablePrompt ? '反推变量提示词' : '生成新 SOP'}</h3>
                  <p className="sop-center-quiet-text mt-1 text-xs">{generatingVariablePrompt ? '技能分析参考图片后，直接保存可填入生图输入框的变量提示词。' : '选择 SOP 元指令、目标分组并提供文字或图片输入。'}</p>
                </div>
                <SelectField label="生成元指令" value={generatorMetaId} onChange={(event) => setGeneratorMetaId(event.target.value)} options={[{ value: '', label: '请选择' }, ...metaInstructions.map((item) => ({ value: item.id, label: item.name }))]} />
                <SelectField label="保存到分组" value={generatorGroupId} onChange={(event) => setGeneratorGroupId(event.target.value)} options={[{ value: '', label: '未分组' }, ...groups.map((group) => ({ value: group.id, label: group.name }))]} />
                <TextArea label="生成说明" aria-label="SOP 生成说明" value={generatorBrief} onChange={(event) => setGeneratorBrief(event.target.value)} placeholder={generatingVariablePrompt ? '补充目标、复刻或探索方向、受众与文案要求' : '说明 SOP 的目标、输入、输出格式和禁止项'} className="min-h-32 leading-6" />
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-medium text-[hsl(var(--ds-color-text-muted))]">参考图片</span>
                      <span className="ml-2 text-xs text-[hsl(var(--ds-color-text-subtle))]">支持多选与拖拽</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[hsl(var(--ds-color-text-subtle))]">{referenceImages.length}/{MAX_SOP_REFERENCE_IMAGES}</span>
                      {referenceImages.length > 0 && (
                        <button
                          type="button"
                          disabled={job.status === 'running'}
                          onClick={() => setReferenceImages([])}
                          className="text-xs font-medium text-[hsl(var(--ds-color-text-muted))] hover:text-[hsl(var(--ds-color-danger))] disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          清空
                        </button>
                      )}
                    </div>
                  </div>
                  <label
                    className="sop-center-upload"
                    data-sop-reference-dropzone={true}
                    data-drag-active={referenceDragActive || undefined}
                    data-disabled={job.status === 'running' || referenceImages.length >= MAX_SOP_REFERENCE_IMAGES || undefined}
                    onDragEnter={handleReferenceDragEnter}
                    onDragOver={handleReferenceDragOver}
                    onDragLeave={handleReferenceDragLeave}
                    onDrop={handleReferenceDrop}
                  >
                    <input type="file" accept="image/*" multiple className="sr-only" disabled={job.status === 'running' || referenceImages.length >= MAX_SOP_REFERENCE_IMAGES} onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void addReferenceImages(files) }} />
                    <span>
                      <FileImage size={22} className="mx-auto" />
                      <span className="mt-2 block text-sm font-semibold">{referenceDragActive ? '松开即可添加图片' : '拖拽多张图片到这里，或点击选择'}</span>
                      <span className="sop-center-quiet-text mt-1 block text-xs">单张不超过 10 MiB，最多 {MAX_SOP_REFERENCE_IMAGES} 张；AI 将按当前顺序综合分析</span>
                    </span>
                  </label>
                  {referenceImages.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {referenceImages.map((image, index) => (
                        <div key={image.id} className="sop-center-thumb group relative min-w-0">
                          <div className="relative aspect-[4/3] overflow-hidden">
                            <img src={image.dataUrl} alt={`参考图 ${index + 1}：${image.name}`} className="h-full w-full object-cover" />
                            <span className="absolute bottom-1.5 left-1.5 rounded-md bg-[hsl(var(--ds-color-scrim)/0.72)] px-1.5 py-0.5 text-[10px] font-semibold text-[hsl(var(--ds-color-text-inverse))]">图 {index + 1}</span>
                            <button type="button" disabled={job.status === 'running'} onClick={() => setReferenceImages((current) => current.filter((item) => item.id !== image.id))} aria-label={`移除${image.name}`} className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-[hsl(var(--ds-color-scrim)/0.72)] text-[hsl(var(--ds-color-text-inverse))] opacity-80 transition-opacity hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"><X size={13} /></button>
                          </div>
                          <p className="truncate px-2 py-1.5 text-[11px] text-[hsl(var(--ds-color-text-muted))]" title={image.name}>{image.name}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <Button onClick={() => void runGeneration()} loading={job.status === 'running'} className="w-full" size="lg" leadingIcon={<Sparkles size={17} />}>{job.status === 'running' ? (generatingVariablePrompt ? '正在反推变量提示词' : '正在生成 SOP') : (generatingVariablePrompt ? '反推并保存变量提示词' : '开始生成并保存 SOP')}</Button>
              </div>
            </DialogPane>
            <DialogPane as="aside" className="sop-center-editor-panel">
              <div className="sop-center-editor-card space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">生成状态</h3>
                    <p className="sop-center-quiet-text mt-1 text-xs">每一步都会随实际请求状态更新。</p>
                  </div>
                  {job.status !== 'idle' && <span className="text-xs tabular-nums text-[hsl(var(--ds-color-text-subtle))]">{generationProgress}%</span>}
                </div>
                <div aria-live="polite" className="sop-center-status" data-status={job.status}>
                  <div className="flex items-center gap-3">
                    {job.status === 'running' ? <LoaderCircle className="sop-center-status-icon animate-spin" size={22} /> : job.status === 'success' ? <CheckCircle2 className="sop-center-status-icon" size={22} /> : job.status === 'error' ? <XCircle className="sop-center-status-icon" size={22} /> : <Sparkles className="sop-center-status-icon" size={22} />}
                    <div>
                      <p className="text-sm font-semibold">{job.message}</p>
                      {job.status === 'running' && <p className="sop-center-quiet-text mt-1 text-xs">已运行 {elapsed} 秒，请保持窗口开启</p>}
                      {job.status === 'success' && <p className="sop-center-quiet-text mt-1 text-xs">用时 {elapsed} 秒，结果已安全保存</p>}
                    </div>
                  </div>
                  {job.status !== 'idle' && (
                    <div className="sop-center-progress-track mt-4" role="progressbar" aria-label="SOP 生成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={generationProgress}>
                      <div className="sop-center-progress-bar" style={{ transform: `scaleX(${generationProgress / 100})` }} />
                    </div>
                  )}
                  {job.error && <p role="alert" className="mt-3 whitespace-pre-wrap text-xs leading-5 text-[hsl(var(--ds-color-danger))]">{job.error}</p>}
                  {job.status === 'success' && <p className="sop-center-status-copy mt-3 text-xs leading-5">结果已自动保存到资产库；变量提示词可直接填入生图输入框，SOP 可继续生成具体提示词。</p>}
                  {job.status === 'error' && <Button onClick={() => void runGeneration()} variant="secondary" size="sm" className="mt-4">重新生成</Button>}
                  {job.status === 'success' && <Button onClick={() => setTab('library')} variant="secondary" size="sm" className="mt-4">查看生成结果</Button>}
                </div>
                <ol className="sop-center-step-list" aria-label="SOP 生成详细步骤">
                  {SOP_GENERATION_STEPS.map((step, index) => {
                    const completed = completedGenerationSteps.has(step.id)
                    const active = job.status === 'running' && job.currentStep === step.id
                    const failed = job.status === 'error' && job.currentStep === step.id
                    const state = completed ? 'completed' : active ? 'active' : failed ? 'error' : 'pending'
                    return (
                      <li key={step.id} className="sop-center-step" data-state={state}>
                        <span className="sop-center-step-marker" aria-hidden="true">
                          {completed ? <Check size={13} /> : active ? <LoaderCircle size={13} className="animate-spin" /> : index + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{step.label}</span>
                          <span className="sop-center-quiet-text mt-0.5 block text-xs leading-5">{step.description}</span>
                        </span>
                      </li>
                    )
                  })}
                </ol>
              </div>
            </DialogPane>
          </DialogWorkspace>
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
                <IconButton onClick={() => setCoverPickerOpen(false)} aria-label="关闭 SOP 封面选择" icon={<X size={17} />} className="shrink-0" />
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
                  <Button onClick={() => { setItemDraft({ ...itemDraft, coverImageId: undefined }); setCoverPickerOpen(false) }} variant="secondary" size="sm">移除当前封面</Button>
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
