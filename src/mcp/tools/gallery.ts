// 画廊板块工具：任务查询/读取图片/生图/任务操作

import {
  ALL_FAVORITES_COLLECTION_ID,
  ensureImageCached,
  getTaskFavoriteCollectionIds,
  removeMultipleTasks,
  retryTask,
  submitTaskWithData,
  updateTaskParams,
  updateTaskPrompt,
  useStore,
  clearFailedTasks,
} from '../../store'
import type { InputImage, TaskParams, TaskRecord } from '../../types'
import { errorResult, textResult, type McpToolDefinition } from '../types'
import { clampLimit, findTask, readImageContent, serializeTaskDetail, serializeTaskSummary, waitForTask } from './helpers'

const MAX_REFERENCE_IMAGES = 16

function filterTasks(tasks: TaskRecord[], args: Record<string, unknown>): TaskRecord[] {
  let result = tasks
  const status = args.status as string | undefined
  if (status) result = result.filter((task) => task.status === status)
  if (args.favorite === true) result = result.filter((task) => task.isFavorite)
  const collectionId = args.collectionId as string | undefined
  if (collectionId) {
    if (collectionId === ALL_FAVORITES_COLLECTION_ID) {
      result = result.filter((task) => task.isFavorite)
    } else {
      result = result.filter((task) => getTaskFavoriteCollectionIds(task).includes(collectionId))
    }
  }
  const search = (args.search as string | undefined)?.trim().toLowerCase()
  if (search) result = result.filter((task) => task.prompt.toLowerCase().includes(search))
  return result
}

async function resolveReferenceImages(args: Record<string, unknown>): Promise<InputImage[] | string> {
  const ids: string[] = []
  const directIds = args.referenceImageIds
  if (Array.isArray(directIds)) {
    for (const id of directIds) {
      if (typeof id === 'string' && id) ids.push(id)
    }
  }
  const fromTaskId = args.referenceFromTaskId as string | undefined
  if (fromTaskId) {
    const sourceTask = findTask(fromTaskId)
    if (!sourceTask) return `参考任务 ${fromTaskId} 不存在`
    if (sourceTask.outputImages.length === 0) return `参考任务 ${fromTaskId} 没有输出图片`
    ids.push(...sourceTask.outputImages)
  }
  if (ids.length === 0) return []
  if (ids.length > MAX_REFERENCE_IMAGES) return `参考图数量超过上限（${MAX_REFERENCE_IMAGES} 张）`

  const images: InputImage[] = []
  for (const id of ids) {
    const dataUrl = await ensureImageCached(id).catch(() => undefined)
    if (!dataUrl) return `参考图 ${id} 无法读取（可能已被清理）`
    images.push({ id, dataUrl })
  }
  return images
}

export const galleryTools: McpToolDefinition[] = [
  {
    name: 'gallery_list_tasks',
    description:
      '查询画廊任务列表（按创建时间倒序）。支持按状态（running/done/error）、收藏、收藏夹、提示词关键词过滤，以及 limit/offset 分页。返回每个任务的概要（id、提示词摘要、状态、尺寸、模型、输出图片 id 列表等）。',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['running', 'done', 'error'], description: '按任务状态过滤' },
        favorite: { type: 'boolean', description: 'true 时只看收藏任务' },
        collectionId: { type: 'string', description: '按收藏夹过滤；__all_favorites__ 表示全部收藏' },
        search: { type: 'string', description: '提示词包含的关键词（不区分大小写）' },
        limit: { type: 'integer', description: '返回条数，默认 50，最大 200' },
        offset: { type: 'integer', description: '跳过前 N 条，默认 0' },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      const tasks = filterTasks(useStore.getState().tasks, args)
      const offset = typeof args.offset === 'number' ? Math.max(0, Math.round(args.offset)) : 0
      const limit = clampLimit(args.limit, 50, 200)
      const sorted = [...tasks].sort((a, b) => b.createdAt - a.createdAt)
      return textResult({
        total: sorted.length,
        offset,
        limit,
        tasks: sorted.slice(offset, offset + limit).map(serializeTaskSummary),
      })
    },
  },
  {
    name: 'gallery_get_task',
    description: '获取单个画廊任务的完整详情：完整提示词、请求参数、API 实际生效参数、改写后的提示词、输入/输出图片 id、本地保存路径、来源（Agent/SOP）等。',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string', description: '任务 id' } },
      required: ['taskId'],
      additionalProperties: false,
    },
    handler: (args) => {
      const task = findTask(args.taskId as string)
      if (!task) return errorResult(`任务 ${args.taskId} 不存在`)
      return textResult(serializeTaskDetail(task))
    },
  },
  {
    name: 'gallery_read_image',
    description:
      '读取一张图片的内容（以图像形式返回，可直接查看）。可传 imageId，或传 taskId + imageIndex 读取某任务的第 N 张输出图。thumbnail=true（默认）返回缩略图以节省流量，false 返回原图。',
    inputSchema: {
      type: 'object',
      properties: {
        imageId: { type: 'string', description: '图片 id（image store 的 SHA-256 id）' },
        taskId: { type: 'string', description: '任务 id（与 imageIndex 配合）' },
        imageIndex: { type: 'integer', description: '任务输出图的序号，从 0 开始，默认 0' },
        thumbnail: { type: 'boolean', description: '是否只读缩略图，默认 true' },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      let imageId = args.imageId as string | undefined
      if (!imageId && args.taskId) {
        const task = findTask(args.taskId as string)
        if (!task) return errorResult(`任务 ${args.taskId} 不存在`)
        const index = typeof args.imageIndex === 'number' ? Math.round(args.imageIndex) : 0
        imageId = task.outputImages[index]
        if (!imageId) return errorResult(`任务 ${args.taskId} 没有第 ${index} 张输出图（共 ${task.outputImages.length} 张）`)
      }
      if (!imageId) return errorResult('请提供 imageId，或 taskId + imageIndex')
      return readImageContent(imageId, args.thumbnail !== false)
    },
  },
  {
    name: 'generate_image',
    description:
      '提交一次图片生成任务（会真实调用已配置的图像 API 并消耗额度）。提示词必填；数量/尺寸/质量默认沿用应用当前参数。可用 referenceImageIds 或 referenceFromTaskId 提供参考图。wait=false（默认）立即返回任务 id，之后用 gallery_get_task 轮询；wait=true 等待完成（最长 waitTimeoutSeconds 秒，默认 300）。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '提示词' },
        count: { type: 'integer', description: '生成张数，默认沿用当前参数（通常为 1）' },
        size: { type: 'string', description: '尺寸，如 1024x1024；默认沿用当前参数（auto）' },
        quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high'], description: '质量档位' },
        outputSubFolder: { type: 'string', description: '本地保存的子目录名（仅桌面端本地保存生效）' },
        apiProfileId: { type: 'string', description: '指定 API 配置 id，默认用当前配置' },
        referenceImageIds: { type: 'array', items: { type: 'string' }, description: '参考图 id 列表（最多 16 张）' },
        referenceFromTaskId: { type: 'string', description: '把某个任务的全部输出图作为参考图' },
        wait: { type: 'boolean', description: '是否等待生成完成，默认 false' },
        waitTimeoutSeconds: { type: 'integer', description: 'wait=true 时的最长等待秒数，默认 300，最大 600' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    timeoutSeconds: 660,
    handler: async (args) => {
      const prompt = (args.prompt as string).trim()
      if (!prompt) return errorResult('提示词不能为空')
      const references = await resolveReferenceImages(args)
      if (typeof references === 'string') return errorResult(references)

      const currentParams = useStore.getState().params
      const params: TaskParams = {
        ...currentParams,
        ...(typeof args.count === 'number' ? { n: Math.min(Math.max(Math.round(args.count), 1), 16) } : {}),
        ...(typeof args.size === 'string' && args.size ? { size: args.size } : {}),
        ...(typeof args.quality === 'string' ? { quality: args.quality as TaskParams['quality'] } : {}),
      }

      const taskId = await submitTaskWithData(
        {
          prompt,
          inputImages: references,
          inputImageFolder: null,
          params,
          maskDraft: null,
          scheduledOutputSubFolder: typeof args.outputSubFolder === 'string' && args.outputSubFolder ? args.outputSubFolder : undefined,
          apiProfileId: typeof args.apiProfileId === 'string' && args.apiProfileId ? args.apiProfileId : undefined,
        },
        { silentSuccess: true, useCurrentApiProfileWhenReusedMissing: true },
      )
      if (!taskId) {
        return errorResult('任务提交失败：请检查提示词是否为空、API 配置是否完整（可在应用内查看提示）')
      }

      const wait = args.wait === true
      if (!wait) {
        return textResult({ taskId, status: 'running', hint: '任务已提交。用 gallery_get_task 查询进度，gallery_read_image 查看结果图。' })
      }
      const timeout = clampLimit(args.waitTimeoutSeconds, 300, 600)
      const finished = await waitForTask(taskId, timeout)
      if (!finished) return errorResult(`任务 ${taskId} 异常消失`)
      if (finished.status === 'running') {
        return textResult({ taskId, status: 'running', hint: `等待 ${timeout}s 后仍在生成中，可继续用 gallery_get_task 轮询。` })
      }
      return textResult({
        ...serializeTaskDetail(finished),
        hint: finished.status === 'done' ? '生成完成。用 gallery_read_image 传 taskId+imageIndex 查看图片。' : undefined,
      })
    },
  },
  {
    name: 'task_retry',
    description: '重试一个画廊任务（通常用于失败任务），会按原参数重新提交生成并消耗 API 额度。',
    inputSchema: {
      type: 'object',
      properties: { taskId: { type: 'string', description: '任务 id' } },
      required: ['taskId'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const task = findTask(args.taskId as string)
      if (!task) return errorResult(`任务 ${args.taskId} 不存在`)
      await retryTask(task)
      return textResult(`任务 ${task.id} 已重新提交`)
    },
  },
  {
    name: 'task_update',
    description: '修改一个画廊任务的提示词和/或参数（只改记录，不重新生成；需要重新生成请再调用 task_retry）。',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务 id' },
        prompt: { type: 'string', description: '新的提示词' },
        params: { type: 'object', description: '要覆盖的参数子集（如 {size, quality, n}）' },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const task = findTask(args.taskId as string)
      if (!task) return errorResult(`任务 ${args.taskId} 不存在`)
      const changed: string[] = []
      if (typeof args.prompt === 'string' && args.prompt.trim()) {
        await updateTaskPrompt(task.id, args.prompt)
        changed.push('prompt')
      }
      if (args.params && typeof args.params === 'object') {
        await updateTaskParams(task.id, args.params as Partial<TaskParams>)
        changed.push('params')
      }
      if (changed.length === 0) return errorResult('没有提供要修改的内容（prompt 或 params）')
      return textResult(`任务 ${task.id} 已更新：${changed.join(', ')}`)
    },
  },
  {
    name: 'task_delete',
    description: '删除一个或多个画廊任务（不可恢复，会同时清理未被引用的图片）。',
    inputSchema: {
      type: 'object',
      properties: {
        taskIds: { type: 'array', items: { type: 'string' }, description: '要删除的任务 id 列表' },
      },
      required: ['taskIds'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const taskIds = (args.taskIds as unknown[]).filter((id): id is string => typeof id === 'string' && !!id)
      if (taskIds.length === 0) return errorResult('taskIds 不能为空')
      const existing = new Set(useStore.getState().tasks.map((task) => task.id))
      const validIds = taskIds.filter((id) => existing.has(id))
      if (validIds.length === 0) return errorResult('所有任务 id 都不存在')
      await removeMultipleTasks(validIds)
      return textResult({
        deleted: validIds,
        skipped: taskIds.filter((id) => !existing.has(id)),
        message: `已删除 ${validIds.length} 个任务`,
      })
    },
  },
  {
    name: 'gallery_clear_failed',
    description: '清空画廊中所有失败（error）状态的任务（不可恢复）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const failedCount = useStore.getState().tasks.filter((task) => task.status === 'error').length
      if (failedCount === 0) return textResult('当前没有失败任务')
      // clearFailedTasks 会弹出应用内确认框，真正的清理由确认按钮执行；
      // MCP 场景下自动执行该确认动作，保持与应用一致的清理语义（含孤立图片与 Agent 引用清理）。
      await clearFailedTasks()
      const dialog = useStore.getState().confirmDialog
      const dangerButton = dialog?.buttons?.find((button) => button.tone === 'danger') ?? dialog?.buttons?.[0]
      if (!dangerButton) return errorResult('清理流程异常：未出现确认动作')
      await dangerButton.action()
      return textResult(`已清空 ${failedCount} 个失败任务`)
    },
  },
]
