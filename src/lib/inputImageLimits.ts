export const MAX_DIRECT_INPUT_IMAGES = 100
export const MAX_FOLDER_IMAGES = 999
export const MAX_ALL_REFERENCE_IMAGES = 16
export const MAX_ALL_REFERENCE_PAYLOAD_BYTES = 50 * 1024 * 1024

export function formatInputImageLimitBytes(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)} MiB`
}

export function shouldCycleReferenceImages(
  referenceMode: 'cycle' | 'all' | undefined,
  inputImageCount: number,
  outputImageCount: number,
) {
  return referenceMode !== 'all' && inputImageCount > 0 && outputImageCount > 1
}
