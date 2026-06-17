import type { AgentConversation, TaskRecord } from '../types'
import type { UpdateStatus } from '../hooks/useAutoUpdate'

type ElectronAPI = {
  selectDirectory: () => Promise<string | null>
  saveImage: (filePath: string, dataUrl: string) => Promise<boolean>
  saveJson: (filePath: string, data: unknown) => Promise<boolean>
  saveText: (filePath: string, content: string) => Promise<boolean>
  ensureDir: (dirPath: string) => Promise<boolean>
  pathJoin: (...paths: string[]) => Promise<string>
  checkExists: (filePath: string) => Promise<boolean>
  readDir: (dirPath: string) => Promise<string[]>
  readFileBuffer: (filePath: string) => Promise<{ data: ArrayBuffer; name: string } | null>
  getDefaultPath: () => Promise<string>
  openInExplorer: (filePath: string) => Promise<void>
  getLocalSavePath: () => Promise<string | null>
  setLocalSavePath: (path: string) => Promise<void>
  readJsonText: (filePath: string) => Promise<string | null>
  writeJsonText: (filePath: string, content: string, backupIntervalOrSkip?: number | boolean) => Promise<boolean>
  listBackups: (filePath: string) => Promise<string[]>
  checkBackupHasData: (backupPath: string) => Promise<boolean>
  restoreFromBackup: (backupPath: string, targetPath: string) => Promise<boolean>
  deleteBackup: (backupPath: string) => Promise<boolean>
  saveZipBuffer: (filePath: string, buffer: ArrayBuffer) => Promise<boolean>
  getDesktopPath: () => Promise<string>
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void
  checkForUpdate: () => Promise<{ success: boolean; error?: string }>
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>
  installUpdate: () => Promise<{ success: boolean }>
  getAppVersion: () => Promise<string>
  isElectron: boolean
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

export async function joinPath(...paths: string[]): Promise<string> {
  const api = getAPI()
  if (!api) return paths.join('/')
  return api.pathJoin(...paths)
}

const EXT_MAP: Record<string, string> = {
  png: 'png',
  jpeg: 'jpg',
  webp: 'webp',
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

export async function saveImageToLocal(
  taskId: string,
  imageIndex: number,
  dataUrl: string,
  ext: string = 'png',
  subFolder?: string,
): Promise<string | null> {
  const api = getAPI()
  if (!api) return null

  const imagesDir = await getLocalImageSaveDirectory(subFolder)
  if (!imagesDir) return null
  const fileExt = EXT_MAP[ext] || 'png'
  const fileName = `${taskId}_${imageIndex + 1}.${fileExt}`
  const filePath = await api.pathJoin(imagesDir, fileName)

  const success = await api.saveImage(filePath, dataUrl)
  return success ? filePath : null
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

export async function getDesktopPath(): Promise<string | null> {
  const api = getAPI()
  if (!api) return null
  return api.getDesktopPath()
}
