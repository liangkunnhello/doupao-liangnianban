import { expandCompositeExportItems, type CompositeV2ExportSnapshot } from './compositeExportPlan'
import { buildCompositeOutputPathParts, withCollisionSuffix } from './compositePathTemplates'
import { renderCompositeV2ToJpegDataUrl } from './compositeRendererV2'
import type { CompositeV2FailureItem, CompositeV2SuccessItem } from './compositeV2Types'

export type CompositeV2ExportRuntimeCallbacks = {
  onProgress: (completed: number, total: number) => void
  onSuccess: (item: CompositeV2SuccessItem) => void
  onFailure: (item: CompositeV2FailureItem) => void
  shouldPause: () => boolean
  shouldCancel: () => boolean
}

export function dataUrlSizeKb(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] ?? ''
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.ceil((base64.length * 3 / 4 - padding) / 1024)
}

export async function waitWhilePaused(
  shouldPause: () => boolean,
  shouldCancel: () => boolean,
  sleep: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 150)),
) {
  while (shouldPause() && !shouldCancel()) await sleep()
}

async function renderWithMaxKb(
  input: Omit<Parameters<typeof renderCompositeV2ToJpegDataUrl>[0], 'quality'>,
  maxSizeKb: number,
) {
  let low = 0.5
  let high = 0.9
  let bestDataUrl = await renderCompositeV2ToJpegDataUrl({ ...input, quality: low })
  if (dataUrlSizeKb(bestDataUrl) > maxSizeKb) {
    return { dataUrl: bestDataUrl, warning: `最低质量 0.5 仍超过 ${maxSizeKb}KB` }
  }
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const quality = (low + high) / 2
    const dataUrl = await renderCompositeV2ToJpegDataUrl({ ...input, quality })
    if (dataUrlSizeKb(dataUrl) <= maxSizeKb) {
      bestDataUrl = dataUrl
      low = quality
    } else {
      high = quality
    }
  }
  return { dataUrl: bestDataUrl }
}

async function resolveCollision(api: NonNullable<Window['electronAPI']>, directoryParts: string[], filename: string) {
  let candidate = await api.pathJoin(...directoryParts, filename)
  let suffix = 1
  while (await api.checkExists(candidate)) {
    candidate = await api.pathJoin(...directoryParts, withCollisionSuffix(filename, suffix))
    suffix += 1
  }
  return candidate
}

export async function runCompositeV2Export(snapshot: CompositeV2ExportSnapshot, callbacks: CompositeV2ExportRuntimeCallbacks) {
  const api = window.electronAPI
  if (!api) throw new Error('当前环境不支持本地导出')
  const items = expandCompositeExportItems(snapshot)
  callbacks.onProgress(0, items.length)
  let completed = 0

  for (const item of items) {
    await waitWhilePaused(callbacks.shouldPause, callbacks.shouldCancel)
    if (callbacks.shouldCancel()) break
    try {
      const background = await api.readImageFile(item.background.path)
      if (!background?.dataUrl) throw new Error('背景图读取失败')
      const rendered = await renderWithMaxKb({
        backgroundDataUrl: background.dataUrl,
        preset: item.preset,
        targetSize: { width: item.outputRule.width, height: item.outputRule.height },
        fitMode: snapshot.fitMode,
      }, item.outputRule.maxSizeKb)
      const pathParts = buildCompositeOutputPathParts({
        date: item.date,
        channel: item.outputRule.channelName,
        size: item.outputRule.name,
        preset: item.preset.name,
        index: item.index,
        source: item.background.name.replace(/\.[^.]+$/, ''),
        sourceDir: item.background.relativeDir,
        custom: item.custom,
        subfolderTemplate: item.outputRule.subfolderTemplate,
        filenameTemplate: item.outputRule.filenameTemplate,
        preserveSourceDir: snapshot.preserveSourceDir,
      })
      const directoryParts = [item.preset.outputRootPath, pathParts.dateFolder, ...pathParts.subfolders]
      const outputPath = await resolveCollision(api, directoryParts, pathParts.filename)
      const saved = await api.saveCompositeImage(outputPath, rendered.dataUrl)
      if (!saved) throw new Error('图片写入失败')
      callbacks.onSuccess({
        path: outputPath,
        presetId: item.preset.id,
        presetName: item.preset.name,
        channel: item.outputRule.channelName,
        size: item.outputRule.name,
        index: item.index,
        warning: rendered.warning,
      })
    } catch (error) {
      callbacks.onFailure({
        backgroundPath: item.background.path,
        presetId: item.preset.id,
        presetName: item.preset.name,
        channel: item.outputRule.channelName,
        size: item.outputRule.name,
        reason: error instanceof Error ? error.message : '未知错误',
      })
    }
    completed += 1
    callbacks.onProgress(completed, items.length)
  }
}
