import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  IMAGE_ASPECT_RATIO_TOLERANCE,
  parseRequestedImageDimensions,
  validateGeneratedImageAspectRatio,
} from './imageAspectRatioGate'

const canvasImageMocks = vi.hoisted(() => ({
  getImageDimensions: vi.fn(),
}))

vi.mock('./canvasImage', () => ({
  getImageDimensions: canvasImageMocks.getImageDimensions,
}))

beforeEach(() => {
  canvasImageMocks.getImageDimensions.mockReset()
})

describe('image aspect ratio gate', () => {
  it('parses explicit dimensions and skips auto sizing', async () => {
    expect(parseRequestedImageDimensions('720x1280')).toEqual({ width: 720, height: 1280 })
    expect(parseRequestedImageDimensions('1024 × 1536')).toEqual({ width: 1024, height: 1536 })
    expect(parseRequestedImageDimensions('auto')).toBeNull()

    await expect(validateGeneratedImageAspectRatio('data:image/png;base64,x', 'auto')).resolves.toEqual({
      accepted: true,
      required: false,
      requestedSize: 'auto',
    })
    expect(canvasImageMocks.getImageDimensions).not.toHaveBeenCalled()
  })

  it('accepts the requested ratio within the one percent tolerance', async () => {
    canvasImageMocks.getImageDimensions.mockResolvedValue({ width: 1080, height: 1919 })

    const result = await validateGeneratedImageAspectRatio('data:image/png;base64,x', '720x1280')

    expect(result.accepted).toBe(true)
    expect(result.relativeError).toBeLessThanOrEqual(IMAGE_ASPECT_RATIO_TOLERANCE)
  })

  it('rejects a decodable image with the wrong ratio', async () => {
    canvasImageMocks.getImageDimensions.mockResolvedValue({ width: 1024, height: 1024 })

    const result = await validateGeneratedImageAspectRatio('data:image/png;base64,x', '720x1280')

    expect(result).toMatchObject({
      accepted: false,
      required: true,
      expected: { width: 720, height: 1280 },
      actual: { width: 1024, height: 1024 },
      error: '图片比例门禁未通过：要求 720x1280，实际 1024x1024',
    })
  })

  it('rejects an image whose dimensions cannot be read', async () => {
    canvasImageMocks.getImageDimensions.mockRejectedValue(new Error('decode failed'))

    await expect(validateGeneratedImageAspectRatio('data:image/png;base64,x', '720x1280')).resolves.toMatchObject({
      accepted: false,
      required: true,
      error: '图片比例门禁无法读取返回图片尺寸，要求 720x1280',
    })
  })
})
