import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpenCheckIcon as BookOpenCheck,
  CheckIcon as Check,
  CloseIcon as X,
  CopyIcon as Copy,
  ExpandIcon as Expand,
  FolderOpenIcon as FolderOpen,
  Grid2X2Icon as Grid2X2,
  ImageIcon,
  Layers3Icon as Layers3,
  LoaderCircleIcon as LoaderCircle,
  RefreshIcon as RefreshCw,
  SlidersHorizontalIcon as SlidersHorizontal,
} from '../design-system/icons'
import { ensureImageCached, ensureImageThumbnailCached, rerunSopBatchTasks, retryTask, subscribeImageThumbnail, useStore } from '../store'
import type { SopBatchSnapshot, TaskRecord } from '../types'
import { getSopBatchSnapshot } from '../lib/db'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useDialogFocusTrap } from '../design-system'
import { getHoverPreviewPosition, getHoverPreviewSize } from '../lib/hoverPreviewPosition'
import HoverImagePreview, { type HoverPreviewState } from './HoverImagePreview'
import ViewportTooltip from './ViewportTooltip'
import { isModalBackdropEvent } from '../lib/modalBackdrop'
import TaskParamSummary from './TaskParamSummary'
import { useTooltip } from '../hooks/useTooltip'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import {
  getExplicitImageSaveDirectory,
  getLocalImageSaveDirectory,
  isElectron,
  joinPath,
  openInExplorer,
} from '../lib/localSave'

const HOVER_PREVIEW_MAX_LONG_EDGE = 1024
const SOP_BATCH_MODAL_MODE_STORAGE_KEY = 'doupao.sop-batch-detail-modal-mode'
const SOP_BATCH_IMAGE_VIEW_SIZE_STORAGE_KEY = 'doupao.sop-batch-detail-image-view-size'
const SOP_BATCH_IMAGE_VIEW_SIZE_MIN = 160
const SOP_BATCH_IMAGE_VIEW_SIZE_MAX = 360
const SOP_BATCH_IMAGE_VIEW_SIZE_DEFAULT = 240

function getStoredSopBatchModalMode() {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(SOP_BATCH_MODAL_MODE_STORAGE_KEY) === 'large'
  } catch {
    return false
  }
}

function storeSopBatchModalMode(largeView: boolean) {
  try {
    window.localStorage.setItem(SOP_BATCH_MODAL_MODE_STORAGE_KEY, largeView ? 'large' : 'default')
  } catch {
    // Keep the current session usable if browser storage is unavailable.
  }
}

function normalizeSopBatchImageViewSize(value: number) {
  if (!Number.isFinite(value)) return SOP_BATCH_IMAGE_VIEW_SIZE_DEFAULT
  return Math.max(SOP_BATCH_IMAGE_VIEW_SIZE_MIN, Math.min(SOP_BATCH_IMAGE_VIEW_SIZE_MAX, Math.round(value / 20) * 20))
}

function getStoredSopBatchImageViewSize() {
  if (typeof window === 'undefined') return SOP_BATCH_IMAGE_VIEW_SIZE_DEFAULT
  try {
    const stored = window.localStorage.getItem(SOP_BATCH_IMAGE_VIEW_SIZE_STORAGE_KEY)
    return stored === null ? SOP_BATCH_IMAGE_VIEW_SIZE_DEFAULT : normalizeSopBatchImageViewSize(Number(stored))
  } catch {
    return SOP_BATCH_IMAGE_VIEW_SIZE_DEFAULT
  }
}

function storeSopBatchImageViewSize(value: number) {
  try {
    window.localStorage.setItem(SOP_BATCH_IMAGE_VIEW_SIZE_STORAGE_KEY, String(value))
  } catch {
    // Keep the current session usable if browser storage is unavailable.
  }
}

type PreviewImage = {
  imageId: string
  src: string
  width?: number
  height?: number
}

type ResultItem = {
  task: TaskRecord
  imageId: string
  variantIndex: number
}

function PromptPreview({ prompt, promptIndex }: { prompt: string; promptIndex: number }) {
  const tooltip = useTooltip()

  return (
    <span className="relative block min-w-0">
      <button
        type="button"
        {...tooltip.handlers}
        aria-label={`查看第 ${promptIndex} 条完整提示词`}
        className="-mx-1 block w-[calc(100%+0.5rem)] rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:hover:bg-white/[0.06]"
      >
        <span className="line-clamp-2 text-xs leading-5 text-gray-600 dark:text-gray-300">{prompt}</span>
      </button>
      <ViewportTooltip
        visible={tooltip.visible}
        className="w-[min(30rem,calc(100vw-2rem))] max-w-none whitespace-normal p-0 text-left shadow-xl"
      >
        <span className="block border-b border-gray-200 px-3 py-2 font-medium text-gray-800 dark:border-white/[0.08] dark:text-gray-100">
          第 {promptIndex} 条完整提示词
        </span>
        <span className="block whitespace-pre-wrap break-words px-3 py-2.5 leading-5 text-gray-600 dark:text-gray-200">
          {prompt}
        </span>
      </ViewportTooltip>
    </span>
  )
}

function ResultPreview({
  task,
  imageId,
  variantIndex,
  onOpen,
  onPreviewEnter,
  onPreviewMove,
  onPreviewLeave,
}: ResultItem & {
  onOpen: () => void
  onPreviewEnter: (image: PreviewImage, event: React.PointerEvent<HTMLButtonElement>) => void
  onPreviewMove: (image: PreviewImage, event: React.PointerEvent<HTMLButtonElement>) => void
  onPreviewLeave: (imageId: string) => void
}) {
  const [src, setSrc] = useState('')
  const [dimensions, setDimensions] = useState<{ width?: number; height?: number }>({})

  useEffect(() => {
    setSrc('')
    setDimensions({})
    if (!imageId) return
    let active = true
    const apply = (next: { dataUrl: string; width?: number; height?: number }) => {
      if (!active) return
      setSrc(next.dataUrl)
      setDimensions({ width: next.width, height: next.height })
    }
    const unsubscribe = subscribeImageThumbnail(imageId, apply)
    void ensureImageThumbnailCached(imageId).then((value) => value && apply(value))
    return () => {
      active = false
      unsubscribe()
    }
  }, [imageId])

  const promptIndex = task.sopBatch?.promptIndex ?? 1
  const previewImage = { imageId, src, ...dimensions }
  const aspectRatio = dimensions.width && dimensions.height
    ? `${dimensions.width} / ${dimensions.height}`
    : '1 / 1'

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!imageId}
      onPointerEnter={(event) => onPreviewEnter(previewImage, event)}
      onPointerMove={(event) => onPreviewMove(previewImage, event)}
      onPointerLeave={() => onPreviewLeave(imageId)}
      aria-label={`查看第 ${promptIndex} 条提示词的第 ${variantIndex} 张图片`}
      style={{ aspectRatio }}
      className="relative flex min-h-0 w-full items-center justify-center overflow-hidden rounded-xl bg-gray-100 text-gray-400 transition hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-default disabled:hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 dark:disabled:hover:bg-gray-800"
    >
      {src
        ? <img src={src} alt={`第 ${promptIndex} 条提示词的第 ${variantIndex} 张生成结果`} className="h-full w-full object-cover" />
        : task.status === 'running'
          ? <LoaderCircle size={20} className="animate-spin motion-reduce:animate-none" />
          : <ImageIcon size={20} />}
      {(task.params.n ?? 1) > 1 && (
        <span className="absolute bottom-2 right-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {variantIndex}/{task.params.n}
        </span>
      )}
    </button>
  )
}

function getTaskResultItems(task: TaskRecord) {
  const expected = task.status === 'running'
    ? Math.max(task.params.n ?? 1, task.outputImages.length)
    : task.outputImages.length
  return Array.from({ length: expected }, (_, index): ResultItem => ({
    task,
    imageId: task.outputImages[index] ?? '',
    variantIndex: index + 1,
  }))
}

export default function SopBatchDetailModal({
  sopName,
  tasks,
  onClose,
  onOpenImage,
}: {
  sopName: string
  tasks: TaskRecord[]
  onClose: () => void
  onOpenImage: (imageId: string) => void
}) {
  const modalRef = useRef<HTMLDivElement>(null)
  const lightboxImageId = useStore((state) => state.lightboxImageId)
  const showToast = useStore((state) => state.showToast)
  const workspaceTabs = useStore((state) => state.workspaceTabs)
  useCloseOnEscape(!lightboxImageId, onClose)
  usePreventBackgroundScroll(true, modalRef)
  useDialogFocusTrap(!lightboxImageId, modalRef)
  const [viewMode, setViewMode] = useState<'grouped' | 'all'>('grouped')
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null)
  const [hoverPreviewSizeText, setHoverPreviewSizeText] = useState('')
  const [snapshot, setSnapshot] = useState<SopBatchSnapshot | null>(null)
  const [largeView, setLargeView] = useState(getStoredSopBatchModalMode)
  const [imageViewSize, setImageViewSize] = useState(getStoredSopBatchImageViewSize)
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null)
  const copyFeedbackTimerRef = useRef<number | null>(null)
  const allResults = useMemo(() => tasks.flatMap(getTaskResultItems), [tasks])
  const isRunning = tasks.some((task) => task.status === 'running' || task.falRecoverable || task.customRecoverable)
  const modalSizeStyle = largeView
    ? {
        width: '80vw',
        height: '80vh',
        maxWidth: 'none',
      }
    : {
        height: 'min(86vh, 820px)',
        maxWidth: '1024px',
      }
  const imageGridStyle = {
    gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${imageViewSize}px), 1fr))`,
  }

  const updateImageViewSize = (value: number) => {
    const normalized = normalizeSopBatchImageViewSize(value)
    setImageViewSize(normalized)
    storeSopBatchImageViewSize(normalized)
  }

  const toggleLargeView = () => {
    setLargeView((current) => {
      const next = !current
      storeSopBatchModalMode(next)
      return next
    })
  }

  const copyPrompt = async (task: TaskRecord) => {
    try {
      await copyTextToClipboard(task.prompt)
      setCopiedPromptId(task.id)
      if (copyFeedbackTimerRef.current != null) window.clearTimeout(copyFeedbackTimerRef.current)
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        setCopiedPromptId((current) => current === task.id ? null : current)
        copyFeedbackTimerRef.current = null
      }, 1800)
      showToast('提示词已复制', 'success')
    } catch (error) {
      showToast(getClipboardFailureMessage('复制提示词失败', error), 'error')
    }
  }

  useEffect(() => () => {
    if (copyFeedbackTimerRef.current != null) window.clearTimeout(copyFeedbackTimerRef.current)
  }, [])

  const openBatchOutputFolder = async () => {
    if (!isElectron()) {
      showToast('仅桌面端支持打开图片目录', 'error')
      return
    }

    try {
      const savedImagePath = tasks
        .flatMap((task) => Object.values(task.localSavedOutputImagePaths ?? {}))
        .find(Boolean)
      if (savedImagePath) {
        await openInExplorer(savedImagePath)
        return
      }

      const representativeTask = tasks[0]
      const containingTab = workspaceTabs.find((tab) =>
        tasks.some((task) => tab.tasks.some((candidate) => candidate.id === task.id)))
      let directory = representativeTask?.scheduledOutputPath
        ? await getExplicitImageSaveDirectory(representativeTask.scheduledOutputPath)
        : await getLocalImageSaveDirectory(representativeTask?.scheduledOutputSubFolder ?? containingTab?.name)
      if (directory && representativeTask?.localSaveBatchFolder) {
        directory = await getExplicitImageSaveDirectory(
          await joinPath(directory, representativeTask.localSaveBatchFolder),
        )
      }
      if (!directory) {
        showToast('未设置本地保存目录', 'error')
        return
      }
      await openInExplorer(directory)
    } catch (error) {
      console.error(error)
      showToast('打开图片目录失败', 'error')
    }
  }

  useEffect(() => {
    let active = true
    const snapshotId = tasks[0]?.sopBatch?.snapshotId
    if (!snapshotId) {
      setSnapshot(null)
      return
    }
    void getSopBatchSnapshot(snapshotId).then((value) => {
      if (active) setSnapshot(value ?? null)
    })
    return () => {
      active = false
    }
  }, [tasks])

  const updateHoverPreview = (image: PreviewImage, event: React.PointerEvent<HTMLButtonElement>, preserveLoadedSource: boolean) => {
    if (event.pointerType !== 'mouse' || !image.imageId || !image.src) return
    const size = getHoverPreviewSize({
      imageWidth: image.width || HOVER_PREVIEW_MAX_LONG_EDGE,
      imageHeight: image.height || HOVER_PREVIEW_MAX_LONG_EDGE,
      maxLongEdge: HOVER_PREVIEW_MAX_LONG_EDGE,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    })
    const position = getHoverPreviewPosition({
      pointerX: event.clientX,
      pointerY: event.clientY,
      previewWidth: size.width,
      previewHeight: size.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    })
    setHoverPreview((current) => ({
      imageId: image.imageId,
      src: preserveLoadedSource && current?.imageId === image.imageId ? current.src : image.src,
      ...position,
      ...size,
    }))
    setHoverPreviewSizeText(image.width && image.height ? `${image.width} × ${image.height}` : '')
  }

  const handlePreviewEnter = (image: PreviewImage, event: React.PointerEvent<HTMLButtonElement>) => {
    updateHoverPreview(image, event, false)
    if (event.pointerType !== 'mouse' || !image.imageId || !image.src) return
    void ensureImageCached(image.imageId).then((fullSource) => {
      if (!fullSource) return
      setHoverPreview((current) => current?.imageId === image.imageId ? { ...current, src: fullSource } : current)
    })
  }

  const renderPreview = (item: ResultItem) => (
    <ResultPreview
      key={`${item.task.id}-${item.variantIndex}`}
      {...item}
      onOpen={() => {
        if (!item.imageId) return
        setHoverPreview(null)
        onOpenImage(item.imageId)
      }}
      onPreviewEnter={handlePreviewEnter}
      onPreviewMove={(image, event) => updateHoverPreview(image, event, true)}
      onPreviewLeave={(imageId) => setHoverPreview((current) => current?.imageId === imageId ? null : current)}
    />
  )

  return (
    <>
      <div className="ds-modal-layer fixed inset-0 flex items-center justify-center p-2 animate-overlay-in motion-reduce:animate-none sm:p-4" onMouseDown={(event) => {
        if (isModalBackdropEvent(event)) onClose()
      }}>
        <div className="ds-modal-scrim pointer-events-none absolute inset-0" />
        <div ref={modalRef} style={modalSizeStyle} className="ds-modal-surface relative z-10 flex w-full flex-col overflow-hidden rounded-2xl border transition-[width,height,max-width] duration-200 ease-out animate-modal-in motion-reduce:animate-none" role="dialog" aria-modal="true" aria-labelledby="sop-batch-detail-title">
          <header className="flex flex-col items-stretch gap-3 border-b border-gray-200/80 px-4 py-4 dark:border-white/[0.08] sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="min-w-0 flex-1">
              <h2 id="sop-batch-detail-title" className="flex min-w-0 items-center gap-2 truncate text-lg font-semibold"><BookOpenCheck size={20} className="shrink-0 text-violet-600" />{sopName}</h2>
              <p className="mt-1 text-xs text-gray-500">{tasks.length} 条提示词 · {allResults.length} 张结果</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <button type="button" onClick={() => void openBatchOutputFolder()} className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-gray-600 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-gray-300 dark:hover:bg-white/[0.06]" aria-label="打开 SOP 批量任务图片目录"><FolderOpen size={15} />打开文件夹</button>
              <button type="button" onClick={() => void rerunSopBatchTasks(tasks)} disabled={isRunning} className="flex h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-violet-700 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-violet-300 dark:hover:bg-violet-950/30"><RefreshCw size={14} />再次生成整批</button>
              <div className="flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800" aria-label="结果视图">
                <button type="button" aria-pressed={viewMode === 'grouped'} onClick={() => setViewMode('grouped')} className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition ${viewMode === 'grouped' ? 'bg-white text-violet-700 shadow-sm dark:bg-gray-700 dark:text-violet-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}><Layers3 size={14} />按提示词</button>
                <button type="button" aria-pressed={viewMode === 'all'} onClick={() => setViewMode('all')} className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition ${viewMode === 'all' ? 'bg-white text-violet-700 shadow-sm dark:bg-gray-700 dark:text-violet-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}><Grid2X2 size={14} />全部预览</button>
              </div>
              <button type="button" onClick={onClose} aria-label="关闭 SOP 批量任务图片" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-gray-300 dark:hover:bg-white/[0.06]"><X size={18} /></button>
            </div>
          </header>
          <div role="group" aria-label="SOP 批量任务视图控制" className="flex flex-wrap items-center gap-3 border-b border-gray-200/80 bg-gray-50 px-4 py-3 dark:border-white/[0.08] dark:bg-white/[0.025] sm:px-5">
            <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <SlidersHorizontal size={15} className="shrink-0" />
              <label htmlFor="sop-batch-detail-image-size" className="shrink-0 font-medium text-gray-700 dark:text-gray-200">图片视图</label>
              <span className="hidden shrink-0 text-[11px] sm:inline">紧凑</span>
              <input
                id="sop-batch-detail-image-size"
                type="range"
                min={SOP_BATCH_IMAGE_VIEW_SIZE_MIN}
                max={SOP_BATCH_IMAGE_VIEW_SIZE_MAX}
                step={20}
                value={imageViewSize}
                onChange={(event) => updateImageViewSize(Number(event.target.value))}
                aria-label="调整 SOP 批量任务图片视图大小"
                className="h-2 min-w-24 flex-1 cursor-pointer accent-violet-600 sm:max-w-xs"
              />
              <span className="hidden shrink-0 text-[11px] sm:inline">大图</span>
              <output htmlFor="sop-batch-detail-image-size" className="w-12 shrink-0 text-right font-medium tabular-nums text-gray-700 dark:text-gray-200">{imageViewSize}px</output>
            </div>
            <button
              type="button"
              onClick={toggleLargeView}
              aria-label={largeView ? '退出 SOP 批量任务大弹窗模式' : '进入 SOP 批量任务大弹窗模式'}
              aria-pressed={largeView}
              title={largeView ? '恢复默认弹窗大小' : '使用当前程序窗口 80% 的宽度和高度'}
              className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${largeView ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200' : 'border border-gray-200 bg-white text-gray-600 hover:border-violet-300 hover:text-violet-700 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-gray-300 dark:hover:text-violet-200'}`}
            >
              <Expand size={15} />
              {largeView ? '恢复大小' : '80% 大弹窗'}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {snapshot && (
              <details className="mb-4 rounded-xl border border-violet-200 bg-violet-50/50 p-3 text-xs dark:border-violet-500/20 dark:bg-violet-950/20">
                <summary className="cursor-pointer font-medium text-violet-800 dark:text-violet-200">查看提交快照 · {snapshot.sop.name}</summary>
                <div className="mt-3 space-y-2 leading-5 text-gray-600 dark:text-gray-300">
                  {snapshot.brief && <p><span className="font-medium">本次要求：</span>{snapshot.brief}</p>}
                  <p className="whitespace-pre-wrap"><span className="font-medium">SOP 正文：</span>{snapshot.sop.content}</p>
                  <p>参考图 {snapshot.referenceImageIds.length} 张 · {snapshot.promptCount} 条提示词 × 每条 {snapshot.imagesPerPrompt} 张</p>
                </div>
              </details>
            )}
            {tasks[0] && (
              <section className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-white/[0.08] dark:bg-white/[0.025]" aria-label="SOP 批量任务参数">
                <div className="mb-2 flex items-center gap-2">
                  <SlidersHorizontal size={14} className="text-gray-400" />
                  <h3 className="text-xs font-medium text-gray-700 dark:text-gray-200">批次参数</h3>
                </div>
                <TaskParamSummary task={tasks[0]} className="hide-scrollbar mask-edge-r pr-2" />
              </section>
            )}
            {viewMode === 'grouped'
              ? (
                <div data-testid="sop-batch-results-grid" style={imageGridStyle} className="grid items-start gap-3">
                  {tasks.map((task) => {
                    const results = getTaskResultItems(task)
                    const promptIndex = task.sopBatch?.promptIndex ?? 1
                    const promptCopied = copiedPromptId === task.id
                    return (
                      <article key={task.id} className="rounded-2xl border border-gray-200 p-3 dark:border-white/[0.08]">
                        <div className="mb-3 flex items-start gap-2.5">
                          <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-lg bg-violet-50 px-2 text-xs font-semibold text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">{promptIndex}</span>
                          <div className="min-w-0 flex-1">
                            <PromptPreview prompt={task.prompt} promptIndex={promptIndex} />
                            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[11px] tabular-nums text-gray-400">{task.outputImages.length}/{task.params.n ?? 1} 张</span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => void copyPrompt(task)}
                                  aria-label={promptCopied ? `第 ${promptIndex} 条提示词已复制` : `复制第 ${promptIndex} 条提示词`}
                                  title={promptCopied ? '已复制' : '复制完整提示词'}
                                  className={`flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${promptCopied ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-100'}`}
                                >
                                  {promptCopied ? <Check size={12} /> : <Copy size={12} />}
                                  {promptCopied ? '已复制' : '复制'}
                                </button>
                                <button type="button" onClick={() => void retryTask(task)} disabled={task.status === 'running' || task.falRecoverable || task.customRecoverable} aria-label={`再次生成第 ${promptIndex} 条提示词`} className="flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-violet-700 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-violet-300 dark:hover:bg-violet-950/30"><RefreshCw size={12} />再次生成</button>
                              </div>
                            </div>
                          </div>
                        </div>
                        {results.length > 0
                          ? <div className={`grid items-start gap-2 ${results.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>{results.map((item) => renderPreview(item))}</div>
                          : <div className="flex h-24 items-center justify-center rounded-xl bg-gray-50 text-xs text-gray-400 dark:bg-gray-800/60">暂无可用结果</div>}
                      </article>
                    )
                  })}
                </div>
              )
              : <div data-testid="sop-batch-results-grid" style={imageGridStyle} className="grid items-start gap-2">{allResults.map((item) => renderPreview(item))}</div>}
          </div>
        </div>
      </div>
      {hoverPreview && <HoverImagePreview preview={hoverPreview} sizeText={hoverPreviewSizeText} zIndex={90} />}
    </>
  )
}
