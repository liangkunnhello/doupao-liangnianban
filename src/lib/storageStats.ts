import { getStorageRecordCounts } from './db'

export type StorageRecordCounts = Awaited<ReturnType<typeof getStorageRecordCounts>>

export type StorageOverview = {
  usageBytes: number | null
  quotaBytes: number | null
  usagePercent: number | null
  counts: StorageRecordCounts
}

type StorageOverviewDeps = {
  estimate: () => Promise<{ usage?: number; quota?: number }>
  counts: () => Promise<StorageRecordCounts>
}

const defaultDeps: StorageOverviewDeps = {
  estimate: async () => await navigator.storage?.estimate?.() ?? {},
  counts: getStorageRecordCounts,
}

export async function getStorageOverview(
  deps: StorageOverviewDeps = defaultDeps,
): Promise<StorageOverview> {
  const [estimate, counts] = await Promise.all([deps.estimate(), deps.counts()])
  const usageBytes = typeof estimate.usage === 'number' ? estimate.usage : null
  const quotaBytes = typeof estimate.quota === 'number' ? estimate.quota : null
  return {
    usageBytes,
    quotaBytes,
    usagePercent: usageBytes != null && quotaBytes
      ? Math.round((usageBytes / quotaBytes) * 100)
      : null,
    counts,
  }
}

export function formatStorageBytes(bytes: number | null): string {
  if (bytes == null) return '未知'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}
