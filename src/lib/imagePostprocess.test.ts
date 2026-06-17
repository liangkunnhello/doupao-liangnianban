import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskParams } from '../types'
import { getImagePostprocessPlan, mergePostprocessedActualParams, postprocessGeneratedImage } from './imagePostprocess'

const canvasImageMocks = vi.hoisted(() => ({
  loadImage: vi.fn(),
  canvasToBlob: vi.fn(),
}))

vi.mock('./canvasImage', () => ({
  loadImage: canvasImageMocks.loadImage,
  canvasToBlob: canvasImageMocks.canvasToBlob,
}))

function params(overrides: Partial<TaskParams> = {}): TaskParams {
  return { ...DEFAULT_PARAMS, ...overrides }
}

const originalDocument = globalThis.document
const originalFileReader = globalThis.FileReader

beforeEach(() => {
  canvasImageMocks.loadImage.mockReset()
  canvasImageMocks.canvasToBlob.mockReset()

  const canvasContext = {
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => canvasContext),
  }

  globalThis.document = {
    createElement: vi.fn((tag: string) => {
      if (tag === 'canvas') return canvas
      return null
    }),
  } as any

  class MockFileReader {
    result: string | ArrayBuffer | null = null
    onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null
    onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null

    readAsDataURL(blob: Blob) {
      this.result = `data:${blob.type};base64,encoded`
      this.onload?.call(this as any, {} as ProgressEvent<FileReader>)
    }
  }

  globalThis.FileReader = MockFileReader as any
})

afterEach(() => {
  globalThis.document = originalDocument
  globalThis.FileReader = originalFileReader
  vi.restoreAllMocks()
})

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
    expect(plan.resize).toEqual({ width: 1025, height: 1025 })
  })

  it('keeps small resize targets unchanged', () => {
    const plan = getImagePostprocessPlan(params({
      postprocess_resize_enabled: true,
      postprocess_size: '100 x 100',
    }))

    expect(plan.resize).toEqual({ width: 100, height: 100 })
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

  it('merges postprocessed actual params over original values', () => {
    expect(mergePostprocessedActualParams(
      { size: '2048x2048', output_format: 'png', quality: 'high' },
      { size: '1024x1024', output_format: 'webp' },
    )).toEqual({
      size: '1024x1024',
      output_format: 'webp',
      quality: 'high',
    })
  })

  it('returns undefined when both actual param inputs are empty', () => {
    expect(mergePostprocessedActualParams(undefined, {})).toBeUndefined()
  })

  it('returns the original image when postprocessing is disabled', async () => {
    const dataUrl = 'data:image/png;base64,original'

    await expect(postprocessGeneratedImage(dataUrl, DEFAULT_PARAMS)).resolves.toEqual({
      dataUrl,
      actualParams: {},
    })
    expect(canvasImageMocks.loadImage).not.toHaveBeenCalled()
    expect(canvasImageMocks.canvasToBlob).not.toHaveBeenCalled()
  })

  it('accepts image/jpg as jpeg during resize-only postprocessing', async () => {
    canvasImageMocks.loadImage.mockResolvedValue({ naturalWidth: 640, naturalHeight: 480 })
    canvasImageMocks.canvasToBlob.mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }))

    const result = await postprocessGeneratedImage('data:image/jpg;base64,source', params({
      postprocess_resize_enabled: true,
      postprocess_size: '320x240',
    }))

    expect(canvasImageMocks.loadImage).toHaveBeenCalledWith('data:image/jpg;base64,source')
    expect(canvasImageMocks.canvasToBlob).toHaveBeenCalledWith(expect.any(Object), 'image/jpeg', undefined)
    expect(result).toEqual({
      dataUrl: 'data:image/jpeg;base64,encoded',
      actualParams: {
        size: '320x240',
        output_format: 'jpeg',
      },
    })
  })

  it('rejects unsupported browser MIME fallback for explicit compression', async () => {
    canvasImageMocks.loadImage.mockResolvedValue({ naturalWidth: 640, naturalHeight: 480 })
    canvasImageMocks.canvasToBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))

    await expect(postprocessGeneratedImage('data:image/png;base64,source', params({
      postprocess_compress_enabled: true,
      postprocess_format: 'webp',
    }))).rejects.toThrow('Local image postprocessing failed: image/webp output is not supported')
  })
})
