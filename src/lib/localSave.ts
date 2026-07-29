import type { AgentConversation, AgentRound, TaskRecord } from '../types'
import type { UpdateStatus } from '../hooks/useAutoUpdate'
import { sanitizeGeneratedImageFilenamePart } from './generatedImageFilename'

type ElectronAPI = {
  apiFetch?: (
    request: {
      id: string
      url: string
      method: string
      headers: Array<[string, string]>
      body?: ArrayBuffer
      redirect: RequestRedirect
    },
    onEvent: (event:
      | { id: string; type: 'chunk'; data: Uint8Array | ArrayBuffer }
      | { id: string; type: 'done' }
      | { id: string; type: 'error'; error: string }
    ) => void,
  ) => Promise<{ status: number; statusText: string; headers: Array<[string, string]> }>
  cancelApiFetch?: (id: string) => void
  selectDirectory: () => Promise<string | null>
  selectFile: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
  selectFiles: (filters?: { name: string; extensions: string[] }[]) => Promise<string[] | null>
  saveImage: (filePath: string, dataUrl: string) => Promise<boolean>
  saveCompositeImage: (filePath: string, dataUrl: string, maxSizeKb?: number) => Promise<boolean>
  authorizeCompositeOutputDirectory?: (dirPath: string) => Promise<boolean>
  saveJson: (filePath: string, data: unknown) => Promise<boolean>
  saveText: (filePath: string, content: string) => Promise<boolean>
  ensureDir: (dirPath: string) => Promise<boolean>
  pathJoin: (...paths: string[]) => Promise<string>
  checkExists: (filePath: string) => Promise<boolean>
  readDir: (dirPath: string) => Promise<string[]>
  readImageFile: (filePath: string) => Promise<{ path: string; name: string; dataUrl: string } | null>
  listImageFiles: (dirPath: string) => Promise<{ path: string; name: string; dataUrl?: string }[]>
  listCompositeBackgroundFiles?: (dirPath: string, recursive: boolean) => Promise<Array<{ path: string; name: string; relativeDir: string; width: number; height: number }>>
  scanEnteredCompositeBackgroundFolder?: (dirPath: string, recursive: boolean) => Promise<
    | { success: true; folderPath: string; files: Array<{ path: string; name: string; relativeDir: string; width: number; height: number }> }
    | { success: false; error: string }
  >
  pickImageFile: (input: { path: string; mode: 'random' | 'sequential'; index: number }) => Promise<{ path: string; name: string; dataUrl: string } | null>
  deleteCompositeFiles?: (filePaths: string[]) => Promise<{ deleted: string[]; failed: string[] }>
  distributeFile?: (input: { sourcePath: string; targetPath: string; mode: 'copy' | 'move'; appendRandomByte?: boolean }) => Promise<{ success: boolean }>
  readFileBuffer: (filePath: string) => Promise<{ data: ArrayBuffer; name: string } | null>
  getDefaultPath: () => Promise<string>
  openInExplorer: (filePath: string) => Promise<void>
  getLocalSavePath: () => Promise<string | null>
  setLocalSavePath: (path: string) => Promise<void>
  copyCacheToRoot?: (newRoot: string) => Promise<Array<{ from: string; to: string }>>
  readJsonText: (filePath: string) => Promise<string | null>
  writeJsonText: (filePath: string, content: string, backupIntervalOrSkip?: number | boolean) => Promise<boolean>
  listBackups: (filePath: string) => Promise<string[]>
  checkBackupHasData: (backupPath: string) => Promise<boolean>
  restoreFromBackup: (backupPath: string, targetPath: string) => Promise<boolean>
  deleteBackup: (backupPath: string) => Promise<boolean>
  saveZipBuffer: (filePath: string, buffer: ArrayBuffer) => Promise<boolean>
  selectZipSavePath?: (defaultName: string) => Promise<string | null>
  exportZipToPath?: (request: ElectronZipExportRequest) => Promise<{ success: boolean; error?: string }>
  deleteCacheImages?: (filePaths: string[]) => Promise<{ deleted: string[]; failed: string[] }>
  reconcileCacheImages?: (referencedFileNames: string[]) => Promise<{ deleted: string[]; failed: string[] }>
  getDesktopPath: () => Promise<string>
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void
  checkForUpdate: () => Promise<{ success: boolean; error?: string }>
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>
  installUpdate: () => Promise<{ success: boolean }>
  getAppVersion: () => Promise<string>
  getStartupMode?: () => Promise<{ safeMode: boolean }>
  isElectron: boolean
}

export type ElectronZipExportRequest = {
  destinationPath: string
  manifestJson: string
  entries: Array<
    | { sourcePath: string; archivePath: string; mtime?: number }
    | { data: Uint8Array; archivePath: string; mtime?: number }
  >
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

function getAPI(): ElectronAPI | null {
  return typeof window !== 'undefined' ? (window.electronAPI ?? null) : null
}

export function isElectron(): boolean {
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')) return true
  return Boolean(getAPI()?.isElectron)
}

export async function selectLocalSaveDirectory(): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  return api.selectDirectory()
}

export async function getLocalSavePath(): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  const saved = await api.getLocalSavePath()
  if (saved) return saved
  const defaultPath = await api.getDefaultPath()
  if (defaultPath) {
    await api.setLocalSavePath(defaultPath)
    return defaultPath
  }
  return null
}

export async function setLocalSavePath(path: string): Promise<void> {
  const api = getAPI()
  if (!api) return
  await api.setLocalSavePath(path)
}

export async function copyRawCacheImagesToRoot(newRoot: string): Promise<Array<{ from: string; to: string }>> {
  return await getAPI()?.copyCacheToRoot?.(newRoot) ?? []
}

export async function getDefaultLocalSavePath(): Promise<string> {
  const api = getAPI()
  if (!api) return ''
  return api.getDefaultPath()
}

export async function openInExplorer(filePath: string): Promise<void> {
  const api = getAPI()
  if (!api) return
  await api.openInExplorer(filePath)
}

export async function readFileBuffer(filePath: string): Promise<{ data: ArrayBuffer; name: string } | null> {
  const api = getAPI()
  if (!api) return null
  return api.readFileBuffer(filePath)
}

export async function readDirectory(dirPath: string): Promise<string[]> {
  const api = getAPI()
  if (!api) return []
  return api.readDir(dirPath)
}

export async function checkPathExists(filePath: string): Promise<boolean | null> {
  const api = getAPI()
  if (!api) return null
  return api.checkExists(filePath)
}

export async function joinPath(...paths: string[]): Promise<string> {
  const api = getAPI()
  if (!api) return paths.join('/')
  return api.pathJoin(...paths)
}

const EXT_MAP: Record<string, string> = {
  png: 'png',
  jpeg: 'jpg',
  jpg: 'jpg',
  webp: 'webp',
}

export function getImageExtensionFromDataUrl(dataUrl: string, fallbackExt: string = 'png'): string {
  const mime = dataUrl.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase()
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/png') return 'png'
  return EXT_MAP[fallbackExt] || fallbackExt || 'png'
}

async function ensureSubDir(basePath: string, subDir: string): Promise<string> {
  const api = getAPI()
  if (!api) return ''
  const dirPath = await api.pathJoin(basePath, subDir)
  await api.ensureDir(dirPath)
  return dirPath
}

function sanitizeFolderName(name: string): string {
  return name.trim().replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-').replace(/\s+/g, ' ').slice(0, 100) || '未命名'
}

function formatDateVariable(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function resolveOutputDirectoryVariables(path: string): string {
  return path.replace(/\{date\}/gi, formatDateVariable())
}

export function getDirectoryBaseName(dirPath: string): string {
  const normalized = dirPath.trim().replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]+/).filter(Boolean)
  return sanitizeFolderName(parts[parts.length - 1] || 'images')
}

export async function getLocalImageSaveDirectory(subFolder?: string): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  let imagesDir = await ensureSubDir(basePath, 'images')
  if (subFolder) {
    imagesDir = await ensureSubDir(imagesDir, sanitizeFolderName(subFolder))
  }
  return imagesDir
}

export async function getExplicitImageSaveDirectory(outputDirectory: string): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  const trimmed = resolveOutputDirectoryVariables(outputDirectory.trim())
  if (!trimmed) return null
  const ok = await api.ensureDir(trimmed)
  return ok ? trimmed : null
}

export async function saveRawCacheImageToLocal(id: string, dataUrl: string): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  const cacheDir = await ensureSubDir(basePath, 'cache-images')
  const ext = getImageExtensionFromDataUrl(dataUrl)
  const filePath = await api.pathJoin(cacheDir, `${id}.${ext}`)
  
  const success = await api.saveImage(filePath, dataUrl)
  return success ? filePath : null
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const imageSaveQueues = new Map<string, Promise<void>>()

async function saveImageExclusively<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const previous = imageSaveQueues.get(directory) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => current)
  imageSaveQueues.set(directory, tail)

  await previous
  try {
    return await operation()
  } finally {
    release()
    if (imageSaveQueues.get(directory) === tail) imageSaveQueues.delete(directory)
  }
}

export async function saveImageToLocal(
  taskId: string,
  imageIndex: number,
  dataUrl: string,
  ext: string = 'png',
  subFolder?: string,
  outputDirectory?: string,
  fileNameBase?: string,
): Promise<string | null> {
  const api = getAPI()
  if (!api) return null

  const imagesDir = outputDirectory
    ? await getExplicitImageSaveDirectory(outputDirectory)
    : await getLocalImageSaveDirectory(subFolder)
  if (!imagesDir) return null

  return saveImageExclusively(imagesDir, async () => {
    const fileExt = EXT_MAP[ext] || 'png'
    const directoryBaseName = getDirectoryBaseName(imagesDir) || sanitizeFolderName(taskId)
    const exactBaseName = fileNameBase
      ? sanitizeGeneratedImageFilenamePart(fileNameBase, 220) || directoryBaseName
      : ''
    const exactSequenceMatch = exactBaseName.match(/^(.*)-(\d+)$/)
    const sequencePrefix = exactSequenceMatch?.[1] || directoryBaseName
    const requestedSequence = exactSequenceMatch
      ? Number.parseInt(exactSequenceMatch[2], 10)
      : imageIndex + 1
    let fileName = `${exactBaseName || `${directoryBaseName}-${imageIndex + 1}`}.${fileExt}`
    let filePath = await api.pathJoin(imagesDir, fileName)

    // 避免覆盖：如果文件已存在，则自动查找当前目录下的最大序号并递增
    if (await api.checkExists(filePath)) {
      let maxIndex = 0
      try {
        const files = await api.readDir(imagesDir)
        const regex = new RegExp(`^${escapeRegExp(sequencePrefix)}-(\\d+)\\.`)
        for (const file of files) {
          const match = file.match(regex)
          if (match) {
            const idx = parseInt(match[1], 10)
            if (idx > maxIndex) maxIndex = idx
          }
        }
      } catch (err) {
        console.error('Failed to read directory for sequential naming', err)
      }

      let nextIndex = Math.max(maxIndex + 1, requestedSequence + 1)
      fileName = `${sequencePrefix}-${nextIndex}.${fileExt}`
      filePath = await api.pathJoin(imagesDir, fileName)

      while (await api.checkExists(filePath)) {
        nextIndex++
        fileName = `${sequencePrefix}-${nextIndex}.${fileExt}`
        filePath = await api.pathJoin(imagesDir, fileName)
      }
    }

    const success = await api.saveImage(filePath, dataUrl)
    return success ? filePath : null
  })
}

export async function saveTaskMetaToLocal(
  taskId: string,
  task: TaskRecord,
): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  const tasksDir = await ensureSubDir(basePath, 'tasks')
  const filePath = await api.pathJoin(tasksDir, `${taskId}.json`)

  const meta = {
    id: task.id,
    prompt: task.prompt,
    params: task.params,
    actualParams: task.actualParams,
    actualParamsByImage: task.actualParamsByImage,
    revisedPromptByImage: task.revisedPromptByImage,
    apiProvider: task.apiProvider,
    apiProfileName: task.apiProfileName,
    apiMode: task.apiMode,
    apiModel: task.apiModel,
    inputImageIds: task.inputImageIds,
    inputImageFolderPath: task.inputImageFolderPath,
    outputImages: task.outputImages,
    status: task.status,
    createdAt: task.createdAt,
    finishedAt: task.finishedAt,
    elapsed: task.elapsed,
    isFavorite: task.isFavorite,
    sourceMode: task.sourceMode,
    agentToolAction: task.agentToolAction,
  }

  const success = await api.saveJson(filePath, meta)
  return success ? filePath : null
}

export async function savePromptToLocal(
  taskId: string,
  prompt: string,
): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  const promptsDir = await ensureSubDir(basePath, 'prompts')
  const filePath = await api.pathJoin(promptsDir, `${taskId}.txt`)

  const success = await api.saveText(filePath, prompt)
  return success ? filePath : null
}

function formatAgentConversationMarkdown(conversation: AgentConversation): string {
  const lines: string[] = []
  lines.push(`# ${conversation.title || 'Agent 对话'}`)
  lines.push('')
  lines.push(`创建时间: ${new Date(conversation.createdAt).toLocaleString()}`)
  lines.push(`更新时间: ${new Date(conversation.updatedAt).toLocaleString()}`)
  lines.push('')

  for (const round of conversation.rounds) {
    const roundIndex = round.index + 1
    lines.push(`---`)
    lines.push(``)
    lines.push(`## 第 ${roundIndex} 轮`)
    lines.push('')

    const userMsg = conversation.messages.find((m) => m.id === round.userMessageId)
    if (userMsg) {
      lines.push(`### 用户`)
      lines.push('')
      lines.push(userMsg.content)
      lines.push('')
    }

    const assistantMsg = conversation.messages.find((m) => m.id === round.assistantMessageId)
    if (assistantMsg) {
      lines.push(`### 助手`)
      lines.push('')
      lines.push(assistantMsg.content)
      lines.push('')
    }

    if (round.error) {
      lines.push(`> 错误: ${round.error}`)
      lines.push('')
    }

    lines.push(`状态: ${round.status === 'done' ? '完成' : round.status === 'error' ? '失败' : '运行中'}`)
    if (round.finishedAt) {
      lines.push(`完成时间: ${new Date(round.finishedAt).toLocaleString()}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function formatMarkdownJson(value: unknown) {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
}

function getTaskOutputPath(task: TaskRecord, imageId: string, imageIndex: number) {
  return task.localSavedOutputImagePaths?.[`${imageIndex}:${imageId}`] ?? null
}

export function formatAgentRoundSummaryMarkdown(
  conversation: AgentConversation,
  round: AgentRound,
  tasks: TaskRecord[],
): string {
  const orderedTasks = round.outputTaskIds
    .map((taskId) => tasks.find((task) => task.id === taskId))
    .filter((task): task is TaskRecord => Boolean(task))
  const userMessage = conversation.messages.find((message) => message.id === round.userMessageId)
  const assistantMessage = round.assistantMessageId
    ? conversation.messages.find((message) => message.id === round.assistantMessageId)
    : undefined
  const successCount = orderedTasks.filter((task) => task.outputImages.length > 0).length
  const failedCount = orderedTasks.filter((task) => task.status === 'error').length
  const statusText = round.status === 'done' ? '完成' : round.status === 'error' ? '失败' : '运行中'
  const lines: string[] = [
    `# ${conversation.title || 'Agent 对话'} · 第 ${round.index} 轮`,
    '',
    `- 对话 ID: \`${conversation.id}\``,
    `- 轮次 ID: \`${round.id}\``,
    `- 父轮次: ${round.parentRoundId ? `\`${round.parentRoundId}\`` : '无'}`,
    `- 状态: ${statusText}`,
    `- 开始时间: ${new Date(round.createdAt).toISOString()}`,
    `- 完成时间: ${round.finishedAt ? new Date(round.finishedAt).toISOString() : '未完成'}`,
    `- 图片任务: ${orderedTasks.length}；成功: ${successCount}；失败: ${failedCount}`,
    '',
    '## 用户请求',
    '',
    userMessage?.content || round.prompt || '无',
    '',
    '## 输入资源',
    '',
    `- 参考图 ID: ${round.inputImageIds.length > 0 ? round.inputImageIds.map((id) => `\`${id}\``).join('、') : '无'}`,
    `- 蒙版目标图 ID: ${round.maskTargetImageId ? `\`${round.maskTargetImageId}\`` : '无'}`,
    `- 蒙版图 ID: ${round.maskImageId ? `\`${round.maskImageId}\`` : '无'}`,
    '',
  ]

  if (assistantMessage?.content) {
    lines.push('## Agent 回复', '', assistantMessage.content, '')
  }

  if (round.error) {
    lines.push('## 轮次错误', '', round.error, '')
  }

  lines.push('## 图片任务明细', '')
  if (orderedTasks.length === 0) {
    lines.push('本轮没有图片任务。', '')
  }

  orderedTasks.forEach((task, taskIndex) => {
    lines.push(
      `### ${taskIndex + 1}. 任务 \`${task.id}\``,
      '',
      `- 状态: ${task.status}`,
      `- 批次调用 ID: ${task.agentBatchCallId ? `\`${task.agentBatchCallId}\`` : '无'}`,
      `- 工具调用 ID: ${task.agentToolCallId ? `\`${task.agentToolCallId}\`` : '无'}`,
      `- Provider: ${task.apiProvider ?? '未知'}`,
      `- API 配置: ${task.apiProfileName ?? '未知'}`,
      `- API 模式: ${task.apiMode ?? '未知'}`,
      `- 模型: ${task.apiModel ?? '未知'}`,
      `- 创建时间: ${new Date(task.createdAt).toISOString()}`,
      `- 完成时间: ${task.finishedAt ? new Date(task.finishedAt).toISOString() : '未完成'}`,
      `- 耗时: ${task.elapsed != null ? `${task.elapsed} ms` : '未知'}`,
      '',
      '#### 提示词',
      '',
      task.prompt || '无',
      '',
      '#### 请求参数',
      '',
      formatMarkdownJson(task.params),
      '',
      '#### 实际参数',
      '',
      formatMarkdownJson(task.actualParamsByImage ?? task.actualParams ?? {}),
      '',
      '#### 输出',
      '',
    )

    if (task.outputImages.length === 0) {
      lines.push('- 无输出图片')
    } else {
      task.outputImages.forEach((imageId, imageIndex) => {
        const savedPath = getTaskOutputPath(task, imageId, imageIndex)
        const rawUrl = task.rawImageUrls?.[imageIndex]
        const revisedPrompt = task.revisedPromptByImage?.[imageId]
        lines.push(`- 图片 ${imageIndex + 1}: \`${imageId}\``)
        lines.push(`  - 本地路径: ${savedPath ?? '未保存'}`)
        if (rawUrl) lines.push(`  - 原始 URL: ${rawUrl}`)
        if (revisedPrompt) lines.push(`  - 改写提示词: ${revisedPrompt}`)
      })
    }

    if (task.batchItemStatuses?.length) lines.push('', '#### 批次状态', '', formatMarkdownJson(task.batchItemStatuses))
    if (task.batchItemErrors?.length) lines.push('', '#### 批次错误', '', formatMarkdownJson(task.batchItemErrors))
    if (task.error) lines.push('', '#### 错误', '', task.error)
    lines.push('')
  })

  return lines.join('\n')
}

export async function saveAgentConversationToLocal(
  conversationId: string,
  conversation: AgentConversation,
): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  const agentDir = await ensureSubDir(basePath, 'agent')
  const filePath = await api.pathJoin(agentDir, `${conversationId}.md`)

  const markdown = formatAgentConversationMarkdown(conversation)
  const success = await api.saveText(filePath, markdown)
  return success ? filePath : null
}

export async function saveAgentRoundSummaryToLocal(
  conversation: AgentConversation,
  round: AgentRound,
  tasks: TaskRecord[],
): Promise<string | null> {
  const api = getAPI()
  const basePath = await getLocalSavePath()
  if (!api || !basePath) return null

  const agentDir = await ensureSubDir(basePath, 'agent')
  const conversationDir = await ensureSubDir(agentDir, conversation.id)
  const roundNumber = String(round.index).padStart(3, '0')
  const filePath = await api.pathJoin(conversationDir, `round-${roundNumber}-${round.id}.md`)
  const markdown = formatAgentRoundSummaryMarkdown(conversation, round, tasks)
  const success = await api.saveText(filePath, markdown)
  return success ? filePath : null
}

export async function getBackupList(customPath?: string): Promise<string[]> {
  const api = getAPI()
  if (!api) return []
  const defaultPath = await api.getDefaultPath()
  const dataPath = defaultPath.replace(/[\\/]local-saves$/, '')
  return api.listBackups(dataPath + '/gpt-image-playground.json')
}

export async function getBackupPath(): Promise<string> {
  const api = getAPI()
  if (!api) return ''
  const defaultPath = await api.getDefaultPath()
  const dataPath = defaultPath.replace(/[\\/]local-saves$/, '')
  return dataPath + '/backups'
}

export async function selectBackupDirectory(): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  const result = await api.selectDirectory()
  return result || null
}

export async function createBackupInPath(targetPath: string): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const fileName = `doupao_backup_${ts}.json`
  const filePath = targetPath.replace(/[\\/]$/, '') + '/' + fileName
  const defaultPath = await api.getDefaultPath()
  const dataPath = defaultPath.replace(/[\\/]local-saves$/, '')
  const sourcePath = dataPath + '/gpt-image-playground.json'
  try {
    const content = await api.readJsonText(sourcePath)
    if (!content) return false
    await api.ensureDir(targetPath)
    return await api.writeJsonText(filePath, content, true)
  } catch {
    return false
  }
}

export async function checkBackupHasData(backupPath: string): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  return api.checkBackupHasData(backupPath)
}

export async function restoreFromBackupFile(backupPath: string): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  const defaultPath = await api.getDefaultPath()
  const dataPath = defaultPath.replace(/[\\/]local-saves$/, '')
  return api.restoreFromBackup(backupPath, dataPath + '/gpt-image-playground.json')
}

export async function deleteBackupFile(backupPath: string): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  return api.deleteBackup(backupPath)
}

export async function saveZipToPath(filePath: string, buffer: ArrayBuffer): Promise<boolean> {
  const api = getAPI()
  if (!api) return false
  return api.saveZipBuffer(filePath, buffer)
}

export async function exportZipToPath(request: ElectronZipExportRequest): Promise<{ success: boolean; error?: string }> {
  const api = getAPI()
  return api?.exportZipToPath ? api.exportZipToPath(request) : { success: false, error: '当前环境不支持流式导出' }
}

export async function selectZipSavePath(defaultName: string): Promise<string | null> {
  return getAPI()?.selectZipSavePath?.(defaultName) ?? null
}

export async function deleteRawCacheImages(filePaths: string[]): Promise<void> {
  const api = getAPI()
  if (api?.deleteCacheImages && filePaths.length > 0) await api.deleteCacheImages(filePaths)
}

export async function reconcileRawCacheImages(referencedFileNames: string[]): Promise<void> {
  const api = getAPI()
  if (api?.reconcileCacheImages) await api.reconcileCacheImages(referencedFileNames)
}

export async function getDesktopPath(): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  return api.getDesktopPath()
}
