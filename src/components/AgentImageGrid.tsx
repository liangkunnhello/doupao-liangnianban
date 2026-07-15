import { useEffect, useMemo, useState } from 'react'
import type { TaskRecord } from '../types'
import { ensureImageThumbnailCached, subscribeImageThumbnail, useStore } from '../store'

export type AgentImageGridItem =
  | { task: TaskRecord; taskId: string }
  | { task: null; taskId: string }

export interface AgentImageGridEntry {
  key: string
  task: TaskRecord | null
  taskId: string
  imageId: string | null
  imageIndex: number
}

export function getAgentImageGridEntries(items: AgentImageGridItem[]): AgentImageGridEntry[] {
  return items.flatMap<AgentImageGridEntry>((item) => {
    if (!item.task) {
      return [{ key: `deleted:${item.taskId}`, task: null, taskId: item.taskId, imageId: null, imageIndex: 0 }]
    }
    if (item.task.outputImages.length === 0) {
      return [{ key: `task:${item.task.id}`, task: item.task, taskId: item.task.id, imageId: null, imageIndex: 0 }]
    }
    const task = item.task
    return task.outputImages.map((imageId, imageIndex) => ({
      key: `${task.id}:${imageId}`,
      task,
      taskId: task.id,
      imageId,
      imageIndex,
    }))
  })
}

function getEntryAspectRatio(task: TaskRecord | null, imageId: string | null) {
  const actualSize = imageId ? task?.actualParamsByImage?.[imageId]?.size : undefined
  const size = actualSize ?? task?.actualParams?.size ?? task?.params.size
  if (typeof size !== 'string') return 1
  const match = size.match(/^(\d+)x(\d+)$/i)
  if (!match) return 1
  const width = Number(match[1])
  const height = Number(match[2])
  return width > 0 && height > 0 ? width / height : 1
}

function AgentImageTile({ entry, imageList }: { entry: AgentImageGridEntry; imageList: string[] }) {
  const [thumbnailSrc, setThumbnailSrc] = useState('')
  const streamPreviewSrc = useStore((state) => entry.task ? state.streamPreviews[entry.task.id] || '' : '')
  const setLightboxImageId = useStore((state) => state.setLightboxImageId)
  const imageId = entry.imageId
  const task = entry.task

  useEffect(() => {
    setThumbnailSrc('')
    if (!imageId) return

    let cancelled = false
    const applyThumbnail = (thumbnail: { dataUrl: string }) => {
      if (!cancelled) setThumbnailSrc(thumbnail.dataUrl)
    }
    const unsubscribe = subscribeImageThumbnail(imageId, applyThumbnail)
    ensureImageThumbnailCached(imageId)
      .then((thumbnail) => {
        if (thumbnail) applyThumbnail(thumbnail)
      })
      .catch(() => {
        if (!cancelled) setThumbnailSrc('')
      })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [imageId])

  const src = thumbnailSrc || (!imageId ? streamPreviewSrc : '')
  const isRunning = task?.status === 'running'
  const isError = task?.status === 'error'
  const isDeleted = !task
  const canOpen = Boolean(imageId && src)

  return (
    <button
      type="button"
      disabled={!canOpen}
      aria-label={canOpen ? `查看第 ${entry.imageIndex + 1} 张生成图片` : undefined}
      onClick={() => {
        if (imageId) setLightboxImageId(imageId, imageList)
      }}
      className={`group/image relative min-h-[150px] w-full overflow-hidden rounded-xl border bg-gray-100 text-left transition-[border-color,box-shadow] dark:bg-black/20 ${
        canOpen
          ? 'cursor-zoom-in border-gray-200 hover:border-blue-400/70 hover:shadow-lg dark:border-white/[0.08] dark:hover:border-blue-400/60'
          : 'cursor-default border-dashed border-gray-200 dark:border-white/[0.08]'
      }`}
      style={{ aspectRatio: getEntryAspectRatio(task, imageId) }}
    >
      {src ? (
        <img
          src={src}
          data-image-id={imageId ?? undefined}
          className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover/image:scale-[1.03]"
          alt=""
          loading="lazy"
        />
      ) : (
        <div className="flex h-full min-h-[150px] w-full items-center justify-center px-4 text-center text-xs text-gray-400 dark:text-gray-500">
          {isDeleted ? '图片已删除' : isError ? '生成失败' : '正在生成图片…'}
        </div>
      )}

      {isRunning && (
        <span className="absolute right-2 top-2 rounded-md bg-blue-600/90 px-2 py-1 text-[11px] font-medium text-white shadow-sm backdrop-blur">
          生成中
        </span>
      )}
      {isError && src && (
        <span className="absolute right-2 top-2 rounded-md bg-amber-500/90 px-2 py-1 text-[11px] font-medium text-white shadow-sm backdrop-blur">
          部分完成
        </span>
      )}
    </button>
  )
}

export default function AgentImageGrid({ items, imageList }: { items: AgentImageGridItem[]; imageList: string[] }) {
  const entries = useMemo(() => getAgentImageGridEntries(items), [items])
  if (entries.length === 0) return null

  return (
    <div className="mt-3 grid w-full grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-4" onClick={(event) => event.stopPropagation()}>
      {entries.map((entry) => (
        <AgentImageTile key={entry.key} entry={entry} imageList={imageList} />
      ))}
    </div>
  )
}
