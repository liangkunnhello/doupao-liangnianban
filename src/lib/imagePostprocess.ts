import type { TaskParams } from '../types'
import { MIME_MAP } from './imageApiShared'
import { canvasToBlob, loadImage } from './canvasImage'

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

export interface ProcessImageResult {
  dataUrl: string
  actualParams: Partial<TaskParams>
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

export async function postprocessGeneratedImage(dataUrl: string, params: TaskParams): Promise<ProcessImageResult> {
  const plan = getImagePostprocessPlan(params)
  if (!plan.enabled) {
    return { dataUrl, actualParams: {} }
  }

  const image = await loadImage(dataUrl)
  const width = plan.resize?.width ?? image.naturalWidth
  const height = plan.resize?.height ?? image.naturalHeight
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Local image postprocessing failed: invalid image dimensions')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('褰撳墠娴忚鍣ㄤ笉鏀寔 Canvas')

  const requestedMime = plan.encode.mime ?? getDataUrlMime(dataUrl) ?? 'image/png'
  if (requestedMime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.drawImage(image, 0, 0, width, height)

  const blob = await canvasToBlob(canvas, requestedMime, plan.encode.quality)
  if (blob.type && blob.type !== requestedMime) {
    throw new Error(`Local image postprocessing failed: ${requestedMime} output is not supported`)
  }

  const finalMime = blob.type || requestedMime
  const outputFormat = getOutputFormatFromMime(finalMime)
  return {
    dataUrl: await blobToDataUrl(blob, finalMime),
    actualParams: {
      size: `${width}x${height}`,
      ...(outputFormat ? { output_format: outputFormat } : {}),
    },
  }
}

export function mergePostprocessedActualParams(
  original: Partial<TaskParams> | undefined,
  postprocessed: Partial<TaskParams> | undefined,
): Partial<TaskParams> | undefined {
  const merged = { ...(original ?? {}), ...(postprocessed ?? {}) }
  return Object.keys(merged).length ? merged : undefined
}

function getResizePlan(size: string): PostprocessResizePlan {
  const parsed = parseNormalizedSize(size)
  if (!parsed) {
    throw new Error('Local postprocess size is invalid')
  }

  return parsed
}

function parseNormalizedSize(size: string): PostprocessResizePlan | null {
  const match = size.trim().match(/^(\d+)\s*[xX×]\s*(\d+)$/)
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

function getDataUrlMime(dataUrl: string): string | null {
  const match = /^data:([^;,]+)(?:;[^,]*)?,/i.exec(dataUrl)
  return match ? match[1].toLowerCase() : null
}

function getOutputFormatFromMime(mime: string): TaskParams['output_format'] | undefined {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpeg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/png') return 'png'
  return 'png'
}

async function blobToDataUrl(blob: Blob, fallbackMime: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : `data:${blob.type || fallbackMime};base64,`)
    reader.onerror = () => reject(new Error('鍥剧墖瀵煎嚭澶辫触'))
    reader.readAsDataURL(blob)
  })
}
