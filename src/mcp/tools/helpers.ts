// 各板块工具共用的序列化与轮询辅助

import type { TaskRecord } from '../../types'
import { ensureImageCached, useStore } from '../../store'
import { getImageThumbnail } from '../../lib/db'
import { errorResult, imageResult, splitDataUrl, type McpToolResult } from '../types'

export function serializeTaskSummary(task: TaskRecord) {
  return {
    id: task.id,
    prompt: task.prompt.length > 120 ? `${task.prompt.slice(0, 120)}…` : task.prompt,
    status: task.status,
    error: task.error,
    createdAt: task.createdAt,
    finishedAt: task.finishedAt,
    elapsed: task.elapsed,
    size: task.params.size,
    quality: task.params.quality,
    count: task.params.n,
    model: task.apiModel ?? null,
    apiProfileName: task.apiProfileName ?? null,
    isFavorite: !!task.isFavorite,
    favoriteCollectionIds: task.favoriteCollectionIds ?? [],
    outputImageCount: task.outputImages.length,
    outputImageIds: task.outputImages,
    sourceMode: task.sourceMode ?? 'gallery',
    sopBatchTitle: task.sopBatch?.sopName ?? null,
  }
}

export function serializeTaskDetail(task: TaskRecord) {
  return {
    ...serializeTaskSummary(task),
    prompt: task.prompt,
    params: task.params,
    actualParams: task.actualParams ?? null,
    revisedPromptByImage: task.revisedPromptByImage ?? null,
    inputImageIds: task.inputImageIds,
    inputImageFolderPath: task.inputImageFolderPath ?? null,
    localSavedOutputImagePaths: task.localSavedOutputImagePaths ?? null,
    scheduledOutputPath: task.scheduledOutputPath ?? null,
    scheduledOutputSubFolder: task.scheduledOutputSubFolder ?? null,
    favoriteOutputPath: task.favoriteOutputPath ?? null,
    agentConversationId: task.agentConversationId ?? null,
    agentRoundId: task.agentRoundId ?? null,
    sopBatch: task.sopBatch ?? null,
    progressStage: task.progressStage ?? null,
    progressMessage: task.progressMessage ?? null,
  }
}

export function findTask(taskId: string): TaskRecord | undefined {
  return useStore.getState().tasks.find((task) => task.id === taskId)
}

/** 轮询任务直至 done/error 或超时；超时返回 null（任务仍在跑） */
export async function waitForTask(taskId: string, timeoutSeconds: number, intervalMs = 1500): Promise<TaskRecord | null> {
  const deadline = Date.now() + timeoutSeconds * 1000
  while (Date.now() < deadline) {
    const task = findTask(taskId)
    if (task && task.status !== 'running') return task
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return findTask(taskId) ?? null
}

/** 读取图片内容块：thumbnail=true 走缩略图（省 token），否则原图 */
export async function readImageContent(imageId: string, thumbnail: boolean): Promise<McpToolResult> {
  if (thumbnail) {
    const thumb = await getImageThumbnail(imageId).catch(() => undefined)
    if (thumb?.thumbnailDataUrl) {
      const parts = splitDataUrl(thumb.thumbnailDataUrl)
      if (parts) {
        return imageResult(parts.data, parts.mimeType, `图片 ${imageId}（缩略图${thumb.width && thumb.height ? ` ${thumb.width}x${thumb.height}` : ''}）`)
      }
    }
  }
  const dataUrl = await ensureImageCached(imageId).catch(() => undefined)
  if (!dataUrl) {
    return errorResult(`图片 ${imageId} 不存在或无法读取（可能已被清理）`)
  }
  const parts = splitDataUrl(dataUrl)
  if (!parts) return errorResult(`图片 ${imageId} 数据格式无法解析`)
  return imageResult(parts.data, parts.mimeType, thumbnail ? `图片 ${imageId}（缩略图不可用，已回退原图）` : `图片 ${imageId}（原图）`)
}

export function clampLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.round(value), 1), max)
}
