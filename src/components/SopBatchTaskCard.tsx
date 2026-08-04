import { memo, useEffect, useState, type MouseEvent } from 'react'
import {
  BookOpenCheckIcon as BookOpenCheck,
  ImageIcon,
  LoaderCircleIcon as LoaderCircle,
  RefreshIcon as RefreshCw,
  TrashIcon as Trash2,
} from '../design-system/icons'
import { ensureImageThumbnailCached, subscribeImageThumbnail } from '../store'
import type { TaskRecord } from '../types'
import { formatSopBatchElapsed, getSopBatchElapsedMs, type SopBatchSummary } from '../lib/sopBatchTaskGrouping'
import { Badge, Button, Card, IconButton } from '../design-system'
import TaskParamSummary from './TaskParamSummary'

function BatchThumbnail({ task, imageId, variantIndex, onClick }: { task: TaskRecord; imageId: string; variantIndex: number; onClick: (imageId: string) => void }) {
  const [src, setSrc] = useState('')
  const accessibleLabel = Math.max(task.params?.n ?? 1, task.outputImages.length) > 1
    ? `查看第 ${task.sopBatch?.promptIndex ?? 1} 条 SOP 提示词的第 ${variantIndex} 张图片`
    : `查看第 ${task.sopBatch?.promptIndex ?? 1} 条 SOP 提示词的图片`

  useEffect(() => {
    if (!imageId) return
    let active = true
    const apply = (next: { dataUrl: string }) => { if (active) setSrc(next.dataUrl) }
    const unsubscribe = subscribeImageThumbnail(imageId, apply)
    void ensureImageThumbnailCached(imageId).then((value) => value && apply(value))
    return () => { active = false; unsubscribe() }
  }, [imageId])

  return <button type="button" data-no-drag-select disabled={!imageId} onClick={(event) => { event.stopPropagation(); onClick(imageId) }} aria-label={imageId ? accessibleLabel : `第 ${task.sopBatch?.promptIndex ?? 1} 条 SOP 提示词正在生成图片`} className="sop-batch-thumbnail relative min-h-0 overflow-hidden transition hover:brightness-90 focus-visible:outline-none disabled:cursor-default disabled:hover:brightness-100">
    {src ? <img src={src} alt={`SOP 提示词 ${task.sopBatch?.promptIndex ?? 1} 的生成结果`} className="h-full w-full object-cover" /> : task.status === 'running' ? <LoaderCircle size={18} className="absolute inset-0 m-auto animate-spin motion-reduce:animate-none" /> : <ImageIcon size={18} className="absolute inset-0 m-auto" />}
    <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1 py-0.5 text-[10px] font-medium text-white">{task.sopBatch?.promptIndex ?? 1}-{variantIndex}</span>
  </button>
}

function SopBatchTaskCard({
  sopName,
  tasks,
  summary,
  isSelected = false,
  onClick,
  onOpenBatch,
  onOpenImage,
  onRerun,
  onDelete,
}: {
  sopName: string
  tasks: TaskRecord[]
  summary: SopBatchSummary
  isSelected?: boolean
  onClick: (event: MouseEvent<HTMLElement>) => void
  onOpenBatch: () => void
  onOpenImage: (imageId: string) => void
  onRerun: () => void
  onDelete: () => void
}) {
  const [now, setNow] = useState(Date.now())
  const previews = tasks.flatMap((task) => Array.from(
    { length: Math.max(task.params?.n ?? 1, task.outputImages.length) },
    (_, index) => ({ task, imageId: task.outputImages[index] ?? '', variantIndex: index + 1 }),
  )).slice(0, 4)
  const imageTotal = tasks.reduce((total, task) => total + Math.max(task.params?.n ?? 1, task.outputImages.length), 0)
  const imageCompleted = tasks.reduce((total, task) => total + task.outputImages.length, 0)
  const status = summary.running > 0 ? '生成中' : summary.failed === summary.total ? '生成失败' : summary.failed > 0 ? '部分完成' : '已完成'
  const statusTone = summary.running > 0 ? 'info' : summary.failed === summary.total ? 'danger' : summary.failed > 0 ? 'warning' : 'success'
  const isRunning = tasks.some((task) => task.status === 'running' || task.falRecoverable || task.customRecoverable)
  const representativeTask = tasks[0]
  const elapsed = formatSopBatchElapsed(getSopBatchElapsedMs(tasks, now))

  useEffect(() => {
    if (!isRunning) return
    setNow(Date.now())
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [isRunning])

  return <Card onClick={onClick} data-selected={isSelected || undefined} className="gallery-task-card gallery-sop-card relative flex h-44 cursor-pointer overflow-hidden">
    {isSelected && <span aria-hidden="true" className="gallery-selection-check absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center text-xs font-bold">✓</span>}
    <div className="gallery-task-media grid h-full w-40 min-w-[10rem] shrink-0 grid-cols-2 grid-rows-2 gap-px">
      {previews.map((preview) => <BatchThumbnail key={`${preview.task.id}-${preview.variantIndex}`} {...preview} onClick={onOpenImage} />)}
      {Array.from({ length: Math.max(0, 4 - previews.length) }, (_, index) => <div key={`empty-${index}`} className="sop-batch-thumbnail" />)}
    </div>
    <div className="gallery-task-body flex min-w-0 flex-1 flex-col p-3">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="gallery-sop-card__eyebrow flex items-center gap-1.5 text-xs font-medium"><BookOpenCheck size={14} />SOP 批量任务</p><h3 className="mt-1 truncate text-sm font-semibold">{sopName}</h3></div><Badge tone={statusTone} className="shrink-0 whitespace-nowrap">{status}</Badge></div>
      <p className="gallery-task-meta mt-2 truncate text-xs" title={`本批次耗时 ${elapsed}`}>图片 {imageCompleted}/{imageTotal} · 提示词 {summary.completed}/{summary.total} · 耗时 {elapsed}{summary.running ? ` · 生成中 ${summary.running}` : ''}{summary.failed ? ` · 失败 ${summary.failed}` : ''}</p>
      {representativeTask && <TaskParamSummary task={representativeTask} className="mt-2 hide-scrollbar mask-edge-r pr-2" />}
      <div aria-label="SOP 批量任务操作" className="mt-auto flex min-w-0 items-center gap-1 overflow-x-auto pt-2 hide-scrollbar">
        <Button type="button" data-no-drag-select onClick={(event) => { event.stopPropagation(); onOpenBatch() }} aria-label={`查看 SOP 批量任务 ${sopName}`} variant="ghost" size="sm" className="shrink-0 whitespace-nowrap">查看批次</Button>
        <Button type="button" data-no-drag-select onClick={(event) => { event.stopPropagation(); onRerun() }} aria-label={`再次生成 SOP 批量任务 ${sopName}`} disabled={isRunning} variant="ghost" size="sm" className="shrink-0 whitespace-nowrap"><span className="inline-flex items-center gap-1"><RefreshCw size={14} className="shrink-0" />再次生成</span></Button>
        <IconButton type="button" data-no-drag-select onClick={(event) => { event.stopPropagation(); onDelete() }} aria-label={`删除 SOP 批量任务 ${sopName}`} className="ml-auto shrink-0 ds-icon-button--danger" size="sm" icon={<Trash2 size={16} />} />
      </div>
    </div>
  </Card>
}

export default memo(SopBatchTaskCard, (previous, next) => (
  previous.sopName === next.sopName &&
  previous.tasks === next.tasks &&
  previous.summary === next.summary &&
  previous.isSelected === next.isSelected
))
