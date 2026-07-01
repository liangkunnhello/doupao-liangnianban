import { mapLayerPositionToCanvas, planBackgroundFit } from './compositeRenderPlan'
import type { CompositeV2MediaLayer, CompositeV2Preset, CompositeV2FitMode, CompositeV2Stroke, CompositeV2TextLayer } from './compositeV2Types'

type Size = { width: number; height: number }
const MAX_OVERLAY_CACHE_SIZE = 50
const overlayCache = new Map<string, HTMLCanvasElement>()

export type CompositeV2RenderInput = {
  backgroundDataUrl?: string
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

export function getScaledLayerStrokeWidth(stroke: CompositeV2Stroke | undefined, base: Size, target: Size) {
  if (!stroke?.enabled || stroke.width <= 0) return 0
  return stroke.width * Math.min(target.width / base.width, target.height / base.height)
}

export function getCompositeOverlayCacheKey(preset: Pick<CompositeV2Preset, 'id' | 'updatedAt'>, target: Size) {
  return `${preset.id}:${preset.updatedAt}:${target.width}x${target.height}`
}

export async function renderCombinedOverlay(preset: CompositeV2Preset, target: Size) {
  const key = getCompositeOverlayCacheKey(preset, target)
  const cached = overlayCache.get(key)
  if (cached) {
    overlayCache.delete(key)
    overlayCache.set(key, cached)
    return cached
  }
  const overlay = document.createElement('canvas')
  overlay.width = target.width
  overlay.height = target.height
  const overlayCtx = overlay.getContext('2d')
  if (!overlayCtx) throw new Error('当前环境不支持 Canvas')
  for (const layer of [...preset.layers].reverse()) {
    if (layer.visible) await drawLayer(overlayCtx, layer, preset, target)
  }
  
  if (overlayCache.size >= MAX_OVERLAY_CACHE_SIZE) {
    const firstKey = overlayCache.keys().next().value
    if (firstKey) overlayCache.delete(firstKey)
  }
  overlayCache.set(key, overlay)
  
  return overlay
}

async function resolveLayerImage(layer: CompositeV2MediaLayer) {
  if (!layer.asset) return null
  if (layer.asset.kind === 'dataUrl' && layer.asset.dataUrl) {
    return loadImage(layer.asset.dataUrl)
  }
  if (layer.asset.kind === 'project') {
    const { useCompositeV2Store } = await import('../storeV2')
    const logo = useCompositeV2Store.getState().projectLogos.find(l => l.id === (layer.asset as any).id)
    return logo?.dataUrl ? loadImage(logo.dataUrl) : null
  }
  const path = 'path' in layer.asset ? layer.asset.path : undefined
  if (!path) return null
  const api = window.electronAPI
  const payload = await api?.readImageFile?.(path)
  return payload?.dataUrl ? loadImage(payload.dataUrl) : null
}

function applyShadow(ctx: CanvasRenderingContext2D, layer: CompositeV2TextLayer | CompositeV2MediaLayer, base: Size, target: Size) {
  if (!layer.shadow.enabled) return
  const scaleX = target.width / base.width
  const scaleY = target.height / base.height
  const scale = Math.min(scaleX, scaleY)
  const alpha = Math.max(0, Math.min(1, layer.shadow.opacity))
  const hex = layer.shadow.color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
  ctx.shadowColor = hex
    ? `rgba(${Number.parseInt(hex[1]!, 16)}, ${Number.parseInt(hex[2]!, 16)}, ${Number.parseInt(hex[3]!, 16)}, ${alpha})`
    : layer.shadow.color
  ctx.shadowOffsetX = layer.shadow.x * scale
  ctx.shadowOffsetY = layer.shadow.y * scale
  ctx.shadowBlur = layer.shadow.blur * scale
}

async function drawLayer(ctx: CanvasRenderingContext2D, layer: CompositeV2TextLayer | CompositeV2MediaLayer, preset: CompositeV2Preset, target: Size) {
  const rect = mapLayerPositionToCanvas(layer.position, preset.baseCanvas, target)
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity))
  ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2)
  ctx.rotate((layer.rotation * Math.PI) / 180)
  applyShadow(ctx, layer, preset.baseCanvas, target)

  if (layer.type !== 'text') {
    const image = await resolveLayerImage(layer)
    if (image) {
      if (layer.clip) {
        const radius = Math.min(layer.radius, rect.width / 2, rect.height / 2)
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(-rect.width / 2, -rect.height / 2, rect.width, rect.height, radius)
        ctx.clip()
        ctx.drawImage(image, -rect.width / 2, -rect.height / 2, rect.width, rect.height)
        ctx.restore()
      } else {
        ctx.drawImage(image, -rect.width / 2, -rect.height / 2, rect.width, rect.height)
      }
      const strokeWidth = getScaledLayerStrokeWidth(layer.stroke, preset.baseCanvas, target)
      if (strokeWidth > 0) {
        const radius = Math.min(layer.radius, rect.width / 2, rect.height / 2)
        ctx.beginPath()
        ctx.roundRect(-rect.width / 2, -rect.height / 2, rect.width, rect.height, radius)
        ctx.strokeStyle = layer.stroke?.color || '#111827'
        ctx.lineWidth = strokeWidth
        ctx.lineJoin = 'round'
        ctx.stroke()
      }
    }
  } else {
    const metrics = getScaledTextMetrics(layer.fontSize, layer.stroke?.width || 0, preset.baseCanvas, target)
    const scale = Math.min(target.width / preset.baseCanvas.width, target.height / preset.baseCanvas.height)
    const padding = (layer.padding ?? 5) * scale
    ctx.font = `${layer.fontWeight} ${metrics.fontSize}px ${layer.fontFamily}`
    ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${layer.letterSpacing * Math.min(target.width / preset.baseCanvas.width, target.height / preset.baseCanvas.height)}px`
    ctx.fillStyle = layer.color
    ctx.textAlign = layer.align
    ctx.textBaseline = 'middle'
    const lines = layer.text.split('\n')
    const textX = layer.align === 'left' ? -rect.width / 2 + padding : layer.align === 'right' ? rect.width / 2 - padding : 0
    lines.forEach((line, index) => {
      const y = (index - (lines.length - 1) / 2) * metrics.fontSize * layer.lineHeight
      if (layer.stroke?.enabled && metrics.strokeWidth > 0) {
        ctx.strokeStyle = layer.stroke.color || '#000000'
        ctx.lineWidth = metrics.strokeWidth
        ctx.lineJoin = 'round'
        ctx.strokeText(line, textX, y, Math.max(1, rect.width - padding * 2))
      }
      ctx.fillText(line, textX, y, Math.max(1, rect.width - padding * 2))
    })
  }
  ctx.restore()
}

export async function renderCompositeV2ToCanvas(input: CompositeV2RenderInput, canvas: HTMLCanvasElement) {
  const background = input.backgroundDataUrl ? await loadImage(input.backgroundDataUrl) : null
  const overlay = await renderCombinedOverlay(input.preset, input.targetSize)

  canvas.width = input.targetSize.width
  canvas.height = input.targetSize.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前环境不支持 Canvas')
  ctx.clearRect(0, 0, input.targetSize.width, input.targetSize.height)

  if (background) {
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
  }

  ctx.drawImage(overlay, 0, 0)
  return canvas
}

export async function renderCompositeV2ToJpegDataUrl(input: CompositeV2RenderInput) {
  const canvas = document.createElement('canvas')
  await renderCompositeV2ToCanvas(input, canvas)
  return canvas.toDataURL('image/jpeg', input.quality ?? 0.9)
}
