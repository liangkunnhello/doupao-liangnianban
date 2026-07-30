import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpenCheckIcon as BookOpenCheck,
  CloseIcon as X,
  Grid2X2Icon as Grid2X2,
  ImageIcon,
  Layers3Icon as Layers3,
  LoaderCircleIcon as LoaderCircle,
  RefreshIcon as RefreshCw,
} from '../design-system/icons'
import { ensureImageCached, ensureImageThumbnailCached, rerunSopBatchTasks, retryTask, subscribeImageThumbnail } from '../store'
import type { SopBatchSnapshot, TaskRecord } from '../types'
import { getSopBatchSnapshot } from '../lib/db'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useDialogFocusTrap } from '../design-system'
import { getHoverPreviewPosition, getHoverPreviewSize } from '../lib/hoverPreviewPosition'
import HoverImagePreview, { type HoverPreviewState } from './HoverImagePreview'
import { isModalBackdropEvent } from '../lib/modalBackdrop'

const HOVER_PREVIEW_MAX_LONG_EDGE = 1024

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
      onPointerEnter={(event) => onPreviewEnter(previewImage, event)}
      onPointerMove={(event) => onPreviewMove(previewImage, event)}
      onPointerLeave={() => onPreviewLeave(imageId)}
      aria-label={`查看第 ${promptIndex} 条提示词的第 ${variantIndex} 张图片`}
      style={{ aspectRatio }}
      className="relative flex min-h-0 w-full items-center justify-center overflow-hidden rounded-xl bg-gray-100 text-gray-400 transition hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:bg-gray-800 dark:hover:bg-gray-700"
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
  onOpenTask,
}: {
  sopName: string
  tasks: TaskRecord[]
  onClose: () => void
  onOpenTask: (taskId: string) => void
}) {
  const modalRef = useRef<HTMLDivElement>(null)
  useCloseOnEscape(true, onClose)
  usePreventBackgroundScroll(true, modalRef)
  useDialogFocusTrap(true, modalRef)
  const [viewMode, setViewMode] = useState<'grouped' | 'all'>('grouped')
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null)
  const [hoverPreviewSizeText, setHoverPreviewSizeText] = useState('')
  const [snapshot, setSnapshot] = useState<SopBatchSnapshot | null>(null)
  const allResults = useMemo(() => tasks.flatMap(getTaskResultItems), [tasks])

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
      onOpen={() => onOpenTask(item.task.id)}
      onPreviewEnter={handlePreviewEnter}
      onPreviewMove={(image, event) => updateHoverPreview(image, event, true)}
      onPreviewLeave={(imageId) => setHoverPreview((current) => current?.imageId === imageId ? null : current)}
    />
  )

  return (
    <>
      <div className="ds-modal-layer fixed inset-0 flex items-center justify-center p-4 animate-overlay-in motion-reduce:animate-none" onMouseDown={(event) => {
        if (isModalBackdropEvent(event)) onClose()
      }}>
        <div className="ds-modal-scrim pointer-events-none absolute inset-0" />
        <div ref={modalRef} className="ds-modal-surface relative z-10 flex h-[min(86vh,820px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border animate-modal-in motion-reduce:animate-none" role="dialog" aria-modal="true" aria-labelledby="sop-batch-detail-title">
          <header className="flex items-center justify-between gap-4 border-b border-gray-200/80 px-5 py-4 dark:border-white/[0.08]">
            <div className="min-w-0">
              <h2 id="sop-batch-detail-title" className="flex min-w-0 items-center gap-2 truncate text-lg font-semibold"><BookOpenCheck size={20} className="shrink-0 text-violet-600" />{sopName}</h2>
              <p className="mt-1 text-xs text-gray-500">{tasks.length} 条提示词 · {allResults.length} 张结果</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void rerunSopBatchTasks(tasks)} className="flex h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-violet-700 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-300 dark:hover:bg-violet-950/30"><RefreshCw size={14} />再次运行</button>
              <div className="flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800" aria-label="结果视图">
                <button type="button" aria-pressed={viewMode === 'grouped'} onClick={() => setViewMode('grouped')} className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition ${viewMode === 'grouped' ? 'bg-white text-violet-700 shadow-sm dark:bg-gray-700 dark:text-violet-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}><Layers3 size={14} />按提示词</button>
                <button type="button" aria-pressed={viewMode === 'all'} onClick={() => setViewMode('all')} className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition ${viewMode === 'all' ? 'bg-white text-violet-700 shadow-sm dark:bg-gray-700 dark:text-violet-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}><Grid2X2 size={14} />全部预览</button>
              </div>
              <button type="button" onClick={onClose} aria-label="关闭 SOP 批量任务图片" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-gray-300 dark:hover:bg-white/[0.06]"><X size={18} /></button>
            </div>
          </header>
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
            {viewMode === 'grouped'
              ? (
                <div className="grid grid-cols-4 items-start gap-3">
                  {tasks.map((task) => {
                    const results = getTaskResultItems(task)
                    return (
                      <article key={task.id} className="rounded-2xl border border-gray-200 p-3 dark:border-white/[0.08]">
                        <div className="mb-3 flex items-start gap-3">
                          <span className="flex h-7 min-w-7 items-center justify-center rounded-lg bg-violet-50 px-2 text-xs font-semibold text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">{task.sopBatch?.promptIndex ?? 1}</span>
                          <p className="line-clamp-2 flex-1 text-xs leading-5 text-gray-600 dark:text-gray-300" title={task.prompt}>{task.prompt}</p>
                          <span className="shrink-0 text-[11px] text-gray-400">{task.outputImages.length}/{task.params.n ?? 1} 张</span>
                          {task.status === 'error' && (
                            <button type="button" onClick={() => void retryTask(task)} aria-label={`重试第 ${task.sopBatch?.promptIndex ?? 1} 条提示词`} className="flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] font-medium text-red-600 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-300 dark:hover:bg-red-950/30"><RefreshCw size={12} />重试</button>
                          )}
                        </div>
                        {results.length > 0
                          ? <div className={`grid items-start gap-2 ${results.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>{results.map((item) => renderPreview(item))}</div>
                          : <div className="flex h-24 items-center justify-center rounded-xl bg-gray-50 text-xs text-gray-400 dark:bg-gray-800/60">暂无可用结果</div>}
                      </article>
                    )
                  })}
                </div>
              )
              : <div className="grid grid-cols-4 items-start gap-2">{allResults.map((item) => renderPreview(item))}</div>}
          </div>
        </div>
      </div>
      {hoverPreview && <HoverImagePreview preview={hoverPreview} sizeText={hoverPreviewSizeText} zIndex={90} />}
    </>
  )
}
