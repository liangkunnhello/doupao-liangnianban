import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookmarkIcon as Bookmark,
  BookOpenCheckIcon as BookOpenCheck,
  CheckCircleIcon as CheckCircle2,
  CloseIcon as X,
  CopyIcon as Copy,
  ImageIcon,
  LoaderCircleIcon as LoaderCircle,
  PauseIcon as Pause,
  PlayIcon as Play,
  PlusIcon as Plus,
  RefreshIcon as RefreshCw,
  SearchIcon as Search,
  SendIcon as Send,
  SparklesIcon as Sparkles,
  TrashIcon as Trash2,
  XCircleIcon as XCircle,
} from '../../../design-system/icons'
import { ensureImageCached, submitTaskWithData, useStore } from '../../../store'
import type { InputImage, SopBatchSnapshot } from '../../../types'
import { deleteSopBatchSnapshot, getAllSopBatchSnapshots, getSopBatchSnapshot, putSopBatchSnapshot } from '../../../lib/db'
import { useRequirementPrototype } from '../../requirementPrototype/store'
import {
  allocateSopPromptCounts,
  getSopRunCounts,
  getSopTotalImageCount,
  normalizeSopPromptCandidates,
  selectSopPromptSources,
  SOP_HIGH_VOLUME_WARNING_THRESHOLD,
} from '../sopPromptBatch'
import { generatePromptsFromSopStore } from './storeSopGeneration'
import { useCloseOnEscape } from '../../../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../../../hooks/usePreventBackgroundScroll'
import { Switch, useDialogFocusTrap } from '../../../design-system'
import { isModalBackdropEvent } from '../../../lib/modalBackdrop'
import { LARGE_MODAL_SIZE_STYLE, useLargeModalMode } from '../../../hooks/useLargeModalMode'
import LargeModalToggle from '../../../components/LargeModalToggle'

type BatchStatus = 'idle' | 'generating' | 'paused' | 'ready' | 'submitting' | 'success' | 'error'
type SourceStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed'
const PROMPT_MANAGEMENT_MODAL_MODE_STORAGE_KEY = 'doupao.prompt-management-modal-mode'

type SopPromptSource = {
  id: string
  label: string
  kind: 'image' | 'text'
  imageId?: string
  dataUrl?: string
}

type SourceRun = {
  source: SopPromptSource
  requestedCount: number
  status: SourceStatus
  attempts: number
  error?: string
}

type PromptDraft = {
  id: string
  sourceId: string
  referenceImageIds?: string[]
  promptText: string
  origin: 'ai' | 'manual'
  edited?: boolean
  deleted?: boolean
}

type PersistedSopPromptRun = {
  version?: 2 | 3 | 4
  activeRunId?: string
  selectedSopId: string
  promptCount: number
  imagesPerPrompt: number
  availablePrompts?: number
  quantity?: number
  brief: string
  autoGenerate?: boolean
  secondReference?: boolean
  sources?: SourceRun[]
  prompts?: PromptDraft[]
}

function sourceKey(index: number, imageId: string) {
  return `source-${index + 1}-${imageId}`
}

function promptItemId(sourceId: string) {
  return `sop-prompt-${sourceId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function promptRunId() {
  return `sop-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function getRunUpdatedAt(run: SopBatchSnapshot) {
  return run.updatedAt ?? run.createdAt
}

function getRunStatusLabel(run: SopBatchSnapshot) {
  const status = run.status ?? (run.batchId ? 'submitted' : 'ready')
  if (status === 'generating') return '生成中'
  if (status === 'submitted') return '已生图'
  if (status === 'failed') return '有失败'
  return '可复用'
}

function getPromptRunTitle(run: SopBatchSnapshot) {
  return run.title?.trim()
    || run.brief.trim()
    || `${run.sop.name || '独立'}提示词`
}

export function getGallerySopPromptRunStorageKey(tabId: string | null) {
  return `doupao.gallery-sop-prompt-run.${tabId ?? 'default'}`
}

export type GallerySopRunStatus = {
  workspaceTabId: string | null
  phase: BatchStatus
  message: string
  promptCount: number
  availablePrompts: number
  totalImages: number
  failed: number
}

function SourceThumb({ source, fit = 'cover' }: { source: SopPromptSource; fit?: 'cover' | 'contain' }) {
  const [dataUrl, setDataUrl] = useState(source.dataUrl ?? '')

  useEffect(() => {
    let active = true
    if (source.kind === 'text' || !source.imageId) {
      setDataUrl('')
      return
    }
    if (source.dataUrl) {
      setDataUrl(source.dataUrl)
      return
    }
    void ensureImageCached(source.imageId).then((value) => {
      if (active) setDataUrl(value ?? '')
    })
    return () => {
      active = false
    }
  }, [source.dataUrl, source.imageId])

  if (source.kind === 'text') {
    return <div className="flex h-full w-full items-center justify-center bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-300"><BookOpenCheck size={18} /></div>
  }

  return dataUrl
    ? <img src={dataUrl} alt={source.label} className={`h-full w-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`} />
    : <div className="flex h-full w-full items-center justify-center bg-gray-100 text-gray-400 dark:bg-gray-800"><ImageIcon size={18} /></div>
}

export default function GallerySopBatchModal({
  onClose,
  initialSopId = '',
  initialQuantity,
  initialPromptCount = initialQuantity ?? 5,
  initialImagesPerPrompt = 1,
  initialBrief = '',
  initialAutoGenerate = false,
  initialSecondReference = false,
  autoStart = false,
  workspaceTabId,
  visible = true,
  onBackground,
  onAutoStartConsumed,
  onStatusChange,
}: {
  onClose: () => void
  initialSopId?: string
  initialQuantity?: number
  initialPromptCount?: number
  initialImagesPerPrompt?: number
  initialBrief?: string
  initialAutoGenerate?: boolean
  initialSecondReference?: boolean
  autoStart?: boolean
  workspaceTabId?: string | null
  visible?: boolean
  onBackground?: () => void
  onAutoStartConsumed?: () => void
  onStatusChange?: (status: GallerySopRunStatus) => void
}) {
  const { largeView, toggleLargeView } = useLargeModalMode(PROMPT_MANAGEMENT_MODAL_MODE_STORAGE_KEY)
  const items = useRequirementPrototype((state) => state.sopLibrary)
  const params = useStore((state) => state.params)
  const inputImages = useStore((state) => state.inputImages)
  const inputImageFolder = useStore((state) => state.inputImageFolder)
  const customOutputPath = useStore((state) => state.customOutputPath)
  const activeWorkspaceTabId = useStore((state) => state.activeWorkspaceTabId)
  const workspaceTabs = useStore((state) => state.workspaceTabs)
  const showToast = useStore((state) => state.showToast)
  const setConfirmDialog = useStore((state) => state.setConfirmDialog)
  const setInputImages = useStore((state) => state.setInputImages)
  const setInputImageFolder = useStore((state) => state.setInputImageFolder)
  const setParams = useStore((state) => state.setParams)
  const selectedSopId = initialSopId
  const [promptCount, setPromptCount] = useState(initialPromptCount)
  const [imagesPerPrompt, setImagesPerPrompt] = useState(initialImagesPerPrompt)
  const [brief, setBrief] = useState(initialBrief)
  const [autoGenerate, setAutoGenerate] = useState(initialAutoGenerate)
  const [secondReference, setSecondReference] = useState(initialSecondReference)
  const [sources, setSources] = useState<SourceRun[]>([])
  const [prompts, setPrompts] = useState<PromptDraft[]>([])
  const [status, setStatus] = useState<BatchStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('提示词列表为空，可从输入区主按钮生成')
  const [error, setError] = useState('')
  const [activeRunId, setActiveRunId] = useState(promptRunId)
  const [recentRuns, setRecentRuns] = useState<SopBatchSnapshot[]>([])
  const [runTitle, setRunTitle] = useState('')
  const [librarySearch, setLibrarySearch] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [restoreComplete, setRestoreComplete] = useState(false)
  const [previewSource, setPreviewSource] = useState<SopPromptSource | null>(null)
  const autoStartRef = useRef(false)
  const autoGenerateRef = useRef(initialAutoGenerate)
  const secondReferenceRef = useRef(initialSecondReference)
  const activeRunIdRef = useRef(activeRunId)
  const activeRunSubmittedRef = useRef(false)
  const pendingSnapshotRef = useRef<SopBatchSnapshot | null>(null)
  const snapshotTimerRef = useRef<number | null>(null)
  const generationAbortRef = useRef<AbortController | null>(null)
  const generationPausedRef = useRef(false)
  const pauseWaitersRef = useRef<Array<() => void>>([])
  const componentActiveRef = useRef(true)
  const modalRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  const selectedSop = items.find((item) => item.id === selectedSopId)
  const promptGenerationActive = status === 'generating' || status === 'paused'
  const running = promptGenerationActive || status === 'submitting'
  const targetWorkspaceTabId = workspaceTabId ?? activeWorkspaceTabId
  const activeTab = workspaceTabs.find((tab) => tab.id === targetWorkspaceTabId)
  const promptRunStorageKey = getGallerySopPromptRunStorageKey(targetWorkspaceTabId)
  const allSources = useMemo<SopPromptSource[]>(() => {
    const direct = inputImages.map((image, index) => ({
      id: sourceKey(index, image.id),
      label: `图${index + 1}`,
      kind: 'image' as const,
      imageId: image.id,
      dataUrl: image.dataUrl,
    }))
    if (direct.length > 0) return direct
    const folderImages = (inputImageFolder?.imageIds ?? []).map((imageId, index) => ({
      id: sourceKey(index, imageId),
      label: `图${index + 1}`,
      kind: 'image' as const,
      imageId,
    }))
    return folderImages.length ? folderImages : [{ id: 'text-to-image', label: '文生图（无参考图）', kind: 'text' as const }]
  }, [inputImageFolder?.imageIds, inputImages])
  const normalizedCounts = getSopRunCounts(promptCount, imagesPerPrompt)
  const targetCount = normalizedCounts.promptCount
  const targetImagesPerPrompt = normalizedCounts.imagesPerPrompt
  const totalImageCount = getSopTotalImageCount(targetCount, targetImagesPerPrompt)
  const selectedSources = useMemo(
    () => selectSopPromptSources(allSources, targetCount, brief),
    [allSources, brief, targetCount],
  )
  const visiblePrompts = prompts.filter((item) => !item.deleted && item.promptText.trim())
  const aiCount = prompts.filter((item) => !item.deleted && item.origin === 'ai' && item.promptText.trim()).length
  const missingCount = Math.max(0, targetCount - visiblePrompts.length)
  const activeRun = recentRuns.find((run) => run.id === activeRunId)
  const filteredRuns = useMemo(() => {
    const keyword = librarySearch.trim().toLocaleLowerCase()
    return recentRuns.filter((run) => {
      if (favoritesOnly && !run.pinned) return false
      if (!keyword) return true
      return [
        getPromptRunTitle(run),
        run.sop.name,
        run.brief,
        ...run.prompts.map((prompt) => prompt.text),
      ].some((value) => value.toLocaleLowerCase().includes(keyword))
    })
  }, [favoritesOnly, librarySearch, recentRuns])
  const getPromptReferenceSources = (item: PromptDraft) => {
    const source = allSources.find((candidate) => candidate.id === item.sourceId)
    const imageIds = item.referenceImageIds
      ?? (source?.kind === 'image' && source.imageId
        ? [source.imageId]
        : [])
    return imageIds.map((imageId, index) =>
      allSources.find((candidate) => candidate.imageId === imageId) ?? {
        id: `reference-${imageId}`,
        label: `参考图 ${index + 1}`,
        kind: 'image' as const,
        imageId,
      })
  }

  const setCurrentRunId = (id: string, submitted = false) => {
    activeRunIdRef.current = id
    activeRunSubmittedRef.current = submitted
    setActiveRunId(id)
  }

  const releasePauseWaiters = () => {
    const waiters = pauseWaitersRef.current.splice(0)
    for (const resolve of waiters) resolve()
  }

  const waitWhileGenerationPaused = async () => {
    if (!generationPausedRef.current) return
    await new Promise<void>((resolve) => {
      pauseWaitersRef.current.push(resolve)
    })
  }

  const pausePromptGeneration = () => {
    if (status !== 'generating' || !generationAbortRef.current) return
    generationPausedRef.current = true
    setStatus('paused')
    setStatusMessage('提示词生成已暂停，将在当前请求完成后停止发送下一批')
  }

  const resumePromptGeneration = () => {
    if (status !== 'paused' || !generationAbortRef.current) return
    generationPausedRef.current = false
    releasePauseWaiters()
    setStatus('generating')
    setStatusMessage(`继续生成提示词，当前可用 ${visiblePrompts.length}/${targetCount} 条`)
  }

  const cancelPromptGeneration = () => {
    const controller = generationAbortRef.current
    if (!controller) return
    generationPausedRef.current = false
    releasePauseWaiters()
    controller.abort(new DOMException('提示词生成已取消', 'AbortError'))
    setStatusMessage('正在取消提示词生成')
  }

  const resetCompletedRun = () => {
    const nextRunId = promptRunId()
    setCurrentRunId(nextRunId)
    setRunTitle('')
    setSources([])
    setPrompts([])
    setStatus('idle')
    setError('')
    setStatusMessage('提示词列表为空，可从输入区主按钮生成')
    writeRunPointer(
      nextRunId,
      [],
      autoGenerateRef.current,
      brief,
      targetCount,
      targetImagesPerPrompt,
      secondReferenceRef.current,
    )
  }

  const updateRecentRun = (snapshot: SopBatchSnapshot) => {
    setRecentRuns((current) => [snapshot, ...current.filter((item) => item.id !== snapshot.id)]
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || getRunUpdatedAt(b) - getRunUpdatedAt(a)))
  }

  const writeRunPointer = (
    runId: string,
    nextPrompts: PromptDraft[],
    nextAutoGenerate = autoGenerate,
    nextBrief = brief,
    nextPromptCount = targetCount,
    nextImagesPerPrompt = targetImagesPerPrompt,
    nextSecondReference = secondReferenceRef.current,
  ) => {
    window.localStorage.setItem(promptRunStorageKey, JSON.stringify({
      version: 4,
      activeRunId: runId,
      selectedSopId,
      promptCount: nextPromptCount,
      imagesPerPrompt: nextImagesPerPrompt,
      availablePrompts: nextPrompts.filter((item) => !item.deleted && item.promptText.trim()).length,
      brief: nextBrief,
      autoGenerate: nextAutoGenerate,
      secondReference: nextSecondReference,
    } satisfies PersistedSopPromptRun))
  }

  const buildPromptRunSnapshot = (
    runId: string,
    nextPrompts: PromptDraft[],
    nextSources: SourceRun[],
    runStatus: NonNullable<SopBatchSnapshot['status']>,
    patch: Partial<SopBatchSnapshot> = {},
  ): SopBatchSnapshot | null => {
    const previous = recentRuns.find((item) => item.id === runId)
    const snapshotSop = previous?.sop ?? selectedSop
    if (!snapshotSop) return null
    const referenceImageIds = selectedSources
      .filter((source) => source.kind === 'image' && source.imageId)
      .map((source) => source.imageId!)
    const now = Date.now()
    return {
      id: runId,
      batchId: patch.batchId ?? previous?.batchId ?? '',
      workspaceTabId: targetWorkspaceTabId,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      status: runStatus,
      pinned: patch.pinned ?? previous?.pinned ?? false,
      batchIds: patch.batchIds ?? previous?.batchIds ?? [],
      taskIds: patch.taskIds ?? previous?.taskIds ?? [],
      title: runTitle.trim() || previous?.title,
      sop: {
        id: snapshotSop.id,
        name: snapshotSop.name,
        description: snapshotSop.description,
        content: snapshotSop.content,
      },
      brief: brief.trim(),
      referenceImageIds: patch.referenceImageIds ?? referenceImageIds,
      promptCount: nextPrompts.filter((item) => !item.deleted && item.promptText.trim()).length,
      imagesPerPrompt: targetImagesPerPrompt,
      prompts: nextPrompts.map((item) => ({
        id: item.id,
        text: item.promptText,
        origin: item.origin,
        edited: Boolean(item.edited),
        sourceId: item.sourceId,
        referenceImageIds: item.referenceImageIds,
        deleted: Boolean(item.deleted),
      })),
      params: { ...params, n: targetImagesPerPrompt, reference_mode: 'cycle' },
      ...patch,
    }
  }

  const flushPromptRunSnapshot = async (snapshot?: SopBatchSnapshot | null) => {
    const next = snapshot ?? pendingSnapshotRef.current
    if (!next) return
    if (snapshotTimerRef.current != null) window.clearTimeout(snapshotTimerRef.current)
    snapshotTimerRef.current = null
    pendingSnapshotRef.current = null
    await putSopBatchSnapshot(next)
    updateRecentRun(next)
  }

  const queuePromptRunSnapshot = (snapshot: SopBatchSnapshot) => {
    pendingSnapshotRef.current = snapshot
    if (snapshotTimerRef.current != null) window.clearTimeout(snapshotTimerRef.current)
    snapshotTimerRef.current = window.setTimeout(() => {
      const pending = pendingSnapshotRef.current
      if (pending) void flushPromptRunSnapshot(pending)
    }, 350)
  }

  const persistPromptRun = (
    nextPrompts: PromptDraft[],
    nextSources = sources,
    nextAutoGenerate = autoGenerate,
    runStatus: NonNullable<SopBatchSnapshot['status']> = 'ready',
  ) => {
    let runId = activeRunIdRef.current
    if (activeRunSubmittedRef.current && runStatus !== 'submitted') {
      runId = promptRunId()
      setCurrentRunId(runId)
    }
    writeRunPointer(runId, nextPrompts, nextAutoGenerate)
    const snapshot = buildPromptRunSnapshot(runId, nextPrompts, nextSources, runStatus)
    if (snapshot) queuePromptRunSnapshot(snapshot)
  }

  const applyPromptRun = async (run: SopBatchSnapshot, message: string, restoreGenerationContext = false) => {
    if (run.id !== activeRunIdRef.current) await flushPromptRunSnapshot()
    const sourceByImageId = new Map(run.referenceImageIds.map((imageId, index) => [
      imageId,
      {
        id: `restored-${imageId}`,
        label: `图${index + 1}`,
        kind: 'image' as const,
        imageId,
      },
    ]))
    const textSource: SopPromptSource = { id: 'text-to-image', label: '文生图（无参考图）', kind: 'text' }
    const restoredPrompts: PromptDraft[] = run.prompts.map((item, index) => {
      const imageId = item.referenceImageIds?.length === 1
        ? item.referenceImageIds[0]
        : run.referenceImageIds.length > 0
          ? run.referenceImageIds[index % run.referenceImageIds.length]
          : undefined
      const source = imageId ? sourceByImageId.get(imageId) : textSource
      return {
        id: item.id,
        sourceId: source?.id ?? textSource.id,
        referenceImageIds: imageId ? [imageId] : [],
        promptText: item.text,
        origin: item.origin,
        edited: item.edited,
        deleted: item.deleted,
      }
    })
    const restoredSourceMap = new Map<string, SourceRun>()
    for (const item of restoredPrompts) {
      const imageId = item.referenceImageIds?.[0]
      const source = imageId ? sourceByImageId.get(imageId) : textSource
      if (!source) continue
      const existing = restoredSourceMap.get(source.id)
      restoredSourceMap.set(source.id, {
        source,
        requestedCount: (existing?.requestedCount ?? 0) + 1,
        status: 'completed',
        attempts: 0,
      })
    }
    const restoredSources = [...restoredSourceMap.values()]
    const restoredImages = restoreGenerationContext
      ? (await Promise.all(run.referenceImageIds.map(async (imageId): Promise<InputImage | null> => {
          const dataUrl = await ensureImageCached(imageId)
          return dataUrl ? { id: imageId, dataUrl } : null
        }))).filter((image): image is InputImage => Boolean(image))
      : []

    setCurrentRunId(run.id, run.status === 'submitted' || Boolean(run.batchId))
    setRunTitle(getPromptRunTitle(run))
    setPromptCount(run.promptCount || restoredPrompts.filter((item) => !item.deleted && item.promptText.trim()).length || initialPromptCount)
    setImagesPerPrompt(run.imagesPerPrompt || initialImagesPerPrompt)
    setBrief(run.brief)
    setSources(restoredSources)
    setPrompts(restoredPrompts)
    if (restoreGenerationContext) {
      setParams(run.params)
      setInputImageFolder(null)
      setInputImages(restoredImages)
    }
    setStatus('ready')
    setError('')
    setStatusMessage(message)
    writeRunPointer(
      run.id,
      restoredPrompts,
      autoGenerateRef.current,
      run.brief,
      run.promptCount,
      run.imagesPerPrompt,
    )
    if (restoreGenerationContext && restoredImages.length !== run.referenceImageIds.length) {
      showToast(`已加载提示词，但有 ${run.referenceImageIds.length - restoredImages.length} 张历史参考图不可用`, 'info')
    }
  }

  useEffect(() => {
    let active = true
    setRestoreComplete(false)
    autoStartRef.current = false

    void (async () => {
      const allRuns = await getAllSopBatchSnapshots()
      if (!active) return
      const sortedRuns = allRuns
        .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || getRunUpdatedAt(b) - getRunUpdatedAt(a))
      setRecentRuns(sortedRuns)

      let persisted: Partial<PersistedSopPromptRun> | null = null
      try {
        const raw = window.localStorage.getItem(promptRunStorageKey)
        persisted = raw ? JSON.parse(raw) as Partial<PersistedSopPromptRun> : null
      } catch {
        window.localStorage.removeItem(promptRunStorageKey)
      }

      if (persisted?.selectedSopId === selectedSopId && persisted.activeRunId) {
        const storedRun = await getSopBatchSnapshot(persisted.activeRunId)
        if (active && storedRun?.sop.id === selectedSopId) {
          if (typeof persisted.autoGenerate === 'boolean') {
            autoGenerateRef.current = persisted.autoGenerate
            setAutoGenerate(persisted.autoGenerate)
          }
          if (typeof persisted.secondReference === 'boolean') {
            secondReferenceRef.current = persisted.secondReference
            setSecondReference(persisted.secondReference)
          }
          await applyPromptRun(storedRun, `已恢复上次 SOP 提示词列表，当前可用 ${storedRun.prompts.filter((item) => !item.deleted && item.text.trim()).length} 条`, true)
          if (active) setRestoreComplete(true)
          return
        }
      }

      if (!selectedSopId && sortedRuns[0]) {
        const latestRun = sortedRuns[0]
        await applyPromptRun(latestRun, `已打开最近的提示词集，当前可用 ${latestRun.prompts.filter((item) => !item.deleted && item.text.trim()).length} 条`)
        if (active) setRestoreComplete(true)
        return
      }

      const legacyPrompts = persisted?.selectedSopId === selectedSopId && Array.isArray(persisted.prompts)
        ? persisted.prompts
        : []
      if (legacyPrompts.length > 0) {
        const legacySources = Array.isArray(persisted?.sources) ? persisted.sources : []
        const migratedRunId = promptRunId()
        setCurrentRunId(migratedRunId)
        setRunTitle('')
        setPromptCount(persisted?.promptCount ?? persisted?.quantity ?? initialPromptCount)
        setImagesPerPrompt(persisted?.imagesPerPrompt ?? initialImagesPerPrompt)
        setBrief(typeof persisted?.brief === 'string' ? persisted.brief : initialBrief)
        if (typeof persisted?.autoGenerate === 'boolean') {
          autoGenerateRef.current = persisted.autoGenerate
          setAutoGenerate(persisted.autoGenerate)
        }
        if (typeof persisted?.secondReference === 'boolean') {
          secondReferenceRef.current = persisted.secondReference
          setSecondReference(persisted.secondReference)
        }
        setSources(legacySources)
        setPrompts(legacyPrompts)
        setStatus('ready')
        setStatusMessage(`已迁移上次保存的 SOP 提示词列表，当前可用 ${legacyPrompts.filter((item) => !item.deleted && item.promptText.trim()).length} 条`)
        const migrated = buildPromptRunSnapshot(migratedRunId, legacyPrompts, legacySources, 'ready')
        if (migrated) await flushPromptRunSnapshot(migrated)
        writeRunPointer(
          migratedRunId,
          legacyPrompts,
          persisted?.autoGenerate ?? autoGenerateRef.current,
          persisted?.brief ?? initialBrief,
          persisted?.promptCount ?? persisted?.quantity ?? initialPromptCount,
          persisted?.imagesPerPrompt ?? initialImagesPerPrompt,
        )
      } else {
        const newRunId = promptRunId()
        setCurrentRunId(newRunId)
        setRunTitle('')
        setPromptCount(initialPromptCount)
        setImagesPerPrompt(initialImagesPerPrompt)
        setBrief(initialBrief)
        setSources([])
        setPrompts([])
        setStatus('idle')
        setStatusMessage('提示词列表为空，可从输入区主按钮生成')
        writeRunPointer(newRunId, [], autoGenerateRef.current, initialBrief, initialPromptCount, initialImagesPerPrompt)
      }
      if (active) setRestoreComplete(true)
    })().catch((cause) => {
      if (!active) return
      setRestoreComplete(true)
      setError(cause instanceof Error ? cause.message : '恢复 SOP 提示词运行记录失败')
    })

    return () => {
      active = false
      generationPausedRef.current = false
      const waiters = pauseWaitersRef.current.splice(0)
      for (const resolve of waiters) resolve()
      generationAbortRef.current?.abort(new DOMException('SOP 已切换或工作台已关闭', 'AbortError'))
      generationAbortRef.current = null
    }
  }, [promptRunStorageKey, selectedSopId])

  useEffect(() => () => {
    componentActiveRef.current = false
    if (snapshotTimerRef.current != null) window.clearTimeout(snapshotTimerRef.current)
    const pending = pendingSnapshotRef.current
    if (pending) void putSopBatchSnapshot(pending)
  }, [])

  const toggleAutoGenerate = (nextAutoGenerate: boolean) => {
    autoGenerateRef.current = nextAutoGenerate
    setAutoGenerate(nextAutoGenerate)
    if (prompts.length > 0) persistPromptRun(prompts, sources, nextAutoGenerate)
    else writeRunPointer(activeRunIdRef.current, prompts, nextAutoGenerate)
  }

  const toggleSecondReference = (nextSecondReference: boolean) => {
    secondReferenceRef.current = nextSecondReference
    setSecondReference(nextSecondReference)
    writeRunPointer(
      activeRunIdRef.current,
      prompts,
      autoGenerateRef.current,
      brief,
      targetCount,
      targetImagesPerPrompt,
      nextSecondReference,
    )
  }

  const closeSafely = () => {
    if (running) {
      onBackground?.()
      showToast(status === 'paused' ? 'SOP 提示词生成已暂停，可随时返回继续' : 'SOP 提示词正在后台生成，可随时从当前标签页的列表继续查看', 'success')
      return
    }
    onClose()
  }

  const toggleRunPinned = async (run: SopBatchSnapshot) => {
    if (run.id === activeRunIdRef.current) await flushPromptRunSnapshot()
    const latest = await getSopBatchSnapshot(run.id) ?? run
    const updated = { ...latest, pinned: !latest.pinned, updatedAt: Date.now() }
    await putSopBatchSnapshot(updated)
    updateRecentRun(updated)
    showToast(updated.pinned ? '已收藏为可复用提示词集' : '已取消收藏提示词集', 'success')
  }

  const toggleActiveRunPinned = async () => {
    await flushPromptRunSnapshot()
    let run = await getSopBatchSnapshot(activeRunIdRef.current)
    if (!run) {
      const created = buildPromptRunSnapshot(activeRunIdRef.current, prompts, sources, 'ready')
      if (!created) return
      run = created
    }
    await toggleRunPinned(run)
  }

  const performDeleteRun = async (run: SopBatchSnapshot) => {
    if (run.taskIds?.length || run.batchId) {
      showToast('该运行记录已关联生图任务，不能直接删除', 'info')
      return
    }
    if (run.id === activeRunIdRef.current) await flushPromptRunSnapshot()
    await deleteSopBatchSnapshot(run.id)
    const remainingRuns = recentRuns.filter((item) => item.id !== run.id)
    setRecentRuns(remainingRuns)
    if (run.id === activeRunIdRef.current) {
      if (remainingRuns[0]) {
        await applyPromptRun(remainingRuns[0], `已打开提示词集「${getPromptRunTitle(remainingRuns[0])}」`)
      } else {
        const newRunId = promptRunId()
        setCurrentRunId(newRunId)
        setRunTitle('')
        setSources([])
        setPrompts([])
        setStatus('idle')
        setStatusMessage('提示词仓库为空，可新建提示词集或从 SOP 生成')
        writeRunPointer(newRunId, [])
      }
    }
    showToast('提示词集已删除', 'success')
  }

  const deleteRun = (run: SopBatchSnapshot) => {
    if (run.taskIds?.length || run.batchId) {
      showToast('该运行记录已关联生图任务，不能直接删除', 'info')
      return
    }
    setConfirmDialog({
      title: '删除提示词集？',
      message: `将永久删除「${getPromptRunTitle(run)}」，此操作不可撤销。`,
      confirmText: '确认删除',
      tone: 'danger',
      action: () => void performDeleteRun(run),
    })
  }

  const updateActiveRunMetadata = (next: { title?: string; brief?: string }) => {
    const nextTitle = next.title ?? runTitle
    const nextBrief = next.brief ?? brief
    setRunTitle(nextTitle)
    setBrief(nextBrief)
    if (!activeRun) return
    const snapshot = buildPromptRunSnapshot(activeRun.id, prompts, sources, activeRun.status ?? 'ready', {
      title: nextTitle.trim() || undefined,
      brief: nextBrief.trim(),
    })
    if (snapshot) queuePromptRunSnapshot(snapshot)
  }

  const createPromptCollection = async () => {
    await flushPromptRunSnapshot()
    const now = Date.now()
    const runId = promptRunId()
    const sourceId = 'text-to-image'
    const snapshot: SopBatchSnapshot = {
      id: runId,
      title: '未命名提示词集',
      batchId: '',
      workspaceTabId: targetWorkspaceTabId,
      createdAt: now,
      updatedAt: now,
      status: 'ready',
      pinned: false,
      batchIds: [],
      taskIds: [],
      sop: selectedSop
        ? {
            id: selectedSop.id,
            name: selectedSop.name,
            description: selectedSop.description,
            content: selectedSop.content,
          }
        : {
            id: 'prompt-library',
            name: '独立提示词集',
            description: '',
            content: '',
          },
      brief: '',
      referenceImageIds: [],
      promptCount: 0,
      imagesPerPrompt: targetImagesPerPrompt,
      prompts: [{
        id: promptItemId(sourceId),
        text: '',
        origin: 'manual',
        edited: false,
        sourceId,
        referenceImageIds: [],
        deleted: false,
      }],
      params: { ...params, n: targetImagesPerPrompt, reference_mode: 'cycle' },
    }
    await putSopBatchSnapshot(snapshot)
    updateRecentRun(snapshot)
    await applyPromptRun(snapshot, '已新建提示词集，修改内容会自动保存')
  }

  const duplicateActiveRun = async () => {
    if (!activeRun) return
    await flushPromptRunSnapshot()
    const latest = await getSopBatchSnapshot(activeRun.id) ?? activeRun
    const now = Date.now()
    const duplicated: SopBatchSnapshot = {
      ...latest,
      id: promptRunId(),
      title: `${getPromptRunTitle(latest)} 副本`,
      batchId: '',
      batchIds: [],
      taskIds: [],
      createdAt: now,
      updatedAt: now,
      status: 'ready',
      pinned: false,
      prompts: latest.prompts.map((prompt) => ({ ...prompt, id: promptItemId(prompt.sourceId ?? 'text-to-image') })),
    }
    await putSopBatchSnapshot(duplicated)
    updateRecentRun(duplicated)
    await applyPromptRun(duplicated, '已创建提示词集副本')
  }

  const copyActivePrompts = async () => {
    const text = visiblePrompts.map((item) => item.promptText.trim()).filter(Boolean).join('\n\n')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      showToast(`已复制 ${visiblePrompts.length} 条提示词`, 'success')
    } catch {
      showToast('复制失败，请检查系统剪贴板权限', 'error')
    }
  }

  const updatePrompts = (updater: (current: PromptDraft[]) => PromptDraft[]) => {
    setPrompts((current) => {
      const next = updater(current)
      persistPromptRun(next)
      return next
    })
  }

  const loadPromptInputImages = async (items: PromptDraft[]) => {
    const imageIds = [...new Set(items.flatMap((item) => {
      const source = allSources.find((candidate) => candidate.id === item.sourceId)
      return (item.referenceImageIds
        ?? (source?.kind === 'image' && source.imageId ? [source.imageId] : [])).slice(0, 1)
    }))]
    const loaded = await Promise.all(imageIds.map(async (imageId): Promise<InputImage | null> => {
      const source = allSources.find((candidate) => candidate.imageId === imageId)
      const dataUrl = source?.dataUrl ?? await ensureImageCached(imageId)
      return dataUrl ? { id: imageId, dataUrl } : null
    }))
    if (loaded.some((image) => !image)) throw new Error('部分参考图已不存在，请移除后重试')
    return loaded.filter((image): image is InputImage => Boolean(image))
  }

  const loadSourceInputImage = async (source: SopPromptSource): Promise<InputImage | null> => {
    if (source.kind !== 'image' || !source.imageId) return null
    const dataUrl = source.dataUrl ?? await ensureImageCached(source.imageId)
    if (!dataUrl) throw new Error(`参考图「${source.label}」已不存在，请移除后重试`)
    return { id: source.imageId, dataUrl }
  }

  const submitPromptList = async (itemsToSubmit = visiblePrompts) => {
    if (!selectedSop) return
    const usablePrompts = itemsToSubmit.filter((item) => !item.deleted && item.promptText.trim())
    if (!usablePrompts.length) {
      setStatus('error')
      setStatusMessage('无法开始生图')
      setError('请先生成或手动新增至少一条提示词')
      return
    }
    const requestedImageCount = usablePrompts.length * targetImagesPerPrompt
    setStatus('submitting')
    setError('')
    setStatusMessage(`正在提交 ${usablePrompts.length} 条提示词，预计生成 ${requestedImageCount} 张图片`)
    const batchId = `sop-batch-${Date.now().toString(36)}`
    const snapshotId = activeRunIdRef.current
    let promptInputImages: InputImage[]
    let submittingSnapshot: SopBatchSnapshot | null = null
    try {
      promptInputImages = secondReferenceRef.current ? await loadPromptInputImages(usablePrompts) : []
      await flushPromptRunSnapshot()
      const existingSnapshot = await getSopBatchSnapshot(snapshotId)
      submittingSnapshot = buildPromptRunSnapshot(snapshotId, itemsToSubmit, sources, 'ready', {
        batchId,
        batchIds: [...new Set([...(existingSnapshot?.batchIds ?? (existingSnapshot?.batchId ? [existingSnapshot.batchId] : [])), batchId])],
        taskIds: existingSnapshot?.taskIds ?? [],
        pinned: existingSnapshot?.pinned ?? false,
      })
      await flushPromptRunSnapshot(submittingSnapshot)
    } catch (cause) {
      setStatus('error')
      setStatusMessage('批次提交前检查失败')
      setError(cause instanceof Error ? cause.message : '参考图或批次快照保存失败')
      return
    }
    const promptInputImageById = new Map(promptInputImages.map((image) => [image.id, image]))
    const results = await Promise.allSettled(usablePrompts.map(async (item, index) => {
      const source = allSources.find((candidate) => candidate.id === item.sourceId)
      const itemReferenceImageIds = (item.referenceImageIds
        ?? (source?.kind === 'image' && source.imageId ? [source.imageId] : [])).slice(0, 1)
      const itemInputImages = secondReferenceRef.current
        ? itemReferenceImageIds.flatMap((imageId) => {
            const image = promptInputImageById.get(imageId)
            return image ? [image] : []
          })
        : []
      return submitTaskWithData({
        prompt: item.promptText.trim(),
        inputImages: itemInputImages,
        inputImageFolder: null,
        params: { ...params, n: targetImagesPerPrompt, reference_mode: 'cycle' },
        maskDraft: null,
        targetTabId: targetWorkspaceTabId,
        scheduledOutputPath: customOutputPath.trim() || undefined,
        scheduledOutputSubFolder: activeTab?.name,
        sopBatch: {
          batchId,
          snapshotId,
          sopId: selectedSop.id,
          sopName: selectedSop.name,
          promptId: item.id,
          promptIndex: index + 1,
          promptCount: usablePrompts.length,
          imagesPerPrompt: targetImagesPerPrompt,
        },
      }, { silentSuccess: true })
    }))
    const submittedTaskIds = results.flatMap((result) =>
      result.status === 'fulfilled' && typeof result.value === 'string' && result.value ? [result.value] : [])
    const successCount = results.filter((result) => result.status === 'fulfilled' && Boolean(result.value)).length
    const failCount = results.length - successCount
    if (submittingSnapshot) {
      const completedSnapshot: SopBatchSnapshot = {
        ...submittingSnapshot,
        status: successCount > 0 ? 'submitted' : 'failed',
        updatedAt: Date.now(),
        taskIds: [...new Set([...(submittingSnapshot.taskIds ?? []), ...submittedTaskIds])],
      }
      await flushPromptRunSnapshot(completedSnapshot)
      if (successCount > 0) setCurrentRunId(snapshotId, true)
    }
    if (successCount === 0) {
      setStatus('error')
      setStatusMessage('没有任务成功提交')
      setError('请检查图片 API 配置或输出参数后重试。')
      showToast('SOP 生图任务提交失败', 'error')
      return
    }
    setStatus(failCount > 0 ? 'error' : 'success')
    setStatusMessage(failCount > 0 ? `部分提交完成：成功 ${successCount} 个，失败 ${failCount} 个` : `已并发提交 ${successCount} 个 SOP 生图任务`)
    setError(failCount > 0 ? '失败项未创建任务卡，请检查 API 配置后重新提交。' : '')
    showToast(failCount > 0 ? `SOP 批量任务部分提交失败：${failCount} 个` : `已提交 ${successCount} 个 SOP 生图任务`, failCount > 0 ? 'error' : 'success')
    if (failCount === 0) resetCompletedRun()
  }

  const generateForSources = async (retrySourceId?: string, freshRun = false) => {
    if (!selectedSop) {
      setStatus('error')
      setStatusMessage('无法生成提示词')
      setError('请先选择一个 SOP')
      return
    }
    const currentSources = freshRun ? [] : sources
    const currentPrompts = freshRun ? [] : prompts
    generationAbortRef.current?.abort(new DOMException('已开始新的提示词生成', 'AbortError'))
    const generationController = new AbortController()
    generationAbortRef.current = generationController
    generationPausedRef.current = false
    releasePauseWaiters()
    const allocations = allocateSopPromptCounts(targetCount, selectedSources.length)
    const retrySource = retrySourceId
      ? currentSources.find((entry) => entry.source.id === retrySourceId)?.source
      : undefined
    const isRetryTarget = (source: SopPromptSource) => !retrySourceId
      || source.id === retrySourceId
      || Boolean(source.imageId && retrySource?.imageId === source.imageId)
    const promptBelongsToSource = (item: PromptDraft, source: SopPromptSource) =>
      item.sourceId === source.id
      || Boolean(source.imageId && item.referenceImageIds?.[0] === source.imageId)
      || (source.kind === 'text' && !(item.referenceImageIds?.length))
    const plannedSources: SourceRun[] = selectedSources.map((source, index) => {
      const previous = currentSources.find((entry) =>
        entry.source.id === source.id
        || Boolean(source.imageId && entry.source.imageId === source.imageId))
      const requestedCount = allocations[index] ?? 0
      const currentCount = currentPrompts.filter((item) =>
        !item.deleted && item.promptText.trim() && promptBelongsToSource(item, source)).length
      const shouldGenerate = isRetryTarget(source) && currentCount < requestedCount
      return {
        source,
        requestedCount,
        status: shouldGenerate
          ? 'running'
          : currentCount >= requestedCount
            ? 'completed'
            : previous?.status ?? 'pending',
        attempts: (previous?.attempts ?? 0) + (shouldGenerate ? 1 : 0),
        error: shouldGenerate ? undefined : previous?.error,
      }
    }).filter((source) => source.requestedCount > 0)
    setSources(plannedSources)
    setStatus('generating')
    setStatusMessage(retrySourceId
      ? '正在重试当前参考图的提示词缺口'
      : selectedSources[0]?.kind === 'text'
        ? `正在生成 ${targetCount} 条文生图提示词`
        : `正在逐张参考 ${selectedSources.length} 张图片生成 ${targetCount} 条提示词`)
    setError('')
    persistPromptRun(retrySourceId ? currentPrompts : [], plannedSources, autoGenerate, 'generating')
    const existingPrompts = currentPrompts.filter((item) => !item.deleted && item.promptText.trim()).map((item) => item.promptText.trim())
    const nextPrompts = retrySourceId ? [...currentPrompts] : []
    const nextSources = [...plannedSources]
    const progressiveDispatch = autoGenerateRef.current && !retrySourceId
    const progressiveBatchId = progressiveDispatch ? `sop-batch-${Date.now().toString(36)}` : ''
    const progressiveSnapshotId = activeRunIdRef.current
    const progressiveTaskIds: string[] = []
    let progressiveSuccessCount = 0
    let progressiveFailureCount = 0
    let progressivePersistenceError = ''
    let generationCancelled = false

    const saveProgressiveSnapshot = async (runStatus: NonNullable<SopBatchSnapshot['status']>) => {
      if (!progressiveDispatch) return
      const snapshot = buildPromptRunSnapshot(progressiveSnapshotId, nextPrompts, nextSources, runStatus, {
        batchId: progressiveBatchId,
        batchIds: [progressiveBatchId],
        taskIds: [...progressiveTaskIds],
      })
      if (!snapshot) return
      try {
        await flushPromptRunSnapshot(snapshot)
      } catch (cause) {
        progressivePersistenceError = cause instanceof Error ? cause.message : '运行记录保存失败'
      }
    }

    for (const sourceRun of plannedSources.filter((entry) => isRetryTarget(entry.source))) {
      const sourceIndex = nextSources.findIndex((entry) => entry.source.id === sourceRun.source.id)
      const existingForSource = nextPrompts.filter((item) =>
        !item.deleted && item.promptText.trim() && promptBelongsToSource(item, sourceRun.source))
      const deficit = Math.max(0, sourceRun.requestedCount - existingForSource.length)
      if (deficit === 0) {
        nextSources[sourceIndex] = { ...nextSources[sourceIndex], status: 'completed', error: undefined }
        continue
      }
      try {
        const sourceImage = await loadSourceInputImage(sourceRun.source)
        const referenceImageIds = sourceImage ? [sourceImage.id] : []
        const generationInputImages = progressiveDispatch && secondReferenceRef.current && sourceImage ? [sourceImage] : []
        const sourcePosition = plannedSources.findIndex((entry) => entry.source.id === sourceRun.source.id) + 1
        const generatedBeforeRequest = nextPrompts.filter((item) =>
          !item.deleted && item.promptText.trim() && promptBelongsToSource(item, sourceRun.source)).length
        const generated = await generatePromptsFromSopStore(selectedSop, deficit, brief, {
          context: {
            sourceLabel: sourceImage ? sourceRun.source.label : undefined,
            sourceIndex: sourceImage ? sourcePosition : undefined,
            sourceCount: sourceImage ? plannedSources.length : undefined,
            totalPromptCount: targetCount,
          },
          referenceImages: sourceImage
            ? [{ name: sourceRun.source.label, dataUrl: sourceImage.dataUrl }]
            : undefined,
          exact: false,
          existingPrompts: [...existingPrompts, ...nextPrompts.map((item) => item.promptText.trim()).filter(Boolean)],
          maxBatchSize: progressiveDispatch ? 1 : undefined,
          beforeBatch: waitWhileGenerationPaused,
          signal: generationController.signal,
          onBatch: async (batchPrompts) => {
            for (const prompt of batchPrompts) {
              if (!componentActiveRef.current || generationController.signal.aborted) {
                throw generationController.signal.reason instanceof Error
                  ? generationController.signal.reason
                  : new DOMException('提示词生成已取消', 'AbortError')
              }
              const item: PromptDraft = {
                id: promptItemId(sourceRun.source.id),
                sourceId: sourceRun.source.id,
                referenceImageIds,
                promptText: prompt,
                origin: 'ai',
              }
              nextPrompts.push(item)
              setPrompts([...nextPrompts])
              const promptIndex = nextPrompts.filter((entry) => !entry.deleted && entry.promptText.trim()).length
              if (progressiveDispatch) {
                setStatusMessage(`已生成提示词 ${promptIndex}/${targetCount}，正在发送第 ${promptIndex} 条生图任务`)
                await saveProgressiveSnapshot('generating')
                let dispatched = false
                try {
                  const taskId = await submitTaskWithData({
                    prompt: item.promptText.trim(),
                    inputImages: generationInputImages,
                    inputImageFolder: null,
                    params: { ...params, n: targetImagesPerPrompt, reference_mode: 'cycle' },
                    maskDraft: null,
                    targetTabId: targetWorkspaceTabId,
                    scheduledOutputPath: customOutputPath.trim() || undefined,
                    scheduledOutputSubFolder: activeTab?.name,
                    sopBatch: {
                      batchId: progressiveBatchId,
                      snapshotId: progressiveSnapshotId,
                      sopId: selectedSop.id,
                      sopName: selectedSop.name,
                      promptId: item.id,
                      promptIndex,
                      promptCount: targetCount,
                      imagesPerPrompt: targetImagesPerPrompt,
                    },
                  }, { silentSuccess: true })
                  if (typeof taskId === 'string' && taskId) {
                    progressiveTaskIds.push(taskId)
                    progressiveSuccessCount += 1
                    dispatched = true
                  } else {
                    progressiveFailureCount += 1
                  }
                } catch {
                  progressiveFailureCount += 1
                }
                if (!componentActiveRef.current || generationController.signal.aborted) {
                  throw generationController.signal.reason instanceof Error
                    ? generationController.signal.reason
                    : new DOMException('提示词生成已取消', 'AbortError')
                }
                await saveProgressiveSnapshot('generating')
                setStatusMessage(generationPausedRef.current
                  ? `提示词生成已暂停，第 ${promptIndex} 条${dispatched ? '已发送' : '发送失败'}`
                  : dispatched
                    ? `第 ${promptIndex} 条已发送，继续生成下一条提示词`
                    : `第 ${promptIndex} 条发送失败，继续生成下一条提示词`)
              } else {
                persistPromptRun([...nextPrompts], nextSources, autoGenerate, 'generating')
                setStatusMessage(generationPausedRef.current
                  ? `提示词生成已暂停，当前可用 ${promptIndex}/${targetCount} 条`
                  : `正在生成提示词 ${promptIndex}/${targetCount}`)
              }
            }
          },
          onProgress: (completed, total) => {
            if (!progressiveDispatch) {
              const completedCount = Math.min(
                nextPrompts.filter((item) => !item.deleted && item.promptText.trim()).length,
                targetCount,
              )
              const totalCount = Math.min(completedCount + Math.max(0, total - completed), targetCount)
              setStatusMessage(generationPausedRef.current
                ? `提示词生成已暂停，当前可用 ${completedCount}/${totalCount} 条`
                : `正在参考 ${sourceRun.source.label} 生成提示词 ${completedCount}/${totalCount}`)
            }
          },
        })
        if (generationController.signal.aborted) {
          throw generationController.signal.reason instanceof Error
            ? generationController.signal.reason
            : new DOMException('提示词生成已取消', 'AbortError')
        }
        const candidates = normalizeSopPromptCandidates(generated, deficit, [...existingPrompts, ...nextPrompts.map((item) => item.promptText)])
        nextPrompts.push(...candidates.map((prompt) => ({
          id: promptItemId(sourceRun.source.id),
          sourceId: sourceRun.source.id,
          referenceImageIds,
          promptText: prompt,
          origin: 'ai' as const,
        })))
        const generatedCount = nextPrompts.filter((item) =>
          !item.deleted && item.promptText.trim() && promptBelongsToSource(item, sourceRun.source)).length - generatedBeforeRequest
        nextSources[sourceIndex] = {
          ...nextSources[sourceIndex],
          status: generatedCount >= deficit ? 'completed' : 'partial',
          error: generatedCount >= deficit ? undefined : `缺少 ${deficit - generatedCount} 条`,
        }
      } catch (cause) {
        if (generationController.signal.aborted || isAbortError(cause)) {
          generationCancelled = true
          const generatedCount = nextPrompts.filter((item) =>
            !item.deleted && item.promptText.trim() && promptBelongsToSource(item, sourceRun.source)).length - existingForSource.length
          nextSources[sourceIndex] = {
            ...nextSources[sourceIndex],
            status: generatedCount > 0 ? 'partial' : 'pending',
            error: undefined,
          }
          break
        } else {
          nextSources[sourceIndex] = {
            ...nextSources[sourceIndex],
            status: 'failed',
            error: cause instanceof Error ? cause.message : '提示词生成失败',
          }
        }
      }
    }

    if (!componentActiveRef.current) return
    if (generationCancelled) {
      for (let index = 0; index < nextSources.length; index += 1) {
        if (nextSources[index].status === 'running') {
          nextSources[index] = { ...nextSources[index], status: 'pending', error: undefined }
        }
      }
    }
    setPrompts(nextPrompts)
    setSources(nextSources)
    const available = nextPrompts.filter((item) => !item.deleted && item.promptText.trim()).length
    const failed = nextSources.filter((item) => item.status === 'failed').length
    const missing = Math.max(0, targetCount - available)
    if (generationAbortRef.current === generationController) generationAbortRef.current = null
    generationPausedRef.current = false
    releasePauseWaiters()
    if (generationCancelled) {
      if (progressiveDispatch && progressiveSuccessCount > 0) {
        await saveProgressiveSnapshot('submitted')
        setCurrentRunId(progressiveSnapshotId, true)
        showToast(`已取消后续提示词生成，已发送 ${progressiveSuccessCount} 个生图任务`, 'info')
        resetCompletedRun()
      } else {
        persistPromptRun(nextPrompts, nextSources, autoGenerate, 'ready')
        await flushPromptRunSnapshot()
        setStatus(available > 0 ? 'ready' : 'idle')
        setStatusMessage(available > 0 ? `已取消提示词生成，保留当前 ${available} 条提示词` : '提示词生成已取消')
        setError('')
      }
      return
    }
    if (progressiveDispatch) {
      const finalSnapshotStatus = progressiveSuccessCount > 0 ? 'submitted' : 'failed'
      await saveProgressiveSnapshot(finalSnapshotStatus)
      if (progressiveSuccessCount > 0) setCurrentRunId(progressiveSnapshotId, true)
      const hasProblems = Boolean(failed || missing || progressiveFailureCount || progressivePersistenceError)
      setStatus(hasProblems ? 'error' : 'success')
      setStatusMessage(hasProblems
        ? `逐条生成完成：已发送 ${progressiveSuccessCount} 条，发送失败 ${progressiveFailureCount} 条，提示词缺口 ${missing} 条`
        : `已逐条生成并发送 ${progressiveSuccessCount} 个 SOP 生图任务`)
      setError([
        failed ? '提示词生成中断，可重试缺口。' : '',
        progressiveFailureCount ? '部分提示词未创建生图任务。' : '',
        progressivePersistenceError ? `运行记录保存失败：${progressivePersistenceError}` : '',
      ].filter(Boolean).join(' '))
      showToast(
        hasProblems ? `SOP 逐条生图部分完成：已发送 ${progressiveSuccessCount} 条` : `已逐条发送 ${progressiveSuccessCount} 个 SOP 生图任务`,
        hasProblems ? 'error' : 'success',
      )
      if (!hasProblems) resetCompletedRun()
    } else {
      persistPromptRun(nextPrompts, nextSources, autoGenerate, failed && available === 0 ? 'failed' : 'ready')
      await flushPromptRunSnapshot()
      setStatus('ready')
      setStatusMessage(missing ? `提示词列表部分完成：当前可用 ${available} 条，缺口 ${missing} 条` : `提示词列表已生成：当前可用 ${available} 条`)
      if (failed || missing) setError(failed ? '提示词生成失败，可重试缺口。' : '')
    }
  }

  const generatePromptList = async (replaceConfirmed = false) => {
    if (running || !selectedSop) return
    const replacingCurrent = visiblePrompts.length > 0
    if (replacingCurrent && !replaceConfirmed) {
      setConfirmDialog({
        title: '生成新的提示词列表？',
        message: '当前提示词列表会保留在提示词仓库中，并创建一份新的列表。',
        confirmText: '继续生成',
        action: () => void generatePromptList(true),
      })
      return
    }
    if (replacingCurrent) {
      await flushPromptRunSnapshot()
      const nextRunId = promptRunId()
      setCurrentRunId(nextRunId)
      setSources([])
      setPrompts([])
      writeRunPointer(
        nextRunId,
        [],
        autoGenerateRef.current,
        brief,
        targetCount,
        targetImagesPerPrompt,
        secondReferenceRef.current,
      )
    }
    void generateForSources(undefined, replacingCurrent)
  }

  const addManualPrompt = (sourceId: string) => {
    const source = allSources.find((candidate) => candidate.id === sourceId)
    const referenceImageIds = source?.kind === 'image' && source.imageId
      ? [source.imageId]
      : []
    updatePrompts((current) => [...current, { id: promptItemId(sourceId), sourceId, referenceImageIds, promptText: '', origin: 'manual' }])
  }

  const regeneratePrompt = async (item: PromptDraft, overwriteConfirmed = false) => {
    if (!selectedSop || running) return
    if ((item.edited || item.origin === 'manual') && !overwriteConfirmed) {
      setConfirmDialog({
        title: '覆盖当前提示词？',
        message: '重新生成会替换当前提示词内容，原内容无法恢复。',
        confirmText: '重新生成',
        tone: 'warning',
        action: () => void regeneratePrompt(item, true),
      })
      return
    }
    const generationController = new AbortController()
    generationAbortRef.current = generationController
    generationPausedRef.current = false
    setStatus('generating')
    setStatusMessage('正在重新生成这一条提示词')
    setError('')
    try {
      const source = allSources.find((candidate) =>
        candidate.id === item.sourceId
        || Boolean(candidate.imageId && candidate.imageId === item.referenceImageIds?.[0]))
      const sourceImage = source
        ? await loadSourceInputImage(source)
        : item.referenceImageIds?.[0]
          ? await ensureImageCached(item.referenceImageIds[0]).then((dataUrl) =>
              dataUrl ? { id: item.referenceImageIds![0], dataUrl } : null)
          : null
      const referenceImageIds = sourceImage ? [sourceImage.id] : []
      const existingPrompts = prompts
        .filter((entry) => entry.id !== item.id && !entry.deleted && entry.promptText.trim())
        .map((entry) => entry.promptText.trim())
      const generated = await generatePromptsFromSopStore(selectedSop, 1, brief, {
        context: {
          sourceLabel: sourceImage ? source?.label ?? '参考图' : undefined,
          sourceIndex: sourceImage && source ? selectedSources.findIndex((candidate) => candidate.id === source.id) + 1 : undefined,
          sourceCount: sourceImage ? selectedSources.length : undefined,
          totalPromptCount: targetCount,
        },
        referenceImages: sourceImage
          ? [{ name: source?.label ?? '参考图', dataUrl: sourceImage.dataUrl }]
          : undefined,
        exact: true,
        existingPrompts,
        beforeBatch: waitWhileGenerationPaused,
        signal: generationController.signal,
      })
      if (generationController.signal.aborted) return
      updatePrompts((current) => current.map((entry) => entry.id === item.id
        ? { ...entry, referenceImageIds, promptText: generated[0] ?? entry.promptText, origin: 'ai', edited: false }
        : entry))
      setStatus('ready')
      setStatusMessage(`已重新生成第 ${visiblePrompts.findIndex((entry) => entry.id === item.id) + 1} 条提示词`)
    } catch (cause) {
      setStatus('ready')
      if (generationController.signal.aborted || isAbortError(cause)) {
        setStatusMessage('已取消重新生成，保留原提示词')
        setError('')
      } else {
        setStatusMessage('单条提示词重新生成失败')
        setError(cause instanceof Error ? cause.message : '提示词重新生成失败')
      }
    } finally {
      if (generationAbortRef.current === generationController) generationAbortRef.current = null
      generationPausedRef.current = false
      releasePauseWaiters()
    }
  }

  useEffect(() => {
    onStatusChange?.({
      workspaceTabId: targetWorkspaceTabId,
      phase: status,
      message: statusMessage,
      promptCount: targetCount,
      availablePrompts: visiblePrompts.length,
      totalImages: totalImageCount,
      failed: sources.some((source) => source.status === 'failed') || status === 'error' ? 1 : 0,
    })
  }, [onStatusChange, sources, status, statusMessage, targetCount, targetWorkspaceTabId, totalImageCount, visiblePrompts.length])

  useEffect(() => {
    if (!restoreComplete || !autoStart || autoStartRef.current || running || !selectedSop) return
    if (visiblePrompts.length > 0) return
    autoStartRef.current = true
    onAutoStartConsumed?.()
    void generateForSources()
  }, [autoStart, onAutoStartConsumed, restoreComplete, running, selectedSop, visiblePrompts.length])

  useEffect(() => {
    if (!autoStart) autoStartRef.current = false
  }, [autoStart])

  useCloseOnEscape(visible && !previewSource, closeSafely)
  useCloseOnEscape(visible && Boolean(previewSource), () => setPreviewSource(null))
  usePreventBackgroundScroll(visible, modalRef)
  useDialogFocusTrap(visible && !previewSource, modalRef)
  useDialogFocusTrap(visible && Boolean(previewSource), previewRef)

  if (!visible) return null

  const statusMetaClass = status === 'success'
    ? 'text-emerald-700 dark:text-emerald-300'
    : status === 'error'
      ? 'text-red-700 dark:text-red-300'
      : status === 'paused'
        ? 'text-amber-700 dark:text-amber-300'
      : running
        ? 'text-violet-700 dark:text-violet-300'
        : 'text-gray-500 dark:text-gray-400'

  return (
    <div className="ds-modal-layer fixed inset-0 flex items-center justify-center p-4 animate-overlay-in motion-reduce:animate-none" onMouseDown={(event) => {
      if (isModalBackdropEvent(event)) closeSafely()
    }}>
      <div className="ds-modal-scrim pointer-events-none absolute inset-0" />
      <div
        ref={modalRef}
        style={largeView ? LARGE_MODAL_SIZE_STYLE : { height: 'min(86vh, 820px)', maxWidth: '1024px' }}
        className="ds-modal-surface relative z-10 flex w-full flex-col overflow-hidden rounded-2xl border transition-[width,height,max-width] duration-200 ease-out animate-modal-in motion-reduce:animate-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gallery-sop-title"
      >
        <header className="flex items-center justify-between border-b border-gray-200/80 px-5 py-4 dark:border-white/[0.08] sm:px-6">
          <div>
            <h2 id="gallery-sop-title" className="flex items-center gap-2 text-lg font-semibold">
              <BookOpenCheck size={20} className="text-violet-600" />
              提示词仓库与生图
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {selectedSop
                ? `当前 SOP：${selectedSop.name} · ${targetCount} 条提示词 × 每条 ${targetImagesPerPrompt} 张 = 预计 ${totalImageCount} 张`
                : '无需加载 SOP，可直接查看、整理和复用程序之前保存的提示词。'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <LargeModalToggle largeView={largeView} dialogName="提示词管理" onToggle={toggleLargeView} />
            <button type="button" onClick={closeSafely} aria-label={status === 'paused' ? '转入后台保持 SOP 提示词暂停' : running ? '转入后台继续生成 SOP 提示词' : '关闭 SOP 提示词列表'} title={status === 'paused' ? '关闭后保持暂停，可稍后继续' : running ? '关闭后将在后台继续生成' : '关闭 SOP 提示词列表'} className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-gray-300 dark:hover:bg-white/[0.06]"><X size={18} /></button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col bg-gray-50/70 p-4 dark:bg-black/20 sm:p-5">
          <div aria-live="polite" className={`mb-4 rounded-xl border p-4 ${status === 'success' ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/25 dark:bg-emerald-500/[0.08]' : status === 'error' ? 'border-red-200 bg-red-50 dark:border-red-500/25 dark:bg-red-500/[0.08]' : status === 'paused' ? 'border-amber-200 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/[0.08]' : running ? 'border-violet-200 bg-violet-50 dark:border-violet-500/25 dark:bg-violet-500/[0.08]' : 'border-gray-200 bg-white dark:border-white/[0.1] dark:bg-white/[0.035]'}`}>
            <div className="grid items-center gap-3 lg:grid-cols-[minmax(18rem,1fr)_auto]">
              <div className="flex min-w-0 items-center gap-3 self-center">
                {status === 'paused' ? <Pause size={20} className="shrink-0 text-amber-600" /> : running ? <LoaderCircle size={20} className="shrink-0 animate-spin text-violet-600" /> : status === 'success' ? <CheckCircle2 size={20} className="shrink-0 text-emerald-600" /> : status === 'error' ? <XCircle size={20} className="shrink-0 text-red-600" /> : <ImageIcon size={20} className="shrink-0 text-gray-400" />}
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-5">{statusMessage}</p>
                  <p className={`mt-0.5 text-xs leading-5 ${statusMetaClass}`}>
                    {selectedSop
                      ? `请求 ${targetCount} · 智能生成 ${aiCount} · 当前可用 ${visiblePrompts.length} · 缺口 ${missingCount} · 预计图片 ${visiblePrompts.length * targetImagesPerPrompt}/${totalImageCount}`
                      : `仓库 ${recentRuns.length} 个提示词集 · 当前提示词 ${visiblePrompts.length} 条`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                {promptGenerationActive && <>
                  <button
                    type="button"
                    onClick={status === 'paused' ? resumePromptGeneration : pausePromptGeneration}
                    aria-label={status === 'paused' ? '继续提示词生成' : '暂停提示词生成'}
                    className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-200 bg-white px-3 text-xs font-medium text-amber-700 transition hover:border-amber-300 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-500/30 dark:bg-white/[0.06] dark:text-amber-200 dark:hover:bg-amber-500/10"
                  >
                    {status === 'paused' ? <Play size={14} /> : <Pause size={14} />}
                    {status === 'paused' ? '继续' : '暂停'}
                  </button>
                  <button
                    type="button"
                    onClick={cancelPromptGeneration}
                    aria-label="取消提示词生成"
                    className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-red-200 bg-white px-3 text-xs font-medium text-red-700 transition hover:border-red-300 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:border-red-500/30 dark:bg-white/[0.06] dark:text-red-200 dark:hover:bg-red-500/10"
                  >
                    <XCircle size={14} />
                    取消
                  </button>
                </>}
                {sources.length > 0 && selectedSop && <button
                  type="button"
                  onClick={() => void generatePromptList()}
                  disabled={running}
                  aria-label={`重新生成 ${targetCount} 条 SOP 提示词`}
                  className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-violet-200 bg-white px-3 text-xs font-medium text-violet-700 transition hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-violet-500/30 dark:bg-white/[0.06] dark:text-violet-200 dark:hover:bg-violet-500/10"
                >
                  <Sparkles size={14} />
                  重新生成提示词
                </button>}
                {selectedSop && <>
                  <Switch
                    checked={autoGenerate}
                    onCheckedChange={toggleAutoGenerate}
                    disabled={running}
                    aria-label="每生成一条提示词立即发送生图"
                    label={<span className="whitespace-nowrap text-xs">逐条生成并生图</span>}
                    className="h-9 rounded-lg border border-gray-200 bg-white px-3 dark:border-white/[0.12] dark:bg-white/[0.06]"
                  />
                  <Switch
                    checked={secondReference}
                    onCheckedChange={toggleSecondReference}
                    disabled={running}
                    aria-label="实际生图时再次使用输入区参考图"
                    title="开启后，参考图先用于生成提示词，并在实际生图时再次传入"
                    label={<span className="whitespace-nowrap text-xs">二次参考</span>}
                    className="h-9 rounded-lg border border-gray-200 bg-white px-3 dark:border-white/[0.12] dark:bg-white/[0.06]"
                  />
                  <button
                    type="button"
                    aria-label={activeRunSubmittedRef.current ? '当前 SOP 生图任务已发送' : `生成 ${visiblePrompts.length * targetImagesPerPrompt} 张图片`}
                    onClick={() => void submitPromptList()}
                    disabled={running || visiblePrompts.length === 0 || missingCount > 0 || activeRunSubmittedRef.current}
                    className="flex h-9 items-center gap-2 whitespace-nowrap rounded-lg border border-violet-600 bg-violet-600 px-3 text-xs font-medium text-white transition hover:border-violet-700 hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:border-violet-200 disabled:bg-violet-50 disabled:text-violet-300 dark:disabled:border-violet-500/20 dark:disabled:bg-violet-500/10 dark:disabled:text-violet-400/60"
                  >
                    <Send size={14} />
                    {activeRunSubmittedRef.current ? `已发送 ${visiblePrompts.length * targetImagesPerPrompt} 张` : `生成 ${visiblePrompts.length * targetImagesPerPrompt} 张图片`}
                  </button>
                </>}
              </div>
            </div>
            {error && <p role="alert" className="mt-2 text-xs leading-5 text-red-700 dark:text-red-300">{error}</p>}
            {selectedSop && totalImageCount >= SOP_HIGH_VOLUME_WARNING_THRESHOLD && <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">本次预计生成 {totalImageCount} 张图片，可能产生较高费用，请确认数量后再提交。</p>}
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.1] dark:bg-gray-900 md:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-b border-gray-200 bg-gray-50/70 dark:border-white/[0.08] dark:bg-gray-950/60 md:border-b-0 md:border-r">
              <div className="border-b border-gray-200 p-3 dark:border-white/[0.08]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">提示词仓库</h3>
                    <p className="mt-0.5 text-[11px] text-gray-500">{recentRuns.length} 个持久化提示词集</p>
                  </div>
                  <button type="button" onClick={() => void createPromptCollection()} disabled={running} aria-label="新建提示词集" className="flex h-8 items-center gap-1.5 rounded-lg bg-violet-600 px-2.5 text-xs font-medium text-white transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40"><Plus size={13} />新建</button>
                </div>
                <label className="mt-3 flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-100 dark:border-white/[0.1] dark:bg-gray-900 dark:focus-within:ring-violet-950">
                  <Search size={14} className="shrink-0 text-gray-400" />
                  <input value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} aria-label="搜索提示词仓库" placeholder="搜索名称、SOP 或内容" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-gray-400" />
                </label>
                <button type="button" onClick={() => setFavoritesOnly((current) => !current)} aria-pressed={favoritesOnly} className={`mt-2 flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${favoritesOnly ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]'}`}><Bookmark size={13} fill={favoritesOnly ? 'currentColor' : 'none'} />仅看收藏</button>
              </div>

              <div role="list" aria-label="提示词仓库列表" className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                {filteredRuns.map((run) => {
                  const available = run.prompts.filter((item) => !item.deleted && item.text.trim()).length
                  const selected = run.id === activeRunId
                  return (
                    <article role="listitem" key={run.id} className={`group grid grid-cols-[2.25rem_minmax(0,1fr)_2rem] items-center gap-2 rounded-xl border p-2 transition ${selected ? 'border-violet-300 bg-violet-50 shadow-sm dark:border-violet-500/40 dark:bg-violet-500/10' : 'border-transparent hover:border-gray-200 hover:bg-white dark:hover:border-white/[0.08] dark:hover:bg-white/[0.04]'}`}>
                      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${selected ? 'bg-violet-600 text-white' : 'bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-300'}`}><BookOpenCheck size={16} /></div>
                      <button type="button" onClick={() => void applyPromptRun(run, `已打开提示词集「${getPromptRunTitle(run)}」`)} disabled={running || selected} aria-label={`查看提示词集 ${getPromptRunTitle(run)}`} className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-default">
                        <span className="block truncate text-xs font-semibold">{getPromptRunTitle(run)}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-gray-500 dark:text-gray-400">{run.sop.name} · {available} 条 · {getRunStatusLabel(run)}</span>
                        <span className="mt-0.5 block text-[10px] text-gray-400">{new Date(getRunUpdatedAt(run)).toLocaleString()}</span>
                      </button>
                      <button type="button" onClick={() => void toggleRunPinned(run)} disabled={running} aria-label={run.pinned ? `取消收藏 ${getPromptRunTitle(run)}` : `收藏 ${getPromptRunTitle(run)}`} aria-pressed={Boolean(run.pinned)} className={`flex h-8 w-8 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-40 ${run.pinned ? 'text-amber-500' : 'text-gray-300 hover:bg-gray-100 hover:text-gray-500 dark:text-gray-600 dark:hover:bg-white/[0.06]'}`}><Bookmark size={14} fill={run.pinned ? 'currentColor' : 'none'} /></button>
                    </article>
                  )
                })}
                {filteredRuns.length === 0 && (
                  <div className="flex min-h-40 flex-col items-center justify-center px-4 text-center text-gray-500">
                    <BookOpenCheck size={22} />
                    <p className="mt-2 text-xs font-medium">{recentRuns.length ? '没有匹配的提示词集' : '提示词仓库还是空的'}</p>
                    <p className="mt-1 text-[11px] leading-5">{recentRuns.length ? '试试其他关键词或关闭收藏筛选。' : '新建一个，或从 SOP 生成后自动保存。'}</p>
                  </div>
                )}
              </div>
            </aside>

            <section className="flex min-h-0 min-w-0 flex-col">
              {activeRun || sources.length > 0 ? (
                <>
                  <div className="border-b border-gray-200 p-4 dark:border-white/[0.08]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-[16rem] flex-1">
                        <input value={runTitle} onChange={(event) => updateActiveRunMetadata({ title: event.target.value })} disabled={running} aria-label="提示词集名称" placeholder="未命名提示词集" className="w-full border-0 bg-transparent p-0 text-base font-semibold outline-none placeholder:text-gray-400 focus:ring-0 disabled:opacity-60" />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {activeRun?.sop.name ?? selectedSop?.name ?? '独立提示词集'} · {visiblePrompts.length} 条提示词 · {activeRun ? getRunStatusLabel(activeRun) : '编辑中'}
                          {activeRun ? ` · ${new Date(getRunUpdatedAt(activeRun)).toLocaleString()}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {status === 'paused'
                          ? <span className="mr-1 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"><Pause size={13} />已暂停</span>
                          : running && <span className="mr-1 flex items-center gap-1.5 rounded-lg bg-violet-50 px-2 py-1.5 text-xs text-violet-700 dark:bg-violet-950/30 dark:text-violet-300"><LoaderCircle size={13} className="animate-spin" />处理中</span>}
                        <button type="button" onClick={() => void toggleActiveRunPinned()} disabled={running || !activeRun} aria-label={activeRun?.pinned ? '取消收藏当前提示词集' : '收藏当前提示词集'} aria-pressed={Boolean(activeRun?.pinned)} title={activeRun?.pinned ? '取消收藏' : '收藏'} className={`flex h-9 w-9 items-center justify-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-40 ${activeRun?.pinned ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06]'}`}><Bookmark size={15} fill={activeRun?.pinned ? 'currentColor' : 'none'} /></button>
                        <button type="button" onClick={() => void copyActivePrompts()} disabled={running || visiblePrompts.length === 0} aria-label="复制全部提示词" title="复制全部" className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"><Copy size={15} /></button>
                        <button type="button" onClick={() => void duplicateActiveRun()} disabled={running || !activeRun} aria-label="复制当前提示词集为副本" title="创建副本" className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"><Plus size={15} /></button>
                        <button type="button" onClick={() => activeRun && void deleteRun(activeRun)} disabled={running || !activeRun || Boolean(activeRun?.taskIds?.length || activeRun?.batchId)} aria-label="删除当前提示词集" title={activeRun?.taskIds?.length || activeRun?.batchId ? '已关联生图任务，不能删除' : '删除提示词集'} className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-red-950/30"><Trash2 size={15} /></button>
                      </div>
                    </div>
                    <label className="mt-3 block">
                      <span className="mb-1 block text-[11px] font-medium text-gray-500">本次要求 / 说明</span>
                      <textarea value={brief} onChange={(event) => updateActiveRunMetadata({ brief: event.target.value })} disabled={running} rows={2} aria-label="提示词集说明" placeholder="记录用途、风格、限制或其他上下文" className="min-h-14 w-full resize-y rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs leading-5 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:opacity-60 dark:border-white/[0.1] dark:bg-gray-950 dark:focus:ring-violet-950" />
                    </label>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {sources.map((sourceRun) => {
                const sourcePrompts = prompts.filter((item) => item.sourceId === sourceRun.source.id && !item.deleted)
                const sourceAvailable = sourcePrompts.filter((item) => item.promptText.trim()).length
                const sourceMissing = Math.max(0, sourceRun.requestedCount - sourceAvailable)
                const canRetrySource = Boolean(selectedSop && sourceMissing > 0 && sourceRun.status !== 'running')
                return (
                  <article key={sourceRun.source.id} className="mb-4 overflow-hidden rounded-xl border border-gray-200 dark:border-white/[0.1]">
                    <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-white/[0.08] dark:bg-gray-950">
                      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg"><SourceThumb source={sourceRun.source} /></div>
                      <div className="min-w-[12rem] flex-1">
                        <h4 className="truncate text-sm font-semibold">{sourceRun.source.label}</h4>
                        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                          目标 {sourceRun.requestedCount} 条 · 已有 {sourceAvailable} 条
                          {sourceMissing > 0 ? ` · 待补 ${sourceMissing} 条` : ''}
                        </p>
                        {sourceRun.error && <p className="mt-1 text-xs leading-5 text-red-600 dark:text-red-300">{sourceRun.error}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        {sourceRun.status === 'running' && <span className="flex items-center gap-1.5 text-xs text-violet-700 dark:text-violet-300"><LoaderCircle size={13} className="animate-spin" />生成中</span>}
                        {canRetrySource && (
                          <button type="button" onClick={() => void generateForSources(sourceRun.source.id)} disabled={running} className="flex h-8 items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-2.5 text-xs font-medium text-violet-700 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-violet-500/30 dark:bg-gray-900 dark:text-violet-200 dark:hover:bg-violet-500/10"><RefreshCw size={13} />补齐 {sourceMissing} 条</button>
                        )}
                        <button type="button" onClick={() => addManualPrompt(sourceRun.source.id)} disabled={running} className="flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.1] dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.06]"><Plus size={13} />新增提示词</button>
                      </div>
                    </div>
                    <div className="space-y-3 p-3">
                      {sourcePrompts.map((item, index) => {
                        const referenceSources = getPromptReferenceSources(item)
                        return (
                          <div key={item.id} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-white/[0.08] dark:bg-gray-900">
                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${item.origin === 'ai' ? 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'}`}>{index + 1}</span>
                            <div className="min-w-0 flex-1">
                              <textarea value={item.promptText} onChange={(event) => updatePrompts((current) => current.map((entry) => entry.id === item.id ? { ...entry, promptText: event.target.value, edited: true } : entry))} rows={5} disabled={running} aria-label={`第 ${index + 1} 条提示词`} className="min-h-32 w-full resize-y rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm leading-6 text-gray-900 outline-none transition focus:border-violet-500 focus:bg-white focus:ring-2 focus:ring-violet-100 disabled:opacity-60 dark:border-white/[0.1] dark:bg-gray-950 dark:text-gray-100 dark:focus:ring-violet-950" />
                              {referenceSources.length > 0 && (
                                <div className="mt-2 flex min-w-0 items-center gap-2">
                                  <span className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">参考图</span>
                                  <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-1">
                                    {referenceSources.map((referenceSource, referenceIndex) => (
                                      <button
                                        key={referenceSource.imageId ?? referenceSource.id}
                                        type="button"
                                        onClick={() => setPreviewSource(referenceSource)}
                                        aria-label={`查看第 ${index + 1} 条提示词的参考图 ${referenceIndex + 1} 大图`}
                                        title={`${referenceSource.label} · 点击查看大图`}
                                        className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-100 transition hover:border-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-white/[0.12] dark:bg-gray-800"
                                      >
                                        <SourceThumb source={referenceSource} />
                                      </button>
                                    ))}
                                  </div>
                                  <span className="shrink-0 text-[11px] text-gray-400">{referenceSources.length} 张</span>
                                </div>
                              )}
                              <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">{item.edited ? '已编辑' : item.origin === 'ai' ? '智能生成' : '手动添加'} · 已自动保存 · {item.promptText.trim().length} 字</p>
                            </div>
                            <div className="flex items-center gap-1">
                              {selectedSop && <button type="button" onClick={() => void regeneratePrompt(item)} disabled={running} aria-label={`重新生成第 ${index + 1} 条提示词`} title="重新生成" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-violet-50 hover:text-violet-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-violet-950/30"><RefreshCw size={15} /></button>}
                              <button type="button" onClick={() => updatePrompts((current) => current.map((entry) => entry.id === item.id ? { ...entry, deleted: true } : entry))} disabled={running} aria-label={`删除第 ${index + 1} 条提示词`} title="删除提示词" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-950/30"><Trash2 size={15} /></button>
                            </div>
                          </div>
                        )
                      })}
                      {!sourcePrompts.length && <p className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-xs text-gray-500 dark:border-white/[0.1]">当前没有提示词，可点击“新增提示词”手动添加。</p>}
                    </div>
                  </article>
                )
              })}
              {!sources.length && (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 px-6 text-center text-gray-500 dark:border-white/[0.1]">
                  <BookOpenCheck size={26} />
                  <p className="mt-3 text-sm font-medium">这个提示词集还没有内容</p>
                  <p className="mt-1 max-w-md text-xs leading-5">可以从 SOP 生成，也可以新建独立提示词集后手动整理。</p>
                  <div className="mt-4 flex items-center gap-2">
                    <button type="button" onClick={() => void createPromptCollection()} disabled={running} className="flex h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-40 dark:border-white/[0.1] dark:bg-gray-900 dark:text-gray-200"><Plus size={14} />新建提示词集</button>
                    {selectedSop && (
                      <button type="button" onClick={() => void generatePromptList()} disabled={running} aria-label={`生成 ${targetCount} 条 SOP 提示词`} className="flex h-9 items-center gap-2 rounded-lg bg-violet-600 px-4 text-xs font-medium text-white transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-violet-200 dark:disabled:bg-violet-500/20 dark:disabled:text-violet-300"><Sparkles size={14} />生成 {targetCount} 条提示词</button>
                    )}
                  </div>
                </div>
              )}
                  </div>
                </>
              ) : (
                <div className="flex min-h-64 flex-1 flex-col items-center justify-center px-6 text-center text-gray-500">
                  <BookOpenCheck size={28} />
                  <p className="mt-3 text-sm font-medium">{recentRuns.length ? '从左侧选择一个提示词集' : '建立你的第一个提示词集'}</p>
                  <p className="mt-1 max-w-md text-xs leading-5">{recentRuns.length ? '右侧会显示完整提示词、说明与可复用操作。' : '提示词会持久化保存在本机应用数据中，不依赖当前是否加载 SOP。'}</p>
                  <button type="button" onClick={() => void createPromptCollection()} disabled={running} className="mt-4 flex h-9 items-center gap-2 rounded-lg bg-violet-600 px-4 text-xs font-medium text-white transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-40"><Plus size={14} />新建提示词集</button>
                  {selectedSop && <button type="button" onClick={() => void generatePromptList()} disabled={running} aria-label={`生成 ${targetCount} 条 SOP 提示词`} className="mt-2 flex h-9 items-center gap-2 rounded-lg border border-violet-200 bg-white px-4 text-xs font-medium text-violet-700 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-40 dark:border-violet-500/30 dark:bg-gray-900 dark:text-violet-200"><Sparkles size={14} />从当前 SOP 生成</button>}
                </div>
              )}
            </section>
          </div>
        </div>
        {previewSource && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 p-4"
            onMouseDown={(event) => {
              if (isModalBackdropEvent(event)) setPreviewSource(null)
            }}
          >
            <div
              ref={previewRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="gallery-sop-reference-preview-title"
              className="flex h-[min(82vh,860px)] w-[min(92vw,1200px)] max-w-full flex-col overflow-hidden rounded-2xl bg-gray-950 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white">
                <div className="min-w-0">
                  <h3 id="gallery-sop-reference-preview-title" className="truncate text-sm font-semibold">{previewSource.label}</h3>
                  <p className="mt-0.5 text-xs text-gray-400">提示词对应参考图 · 原图适应窗口显示</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewSource(null)}
                  aria-label="关闭参考图大图预览"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="min-h-0 flex-1 p-4">
                <SourceThumb source={previewSource} fit="contain" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
