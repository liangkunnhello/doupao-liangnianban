import {
  expandCompositeExportItems,
  type CompositeV2ExportItem,
  type CompositeV2ExportSnapshot,
} from './compositeExportPlan'
import {
  buildCompositeOutputPathParts,
  resolveCompositeTemplate,
  withCollisionSuffix,
} from './compositePathTemplates'
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
  maxQuality = 0.9,
  callbacks?: { shouldPause: () => boolean; shouldCancel: () => boolean },
) {
  let low = 0.01
  let high = Math.max(low, Math.min(1, maxQuality))
  if (maxSizeKb <= 0) {
    return { dataUrl: await renderCompositeV2ToJpegDataUrl({ ...input, quality: high }) }
  }
  let bestDataUrl = await renderCompositeV2ToJpegDataUrl({ ...input, quality: low })
  
  if (callbacks?.shouldCancel()) throw new Error('渲染被取消')

  if (dataUrlSizeKb(bestDataUrl) > maxSizeKb) {
    return { dataUrl: bestDataUrl, warning: `最低质量 0.01 仍超过 ${maxSizeKb}KB` }
  }
  for (let iteration = 0; iteration < 8; iteration += 1) {
    if (callbacks?.shouldPause && callbacks?.shouldCancel) {
      await waitWhilePaused(callbacks.shouldPause, callbacks.shouldCancel)
    }
    if (callbacks?.shouldCancel()) throw new Error('渲染被取消')

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

export function buildPresetOutputPathParts(
  item: CompositeV2ExportItem,
  _snapshot: Pick<CompositeV2ExportSnapshot, 'preserveSourceDir'>,
) {
  const output = buildCompositeOutputPathParts({
    ...buildPresetTemplateVariables(item),
    namingTemplate: item.preset.outputFolderTemplate ?? '',
    filenameTemplate: item.preset.filenameTemplate,
    preserveSourceDir: false,
  })
  return {
    subfolders: item.preset.outputFolderTemplate
      ? output.subfolders
      : [output.filename.replace(/\.jpg$/i, '')],
    filename: output.filename,
  }
}

function buildPresetTemplateVariables(item: CompositeV2ExportItem) {
  return {
    date: item.date,
    channel: item.outputRule.channelName,
    size: item.outputRule.name,
    preset: item.preset.name,
    index: item.preset.indexPadding
      ? String(item.index).padStart(item.preset.indexPadding, '0')
      : item.index,
    source: item.background.name.replace(/\.[^.]+$/, ''),
    sourceDir: item.background.relativeDir,
    custom: item.custom,
    customVariables: item.preset.customVariableValues,
  }
}

export function buildPresetOutputRootPath(item: CompositeV2ExportItem) {
  return resolveCompositeTemplate(
    item.preset.outputRootPath,
    buildPresetTemplateVariables(item),
  )
}

export async function authorizeCompositeOutputRoot(
  api: NonNullable<Window['electronAPI']>,
  outputRoot: string,
  authorizedRoots: Set<string>,
) {
  if (authorizedRoots.has(outputRoot)) return
  const authorized = await api.authorizeCompositeOutputDirectory?.(outputRoot)
  if (!authorized) throw new Error('输出目录必须是绝对路径')
  authorizedRoots.add(outputRoot)
}

function setExportingActive(active: boolean) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (active) root.setAttribute('data-exporting', 'true')
  else root.removeAttribute('data-exporting')
}

export async function runCompositeV2Export(snapshot: CompositeV2ExportSnapshot, callbacks: CompositeV2ExportRuntimeCallbacks) {
  const api = window.electronAPI
  if (!api) throw new Error('当前环境不支持本地导出')
  const items = expandCompositeExportItems(snapshot)
  const authorizedRoots = new Set<string>()
  callbacks.onProgress(0, items.length)
  let completed = 0

  setExportingActive(true)
  try {
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
      }, item.outputRule.maxSizeKb, item.outputRule.jpegQuality ?? 0.9, {
        shouldPause: callbacks.shouldPause,
        shouldCancel: callbacks.shouldCancel,
      })
      const pathParts = buildPresetOutputPathParts(item, snapshot)
      const outputRoot = buildPresetOutputRootPath(item)
      await authorizeCompositeOutputRoot(api, outputRoot, authorizedRoots)
      const directoryParts = [outputRoot, ...pathParts.subfolders]
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
  } finally {
    setExportingActive(false)
  }
}
