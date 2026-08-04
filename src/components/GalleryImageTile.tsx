import { memo, useEffect, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { ensureImageThumbnailCached, subscribeImageThumbnail } from '../store'
import type { TaskRecord } from '../types'
import { CheckIcon, ImageIcon } from '../design-system/icons'

export interface GalleryImageItem {
  id: string
  imageId: string
  imageIndex: number
  task: TaskRecord
}

export function buildGalleryImageItems(tasks: TaskRecord[]): GalleryImageItem[] {
  return tasks.flatMap((task) => task.outputImages.map((imageId, imageIndex) => ({
    id: `${task.id}:${imageId}:${imageIndex}`,
    imageId,
    imageIndex,
    task,
  })))
}

interface GalleryImageTileProps {
  item: GalleryImageItem
  selected: boolean
  onSelect: (additive: boolean) => void
  onOpenDetail: () => void
  onAspectRatioChange?: (aspectRatio: number) => void
  style?: CSSProperties
}

function GalleryImageTile({ item, onAspectRatioChange, onOpenDetail, onSelect, selected, style }: GalleryImageTileProps) {
  const [thumbnailSrc, setThumbnailSrc] = useState('')

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    setThumbnailSrc('')
    const applyThumbnail = (thumbnail: { dataUrl: string; width?: number; height?: number }) => {
      if (cancelled) return
      setThumbnailSrc(thumbnail.dataUrl)
      if (thumbnail.width && thumbnail.height) onAspectRatioChange?.(thumbnail.width / thumbnail.height)
    }
    unsubscribe = subscribeImageThumbnail(item.imageId, applyThumbnail)
    ensureImageThumbnailCached(item.imageId)
      .then((thumbnail) => {
        if (thumbnail) applyThumbnail(thumbnail)
      })
      .catch(() => {
        if (!cancelled) setThumbnailSrc('')
      })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [item.imageId])

  const selectFromMouse = (event: MouseEvent<HTMLElement>) => {
    onSelect(event.ctrlKey || event.metaKey)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onOpenDetail()
      return
    }
    if (event.key === ' ') {
      event.preventDefault()
      onSelect(event.ctrlKey || event.metaKey)
    }
  }

  const imageCount = item.task.outputImages.length

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`任务图片 ${item.imageIndex + 1}，单击选择所属任务，双击或按 Enter 查看详情`}
      aria-pressed={selected}
      className={`task-card-wrapper group ${style ? 'absolute' : 'relative aspect-square'} min-w-0 cursor-default overflow-hidden rounded-xl border bg-ds-subtle outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ds-primary focus-visible:ring-offset-2 ${selected ? 'border-ds-selection-border bg-ds-selection ring-1 ring-inset ring-ds-selection-border' : 'border-ds-border hover:border-ds-selection-border'}`}
      data-task-id={item.task.id}
      onClick={selectFromMouse}
      onDoubleClick={(event) => {
        event.preventDefault()
        onOpenDetail()
      }}
      onKeyDown={handleKeyDown}
      draggable={Boolean(thumbnailSrc)}
      onDragStart={(event) => {
        if (!thumbnailSrc) return
        event.dataTransfer.setData('text/plain', `agent-images:${item.imageId}`)
        event.dataTransfer.effectAllowed = 'copy'
      }}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '160px 160px', ...style }}
    >
      {thumbnailSrc ? (
        <img
          src={thumbnailSrc}
          alt=""
          loading="eager"
          decoding="async"
          fetchPriority="low"
          draggable={false}
          data-image-id={item.imageId}
          data-output-image-ids={item.task.outputImages.join(',')}
          className="saveable-image h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-ds-muted">
          <ImageIcon size={24} />
        </div>
      )}

      {selected && (
        <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-ds-primary text-[hsl(var(--ds-color-text-inverse))] shadow-ds-sm">
          <CheckIcon size={14} />
        </span>
      )}

      {imageCount > 1 && (
        <span className="absolute right-2 top-2 rounded-md border border-ds-border bg-ds-surface/90 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-ds-muted shadow-ds-sm">
          {item.imageIndex + 1}/{imageCount}
        </span>
      )}
    </article>
  )
}

export default memo(GalleryImageTile, (previous, next) => (
  previous.item === next.item &&
  previous.selected === next.selected &&
  previous.style?.height === next.style?.height &&
  previous.style?.left === next.style?.left &&
  previous.style?.top === next.style?.top &&
  previous.style?.width === next.style?.width
))
