import type { TaskParams } from '../types'
import { MIME_MAP } from './imageApiShared'
import { normalizeImageSize } from './size'

export interface PostprocessResizePlan {
  width: number
  height: number
}

export interface PostprocessEncodePlan {
  format: TaskParams['output_format'] | null
  mime: string | null
  quality?: number
}

export interface ImagePostprocessPlan {
  enabled: boolean
  resize: PostprocessResizePlan | null
  encode: PostprocessEncodePlan
}

export function getImagePostprocessPlan(params: TaskParams): ImagePostprocessPlan {
  const resize = params.postprocess_resize_enabled ? getResizePlan(params.postprocess_size) : null
  const encode = params.postprocess_compress_enabled
    ? getEncodePlan(params.postprocess_format, params.postprocess_quality)
    : { format: null, mime: null }

  return {
    enabled: Boolean(resize || encode.mime),
    resize,
    encode,
  }
}

function getResizePlan(size: string): PostprocessResizePlan {
  const normalized = normalizeImageSize(size)
  if (!normalized || normalized === 'auto') {
    throw new Error('Local postprocess size is invalid')
  }

  const parsed = parseNormalizedSize(normalized)
  if (!parsed) {
    throw new Error('Local postprocess size is invalid')
  }

  return parsed
}

function parseNormalizedSize(size: string): PostprocessResizePlan | null {
  const match = size.match(/^(\d+)x(\d+)$/)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

function getEncodePlan(
  format: TaskParams['output_format'],
  quality: number | null,
): PostprocessEncodePlan {
  const mime = MIME_MAP[format]
  if (!mime) throw new Error('Local postprocess format is invalid')

  return {
    format,
    mime,
    quality: format === 'png' ? undefined : normalizeCanvasQuality(quality),
  }
}

function normalizeCanvasQuality(value: number | null): number {
  if (value == null || !Number.isFinite(value)) return 0.9
  return Math.min(1, Math.max(0, value / 100))
}
