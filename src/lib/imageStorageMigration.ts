import type { StoredImage } from '../types'

export type ImageStorageMigrationDeps = {
  readBatch: (limit: number) => Promise<StoredImage[]>
  saveImage: (image: StoredImage) => Promise<string | null>
  replaceImage: (image: StoredImage) => Promise<unknown>
  batchSize?: number
  yieldToEventLoop?: () => Promise<void>
}

export async function migrateLegacyImages(deps: ImageStorageMigrationDeps): Promise<number> {
  const batchSize = deps.batchSize ?? 4
  const yieldToEventLoop = deps.yieldToEventLoop ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  let migrated = 0
  while (true) {
    const images = await deps.readBatch(batchSize)
    if (images.length === 0) return migrated
    for (const image of images) {
      if (!image.dataUrl) continue
      const localPath = await deps.saveImage(image)
      if (!localPath) throw new Error(`图片 ${image.id} 迁移失败`)
      await deps.replaceImage({ ...image, localPath, dataUrl: undefined })
      migrated++
    }
    await yieldToEventLoop()
  }
}
