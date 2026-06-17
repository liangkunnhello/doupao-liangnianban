import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskParams } from '../types'
import { getImagePostprocessPlan } from './imagePostprocess'

function params(overrides: Partial<TaskParams> = {}): TaskParams {
  return { ...DEFAULT_PARAMS, ...overrides }
}

describe('image postprocess plan', () => {
  it('keeps postprocessing disabled by default', () => {
    const plan = getImagePostprocessPlan(DEFAULT_PARAMS)

    expect(plan.enabled).toBe(false)
    expect(plan.resize).toBeNull()
    expect(plan.encode.mime).toBeNull()
  })

  it('normalizes resize dimensions when resize is enabled', () => {
    const plan = getImagePostprocessPlan(params({
      postprocess_resize_enabled: true,
      postprocess_size: '1025x1025',
    }))

    expect(plan.enabled).toBe(true)
    expect(plan.resize).toEqual({ width: 1024, height: 1024 })
  })

  it('rejects auto resize targets when resize is enabled', () => {
    expect(() => getImagePostprocessPlan(params({
      postprocess_resize_enabled: true,
      postprocess_size: 'auto',
    }))).toThrow('postprocess size')
  })

  it('uses selected compression format and quality for JPEG/WebP', () => {
    expect(getImagePostprocessPlan(params({
      postprocess_compress_enabled: true,
      postprocess_format: 'jpeg',
      postprocess_quality: 80,
    })).encode).toEqual({ format: 'jpeg', mime: 'image/jpeg', quality: 0.8 })

    expect(getImagePostprocessPlan(params({
      postprocess_compress_enabled: true,
      postprocess_format: 'webp',
      postprocess_quality: 55,
    })).encode).toEqual({ format: 'webp', mime: 'image/webp', quality: 0.55 })
  })

  it('ignores quality for PNG compression', () => {
    expect(getImagePostprocessPlan(params({
      postprocess_compress_enabled: true,
      postprocess_format: 'png',
      postprocess_quality: 10,
    })).encode).toEqual({ format: 'png', mime: 'image/png', quality: undefined })
  })

  it('resizes before encoding when both switches are enabled', () => {
    const plan = getImagePostprocessPlan(params({
      postprocess_resize_enabled: true,
      postprocess_size: '1536x1024',
      postprocess_compress_enabled: true,
      postprocess_format: 'webp',
      postprocess_quality: 90,
    }))

    expect(plan.enabled).toBe(true)
    expect(plan.resize).toEqual({ width: 1536, height: 1024 })
    expect(plan.encode).toEqual({ format: 'webp', mime: 'image/webp', quality: 0.9 })
  })
})
