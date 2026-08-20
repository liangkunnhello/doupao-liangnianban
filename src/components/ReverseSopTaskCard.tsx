import { memo, useEffect, useState, type MouseEvent } from 'react'
import { EyeIcon as Eye, LoaderCircleIcon as LoaderCircle, RefreshIcon as RefreshCw, SquareIcon as Square, TrashIcon as Trash2, WandSparklesIcon as WandSparkles } from '../design-system/icons'
import { ensureImageThumbnailCached, subscribeImageThumbnail } from '../store'
import type { TaskRecord } from '../types'
import { Card, IconButton } from '../design-system'

function Cover({ imageId, running }: { imageId: string; running: boolean }) {
  const [source, setSource] = useState('')
  useEffect(() => {
    if (!imageId) return
    let active = true
    const apply = (value: { dataUrl: string }) => {
      if (active) setSource(value.dataUrl)
    }
    const unsubscribe = subscribeImageThumbnail(imageId, apply)
    void ensureImageThumbnailCached(imageId).then((value) => value && apply(value))
    return () => {
      active = false
      unsubscribe()
    }
  }, [imageId])

  if (source) return <img src={source} alt="反推 SOP 生成结果" className="h-full w-full object-cover" />
  return (
    <div className="flex flex-col items-center gap-2 text-center text-gray-400 dark:text-gray-500">
      {running ? <LoaderCircle size={28} className="animate-spin motion-reduce:animate-none" /> : <WandSparkles size={28} />}
      <span className="text-xs">{running ? '流程执行中' : '等待图片'}</span>
    </div>
  )
}

function stageLabel(stage: TaskRecord['reverseSop'] extends infer T ? T extends { role: 'controller'; stage: infer S } ? S : never : never) {
  const labels: Record<string, string> = {
    queued: '等待执行',
    'reverse-sop': '反推 SOP',
    'generate-variable-prompts': '生成变量提示词',
    'expand-variable-prompts': '展开变量提示词',
    'generate-images': '生成图片',
    completed: '已完成',
    error: '执行失败',
    stopped: '已停止',
  }
  return labels[String(stage)] ?? '处理中'
}

function ReverseSopTaskCard({
  controller,
  imageTasks,
  isSelected,
  onClick,
  onOpen,
  onStop,
  onRetry,
  onDelete,
}: {
  controller: TaskRecord
  imageTasks: TaskRecord[]
  isSelected: boolean
  onClick: (event: MouseEvent) => void
  onOpen: () => void
  onStop: () => void
  onRetry: () => void
  onDelete: () => void
}) {
  const meta = controller.reverseSop?.role === 'controller' ? controller.reverseSop : null
  if (!meta) return null
  const outputImageIds = imageTasks.flatMap((task) => task.outputImages)
  const imageTotal = meta.promptCount * meta.imagesPerPrompt
  const running = !['completed', 'error', 'stopped'].includes(meta.stage)
  const canStop = running
  const canRetry = meta.stage === 'error' || meta.stage === 'stopped'

  return (
    <div className="gallery-card-shell relative rounded-xl">
      <Card
        onClick={onClick}
        data-selected={isSelected || undefined}
        data-status={meta.stage === 'error' ? 'error' : running ? 'running' : 'done'}
        className="gallery-task-card gallery-sop-card relative flex h-44 cursor-pointer overflow-hidden transition-[box-shadow,border-color,background-color,transform]"
      >
        {isSelected && <span aria-hidden="true" className="gallery-selection-check absolute right-2 top-2 z-10 flex h-5 w-5 items-center justify-center text-xs font-bold">✓</span>}
        <div className="gallery-task-media relative flex h-full w-40 min-w-[10rem] shrink-0 items-center justify-center overflow-hidden">
          <Cover imageId={outputImageIds[0] ?? ''} running={running} />
          <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">{outputImageIds.length}/{imageTotal}</span>
        </div>
        <div className="gallery-task-body flex min-w-0 flex-1 flex-col p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-medium"><WandSparkles size={13} className="mr-1 inline" />反推 SOP</span>
            <span className="shrink-0 text-xs tabular-nums">{meta.variablePrompts.length} 模板</span>
          </div>
          <h3 className="gallery-task-prompt truncate text-sm font-medium">{stageLabel(meta.stage)}</h3>
          <p className="gallery-task-meta mt-1 line-clamp-2 min-h-9 text-xs leading-relaxed">{meta.stageMessage || meta.brief || '参考图反推变量提示词流程'}</p>
          {meta.metaInstructionName && <p className="gallery-task-meta mt-1 truncate text-[11px]">元指令：{meta.metaInstructionName}</p>}
          <p className="gallery-task-meta mt-1 text-xs">{meta.promptCount} 条提示词 · 每条 {meta.imagesPerPrompt} 张 · 参考 {meta.sourceImageIds.length} 张</p>
          <div data-no-drag-select className="gallery-task-actions ml-auto mt-auto flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
            <IconButton type="button" onClick={onOpen} aria-label="查看反推 SOP 任务详情" title="查看流程" className="gallery-task-action gallery-task-action--primary" size="sm" icon={<Eye size={16} />} />
            {canStop && <IconButton type="button" onClick={onStop} aria-label="停止反推 SOP 任务" title="停止" className="gallery-task-action" size="sm" icon={<Square size={15} />} />}
            {canRetry && <IconButton type="button" onClick={onRetry} aria-label="重试反推 SOP 任务" title="重试" className="gallery-task-action gallery-task-action--primary" size="sm" icon={<RefreshCw size={16} />} />}
            <IconButton type="button" onClick={onDelete} aria-label="删除反推 SOP 任务" title="删除" className="gallery-task-action gallery-task-action--danger" size="sm" icon={<Trash2 size={16} />} />
          </div>
        </div>
      </Card>
    </div>
  )
}

export default memo(ReverseSopTaskCard)
