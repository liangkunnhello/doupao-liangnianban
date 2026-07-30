export const MAX_DIRECT_INPUT_IMAGES = 100
export const MAX_FOLDER_IMAGES = 999

export function shouldCycleReferenceImages(
  referenceMode: 'cycle' | 'all' | undefined,
  inputImageCount: number,
  outputImageCount: number,
) {
  return referenceMode !== 'all' && inputImageCount > 0 && outputImageCount > 1
}
