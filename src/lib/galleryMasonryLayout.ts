export interface GalleryMasonryLayoutItem {
  height: number
  index: number
  left: number
  top: number
  width: number
}

interface GalleryMasonryLayoutOptions {
  aspectRatios: number[]
  columnWidth: number
  columns: number
  gap: number
}

export interface GalleryMasonryLayout {
  columns: GalleryMasonryLayoutItem[][]
  items: GalleryMasonryLayoutItem[]
  totalHeight: number
}

function normalizeAspectRatio(value: number | undefined) {
  return Number.isFinite(value) && value && value > 0 ? Math.min(4, Math.max(0.25, value)) : 1
}

export function buildGalleryMasonryLayout({ aspectRatios, columnWidth, columns, gap }: GalleryMasonryLayoutOptions): GalleryMasonryLayout {
  const safeColumns = Math.max(1, Math.round(columns))
  const safeColumnWidth = Math.max(1, columnWidth)
  const safeGap = Math.max(0, gap)
  const columnHeights = Array.from({ length: safeColumns }, () => 0)
  const layoutColumns = Array.from({ length: safeColumns }, () => [] as GalleryMasonryLayoutItem[])
  const items: GalleryMasonryLayoutItem[] = []

  aspectRatios.forEach((aspectRatio, index) => {
    let column = 0
    for (let candidate = 1; candidate < safeColumns; candidate++) {
      if (columnHeights[candidate] < columnHeights[column]) column = candidate
    }

    const height = safeColumnWidth / normalizeAspectRatio(aspectRatio)
    const item = {
      index,
      left: column * (safeColumnWidth + safeGap),
      top: columnHeights[column],
      width: safeColumnWidth,
      height,
    }
    items.push(item)
    layoutColumns[column].push(item)
    columnHeights[column] += height + safeGap
  })

  return {
    columns: layoutColumns,
    items,
    totalHeight: Math.max(0, ...columnHeights.map((height) => height - safeGap)),
  }
}

function findFirstVisibleItem(items: GalleryMasonryLayoutItem[], start: number) {
  let lower = 0
  let upper = items.length
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2)
    if (items[middle].top + items[middle].height <= start) {
      lower = middle + 1
    } else {
      upper = middle
    }
  }
  return lower
}

export function getVisibleGalleryMasonryItems(
  layout: GalleryMasonryLayout,
  scrollTop: number,
  viewportHeight: number,
  overscan = viewportHeight,
) {
  const start = Math.max(0, scrollTop - overscan)
  const end = Math.max(start, scrollTop + viewportHeight + overscan)
  const visible: GalleryMasonryLayoutItem[] = []

  layout.columns.forEach((column) => {
    for (let index = findFirstVisibleItem(column, start); index < column.length; index++) {
      const item = column[index]
      if (item.top >= end) break
      visible.push(item)
    }
  })

  return visible.sort((first, second) => first.index - second.index)
}
