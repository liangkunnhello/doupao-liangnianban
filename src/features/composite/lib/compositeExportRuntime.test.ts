import { describe, expect, it } from 'vitest'
import { dataUrlSizeKb, waitWhilePaused } from './compositeExportRuntime'

describe('composite export runtime helpers', () => {
  it('measures base64 data URLs in kilobytes', () => {
    const oneKb = Buffer.alloc(1024).toString('base64')
    expect(dataUrlSizeKb(`data:image/jpeg;base64,${oneKb}`)).toBe(1)
  })

  it('stops waiting when cancellation is requested', async () => {
    let checks = 0
    await waitWhilePaused(
      () => true,
      () => ++checks > 1,
      async () => undefined,
    )
    expect(checks).toBe(2)
  })
})
