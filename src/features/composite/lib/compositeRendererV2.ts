import { mapLayerPositionToCanvas, planBackgroundFit } from './compositeRenderPlan'
import type { CompositeV2ImageLayer, CompositeV2Preset, CompositeV2FitMode, CompositeV2TextLayer } from './compositeV2Types'

type Size = { width: number; height: number }
const overlayCache = new Map<string, HTMLCanvasElement>()

export type CompositeV2RenderInput = {
  backgroundDataUrl: string
  preset: CompositeV2Preset
  targetSize: Size
  fitMode: CompositeV2FitMode
  quality?: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = src
  })
}

export function getScaledTextMetrics(fontSize: number, strokeWidth: number, base: Size, target: Size) {
  const scale = Math.min(target.width / base.width, target.height / base.height)
  return { fontSize: fontSize * scale, strokeWidth: strokeWidth * scale }
}

export function getCompositeOverlayCacheKey(preset: Pick<CompositeV2Preset, 'id' | 'updatedAt'>, target: Size) {
  return `${preset.id}:${preset.updatedAt}:${target.width}x${target.height}`
}

async function renderCombinedOverlay(preset: CompositeV2Preset, target: Size) {
  const key = getCompositeOverlayCacheKey(preset, target)
  const cached = overlayCache.get(key)
  if (cached) return cached
  const overlay = document.createElement('canvas')
  overlay.width = target.width
  overlay.height = target.height
  const overlayCtx = overlay.getContext('2d')
  if (!overlayCtx) throw new Error('当前环境不支持 Canvas')
  for (const layer of [...preset.layers].reverse()) {
    if (layer.visible) await drawLayer(overlayCtx, layer, preset, target)
  }
  overlayCache.set(key, overlay)
  return overlay
}

async function resolveLayerImage(layer: CompositeV2ImageLayer) {
  if (!layer.asset) return null
  const api = window.electronAPI
  const payload = await api?.readImageFile?.(layer.asset.path)
  return payload?.dataUrl ? loadImage(payload.dataUrl) : null
}

function applyShadow(ctx: CanvasRenderingContext2D, layer: CompositeV2TextLayer | CompositeV2ImageLayer, base: Size, target: Size) {
  if (!layer.shadow.enabled) return
  const scaleX = target.width / base.width
  const scaleY = target.height / base.height
  const alpha = Math.max(0, Math.min(1, layer.shadow.opacity))
  const hex = layer.shadow.color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
  ctx.shadowColor = hex
    ? `rgba(${Number.parseInt(hex[1]!, 16)}, ${Number.parseInt(hex[2]!, 16)}, ${Number.parseInt(hex[3]!, 16)}, ${alpha})`
    : layer.shadow.color
  ctx.shadowOffsetX = layer.shadow.x * scaleX
  ctx.shadowOffsetY = layer.shadow.y * scaleY
  ctx.shadowBlur = layer.shadow.blur * Math.min(scaleX, scaleY)
}

async function drawLayer(ctx: CanvasRenderingContext2D, layer: CompositeV2TextLayer | CompositeV2ImageLayer, preset: CompositeV2Preset, target: Size) {
  const rect = mapLayerPositionToCanvas(layer.position, preset.baseCanvas, target)
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity))
  ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2)
  ctx.rotate((layer.rotation * Math.PI) / 180)
  applyShadow(ctx, layer, preset.baseCanvas, target)

  if (layer.type === 'image') {
    const image = await resolveLayerImage(layer)
    if (image) {
      if (layer.clip) {
        const radius = Math.min(layer.radius, rect.width / 2, rect.height / 2)
        ctx.beginPath()
        ctx.roundRect(-rect.width / 2, -rect.height / 2, rect.width, rect.height, radius)
        ctx.clip()
      }
      ctx.drawImage(image, -rect.width / 2, -rect.height / 2, rect.width, rect.height)
    }
  } else {
    const metrics = getScaledTextMetrics(layer.fontSize, layer.stroke.width, preset.baseCanvas, target)
    ctx.font = `${layer.fontWeight} ${metrics.fontSize}px ${layer.fontFamily}`
    ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${layer.letterSpacing * Math.min(target.width / preset.baseCanvas.width, target.height / preset.baseCanvas.height)}px`
    ctx.fillStyle = layer.color
    ctx.textAlign = layer.align
    ctx.textBaseline = 'middle'
    const lines = layer.text.split('\n')
    const textX = layer.align === 'left' ? -rect.width / 2 : layer.align === 'right' ? rect.width / 2 : 0
    lines.forEach((line, index) => {
      const y = (index - (lines.length - 1) / 2) * metrics.fontSize * layer.lineHeight
      if (layer.stroke.enabled && metrics.strokeWidth > 0) {
        ctx.strokeStyle = layer.stroke.color
        ctx.lineWidth = metrics.strokeWidth
        ctx.strokeText(line, textX, y, rect.width)
      }
      ctx.fillText(line, textX, y, rect.width)
    })
  }
  ctx.restore()
}

export async function renderCompositeV2ToCanvas(input: CompositeV2RenderInput, canvas: HTMLCanvasElement) {
  const background = await loadImage(input.backgroundDataUrl)
  canvas.width = input.targetSize.width
  canvas.height = input.targetSize.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前环境不支持 Canvas')

  if (input.fitMode === 'contain-blur') {
    ctx.save()
    ctx.filter = 'blur(24px)'
    ctx.drawImage(background, -24, -24, input.targetSize.width + 48, input.targetSize.height + 48)
    ctx.restore()
  }
  const rect = planBackgroundFit(
    input.fitMode,
    { width: background.naturalWidth, height: background.naturalHeight },
    input.targetSize,
  )
  ctx.drawImage(background, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh)

  const overlay = await renderCombinedOverlay(input.preset, input.targetSize)
  ctx.drawImage(overlay, 0, 0)
  return canvas
}

export async function renderCompositeV2ToJpegDataUrl(input: CompositeV2RenderInput) {
  const canvas = document.createElement('canvas')
  await renderCompositeV2ToCanvas(input, canvas)
  return canvas.toDataURL('image/jpeg', input.quality ?? 0.9)
}
