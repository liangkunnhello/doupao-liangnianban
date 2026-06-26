export type CompositeBatchInput = {
  mode: 'fixed' | 'custom'
  count: number
  startDate: string
  days: number
  customCounts?: number[]
}

export type CompositeBatch = {
  date: string
  count: number
}

export function sanitizeCompositeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*]/g, '_').trim()
}

function formatDateToken(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function parseDate(value: string) {
  const normalized = value.trim()
  if (/^\d{8}$/.test(normalized)) {
    return new Date(Number(normalized.slice(0, 4)), Number(normalized.slice(4, 6)) - 1, Number(normalized.slice(6, 8)))
  }
  return new Date(`${normalized}T00:00:00`)
}

export function expandCompositeBatches(input: CompositeBatchInput): CompositeBatch[] {
  const days = Math.max(1, input.days)
  const start = parseDate(input.startDate)
  return Array.from({ length: days }, (_, dayIndex) => {
    const date = new Date(start)
    date.setDate(start.getDate() + dayIndex)
    return {
      date: formatDateToken(date),
      count: input.mode === 'custom'
        ? Math.max(0, input.customCounts?.[dayIndex] ?? 0)
        : Math.max(0, input.count),
    }
  }).filter((batch) => batch.count > 0)
}

export function buildCompositeFileName({
  template,
  date,
  pageName,
  productName,
  sizeName,
  categoryName,
  fileName,
  index,
  extension,
}: {
  template: string
  date: string
  pageName: string
  productName?: string
  sizeName?: string
  categoryName?: string
  fileName?: string
  index: number
  extension: string
}) {
  const base = renderCompositeNamingTemplate({
    template,
    date,
    pageName,
    productName,
    sizeName,
    categoryName,
    fileName,
    index,
  })
  const safeExtension = extension.replace(/^\./, '')
  return `${base}.${safeExtension}`
}

export function buildCompositeFolderName({
  template,
  date,
  pageName,
  productName,
  sizeName,
  categoryName,
  fileName,
  index,
}: {
  template: string
  date: string
  pageName: string
  productName?: string
  sizeName?: string
  categoryName?: string
  fileName?: string
  index: number
}) {
  return renderCompositeNamingTemplate({
    template,
    date,
    pageName,
    productName,
    sizeName,
    categoryName,
    fileName,
    index,
  })
}

function renderCompositeNamingTemplate({
  template,
  date,
  pageName,
  productName,
  sizeName,
  categoryName,
  fileName,
  index,
}: {
  template: string
  date: string
  pageName: string
  productName?: string
  sizeName?: string
  categoryName?: string
  fileName?: string
  index: number
}) {
  const base = template
    .replaceAll('{date}', date)
    .replaceAll('{page}', pageName)
    .replaceAll('{product}', productName ?? pageName)
    .replaceAll('{size}', sizeName ?? '')
    .replaceAll('{category}', categoryName ?? '')
    .replaceAll('{width}', sizeName?.split('x')[0] ?? '')
    .replaceAll('{height}', sizeName?.split('x')[1] ?? '')
    .replaceAll('{file}', fileName ? fileName.replace(/\.[^.]+$/, '') : '')
    .replaceAll('{index}', String(index))
  return sanitizeCompositeFileName(base || `${date}-${pageName}-${index}`)
}

export function getCompositeProgress(completed: number, total: number) {
  const safeTotal = Math.max(0, total)
  const safeCompleted = Math.max(0, Math.min(completed, safeTotal))
  return {
    completed: safeCompleted,
    total: safeTotal,
    percent: safeTotal === 0 ? 0 : Math.round((safeCompleted / safeTotal) * 100),
  }
}
