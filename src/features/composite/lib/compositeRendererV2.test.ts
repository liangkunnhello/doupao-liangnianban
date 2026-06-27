import { describe, expect, it } from 'vitest'
import { getCompositeOverlayCacheKey, getScaledTextMetrics } from './compositeRendererV2'

describe('composite renderer v2', () => {
  it('scales text metrics from the preset base canvas', () => {
    expect(getScaledTextMetrics(48, 2, { width: 1280, height: 720 }, { width: 640, height: 360 }))
      .toEqual({ fontSize: 24, strokeWidth: 1 })
  })

  it('keys combined watermark overlays by preset revision and target size', () => {
    expect(getCompositeOverlayCacheKey({ id: 'p1', updatedAt: 123 }, { width: 640, height: 360 }))
      .toBe('p1:123:640x360')
  })
})
