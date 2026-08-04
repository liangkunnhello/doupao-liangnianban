import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EmptyState,
  ImageIcon,
  SegmentedControl,
  StatusIndicator,
} from '../design-system'
import { ensureImageThumbnailCached, subscribeImageThumbnail } from '../store'
import { getTaskGridVirtualWindow } from '../lib/taskGridVirtualWindow'
import type { TaskRecord } from '../types'

const NAVIGATOR_ROW_HEIGHT = 372
const NAVIGATOR_OVERSCAN_ROWS = 4

type NavigatorThumbnail = { dataUrl: string; width?: number; height?: number }

interface GalleryTaskNavigatorProps {
  tasks: TaskRecord[]
  activeTaskId: string | null
  onNavigate: (taskId: string) => void
}

interface GalleryTaskOverview {
  batchCount: number
  taskCount: number
  total: number
  completed: number
  failed: number
  processing: number
  concurrent: number
  queued: number
}

function getTaskCounts(task: TaskRecord) {
  const slotStatuses = task.generationSlots?.map((slot) => slot.status) ?? []
  const batchStatuses = task.batchItemStatuses ?? []
  const requested = Math.max(
    1,
    task.params.n || 1,
    slotStatuses.length,
    batchStatuses.length,
    task.outputImages.length,
  )
  const explicitCompleted = Math.max(
    task.outputImages.length,
    slotStatuses.filter((status) => status === 'done').length,
    batchStatuses.filter((status) => status === 'done').length,
  )
  const explicitFailed = Math.max(
    slotStatuses.filter((status) => status === 'failed').length,
    batchStatuses.filter((status) => status === 'error').length,
  )
  const explicitProcessing = slotStatuses.filter((status) => (
    status === 'submitted' || status === 'running' || status === 'validating'
  )).length
  const explicitQueued = slotStatuses.filter((status) => status === 'pending').length
  const completed = Math.min(requested, explicitCompleted)
  const failedFallback = task.status === 'error' && explicitFailed === 0
    ? Math.max(1, requested - completed)
    : explicitFailed
  const failed = Math.min(requested - completed, failedFallback)
  const remainingAfterFailure = requested - completed - failed
  const processingFallback = !slotStatuses.length && task.status === 'running' && task.progressStage !== 'queued'
    ? remainingAfterFailure
    : explicitProcessing
  const processing = Math.min(remainingAfterFailure, processingFallback)
  const remainingAfterProcessing = remainingAfterFailure - processing
  const queuedFallback = !slotStatuses.length && task.status === 'running' && task.progressStage === 'queued'
    ? remainingAfterProcessing
    : explicitQueued
  const queued = Math.min(remainingAfterProcessing, queuedFallback)
  const activeRequests = task.remoteGenerationRequests?.filter((request) => (
    request.status === 'submitted' || request.status === 'running'
  )).length ?? 0
  const concurrent = Math.max(
    activeRequests,
    task.status === 'running' && task.progressStage !== 'queued' ? 1 : 0,
  )

  return { requested, completed, failed, processing, concurrent, queued }
}

export function getGalleryTaskOverview(tasks: TaskRecord[]): GalleryTaskOverview {
  const overview = tasks.reduce<GalleryTaskOverview>((current, task) => {
    const counts = getTaskCounts(task)
    current.total += counts.requested
    current.completed += counts.completed
    current.failed += counts.failed
    current.processing += counts.processing
    current.concurrent += counts.concurrent
    current.queued += counts.queued
    return current
  }, {
    batchCount: 0,
    taskCount: tasks.length,
    total: 0,
    completed: 0,
    failed: 0,
    processing: 0,
    concurrent: 0,
    queued: 0,
  })
  overview.batchCount = new Set(tasks.map((task) => task.sopBatch?.batchId ?? task.id)).size
  return overview
}

function getStatus(task: TaskRecord): {
  label: string
  tone: 'info' | 'success' | 'warning' | 'danger'
  pulse?: boolean
} {
  if (task.status === 'running') return { label: '生成中', tone: 'info', pulse: true }
  if (task.status === 'error') return { label: '失败', tone: 'danger' }
  if (task.batchItemStatuses?.some((status) => status === 'error')) return { label: '部分完成', tone: 'warning' }
  return { label: '已完成', tone: 'success' }
}

function getTaskTitle(task: TaskRecord) {
  const title = task.prompt.replace(/\s+/g, ' ').trim()
  return title || task.sopBatch?.sopName || '未命名任务'
}

function formatTaskTime(timestamp: number) {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function getTaskFallbackRatio(task: TaskRecord) {
  const match = task.params.size.match(/^(\d+)x(\d+)$/i)
  if (!match) return 1
  const width = Number(match[1])
  const height = Number(match[2])
  return width > 0 && height > 0 ? width / height : 1
}

function getPreviewStyle(thumbnail: NavigatorThumbnail | undefined, fallbackRatio: number): CSSProperties {
  const ratio = thumbnail?.width && thumbnail?.height ? thumbnail.width / thumbnail.height : fallbackRatio
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1
  return safeRatio >= 1
    ? { aspectRatio: String(safeRatio), width: '86%', height: 'auto' }
    : { aspectRatio: String(safeRatio), width: 'auto', height: '92%' }
}

function getParameterSummary(task: TaskRecord) {
  const quality = {
    auto: '自动',
    low: '低',
    medium: '中',
    high: '高',
  }[task.params.quality]
  const size = task.params.size === 'auto' ? '自动尺寸' : task.params.size.replace(/x/gi, '×')
  return `${size} · ${quality} · ${task.params.n} 张`
}

function percentage(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0
}

function TaskOverview({ tasks }: { tasks: TaskRecord[] }) {
  const [view, setView] = useState<'stage' | 'logs'>('stage')
  const overview = useMemo(() => getGalleryTaskOverview(tasks), [tasks])
  const recentTasks = useMemo(() => (
    [...tasks].sort((left, right) => right.createdAt - left.createdAt).slice(0, 3)
  ), [tasks])
  const segments = [
    { label: '成功', value: overview.completed, className: 'bg-ds-success' },
    { label: '异常', value: overview.failed, className: 'bg-ds-danger' },
    { label: '处理中', value: overview.processing, className: 'bg-ds-info' },
    { label: '排队', value: overview.queued, className: 'bg-ds-warning' },
  ]

  return (
    <section aria-labelledby="gallery-task-overview-title" className="shrink-0 border-b border-ds-border px-4 pb-4 pt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 id="gallery-task-overview-title" className="text-sm font-semibold text-ds-text">任务列表</h4>
          <p className="mt-0.5 truncate text-xs tabular-nums text-ds-muted">
            {overview.batchCount} 个批次 · 共 {overview.total} 张
          </p>
        </div>
        <SegmentedControl
          aria-label="任务总览视图"
          value={view}
          options={[{ value: 'stage', label: '阶段' }, { value: 'logs', label: '日志' }]}
          size="sm"
          onValueChange={setView}
        />
      </div>

      {view === 'stage' ? (
        <div className="mt-4" data-overview-view="stage">
          <div
            role="progressbar"
            aria-label="任务总体出图进度"
            aria-valuemin={0}
            aria-valuemax={Math.max(1, overview.total)}
            aria-valuenow={overview.completed}
            aria-valuetext={`${overview.completed} 张成功，${overview.failed} 张异常，共 ${overview.total} 张`}
            className="flex h-2 overflow-hidden rounded-full bg-ds-subtle"
          >
            {segments.map((segment) => segment.value > 0 && (
              <span
                key={segment.label}
                aria-hidden="true"
                title={`${segment.label} ${segment.value}`}
                className={`h-full ${segment.className}`}
                style={{ width: `${percentage(segment.value, overview.total)}%` }}
              />
            ))}
          </div>
          <p className="mt-3 text-sm font-medium tabular-nums text-ds-text">
            <strong className="text-xl font-semibold tracking-[-0.02em]">{overview.completed}</strong>
            <span className="text-ds-muted"> / {overview.total}</span> 已出图
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-ds-md bg-ds-subtle px-3 py-2.5 text-center">
              <strong className="block text-xl font-semibold tabular-nums text-ds-text">{overview.completed}</strong>
              <span className="text-[11px] text-ds-muted">成功 · {percentage(overview.completed, overview.total)}%</span>
            </div>
            <div className="rounded-ds-md bg-ds-subtle px-3 py-2.5 text-center">
              <strong className="block text-xl font-semibold tabular-nums text-ds-text">{overview.failed}</strong>
              <span className="text-[11px] text-ds-muted">异常 · {percentage(overview.failed, overview.total)}%</span>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 divide-x divide-ds-border rounded-ds-md bg-ds-subtle py-2">
            {[
              ['处理中', overview.processing],
              ['并发', overview.concurrent],
              ['排队', overview.queued],
            ].map(([label, value]) => (
              <div key={label} className="text-center">
                <strong className="block text-sm font-semibold tabular-nums text-ds-text">{value}</strong>
                <span className="text-[10px] text-ds-muted">{label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-4 min-h-[184px]" data-overview-view="logs">
          {recentTasks.length > 0 ? (
            <ol className="divide-y divide-ds-border">
              {recentTasks.map((task) => {
                const status = getStatus(task)
                return (
                  <li key={task.id} className="flex items-center gap-2 py-2.5">
                    <StatusIndicator tone={status.tone} pulse={status.pulse} className="shrink-0 text-[10px]">
                      {status.label}
                    </StatusIndicator>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-ds-text">{getTaskTitle(task)}</span>
                    <time className="shrink-0 text-[10px] tabular-nums text-ds-muted" dateTime={new Date(task.createdAt).toISOString()}>
                      {formatTaskTime(task.createdAt).slice(5, 16)}
                    </time>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="py-12 text-center text-xs text-ds-muted">暂无任务日志</p>
          )}
        </div>
      )}
    </section>
  )
}

interface NavigatorTaskCardProps {
  task: TaskRecord
  active: boolean
  onNavigate: (taskId: string) => void
}

const NavigatorTaskCard = memo(function NavigatorTaskCard({ active, onNavigate, task }: NavigatorTaskCardProps) {
  const [thumbnails, setThumbnails] = useState<Record<string, NavigatorThumbnail>>({})
  const [activeImageIndex, setActiveImageIndex] = useState(0)
  const title = getTaskTitle(task)
  const status = getStatus(task)
  const imageCount = task.outputImages.length
  const fallbackRatio = getTaskFallbackRatio(task)
  const counts = getTaskCounts(task)
  const allImageIds = useMemo(() => (
    [...new Set([...task.outputImages, ...task.inputImageIds])]
  ), [task.inputImageIds, task.outputImages])

  useEffect(() => {
    let cancelled = false
    const subscriptions = allImageIds.map((imageId) => {
      const apply = (thumbnail: NavigatorThumbnail) => {
        if (cancelled) return
        setThumbnails((current) => current[imageId]?.dataUrl === thumbnail.dataUrl
          && current[imageId]?.width === thumbnail.width
          && current[imageId]?.height === thumbnail.height
          ? current
          : { ...current, [imageId]: thumbnail })
      }
      const unsubscribe = subscribeImageThumbnail(imageId, apply)
      void ensureImageThumbnailCached(imageId)
        .then((thumbnail) => thumbnail && apply(thumbnail))
        .catch(() => {})
      return unsubscribe
    })
    return () => {
      cancelled = true
      subscriptions.forEach((unsubscribe) => unsubscribe())
    }
  }, [allImageIds])

  useEffect(() => {
    setActiveImageIndex((current) => imageCount ? Math.min(current, imageCount - 1) : 0)
  }, [imageCount])

  const previewLayers = imageCount <= 1
    ? [{ index: 0, position: 'front' as const }]
    : imageCount === 2
      ? [
          { index: (activeImageIndex + 1) % imageCount, position: 'left' as const },
          { index: activeImageIndex, position: 'front' as const },
        ]
      : [
          { index: (activeImageIndex - 1 + imageCount) % imageCount, position: 'left' as const },
          { index: (activeImageIndex + 1) % imageCount, position: 'right' as const },
          { index: activeImageIndex, position: 'front' as const },
        ]

  return (
    <article className="relative h-[372px] w-full border-b border-ds-border">
      <button
        type="button"
        aria-current={active ? 'location' : undefined}
        aria-label={`定位到任务：${title}，${getParameterSummary(task)}，${task.inputImageIds.length} 张参考图`}
        className={`group block h-full w-full bg-transparent px-2 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-primary ${
          active ? 'bg-ds-selection/70' : 'hover:bg-ds-subtle/65'
        }`}
        onClick={() => onNavigate(task.id)}
      >
        <span className="sr-only">{title}</span>
        <span className="relative flex h-[220px] w-full items-center justify-center overflow-hidden" aria-hidden="true">
          {previewLayers.map(({ index, position }) => {
            const imageId = task.outputImages[index]
            const thumbnail = thumbnails[imageId]
            const transform = position === 'front'
              ? 'translate(-50%, -50%) scale(1)'
              : position === 'left'
                ? 'translate(calc(-50% - 24px), -50%) scale(0.91) rotate(-1.5deg)'
                : 'translate(calc(-50% + 24px), -50%) scale(0.91) rotate(1.5deg)'
            return (
              <span
                key={`${position}:${imageId}`}
                data-carousel-layer={position}
                className={`absolute left-1/2 top-1/2 overflow-hidden rounded-[14px] bg-ds-subtle transition-[transform,opacity,filter,box-shadow] duration-300 ease-out motion-reduce:transition-none ${
                  position === 'front'
                    ? 'gallery-task-navigator__front z-20 opacity-100 shadow-ds-lg'
                    : 'z-10 opacity-55 shadow-ds-md saturate-75'
                }`}
                style={{ ...getPreviewStyle(thumbnail, fallbackRatio), transform }}
              >
                {thumbnail ? (
                  <img
                    src={thumbnail.dataUrl}
                    alt=""
                    loading="eager"
                    decoding="async"
                    fetchPriority={position === 'front' ? 'auto' : 'low'}
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-ds-muted"><ImageIcon className="h-6 w-6" /></span>
                )}
              </span>
            )
          })}
        </span>
        <span aria-live="polite" className="mt-0.5 flex h-7 items-center justify-center text-xs font-semibold tabular-nums text-ds-text">
          {activeImageIndex + 1}/{imageCount}
        </span>
        <span className="mt-1 flex h-9 items-center gap-2 rounded-ds-md bg-ds-subtle px-2">
          <span className="shrink-0 text-[10px] text-ds-muted">参考</span>
          <span className="flex shrink-0 -space-x-1">
            {task.inputImageIds.slice(0, 3).map((imageId, index) => {
              const thumbnail = thumbnails[imageId]
              return (
                <span key={imageId} className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-md border border-ds-surface bg-ds-surface text-ds-muted">
                  {thumbnail ? (
                    <img src={thumbnail.dataUrl} alt={`参考图 ${index + 1}`} className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <ImageIcon className="h-3 w-3" />
                  )}
                </span>
              )
            })}
            {task.inputImageIds.length === 0 && <span className="text-[10px] text-ds-muted">无</span>}
          </span>
          {task.inputImageIds.length > 3 && <span className="shrink-0 text-[10px] tabular-nums text-ds-muted">+{task.inputImageIds.length - 3}</span>}
          <span className="ml-auto min-w-0 truncate text-[10px] tabular-nums text-ds-muted">{getParameterSummary(task)}</span>
        </span>
        <span className="mt-1 flex h-10 items-center gap-2 border-t border-ds-border pt-2">
          <StatusIndicator tone={status.tone} pulse={status.pulse} className="shrink-0 text-[10px]">{status.label}</StatusIndicator>
          <span className="min-w-0 flex-1 truncate text-center text-[10px] font-medium tabular-nums text-ds-muted">{formatTaskTime(task.createdAt)}</span>
          <span className="shrink-0 text-[10px] font-semibold tabular-nums text-ds-muted">
            <span className="text-ds-success">{counts.completed}</span> 完成 · <span className={counts.failed ? 'text-ds-danger' : 'text-ds-muted'}>{counts.failed}</span> 失败
          </span>
        </span>
      </button>
      {imageCount > 1 && (
        <>
          <button
            type="button"
            aria-label={`上一张：${title}`}
            className="absolute left-3 top-[104px] z-30 flex h-9 w-9 items-center justify-center rounded-full bg-ds-surface/90 text-ds-text shadow-ds-md outline-none transition-[background-color,transform] duration-150 hover:scale-105 hover:bg-ds-surface focus-visible:ring-2 focus-visible:ring-ds-primary motion-reduce:transition-none"
            onClick={() => setActiveImageIndex((current) => (current - 1 + imageCount) % imageCount)}
          >
            <ChevronLeftIcon className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`下一张：${title}`}
            className="absolute right-3 top-[104px] z-30 flex h-9 w-9 items-center justify-center rounded-full bg-ds-surface/90 text-ds-text shadow-ds-md outline-none transition-[background-color,transform] duration-150 hover:scale-105 hover:bg-ds-surface focus-visible:ring-2 focus-visible:ring-ds-primary motion-reduce:transition-none"
            onClick={() => setActiveImageIndex((current) => (current + 1) % imageCount)}
          >
            <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </>
      )}
    </article>
  )
}, (previous, next) => (
  previous.task === next.task
  && previous.active === next.active
  && previous.onNavigate === next.onNavigate
))

export default function GalleryTaskNavigator({ activeTaskId, onNavigate, tasks }: GalleryTaskNavigatorProps) {
  const scrollContainerRef = useRef<HTMLElement>(null)
  const [viewport, setViewport] = useState({ height: 0, scrollTop: 0 })
  const tasksWithImages = useMemo(() => tasks.filter((task) => task.outputImages.length > 0), [tasks])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    let frame = 0
    const updateViewport = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const next = { height: container.clientHeight, scrollTop: container.scrollTop }
        setViewport((current) => (
          current.height === next.height && current.scrollTop === next.scrollTop ? current : next
        ))
      })
    }

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateViewport)
    observer?.observe(container)
    container.addEventListener('scroll', updateViewport, { passive: true })
    updateViewport()
    return () => {
      observer?.disconnect()
      container.removeEventListener('scroll', updateViewport)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  const virtualWindow = getTaskGridVirtualWindow({
    itemCount: tasksWithImages.length,
    columns: 1,
    rowHeight: NAVIGATOR_ROW_HEIGHT,
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.height,
    overscanRows: NAVIGATOR_OVERSCAN_ROWS,
  })
  const visibleTasks = tasksWithImages.slice(virtualWindow.start, virtualWindow.end)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TaskOverview tasks={tasks} />
      <nav
        ref={scrollContainerRef}
        aria-label="图片任务导航"
        className="doupao-side-panel__scroll relative min-h-0 flex-1 overflow-y-auto px-2"
      >
        {tasksWithImages.length > 0 ? (
          <div style={{ height: virtualWindow.totalHeight }}>
            <div className="absolute inset-x-2" style={{ top: virtualWindow.offsetTop }}>
              {visibleTasks.map((task) => (
                <NavigatorTaskCard key={task.id} task={task} active={task.id === activeTaskId} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<ImageIcon size={20} />}
            title="当前没有可定位的图片"
            description="调整画廊筛选，或等待任务生成图片。"
          />
        )}
      </nav>
    </div>
  )
}
