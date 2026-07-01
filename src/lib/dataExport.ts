import type { StoredImage } from '../types'

type ExportTaskRefs = {
  inputImageIds?: string[]
  maskImageId?: string | null
  outputImages?: string[]
  streamPartialImageIds?: string[]
}

type ExportConversationRefs = { rounds?: Array<{ inputImageIds?: string[] }> }

export function collectReferencedExportImageIds(
  tasks: ExportTaskRefs[],
  conversations: ExportConversationRefs[],
): string[] {
  const ids = new Set<string>()
  const add = (values?: string[]) => values?.forEach((id) => id && ids.add(id))
  for (const task of tasks) {
    add(task.inputImageIds)
    if (task.maskImageId) ids.add(task.maskImageId)
    add(task.outputImages)
    add(task.streamPartialImageIds)
  }
  for (const conversation of conversations) {
    for (const round of conversation.rounds ?? []) add(round.inputImageIds)
  }
  return [...ids]
}

export type ElectronImageExportEntry = {
  imageId: string
  sourcePath: string
  archivePath: string
  createdAt?: number
}

export async function buildElectronImageExportEntries(
  ids: string[],
  getImage: (id: string) => Promise<StoredImage | undefined>,
): Promise<ElectronImageExportEntry[]> {
  const entries: ElectronImageExportEntry[] = []
  for (const id of ids) {
    const image = await getImage(id)
    if (!image) throw new Error(`图片 ${id} 已不存在`)
    if (!image.localPath) throw new Error(`图片 ${id} 尚未迁移到本地存储`)
    const match = image.localPath.match(/\.([a-zA-Z0-9]+)$/)
    const ext = match?.[1].toLowerCase()
    if (!ext || !['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      throw new Error(`图片 ${id} 的文件格式不受支持`)
    }
    entries.push({
      imageId: id,
      sourcePath: image.localPath,
      archivePath: `images/${id}.${ext}`,
      createdAt: image.createdAt,
    })
  }
  return entries
}
