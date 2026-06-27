import type { CompositeV2FitMode, CompositeV2Position } from './compositeV2Types'

type Size = { width: number; height: number }

export type CompositeV2RenderBranch = 'source-first' | 'target-first'

export type CompositeV2DrawRect = {
  sx: number
  sy: number
  sw: number
  sh: number
  dx: number
  dy: number
  dw: number
  dh: number
}

function assertValidSize(size: Size) {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    throw new Error('Invalid composite size')
  }
}

export function chooseRenderBranch(source: Size, target: Size, tolerance = 0.001): CompositeV2RenderBranch {
  assertValidSize(source)
  assertValidSize(target)

  const sourceRatio = source.width / source.height
  const targetRatio = target.width / target.height
  return Math.abs(sourceRatio - targetRatio) <= tolerance ? 'source-first' : 'target-first'
}

export function planBackgroundFit(mode: CompositeV2FitMode, source: Size, target: Size): CompositeV2DrawRect {
  assertValidSize(source)
  assertValidSize(target)

  if (mode === 'stretch') {
    return {
      sx: 0,
      sy: 0,
      sw: source.width,
      sh: source.height,
      dx: 0,
      dy: 0,
      dw: target.width,
      dh: target.height,
    }
  }

  const scale = mode === 'crop-fill'
    ? Math.max(target.width / source.width, target.height / source.height)
    : Math.min(target.width / source.width, target.height / source.height)

  if (mode === 'contain-blur') {
    const dw = source.width * scale
    const dh = source.height * scale
    return {
      sx: 0,
      sy: 0,
      sw: source.width,
      sh: source.height,
      dx: (target.width - dw) / 2,
      dy: (target.height - dh) / 2,
      dw,
      dh,
    }
  }

  const sw = target.width / scale
  const sh = target.height / scale
  return {
    sx: (source.width - sw) / 2,
    sy: (source.height - sh) / 2,
    sw,
    sh,
    dx: 0,
    dy: 0,
    dw: target.width,
    dh: target.height,
  }
}

export function mapLayerPositionToCanvas(position: CompositeV2Position, base: Size, target: Size) {
  assertValidSize(base)
  assertValidSize(target)
  assertValidSize({ width: position.width, height: position.height })

  const scaleX = target.width / base.width
  const scaleY = target.height / base.height

  if (position.mode === 'free') {
    return {
      x: position.x * scaleX,
      y: position.y * scaleY,
      width: position.width * scaleX,
      height: position.height * scaleY,
    }
  }

  const width = position.width * scaleX
  const height = position.height * scaleY
  const marginX = position.marginX * scaleX
  const marginY = position.marginY * scaleY
  const offsetX = position.offsetX * scaleX
  const offsetY = position.offsetY * scaleY
  const [vertical, horizontal] = position.anchor.split('-') as [string, string | undefined]
  const h = horizontal ?? vertical
  const v = horizontal ? vertical : 'center'
  const x = h === 'left' ? marginX : h === 'right' ? target.width - width - marginX : (target.width - width) / 2
  const y = v === 'top' ? marginY : v === 'bottom' ? target.height - height - marginY : (target.height - height) / 2

  return { x: x + offsetX, y: y + offsetY, width, height }
}
