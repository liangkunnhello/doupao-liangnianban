import type { CompositeFsImage, CompositePickMode } from './compositeTypes'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

function getExtension(name: string) {
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index).toLowerCase() : ''
}

export function isCompositeImageFile(name: string) {
  return IMAGE_EXTENSIONS.has(getExtension(name))
}

export function filterCompositeImageFiles(files: CompositeFsImage[]) {
  return files.filter((file) => isCompositeImageFile(file.name))
}

export function pickCompositeAsset(
  files: CompositeFsImage[],
  mode: CompositePickMode,
  index: number,
  random = Math.random,
) {
  const images = filterCompositeImageFiles(files)
  if (!images.length) throw new Error('没有可用图片素材')
  if (mode === 'random') {
    return images[Math.min(images.length - 1, Math.floor(random() * images.length))]
  }
  return images[((index % images.length) + images.length) % images.length]
}
