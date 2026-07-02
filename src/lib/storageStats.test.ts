import { describe, expect, it } from 'vitest'
import { getStorageOverview } from './storageStats'

describe('getStorageOverview', () => {
  it('combines quota usage and record counts without loading records', async () => {
    await expect(getStorageOverview({
      estimate: async () => ({ usage: 80, quota: 100 }),
      counts: async () => ({ tasks: 10, images: 20, thumbnails: 18, conversations: 2, compositeAssets: 3 }),
    })).resolves.toEqual({
      usageBytes: 80,
      quotaBytes: 100,
      usagePercent: 80,
      counts: { tasks: 10, images: 20, thumbnails: 18, conversations: 2, compositeAssets: 3 },
    })
  })

  it('handles unavailable quota information', async () => {
    const result = await getStorageOverview({
      estimate: async () => ({}),
      counts: async () => ({ tasks: 0, images: 0, thumbnails: 0, conversations: 0, compositeAssets: 0 }),
    })
    expect(result.usagePercent).toBeNull()
  })
})
