import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookmarkIcon as Bookmark,
  BookOpenCheckIcon as BookOpenCheck,
  CheckCircleIcon as CheckCircle2,
  CloseIcon as X,
  HistoryIcon as History,
  ImageIcon,
  LoaderCircleIcon as LoaderCircle,
  PlusIcon as Plus,
  RefreshIcon as RefreshCw,
  SendIcon as Send,
  SparklesIcon as Sparkles,
  TrashIcon as Trash2,
  XCircleIcon as XCircle,
} from '../../../design-system/icons'
import { ensureImageCached, submitTaskWithData, useStore } from '../../../store'
import type { InputImage, SopBatchSnapshot } from '../../../types'
import { MAX_ALL_REFERENCE_IMAGES } from '../../../lib/inputImageLimits'
import { deleteSopBatchSnapshot, getAllSopBatchSnapshots, getSopBatchSnapshot, putSopBatchSnapshot } from '../../../lib/db'
import { useRequirementPrototype } from '../../requirementPrototype/store'
import {
  getSopRunCounts,
  getSopTotalImageCount,
  normalizeSopPromptCandidates,
  selectSharedSopPromptSources,
  SOP_HIGH_VOLUME_WARNING_THRESHOLD,
} from '../sopPromptBatch'
import { generatePromptsFromSopStore } from './storeSopGeneration'
import { useCloseOnEscape } from '../../../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../../../hooks/usePreventBackgroundScroll'
import { Switch, useDialogFocusTrap } from '../../../design-system'

type BatchStatus = 'idle' | 'generating' | 'ready' | 'submitting' | 'success' | 'error'
type SourceStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed'

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
  promptText: string
  origin: 'ai' | 'manual'
  edited?: boolean
  deleted?: boolean
}

type PersistedSopPromptRun = {
  version?: 2 | 3
  activeRunId?: string
  selectedSopId: string
  promptCount: number
  imagesPerPrompt: number
  availablePrompts?: number
  quantity?: number
  brief: string
  autoGenerate?: boolean
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

function getRunUpdatedAt(run: SopBatchSnapshot) {
  return run.updatedAt ?? run.createdAt
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

function SourceThumb({ source }: { source: SopPromptSource }) {
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
    ? <img src={dataUrl} alt={source.label} className="h-full w-full object-cover" />
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
  autoStart = false,
  workspaceTabId,
  visible = true,
  onBackground,
  onStatusChange,
}: {
  onClose: () => void
  initialSopId?: string
  initialQuantity?: number
  initialPromptCount?: number
  initialImagesPerPrompt?: number
  initialBrief?: string
  initialAutoGenerate?: boolean
  autoStart?: boolean
  workspaceTabId?: string | null
  visible?: boolean
  onBackground?: () => void
  onStatusChange?: (status: GallerySopRunStatus) => void
}) {
  const items = useRequirementPrototype((state) => state.sopLibrary)
  const params = useStore((state) => state.params)
  const inputImages = useStore((state) => state.inputImages)
  const inputImageFolder = useStore((state) => state.inputImageFolder)
  const customOutputPath = useStore((state) => state.customOutputPath)
  const activeWorkspaceTabId = useStore((state) => state.activeWorkspaceTabId)
  const workspaceTabs = useStore((state) => state.workspaceTabs)
  const showToast = useStore((state) => state.showToast)
  const setInputImages = useStore((state) => state.setInputImages)
  const setInputImageFolder = useStore((state) => state.setInputImageFolder)
  const setParams = useStore((state) => state.setParams)
  const selectedSopId = initialSopId
  const [promptCount, setPromptCount] = useState(initialPromptCount)
  const [imagesPerPrompt, setImagesPerPrompt] = useState(initialImagesPerPrompt)
  const [brief, setBrief] = useState(initialBrief)
  const [autoGenerate, setAutoGenerate] = useState(initialAutoGenerate)
  const [sources, setSources] = useState<SourceRun[]>([])
  const [prompts, setPrompts] = useState<PromptDraft[]>([])
  const [status, setStatus] = useState<BatchStatus>('idle')
  const [statusMessage, setStatusMessage] = useState('提示词列表为空，可从输入区主按钮生成')
  const [error, setError] = useState('')
  const [activeRunId, setActiveRunId] = useState(promptRunId)
  const [recentRuns, setRecentRuns] = useState<SopBatchSnapshot[]>([])
  const [showRunHistory, setShowRunHistory] = useState(false)
  const [restoreComplete, setRestoreComplete] = useState(false)
  const autoStartRef = useRef(false)
  const autoGenerateRef = useRef(initialAutoGenerate)
  const activeRunIdRef = useRef(activeRunId)
  const activeRunSubmittedRef = useRef(false)
  const pendingSnapshotRef = useRef<SopBatchSnapshot | null>(null)
  const snapshotTimerRef = useRef<number | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  const selectedSop = items.find((item) => item.id === selectedSopId)
  const running = status === 'generating' || status === 'submitting'
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
  const selectedSources = useMemo(() => selectSharedSopPromptSources(allSources), [allSources])
  const sharedSource = useMemo<SopPromptSource>(() => {
    const firstImage = selectedSources.find((source) => source.kind === 'image')
    return firstImage
      ? { ...firstImage, id: 'shared-reference', label: `共同参考 · ${selectedSources.length} 张` }
      : { id: 'text-to-image', label: '文生图（无参考图）', kind: 'text' }
  }, [selectedSources])
  const visiblePrompts = prompts.filter((item) => !item.deleted && item.promptText.trim())
  const aiCount = prompts.filter((item) => !item.deleted && item.origin === 'ai' && item.promptText.trim()).length
  const missingCount = Math.max(0, targetCount - visiblePrompts.length)
  const activeRun = recentRuns.find((run) => run.id === activeRunId)

  const setCurrentRunId = (id: string, submitted = false) => {
    activeRunIdRef.current = id
    activeRunSubmittedRef.current = submitted
    setActiveRunId(id)
  }

  const updateRecentRun = (snapshot: SopBatchSnapshot) => {
    setRecentRuns((current) => [snapshot, ...current.filter((item) => item.id !== snapshot.id)]
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || getRunUpdatedAt(b) - getRunUpdatedAt(a))
      .slice(0, 30))
  }

  const writeRunPointer = (
    runId: string,
    nextPrompts: PromptDraft[],
    nextAutoGenerate = autoGenerate,
    nextBrief = brief,
    nextPromptCount = targetCount,
    nextImagesPerPrompt = targetImagesPerPrompt,
  ) => {
    window.localStorage.setItem(promptRunStorageKey, JSON.stringify({
      version: 3,
      activeRunId: runId,
      selectedSopId,
      promptCount: nextPromptCount,
      imagesPerPrompt: nextImagesPerPrompt,
      availablePrompts: nextPrompts.filter((item) => !item.deleted && item.promptText.trim()).length,
      brief: nextBrief,
      autoGenerate: nextAutoGenerate,
    } satisfies PersistedSopPromptRun))
  }

  const buildPromptRunSnapshot = (
    runId: string,
    nextPrompts: PromptDraft[],
    nextSources: SourceRun[],
    runStatus: NonNullable<SopBatchSnapshot['status']>,
    patch: Partial<SopBatchSnapshot> = {},
  ): SopBatchSnapshot | null => {
    if (!selectedSop) return null
    const previous = recentRuns.find((item) => item.id === runId)
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
      sop: {
        id: selectedSop.id,
        name: selectedSop.name,
        description: selectedSop.description,
        content: selectedSop.content,
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
        deleted: Boolean(item.deleted),
      })),
      params: { ...params, n: targetImagesPerPrompt, reference_mode: 'all' },
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

  const applyPromptRun = async (run: SopBatchSnapshot, message: string) => {
    const sourceId = run.referenceImageIds.length ? 'shared-reference' : 'text-to-image'
    const restoredPrompts: PromptDraft[] = run.prompts.map((item) => ({
      id: item.id,
      sourceId: item.sourceId ?? sourceId,
      promptText: item.text,
      origin: item.origin,
      edited: item.edited,
      deleted: item.deleted,
    }))
    const restoredSource: SopPromptSource = run.referenceImageIds.length
      ? {
          id: 'shared-reference',
          label: `共同参考 · ${run.referenceImageIds.length} 张`,
          kind: 'image',
          imageId: run.referenceImageIds[0],
        }
      : { id: 'text-to-image', label: '文生图（无参考图）', kind: 'text' }
    const restoredSources: SourceRun[] = [{
      source: restoredSource,
      requestedCount: run.promptCount,
      status: 'completed',
      attempts: 0,
    }]
    const restoredImages = (await Promise.all(run.referenceImageIds.map(async (imageId): Promise<InputImage | null> => {
      const dataUrl = await ensureImageCached(imageId)
      return dataUrl ? { id: imageId, dataUrl } : null
    }))).filter((image): image is InputImage => Boolean(image))

    setCurrentRunId(run.id, run.status === 'submitted' || Boolean(run.batchId))
    setPromptCount(run.promptCount || restoredPrompts.filter((item) => !item.deleted && item.promptText.trim()).length || initialPromptCount)
    setImagesPerPrompt(run.imagesPerPrompt || initialImagesPerPrompt)
    setBrief(run.brief)
    setSources(restoredSources)
    setPrompts(restoredPrompts)
    setParams(run.params)
    setInputImageFolder(null)
    setInputImages(restoredImages)
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
    if (restoredImages.length !== run.referenceImageIds.length) {
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
      const matchingRuns = allRuns
        .filter((run) => run.sop.id === selectedSopId)
        .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || getRunUpdatedAt(b) - getRunUpdatedAt(a))
        .slice(0, 30)
      setRecentRuns(matchingRuns)

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
          await applyPromptRun(storedRun, `已恢复上次 SOP 提示词列表，当前可用 ${storedRun.prompts.filter((item) => !item.deleted && item.text.trim()).length} 条`)
          if (active) setRestoreComplete(true)
          return
        }
      }

      const legacyPrompts = persisted?.selectedSopId === selectedSopId && Array.isArray(persisted.prompts)
        ? persisted.prompts
        : []
      if (legacyPrompts.length > 0) {
        const legacySources = Array.isArray(persisted?.sources) ? persisted.sources : []
        const migratedRunId = promptRunId()
        setCurrentRunId(migratedRunId)
        setPromptCount(persisted?.promptCount ?? persisted?.quantity ?? initialPromptCount)
        setImagesPerPrompt(persisted?.imagesPerPrompt ?? initialImagesPerPrompt)
        setBrief(typeof persisted?.brief === 'string' ? persisted.brief : initialBrief)
        if (typeof persisted?.autoGenerate === 'boolean') {
          autoGenerateRef.current = persisted.autoGenerate
          setAutoGenerate(persisted.autoGenerate)
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
    }
  }, [promptRunStorageKey, selectedSopId])

  useEffect(() => () => {
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

  const closeSafely = () => {
    if (running) {
      onBackground?.()
      showToast('SOP 提示词正在后台生成，可随时从当前标签页的列表继续查看', 'success')
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

  const deleteRun = async (run: SopBatchSnapshot) => {
    if (run.taskIds?.length || run.batchId) {
      showToast('该运行记录已关联生图任务，不能直接删除', 'info')
      return
    }
    if (!window.confirm(`删除这次包含 ${run.promptCount} 条提示词的运行记录吗？`)) return
    await deleteSopBatchSnapshot(run.id)
    setRecentRuns((current) => current.filter((item) => item.id !== run.id))
    if (run.id === activeRunIdRef.current) {
      const newRunId = promptRunId()
      setCurrentRunId(newRunId)
      setSources([])
      setPrompts([])
      setStatus('idle')
      setStatusMessage('提示词列表为空，可从输入区主按钮生成')
      writeRunPointer(newRunId, [])
    }
    showToast('SOP 运行记录已删除', 'success')
  }

  const updatePrompts = (updater: (current: PromptDraft[]) => PromptDraft[]) => {
    setPrompts((current) => {
      const next = updater(current)
      persistPromptRun(next)
      return next
    })
  }

  const loadSharedInputImages = async () => {
    const imageSources = selectedSources.filter((source) => source.kind === 'image' && source.imageId)
    if (imageSources.length > MAX_ALL_REFERENCE_IMAGES) {
      throw new Error(`共同参考图最多支持 ${MAX_ALL_REFERENCE_IMAGES} 张，当前为 ${imageSources.length} 张`)
    }
    const loaded = await Promise.all(imageSources.map(async (source): Promise<InputImage | null> => {
      if (!source.imageId) return null
      const dataUrl = source.dataUrl ?? await ensureImageCached(source.imageId)
      return dataUrl ? { id: source.imageId, dataUrl } : null
    }))
    if (loaded.some((image) => !image)) throw new Error('部分共同参考图已不存在，请移除后重试')
    return loaded.filter((image): image is InputImage => Boolean(image))
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
    if (requestedImageCount >= SOP_HIGH_VOLUME_WARNING_THRESHOLD && !window.confirm(`本次将生成 ${requestedImageCount} 张图片，可能产生较高费用。确认继续提交吗？`)) {
      setStatus('ready')
      setStatusMessage('已取消高数量生图提交')
      return
    }
    setStatus('submitting')
    setError('')
    setStatusMessage(`正在提交 ${usablePrompts.length} 条提示词，预计生成 ${requestedImageCount} 张图片`)
    const batchId = `sop-batch-${Date.now().toString(36)}`
    const snapshotId = activeRunIdRef.current
    let promptInputImages: InputImage[]
    let submittingSnapshot: SopBatchSnapshot | null = null
    try {
      promptInputImages = await loadSharedInputImages()
      await flushPromptRunSnapshot()
      const existingSnapshot = await getSopBatchSnapshot(snapshotId)
      submittingSnapshot = buildPromptRunSnapshot(snapshotId, itemsToSubmit, sources, 'ready', {
        batchId,
        batchIds: [...new Set([...(existingSnapshot?.batchIds ?? (existingSnapshot?.batchId ? [existingSnapshot.batchId] : [])), batchId])],
        taskIds: existingSnapshot?.taskIds ?? [],
        pinned: existingSnapshot?.pinned ?? false,
        referenceImageIds: promptInputImages.map((image) => image.id),
      })
      await flushPromptRunSnapshot(submittingSnapshot)
    } catch (cause) {
      setStatus('error')
      setStatusMessage('批次提交前检查失败')
      setError(cause instanceof Error ? cause.message : '共同参考图或批次快照保存失败')
      return
    }
    const results = await Promise.allSettled(usablePrompts.map(async (item, index) => {
      return submitTaskWithData({
        prompt: item.promptText.trim(),
        inputImages: promptInputImages,
        inputImageFolder: null,
        params: { ...params, n: targetImagesPerPrompt, reference_mode: 'all' },
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
  }

  const generateForSources = async (retrySourceId?: string) => {
    if (!selectedSop) {
      setStatus('error')
      setStatusMessage('无法生成提示词')
      setError('请先选择一个 SOP')
      return
    }
    const previous = sources.find((entry) => entry.source.id === sharedSource.id)
    const plannedSources: SourceRun[] = [{
      source: sharedSource,
      requestedCount: targetCount,
      status: 'running',
      attempts: (previous?.attempts ?? 0) + 1,
    }]
    setSources(plannedSources)
    setStatus('generating')
    setStatusMessage(retrySourceId ? `正在重试提示词缺口` : sharedSource.kind === 'text' ? `正在生成 ${targetCount} 条文生图提示词` : `正在使用 ${selectedSources.length} 张共同参考图生成 ${targetCount} 条提示词`)
    setError('')
    persistPromptRun(retrySourceId ? prompts : [], plannedSources, autoGenerate, 'generating')
    const existingPrompts = prompts.filter((item) => !item.deleted && item.promptText.trim()).map((item) => item.promptText.trim())
    const nextPrompts = retrySourceId ? [...prompts] : []
    const nextSources = [...plannedSources]
    const existingForSource = nextPrompts.filter((item) => !item.deleted && item.promptText.trim()).map((item) => item.promptText.trim())
    const deficit = Math.max(0, targetCount - existingForSource.length)
    if (deficit > 0) {
      try {
        const sharedImages = await loadSharedInputImages()
        const generated = await generatePromptsFromSopStore(selectedSop, deficit, brief, {
          context: {
            sourceLabel: sharedImages.length ? `共同参考图（${sharedImages.length} 张）` : undefined,
            totalPromptCount: targetCount,
          },
          referenceImages: sharedImages.length
            ? sharedImages.map((image, index) => ({ name: `图${index + 1}`, dataUrl: image.dataUrl }))
            : undefined,
          exact: false,
          existingPrompts: [...existingPrompts, ...nextPrompts.map((item) => item.promptText)],
          onProgress: (completed, total) => {
            setStatusMessage(`正在生成提示词 ${Math.min(existingForSource.length + completed, targetCount)}/${Math.min(existingForSource.length + total, targetCount)}`)
          },
        })
        const candidates = normalizeSopPromptCandidates(generated, deficit, [...existingPrompts, ...nextPrompts.map((item) => item.promptText)])
        nextPrompts.push(...candidates.map((prompt) => ({
          id: promptItemId(sharedSource.id),
          sourceId: sharedSource.id,
          promptText: prompt,
          origin: 'ai' as const,
        })))
        nextSources[0] = { ...nextSources[0], status: candidates.length >= deficit ? 'completed' : 'partial', error: candidates.length >= deficit ? undefined : `缺少 ${deficit - candidates.length} 条` }
      } catch (cause) {
        nextSources[0] = { ...nextSources[0], status: 'failed', error: cause instanceof Error ? cause.message : '提示词生成失败' }
      }
    }

    setPrompts(nextPrompts)
    setSources(nextSources)
    const available = nextPrompts.filter((item) => !item.deleted && item.promptText.trim()).length
    const failed = nextSources.some((item) => item.status === 'failed') ? 1 : 0
    persistPromptRun(nextPrompts, nextSources, autoGenerate, failed && available === 0 ? 'failed' : 'ready')
    await flushPromptRunSnapshot()
    const missing = Math.max(0, targetCount - available)
    setStatus(failed || missing ? 'ready' : 'ready')
    setStatusMessage(missing ? `提示词列表部分完成：当前可用 ${available} 条，缺口 ${missing} 条` : `提示词列表已生成：当前可用 ${available} 条`)
    if (failed || missing) setError(failed ? '提示词生成失败，可重试缺口。' : '')
    if (autoGenerateRef.current && available > 0 && !missing && !retrySourceId) await submitPromptList(nextPrompts)
  }

  const generatePromptList = () => {
    if (running || !selectedSop) return
    if (visiblePrompts.length > 0 && !window.confirm('重新生成会替换当前提示词列表，是否继续？')) return
    void generateForSources()
  }

  const addManualPrompt = (sourceId: string) => {
    updatePrompts((current) => [...current, { id: promptItemId(sourceId), sourceId, promptText: '', origin: 'manual' }])
  }

  const regeneratePrompt = async (item: PromptDraft) => {
    if (!selectedSop || running) return
    if ((item.edited || item.origin === 'manual') && !window.confirm('重新生成会覆盖当前提示词，是否继续？')) return
    setStatus('generating')
    setStatusMessage('正在重新生成这一条提示词')
    setError('')
    try {
      const sharedImages = await loadSharedInputImages()
      const existingPrompts = prompts
        .filter((entry) => entry.id !== item.id && !entry.deleted && entry.promptText.trim())
        .map((entry) => entry.promptText.trim())
      const generated = await generatePromptsFromSopStore(selectedSop, 1, brief, {
        context: {
          sourceLabel: sharedImages.length ? `共同参考图（${sharedImages.length} 张）` : undefined,
          totalPromptCount: targetCount,
        },
        referenceImages: sharedImages.length
          ? sharedImages.map((image, index) => ({ name: `图${index + 1}`, dataUrl: image.dataUrl }))
          : undefined,
        exact: true,
        existingPrompts,
      })
      updatePrompts((current) => current.map((entry) => entry.id === item.id
        ? { ...entry, promptText: generated[0] ?? entry.promptText, origin: 'ai', edited: false }
        : entry))
      setStatus('ready')
      setStatusMessage(`已重新生成第 ${visiblePrompts.findIndex((entry) => entry.id === item.id) + 1} 条提示词`)
    } catch (cause) {
      setStatus('ready')
      setStatusMessage('单条提示词重新生成失败')
      setError(cause instanceof Error ? cause.message : '提示词重新生成失败')
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
    void generateForSources()
  }, [autoStart, restoreComplete, running, selectedSop, visiblePrompts.length])

  useCloseOnEscape(visible, closeSafely)
  usePreventBackgroundScroll(visible, modalRef)
  useDialogFocusTrap(visible, modalRef)

  if (!visible) return null

  const statusMetaClass = status === 'success'
    ? 'text-emerald-700 dark:text-emerald-300'
    : status === 'error'
      ? 'text-red-700 dark:text-red-300'
      : running
        ? 'text-violet-700 dark:text-violet-300'
        : 'text-gray-500 dark:text-gray-400'

  return (
    <div className="ds-modal-layer fixed inset-0 flex items-center justify-center p-4 animate-overlay-in motion-reduce:animate-none">
      <div className="ds-modal-scrim pointer-events-none absolute inset-0" />
      <div ref={modalRef} className="ds-modal-surface relative z-10 animate-modal-in motion-reduce:animate-none flex h-[min(88vh,920px)] w-full max-w-[1440px] flex-col overflow-hidden rounded-2xl border" role="dialog" aria-modal="true" aria-labelledby="gallery-sop-title">
        <header className="flex items-center justify-between border-b border-gray-200/80 px-5 py-4 dark:border-white/[0.08] sm:px-6">
          <div>
            <h2 id="gallery-sop-title" className="flex items-center gap-2 text-lg font-semibold">
              <BookOpenCheck size={20} className="text-violet-600" />
              SOP 生图工作台
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {selectedSop ? `当前 SOP：${selectedSop.name} · ${targetCount} 条提示词 × 每条 ${targetImagesPerPrompt} 张 = 预计 ${totalImageCount} 张` : '请先选择一个 SOP。'}
            </p>
          </div>
          <button type="button" onClick={closeSafely} aria-label={running ? '转入后台继续生成 SOP 提示词' : '关闭 SOP 提示词列表'} title={running ? '关闭后将在后台继续生成' : '关闭 SOP 提示词列表'} className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-gray-300 dark:hover:bg-white/[0.06]"><X size={18} /></button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col bg-gray-50/70 p-4 dark:bg-black/20 sm:p-5">
          <div aria-live="polite" className={`mb-4 rounded-xl border p-4 ${status === 'success' ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/25 dark:bg-emerald-500/[0.08]' : status === 'error' ? 'border-red-200 bg-red-50 dark:border-red-500/25 dark:bg-red-500/[0.08]' : running ? 'border-violet-200 bg-violet-50 dark:border-violet-500/25 dark:bg-violet-500/[0.08]' : 'border-gray-200 bg-white dark:border-white/[0.1] dark:bg-white/[0.035]'}`}>
            <div className="grid items-center gap-3 lg:grid-cols-[minmax(18rem,1fr)_auto]">
              <div className="flex min-w-0 items-center gap-3 self-center">
                {running ? <LoaderCircle size={20} className="shrink-0 animate-spin text-violet-600" /> : status === 'success' ? <CheckCircle2 size={20} className="shrink-0 text-emerald-600" /> : status === 'error' ? <XCircle size={20} className="shrink-0 text-red-600" /> : <ImageIcon size={20} className="shrink-0 text-gray-400" />}
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-5">{statusMessage}</p>
                  <p className={`mt-0.5 text-xs leading-5 ${statusMetaClass}`}>请求 {targetCount} · AI 成功 {aiCount} · 当前可用 {visiblePrompts.length} · 缺口 {missingCount} · 预计图片 {visiblePrompts.length * targetImagesPerPrompt}/{totalImageCount}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                {sources.length > 0 && <button
                  type="button"
                  onClick={generatePromptList}
                  disabled={running || !selectedSop}
                  aria-label={`重新生成 ${targetCount} 条 SOP 提示词`}
                  className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-violet-200 bg-white px-3 text-xs font-medium text-violet-700 transition hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-violet-500/30 dark:bg-white/[0.06] dark:text-violet-200 dark:hover:bg-violet-500/10"
                >
                  <Sparkles size={14} />
                  重新生成提示词
                </button>}
                <button type="button" onClick={() => setShowRunHistory((current) => !current)} aria-expanded={showRunHistory} className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-gray-200 dark:hover:bg-white/[0.1]"><History size={14} />最近运行 {recentRuns.length}</button>
                <button type="button" onClick={() => void toggleActiveRunPinned()} disabled={running || visiblePrompts.length === 0} aria-pressed={Boolean(activeRun?.pinned)} className={`flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40 ${activeRun?.pinned ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-white/[0.12] dark:bg-white/[0.06] dark:text-gray-200 dark:hover:bg-white/[0.1]'}`}><Bookmark size={14} fill={activeRun?.pinned ? 'currentColor' : 'none'} />{activeRun?.pinned ? '已收藏' : '收藏提示词集'}</button>
                <Switch
                  checked={autoGenerate}
                  onCheckedChange={toggleAutoGenerate}
                  disabled={running}
                  aria-label="提示词生成完成后自动生图"
                  label={<span className="whitespace-nowrap text-xs">自动生图</span>}
                  className="h-9 rounded-lg border border-gray-200 bg-white px-3 dark:border-white/[0.12] dark:bg-white/[0.06]"
                />
                <button type="button" aria-label={`生成 ${visiblePrompts.length * targetImagesPerPrompt} 张图片`} onClick={() => void submitPromptList()} disabled={running || visiblePrompts.length === 0 || missingCount > 0} className="flex h-9 items-center gap-2 whitespace-nowrap rounded-lg border border-violet-600 bg-violet-600 px-3 text-xs font-medium text-white transition hover:border-violet-700 hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:border-violet-200 disabled:bg-violet-50 disabled:text-violet-300 dark:disabled:border-violet-500/20 dark:disabled:bg-violet-500/10 dark:disabled:text-violet-400/60"><Send size={14} />生成 {visiblePrompts.length * targetImagesPerPrompt} 张图片</button>
              </div>
            </div>
            {error && <p role="alert" className="mt-2 text-xs leading-5 text-red-700 dark:text-red-300">{error}</p>}
            {totalImageCount >= SOP_HIGH_VOLUME_WARNING_THRESHOLD && <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">本次预计生成 {totalImageCount} 张图片，可能产生较高费用，请确认数量后再提交。</p>}
          </div>

          {showRunHistory && (
            <section className="mb-4 max-h-52 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 dark:border-white/[0.1] dark:bg-gray-900">
              <div className="mb-2 flex items-center justify-between"><div><h3 className="text-sm font-semibold">最近运行</h3><p className="mt-0.5 text-[11px] text-gray-500">加载历史记录可继续编辑；收藏的提示词集会固定在顶部。</p></div></div>
              <div className="space-y-2">
                {recentRuns.map((run) => {
                  const available = run.prompts.filter((item) => !item.deleted && item.text.trim()).length
                  return (
                    <div key={run.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${run.id === activeRunId ? 'border-violet-300 bg-violet-50/60 dark:border-violet-500/40 dark:bg-violet-950/20' : 'border-gray-200 dark:border-white/[0.08]'}`}>
                      <Bookmark size={14} className={run.pinned ? 'shrink-0 text-amber-500' : 'shrink-0 text-gray-300 dark:text-gray-600'} fill={run.pinned ? 'currentColor' : 'none'} />
                      <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{new Date(getRunUpdatedAt(run)).toLocaleString()} · {available} 条提示词</p><p className="mt-0.5 truncate text-[11px] text-gray-500">{run.brief || '未填写本次要求'} · {run.status ?? (run.batchId ? 'submitted' : 'ready')}</p></div>
                      <button type="button" onClick={() => void applyPromptRun(run, `已加载历史提示词列表，当前可用 ${available} 条`)} disabled={running || run.id === activeRunId} className="h-8 rounded-lg px-2 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-violet-300 dark:hover:bg-violet-950/40">加载</button>
                      <button type="button" onClick={() => void toggleRunPinned(run)} disabled={running} className="h-8 rounded-lg px-2 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-white/[0.06]">{run.pinned ? '取消收藏' : '收藏'}</button>
                      <button type="button" onClick={() => void deleteRun(run)} disabled={running || Boolean(run.taskIds?.length || run.batchId)} title={run.taskIds?.length || run.batchId ? '已关联生图任务，需随任务生命周期保留' : '删除运行记录'} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-red-950/30"><Trash2 size={14} /></button>
                    </div>
                  )
                })}
                {recentRuns.length === 0 && <p className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-xs text-gray-500 dark:border-white/[0.1]">当前 SOP 还没有历史运行记录。</p>}
              </div>
            </section>
          )}

          <section className="min-h-0 flex-1 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.1] dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-white/[0.08]">
              <div>
                <h3 className="font-semibold">提示词列表</h3>
                <p className="mt-1 text-xs text-gray-500">所有有效提示词都会参与生图；修改会自动保存。</p>
              </div>
              {running && <span className="flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-700 dark:bg-violet-950/30 dark:text-violet-300"><LoaderCircle size={14} className="animate-spin" />处理中</span>}
            </div>

            <div className="h-full max-h-[calc(86vh-220px)] overflow-y-auto p-4">
              {sources.map((sourceRun) => {
                const sourcePrompts = prompts.filter((item) => item.sourceId === sourceRun.source.id && !item.deleted)
                const sourceAvailable = sourcePrompts.filter((item) => item.promptText.trim()).length
                const sourceMissing = Math.max(0, sourceRun.requestedCount - sourceAvailable)
                return (
                  <article key={sourceRun.source.id} className="mb-4 overflow-hidden rounded-xl border border-gray-200 dark:border-white/[0.1]">
                    <div className="flex items-center gap-3 bg-gray-50 p-3 dark:bg-gray-950">
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg"><SourceThumb source={sourceRun.source} /></div>
                      <div className="min-w-0 flex-1"><h4 className="truncate text-sm font-semibold">{sourceRun.source.label}</h4><p className="mt-1 text-xs text-gray-500">分配 {sourceRun.requestedCount} · 当前 {sourceAvailable} · 缺口 {sourceMissing} · 调用 {sourceRun.attempts}</p>{sourceRun.error && <p className="mt-1 text-xs leading-5 text-red-500">{sourceRun.error}</p>}</div>
                      <span className="rounded-md bg-gray-200 px-2 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">{sourceRun.status}</span>
                      <button type="button" onClick={() => void generateForSources(sourceRun.source.id)} disabled={running || sourceMissing === 0 || !selectedSop} className="flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.1] dark:bg-gray-900 dark:hover:bg-white/[0.06]"><RefreshCw size={13} />重试缺口</button>
                      <button type="button" onClick={() => addManualPrompt(sourceRun.source.id)} disabled={running} className="flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/[0.1] dark:bg-gray-900 dark:hover:bg-white/[0.06]"><Plus size={13} />新增</button>
                    </div>
                    <div className="space-y-2 p-3">
                      {sourcePrompts.map((item, index) => (
                        <div key={item.id} className="flex gap-2">
                          <span className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${item.origin === 'ai' ? 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'}`}>{index + 1}</span>
                          <div className="min-w-0 flex-1">
                            <textarea value={item.promptText} onChange={(event) => updatePrompts((current) => current.map((entry) => entry.id === item.id ? { ...entry, promptText: event.target.value, edited: true } : entry))} rows={3} disabled={running} aria-label={`第 ${index + 1} 条提示词`} className="min-h-20 w-full resize-y rounded-lg border border-gray-300 bg-white p-2 text-xs leading-5 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:opacity-60 dark:border-white/[0.1] dark:bg-gray-950 dark:focus:ring-violet-950" />
                            <p className="mt-1 text-[11px] text-gray-400">{item.edited ? '已编辑 · 已自动保存' : item.origin === 'ai' ? 'AI 生成 · 已自动保存' : '手动添加 · 已自动保存'}</p>
                          </div>
                          <button type="button" onClick={() => void regeneratePrompt(item)} disabled={running} aria-label={`重新生成第 ${index + 1} 条提示词`} title="重新生成" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-violet-50 hover:text-violet-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-violet-950/30"><RefreshCw size={15} /></button>
                          <button type="button" onClick={() => updatePrompts((current) => current.map((entry) => entry.id === item.id ? { ...entry, deleted: true } : entry))} disabled={running} aria-label={`删除第 ${index + 1} 条提示词`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-950/30"><Trash2 size={15} /></button>
                        </div>
                      ))}
                      {!sourcePrompts.length && <p className="rounded-lg border border-dashed border-gray-300 p-4 text-center text-xs text-gray-500 dark:border-white/[0.1]">当前没有提示词，可重试缺口或手动新增。</p>}
                    </div>
                  </article>
                )
              })}
              {!sources.length && (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 px-6 text-center text-gray-500 dark:border-white/[0.1]">
                  <BookOpenCheck size={26} />
                  <p className="mt-3 text-sm font-medium">还没有提示词列表</p>
                  <p className="mt-1 max-w-md text-xs leading-5">系统会根据当前 SOP 和输入区中的本次要求生成提示词，生成后可先检查、修改，再开始生图。</p>
                  <button
                    type="button"
                    onClick={generatePromptList}
                    disabled={running || !selectedSop}
                    aria-label={`生成 ${targetCount} 条 SOP 提示词`}
                    className="mt-4 flex h-9 items-center gap-2 rounded-lg bg-violet-600 px-4 text-xs font-medium text-white transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-violet-200 dark:disabled:bg-violet-500/20 dark:disabled:text-violet-300"
                  >
                    <Sparkles size={14} />
                    生成 {targetCount} 条提示词
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
