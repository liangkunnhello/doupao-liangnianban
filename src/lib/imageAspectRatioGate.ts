import { getImageDimensions, type ImageDimensions } from './canvasImage'

export const IMAGE_ASPECT_RATIO_TOLERANCE = 0.01
const IMAGE_ASPECT_RATIO_DECODE_TIMEOUT_MS = 5_000

export interface ImageAspectRatioGateResult {
  accepted: boolean
  required: boolean
  requestedSize: string
  expected?: ImageDimensions
  actual?: ImageDimensions
  relativeError?: number
  error?: string
}

export function parseRequestedImageDimensions(size: string): ImageDimensions | null {
  const match = size.trim().match(/^(\d+)\s*[xX×]\s*(\d+)$/)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

async function getImageDimensionsWithTimeout(dataUrl: string): Promise<ImageDimensions> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      getImageDimensions(dataUrl),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('图片尺寸读取超时')),
          IMAGE_ASPECT_RATIO_DECODE_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function validateGeneratedImageAspectRatio(
  dataUrl: string,
  requestedSize: string,
  tolerance = IMAGE_ASPECT_RATIO_TOLERANCE,
): Promise<ImageAspectRatioGateResult> {
  const expected = parseRequestedImageDimensions(requestedSize)
  if (!expected) {
    return { accepted: true, required: false, requestedSize }
  }

  let actual: ImageDimensions
  try {
    actual = await getImageDimensionsWithTimeout(dataUrl)
  } catch {
    return {
      accepted: false,
      required: true,
      requestedSize,
      expected,
      error: `图片比例门禁无法读取返回图片尺寸，要求 ${requestedSize}`,
    }
  }

  if (
    !Number.isFinite(actual.width) ||
    !Number.isFinite(actual.height) ||
    actual.width <= 0 ||
    actual.height <= 0
  ) {
    return {
      accepted: false,
      required: true,
      requestedSize,
      expected,
      actual,
      error: `图片比例门禁读取到无效尺寸，要求 ${requestedSize}`,
    }
  }

  const targetRatio = expected.width / expected.height
  const actualRatio = actual.width / actual.height
  const relativeError = Math.abs(actualRatio - targetRatio) / targetRatio
  const accepted = relativeError <= Math.max(0, tolerance)

  return {
    accepted,
    required: true,
    requestedSize,
    expected,
    actual,
    relativeError,
    ...(accepted
      ? {}
      : { error: `图片比例门禁未通过：要求 ${requestedSize}，实际 ${actual.width}x${actual.height}` }),
  }
}
