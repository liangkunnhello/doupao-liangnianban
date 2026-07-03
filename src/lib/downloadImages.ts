import { ensureImageCached } from '../store'
import { zipSync } from 'fflate'
import type { TaskRecord, WorkspaceTab } from '../types'
import { buildGeneratedImageFileNameBase, type GeneratedImageFilenameSettings } from './generatedImageFilename'

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export interface DownloadImagesResult {
  successCount: number
  failCount: number
}

export interface DownloadImageZipEntry {
  imageId: string
  fileNameBase?: string
}

type TaskOutputZipTask = Pick<TaskRecord, 'id' | 'createdAt' | 'outputImages'>

export function formatExportFileTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

export async function downloadImageIds(imageIds: string[], fileNameBase = 'images'): Promise<DownloadImagesResult> {
  if (imageIds.length === 0) return { successCount: 0, failCount: 0 }

  let successCount = 0
  let failCount = 0
  const multiple = imageIds.length > 1

  for (let index = 0; index < imageIds.length; index++) {
    try {
      const blob = await getImageBlob(imageIds[index])
      const order = String(index + 1).padStart(2, '0')
      const fileName = multiple
        ? `${fileNameBase}-${order}.${getBlobExtension(blob)}`
        : `${fileNameBase}.${getBlobExtension(blob)}`
      triggerDownload(blob, fileName)
      successCount++
      if (multiple) await delay(100)
    } catch (err) {
      console.error(err)
      failCount++
    }
  }

  return { successCount, failCount }
}

export async function downloadImageEntries(entries: DownloadImageZipEntry[]): Promise<DownloadImagesResult> {
  let successCount = 0
  let failCount = 0

  for (const entry of entries) {
    try {
      const blob = await getImageBlob(entry.imageId)
      const fileNameBase = sanitizeFileNamePart(entry.fileNameBase || 'image') || 'image'
      triggerDownload(blob, `${fileNameBase}.${getBlobExtension(blob)}`)
      successCount++
      if (entries.length > 1) await delay(100)
    } catch (err) {
      console.error(err)
      failCount++
    }
  }

  return { successCount, failCount }
}

export async function downloadImageEntriesAsZip(entries: DownloadImageZipEntry[], zipFileNameBase = 'images'): Promise<DownloadImagesResult> {
  if (entries.length === 0) return { successCount: 0, failCount: 0 }

  let successCount = 0
  let failCount = 0
  const zipFiles: Record<string, Uint8Array | [Uint8Array, { mtime: Date }]> = {}
  const usedNames = new Set<string>()

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    try {
      const blob = await getImageBlob(entry.imageId)
      const order = String(index + 1).padStart(2, '0')
      const base = sanitizeFileNamePart(entry.fileNameBase || `image-${order}`) || `image-${order}`
      const ext = getBlobExtension(blob)
      let fileName = `${base}.${ext}`
      let duplicateIndex = 2
      while (usedNames.has(fileName)) {
        fileName = `${base}-${String(duplicateIndex).padStart(2, '0')}.${ext}`
        duplicateIndex++
      }
      usedNames.add(fileName)
      zipFiles[fileName] = [new Uint8Array(await blob.arrayBuffer()), { mtime: new Date() }]
      successCount++
    } catch (err) {
      console.error(err)
      failCount++
    }
  }

  if (successCount > 0) {
    const zipped = zipSync(zipFiles, { level: 6 })
    const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
    triggerDownload(new Blob([buffer], { type: 'application/zip' }), `${sanitizeFileNamePart(zipFileNameBase) || 'images'}.zip`)
  }

  return { successCount, failCount }
}

export function getTaskOutputImageZipEntries(tasks: TaskOutputZipTask[]): DownloadImageZipEntry[] {
  return [...tasks]
    .sort((a, b) => b.createdAt - a.createdAt)
    .flatMap((task) => getImageZipEntries(task.outputImages || [], `task-${task.id}`))
}

export function getGeneratedImageDownloadEntries(
  tasks: TaskRecord[],
  workspaceTabs: WorkspaceTab[],
  settings: GeneratedImageFilenameSettings,
  imageIds?: string[],
): DownloadImageZipEntry[] {
  const buildEntry = (task: TaskRecord, imageId: string, index: number): DownloadImageZipEntry => {
    const containingTab = workspaceTabs.find((tab) => tab.tasks.some((item) => item.id === task.id))
    const label = containingTab?.name
      ?? task.scheduledOutputSubFolder
      ?? getPathBaseName(task.scheduledOutputPath)
      ?? 'image'
    return {
      imageId,
      fileNameBase: buildGeneratedImageFileNameBase({
        createdAt: task.createdAt,
        label,
        prompt: task.prompt,
      }, settings, index + 1),
    }
  }

  if (!imageIds) {
    return tasks.flatMap((task) => task.outputImages.map((imageId, index) => buildEntry(task, imageId, index)))
  }

  return imageIds.flatMap((imageId) => {
    for (const task of tasks) {
      const outputIndex = task.outputImages.indexOf(imageId)
      if (outputIndex >= 0) return [buildEntry(task, imageId, outputIndex)]
      const partialIndex = task.streamPartialImageIds?.indexOf(imageId) ?? -1
      if (partialIndex >= 0) return [buildEntry(task, imageId, partialIndex)]
    }
    return []
  })
}

export function getImageZipEntries(imageIds: string[], fileNameBase = 'image'): DownloadImageZipEntry[] {
  const multiple = imageIds.length > 1
  return imageIds.map((imageId, index) => ({
    imageId,
    fileNameBase: multiple ? `${fileNameBase}-${String(index + 1).padStart(2, '0')}` : fileNameBase,
  }))
}

function getPathBaseName(value?: string): string | null {
  if (!value) return null
  const parts = value.trim().replace(/[\\/]+$/, '').split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || null
}

async function getImageBlob(imageIdOrUrl: string): Promise<Blob> {
  let src = imageIdOrUrl
  if (!imageIdOrUrl.startsWith('data:') && !imageIdOrUrl.startsWith('http://') && !imageIdOrUrl.startsWith('https://')) {
    src = await ensureImageCached(imageIdOrUrl) ?? imageIdOrUrl
  }

  const res = await fetch(src)
  if (!res.ok && !src.startsWith('data:')) throw new Error(`读取图片失败：${imageIdOrUrl}`)
  return await res.blob()
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function getBlobExtension(blob: Blob): string {
  return MIME_EXTENSIONS[blob.type.toLowerCase()] ?? blob.type.split('/')[1] ?? 'png'
}

function sanitizeFileNamePart(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-').replace(/\s+/g, ' ').slice(0, 220)
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
