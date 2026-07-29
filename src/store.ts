import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  AgentConversation,
  AgentMessage,
  AgentRound,
  ApiMode,
  ApiProfile,
  AppSettings,
  RemoteGenerationProvider,
  AppMode,
  BatchItemError,
  BatchItemStatus,
  TaskProgressStage,
  TaskParams,
  TaskStatus,
  InputImage,
  InputImageFolder,
  MaskDraft,
  ScheduleItem,
  ScheduleState,
  SopBatchSnapshot,
  TaskRecord,
  FavoriteCollection,
  ExportData,
  ResponsesApiResponse,
  ResponsesOutputItem,
  WorkspaceTab,
  WorkspaceTabGroup,
  WordLibraryGroup,
  WordLibraryEntry,
  WordGenerationBatch,
  WordLibraryExportData,
} from './types'
import type { StoredImage, StoredImageThumbnail } from './types'
import type { CallApiOptions, CallApiResult } from './lib/imageApiShared'
import { DEFAULT_AGENT_MAX_TOOL_ROUNDS, DEFAULT_PARAMS } from './types'
import { createDefaultScheduleRows, formatDateKey, getScheduleRunKey, getWeekStartDate, parseDateKey, resolveScheduleOutputTarget } from './lib/schedule'
import { DEFAULT_MAX_CONCURRENT, DEFAULT_MAX_RETRIES, DEFAULT_SETTINGS, getActiveApiProfile, getAgentImageApiProfile, getAgentProfileValidationError, getAgentTextApiProfile, getApiMaxN, getCustomProviderDefinition, mergeImportedSettings, normalizeMaxConcurrent, normalizeMaxRetries, normalizeSettings, validateApiProfile } from './lib/apiProfiles'
import { dismissAllTooltips } from './lib/tooltipDismiss'
import { remapImageMentionsForOrder, replaceImageMentionsForApi } from './lib/promptImageMentions'
import { appendAdNegativeRule, createAdNegativeRuleSnapshot, getAdNegativeRule } from './lib/adNegativeRules'
import {
  CURRENT_THUMBNAIL_VERSION,
  getAllTasks,
  loadTasksIncrementally,
  putTask as dbPutTask,
  deleteTask as dbDeleteTask,
  clearTasks as dbClearTasks,
  getAllAgentConversations,
  replaceAgentConversations,
  clearAgentConversations as dbClearAgentConversations,
  getWordLibraryState,
  putWordLibraryState,
  getImage,
  getImageThumbnail,
  getStoredFreshImageThumbnail,
  getAllImageIds,
  getAllImages,
  getLegacyImageBatch,
  putImage,
  putImageThumbnail,
  deleteImage,
  clearImages,
  storeImage,
  batchDeleteImages,
  batchGetImages,
  batchGetCompositeAssets,
  putCompositeAssets,
  batchPutTasks,
  commitImportedRecords,
  getMigrationJournal,
  putMigrationJournal,
  getSopBatchSnapshot,
  getAllSopBatchSnapshots,
  putSopBatchSnapshot,
  clearSopBatchSnapshots,
  updateImageLocalPaths,
  getAllLocalImagePaths,
} from './lib/db'
import { callImageApi } from './lib/api'
import { callAgentChatCompletionsApi, callAgentConversationTitleApi, callAgentResponsesApi, callBatchImageSingle, parseBatchImageCallArguments, type AgentApiResultImage, type BatchImageCallResult } from './lib/agentApi'
import { collectAgentRoundOutputImageSlots, extractAgentReferenceIds, getAgentCurrentReferenceId, getAgentGeneratedImageReferenceId, replaceAgentPromptImageReferencesForApi } from './lib/agentImageReferences'
import { showBrowserNotification } from './lib/browserNotification'
import { getDataUrlDecodedByteSize, IMAGE_FETCH_CORS_HINT, isRetryableError, retryTransientRequest, runWithConcurrencyAndRetry } from './lib/imageApiShared'
import {
  formatInputImageLimitBytes,
  MAX_ALL_REFERENCE_IMAGES,
  MAX_ALL_REFERENCE_PAYLOAD_BYTES,
  MAX_DIRECT_INPUT_IMAGES,
  shouldCycleReferenceImages,
} from './lib/inputImageLimits'
import { getFalErrorMessage, getFalQueuedImageResult } from './lib/falAiImageApi'
import { getCustomQueuedImageResult } from './lib/openaiCompatibleImageApi'
import { setApiTransportMode } from './lib/desktopApiFetch'
import { validateMaskMatchesImage } from './lib/canvasImage'
import { mergePostprocessedActualParams, postprocessGeneratedImage } from './lib/imagePostprocess'
import {
  fingerprintImage,
} from './lib/imageFingerprint'
import {
  applyProviderResult,
  applyRemoteRequestSubmitted,
  applyRequestFailure,
  classifyGenerationError,
  classifyImageAgainstState,
  computeSeed,
  createGenerationPolicy,
  createInitialGenerationState,
  getBatchCompletion,
  getRecoverableRequests,
  markExhaustedSlots,
  planNextRequests,
  computeBackoffDelay,
  type GenerationPolicy,
  type GenerationState,
  type ImageProviderCapabilities,
  type PlannedRequest,
  type SlotAssignment,
  type ImageFingerprintLike,
} from './lib/imageBatchOrchestrator'
import { orderInputImagesForMask } from './lib/mask'
import { getChangedParams, normalizeParamsForSettings } from './lib/paramCompatibility'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { isElectron as isElectronEnv, getLocalSavePath, setLocalSavePath, copyRawCacheImagesToRoot, getImageExtensionFromDataUrl, saveImageToLocal, saveTaskMetaToLocal, savePromptToLocal, saveAgentConversationToLocal, saveAgentRoundSummaryToLocal, readFileBuffer, saveRawCacheImageToLocal, exportZipToPath, selectZipSavePath, getLocalImageSaveDirectory, getExplicitImageSaveDirectory, getDirectoryBaseName, readDirectory, joinPath } from './lib/localSave'
import { migrateLegacyImages } from './lib/imageStorageMigration'
import { buildElectronImageExportEntries, collectReferencedExportImageIds } from './lib/dataExport'
import { ByteLruCache } from './lib/byteLruCache'
import { sanitizeSettingsForBackup } from './lib/backupManifest'
import { validateBackupArchive } from './lib/backupImport'
import { runMigration } from './lib/migrations/registry'
import { shouldDeleteOrphanImage } from './lib/storageCleanup'
import { createWorkspaceBackupState, restoreWorkspaceBackupState } from './lib/workspaceBackup'
import { buildGeneratedImageFileNameBase, findNextGeneratedImageSequence } from './lib/generatedImageFilename'
import { assignMissingGeneratedImageBatches, getNextGeneratedImageBatch } from './lib/generatedImageBatch'

export const ALL_FAVORITES_COLLECTION_ID = '__all_favorites__'
export const DEFAULT_FAVORITE_COLLECTION_ID = '__default_favorites__'
export const DEFAULT_FAVORITE_COLLECTION_NAME = '默认'

// ===== Image cache =====
// 内存缓存，id → dataUrl。只保留少量最近使用图片，避免大量 4K data URL 常驻内存。

const imageCache = new ByteLruCache<string, string>(128 * 1024 * 1024)
const thumbnailCache = new ByteLruCache<string, { dataUrl: string; width?: number; height?: number; thumbnailVersion?: number }>(64 * 1024 * 1024)
const thumbnailBackfillIds = new Map<string, 'visible' | 'background'>()
const thumbnailBackfillRunningIds = new Set<string>()
const thumbnailSubscribers = new Map<string, Set<(thumbnail: { dataUrl: string; width?: number; height?: number }) => void>>()
let thumbnailBackfillScheduled = false
const MAX_THUMBNAIL_BACKFILL_CONCURRENT = 4
export const MAX_RETAINED_STREAM_PARTIAL_IMAGES = 3
const FAL_RECOVERY_POLL_MS = 10_000
const CUSTOM_RECOVERY_POLL_MS = 10_000
const SUPPORT_PROMPT_IMAGE_THRESHOLD = 50
const AGENT_INPUT_DRAFT_RETENTION_MS = 3 * 24 * 60 * 60 * 1000
const AGENT_ROUND_IMAGE_MENTION_RE = /@(?:第)?(\d+)轮图(\d+)/g
const falRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const customRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const openAIWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>()
const agentRoundControllers = new Map<string, AbortController>()
const agentRecoveryContinuations = new Set<string>()
let localImageSaveQueue = Promise.resolve()
let agentRoundSummarySaveQueue = Promise.resolve()
let agentConversationPersistenceReady = false
let agentConversationMigrationPending = false
let wordLibraryPersistenceReady = false
let wordLibraryMigrationPending = false
let imageStorageMigrationPromise: Promise<number> | null = null
const OPENAI_INTERRUPTED_ERROR = '请求中断'
const AGENT_STOPPED_MESSAGE = '已停止生成。'
const AGENT_RECOVERY_PAUSE_ERROR = 'AgentRecoveryPauseError'
const AGENT_CONVERSATION_TITLE_MAX_LENGTH = 28
const ERROR_TOAST_MAX_LENGTH = 80
type ToastType = 'info' | 'success' | 'error'
type AgentInputDraft = {
  prompt: string
  inputImages: InputImage[]
  inputImageFolder: InputImageFolder | null
  maskDraft: MaskDraft | null
  maskEditorImageId: string | null
  customOutputPath?: string
  updatedAt?: number
}

export function getErrorToastMessage(message: string): string {
  const text = message.trim()
  if (!text) return '操作失败'

  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? ''
  const separatorIndex = firstLine.search(/[：:]/)
  if (separatorIndex > 0) {
    const title = firstLine.slice(0, separatorIndex).trim()
    if (isErrorToastTitle(title)) return title
  }

  if (firstLine.length > ERROR_TOAST_MAX_LENGTH) return '操作失败，请查看详情'
  return firstLine || '操作失败'
}

function getToastMessage(message: string, type: ToastType): string {
  return type === 'error' ? getErrorToastMessage(message) : message
}

function isErrorToastTitle(title: string): boolean {
  return /(?:失败|错误|异常|报错|无法|不能|超时|中断|断开|请先|请输入|已达上限|不存在|已丢失)$/.test(title)
}

export type SettingsTab = 'general' | 'agent' | 'api' | 'data' | 'backup' | 'about'

const TIMEOUT_STREAMING_HINT = '也可尝试打开「流式传输」，并提高「请求中间步骤图像数」来维持连接。'
const TIMEOUT_PARTIAL_IMAGES_ZERO_HINT = '官方流式接口不发送心跳，当前「请求中间步骤图像数」为 0，连接可能因无数据传输而断开。建议提高到 2 或 3。'
const TIMEOUT_PARTIAL_IMAGES_LOW_HINT = '也可尝试提高「请求中间步骤图像数」来维持连接，避免长时间无数据传输导致断开。'

type TimeoutStreamingHintProfile = Pick<ApiProfile, 'provider' | 'streamImages' | 'streamPartialImages'>

function getTimeoutStreamingHint(profile?: TimeoutStreamingHintProfile | null) {
  if (profile?.provider !== 'openai') return ''
  const partialImages = profile.streamPartialImages ?? DEFAULT_SETTINGS.streamPartialImages ?? 0
  if (profile.streamImages !== true) return TIMEOUT_STREAMING_HINT
  if (partialImages === 0) return TIMEOUT_PARTIAL_IMAGES_ZERO_HINT
  return partialImages < 3 ? TIMEOUT_PARTIAL_IMAGES_LOW_HINT : ''
}

function createOpenAITimeoutError(timeoutSeconds: number, profile?: TimeoutStreamingHintProfile | null) {
  return `请求超时：超过 ${timeoutSeconds} 秒仍未完成，请稍后重试或提高超时时间。${getTimeoutStreamingHint(profile)}`
}

export function getCachedImage(id: string): string | undefined {
  return imageCache.get(id)
}

export function cacheImage(id: string, dataUrl: string) {
  imageCache.set(id, dataUrl, dataUrl.length * 2)
}

function enqueueLocalImageSave(operation: () => Promise<void>): Promise<void> {
  const queued = localImageSaveQueue.catch(() => {}).then(operation)
  localImageSaveQueue = queued
  return queued
}

function getTaskFilenameFallbackLabel(task: TaskRecord): string {
  return task.scheduledOutputSubFolder
    ?? (task.scheduledOutputPath ? getDirectoryBaseName(task.scheduledOutputPath) : 'image')
}

function getNextTaskFilenameBatch(createdAt: number, targetTabId: string | null, fallbackLabel = 'image') {
  const state = useStore.getState()
  const tab = targetTabId ? state.workspaceTabs.find((item) => item.id === targetTabId) : null
  if (tab) return getNextGeneratedImageBatch(tab.tasks, createdAt)

  const unownedTasks = state.tasks.filter((task) =>
    !state.workspaceTabs.some((item) => item.tasks.some((candidate) => candidate.id === task.id)) &&
    getTaskFilenameFallbackLabel(task) === fallbackLabel,
  )
  return getNextGeneratedImageBatch(unownedTasks, createdAt)
}

function formatLocalSaveBatchFolder(createdAt: number, filenameBatch = 1): string {
  const date = new Date(createdAt)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  const batch = String(Math.max(1, filenameBatch)).padStart(3, '0')
  return `${year}${month}${day}-${hours}${minutes}${seconds}-batch-${batch}`
}

function getTaskLocalSaveBatchFolder(createdAt: number, filenameBatch: number): string | undefined {
  const settings = normalizeSettings(useStore.getState().settings)
  return settings.imageSaveLayout === 'batch-folder'
    ? formatLocalSaveBatchFolder(createdAt, filenameBatch)
    : undefined
}

async function getTaskImageSaveDirectory(task: TaskRecord, subFolder?: string): Promise<string | null> {
  const baseDir = task.scheduledOutputPath
    ? await getExplicitImageSaveDirectory(task.scheduledOutputPath)
    : await getLocalImageSaveDirectory(subFolder)
  if (!baseDir) return null
  if (!task.localSaveBatchFolder) return baseDir
  return getExplicitImageSaveDirectory(await joinPath(baseDir, task.localSaveBatchFolder))
}

async function getTaskLocalFilenameState(taskId: string) {
  const state = useStore.getState()
  const task = state.tasks.find((item) => item.id === taskId)
  if (!task) return null

  const containingTab = state.workspaceTabs.find((tab) => tab.tasks.some((item) => item.id === taskId))
  const subFolder = task.scheduledOutputPath ? undefined : (task.scheduledOutputSubFolder ?? containingTab?.name)
  const imagesDir = await getTaskImageSaveDirectory(task, subFolder)
  if (!imagesDir) return null

  const context = {
    createdAt: task.createdAt,
    label: containingTab?.name ?? task.scheduledOutputSubFolder ?? getDirectoryBaseName(imagesDir),
    prompt: task.prompt,
    batch: task.filenameBatch ?? 1,
  }
  const settings = normalizeSettings(state.settings)
  let fileNames: string[] = []
  try {
    fileNames = await readDirectory(imagesDir)
  } catch (err) {
    console.error('Failed to read directory for generated image naming', err)
  }
  const startSequence = findNextGeneratedImageSequence(fileNames, context, settings)

  return { task, context, settings, startSequence, imagesDir }
}

async function saveTaskImagesToLocalFS(taskId: string, imageIds: string[], imageIndexOffset: number = 0) {
  return enqueueLocalImageSave(async () => {
    await saveTaskImagesToLocalFSNow(taskId, imageIds, imageIndexOffset)
  })
}

function getLocalSavedOutputImageKey(imageId: string, imageIndex: number): string {
  return `${imageIndex}:${imageId}`
}

function markTaskOutputImagesSavedToLocal(taskId: string, saved: Record<string, string>) {
  if (Object.keys(saved).length === 0) return

  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task) return

  updateTaskInStore(taskId, {
    localSavedOutputImagePaths: {
      ...(task.localSavedOutputImagePaths ?? {}),
      ...saved,
    },
  })
}

async function saveTaskImagesToLocalFSNow(taskId: string, imageIds: string[], imageIndexOffset: number) {
  if (!isElectronEnv()) return
  const localSavePath = await getLocalSavePath()
  if (!localSavePath) return

  const filenameState = await getTaskLocalFilenameState(taskId)
  if (!filenameState) return
  const { task, context, settings, startSequence, imagesDir } = filenameState

  let sequenceOffset = 0
  const savedPaths: Record<string, string> = {}
  for (let i = 0; i < imageIds.length; i++) {
    const imageId = imageIds[i]
    const imageIndex = imageIndexOffset + i
    const savedKey = getLocalSavedOutputImageKey(imageId, imageIndex)
    if (task.localSavedOutputImagePaths?.[savedKey]) continue

    const dataUrl = await ensureImageCached(imageId)
    if (dataUrl) {
      const fileNameBase = buildGeneratedImageFileNameBase(context, settings, startSequence + sequenceOffset)
      const saved = await saveImageToLocal(taskId, imageIndex, dataUrl, getImageExtensionFromDataUrl(dataUrl, task.params.output_format), undefined, imagesDir, fileNameBase)
      if (saved) {
        savedPaths[savedKey] = saved
        sequenceOffset++
      }
    }
  }
  markTaskOutputImagesSavedToLocal(taskId, savedPaths)
}

async function saveTaskMetaToLocalFS(taskId: string) {
  if (!isElectronEnv()) return
  const localSavePath = await getLocalSavePath()
  if (!localSavePath) return

  const state = useStore.getState()
  const task = state.tasks.find((t) => t.id === taskId)
  if (!task || !task.outputImages?.length) return

  try {
    await saveTaskMetaToLocal(taskId, task)
    await savePromptToLocal(taskId, task.prompt)
  } catch (err) {
    console.error('保存任务元数据到本地失败:', err)
  }
}

async function saveTaskToLocalFS(taskId: string) {
  return enqueueLocalImageSave(async () => {
    await saveTaskToLocalFSNow(taskId)
  })
}

async function saveTaskToLocalFSNow(taskId: string) {
  if (!isElectronEnv()) return
  const localSavePath = await getLocalSavePath()
  if (!localSavePath) return

  const filenameState = await getTaskLocalFilenameState(taskId)
  if (!filenameState) return
  const { task, context, settings, startSequence, imagesDir } = filenameState

  let imageFailCount = 0
  let sequenceOffset = 0
  const savedPaths: Record<string, string> = {}
  try {
    for (let i = 0; i < (task.outputImages?.length ?? 0); i++) {
      const imageId = task.outputImages[i]
      const savedKey = getLocalSavedOutputImageKey(imageId, i)
      if (task.localSavedOutputImagePaths?.[savedKey]) continue

      const dataUrl = await ensureImageCached(imageId)
      if (dataUrl) {
        const fileNameBase = buildGeneratedImageFileNameBase(context, settings, startSequence + sequenceOffset)
        const saved = await saveImageToLocal(taskId, i, dataUrl, getImageExtensionFromDataUrl(dataUrl, task.params.output_format), undefined, imagesDir, fileNameBase)
        if (saved) {
          savedPaths[savedKey] = saved
          sequenceOffset++
        } else {
          imageFailCount++
        }
      } else {
        imageFailCount++
      }
    }

    await saveTaskMetaToLocal(taskId, task)
    await savePromptToLocal(taskId, task.prompt)
    markTaskOutputImagesSavedToLocal(taskId, savedPaths)

    if (imageFailCount > 0) {
      useStore.getState().showToast(`本地保存：${imageFailCount} 张图片保存失败`, 'error')
    }
  } catch (err) {
    console.error('保存到本地失败:', err)
    useStore.getState().showToast('保存到本地失败', 'error')
  }
}

async function saveAgentConversationToLocalFS(conversationId: string) {
  if (!isElectronEnv()) return
  const localSavePath = await getLocalSavePath()
  if (!localSavePath) return

  const conversation = useStore.getState().agentConversations.find((c) => c.id === conversationId)
  if (conversation) {
    try {
      const saved = await saveAgentConversationToLocal(conversationId, conversation)
      if (!saved) {
        useStore.getState().showToast('Agent 对话保存到本地失败', 'error')
      }
    } catch (err) {
      console.error('保存 Agent 对话到本地失败:', err)
      useStore.getState().showToast('Agent 对话保存到本地失败', 'error')
    }
  }
}

function getCachedThumbnail(id: string) {
  const thumbnail = thumbnailCache.get(id)
  if (thumbnail?.thumbnailVersion === CURRENT_THUMBNAIL_VERSION) {
    return thumbnail
  }
  if (thumbnail) {
    thumbnailCache.delete(id)
  }
  return undefined
}

function cacheThumbnail(id: string, thumbnail: { dataUrl: string; width?: number; height?: number; thumbnailVersion?: number }) {
  if (thumbnail.thumbnailVersion !== CURRENT_THUMBNAIL_VERSION) return
  thumbnailCache.set(id, thumbnail, thumbnail.dataUrl.length * 2)
}

export async function ensureImageCached(id: string): Promise<string | undefined> {
  const cached = getCachedImage(id)
  if (cached) return cached
  const rec = await getImage(id)
  if (rec) {
    if (!rec.dataUrl && rec.localPath && isElectronEnv()) {
      try {
        const fileResult = await readFileBuffer(rec.localPath)
        if (fileResult) {
          const mime = fileResult.name.endsWith('webp') ? 'image/webp' : fileResult.name.endsWith('jpg') || fileResult.name.endsWith('jpeg') ? 'image/jpeg' : 'image/png'
          const blob = new Blob([fileResult.data], { type: mime })
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.readAsDataURL(blob)
          })
          cacheImage(id, dataUrl)
          return dataUrl
        }
      } catch (err) {
        console.error('Failed to read image from localPath', rec.localPath, err)
      }
    } else if (rec.dataUrl) {
      cacheImage(id, rec.dataUrl)
      return rec.dataUrl
    }
  }
  return undefined
}

export async function ensureImageThumbnailCached(id: string): Promise<{ dataUrl: string; width?: number; height?: number } | undefined> {
  const cached = getCachedThumbnail(id)
  if (cached) return cached

  const rec = await getStoredFreshImageThumbnail(id)
  if (!rec?.thumbnailDataUrl) {
    scheduleThumbnailBackfill([id], 'visible')
    return undefined
  }

  const thumbnail = {
    dataUrl: rec.thumbnailDataUrl,
    width: rec.width,
    height: rec.height,
    thumbnailVersion: rec.thumbnailVersion,
  }
  cacheThumbnail(id, thumbnail)
  return thumbnail
}

export function subscribeImageThumbnail(id: string, callback: (thumbnail: { dataUrl: string; width?: number; height?: number }) => void) {
  let subscribers = thumbnailSubscribers.get(id)
  if (!subscribers) {
    subscribers = new Set()
    thumbnailSubscribers.set(id, subscribers)
  }
  subscribers.add(callback)
  return () => {
    subscribers?.delete(callback)
    if (subscribers?.size === 0) thumbnailSubscribers.delete(id)
  }
}

function notifyImageThumbnail(id: string, thumbnail: { dataUrl: string; width?: number; height?: number }) {
  thumbnailSubscribers.get(id)?.forEach((callback) => callback(thumbnail))
}

function scheduleThumbnailBackfill(ids: Iterable<string>, priority: 'visible' | 'background' = 'background') {
  for (const id of ids) {
    if (getCachedThumbnail(id) || thumbnailBackfillRunningIds.has(id)) continue
    const currentPriority = thumbnailBackfillIds.get(id)
    if (!currentPriority || priority === 'visible') thumbnailBackfillIds.set(id, priority)
  }
  scheduleThumbnailBackfillTick()
}

function scheduleThumbnailBackfillTick() {
  if (thumbnailBackfillScheduled || thumbnailBackfillIds.size === 0) return
  thumbnailBackfillScheduled = true

  const run = () => {
    thumbnailBackfillScheduled = false
    void processNextThumbnailBackfill()
  }

  if ('requestIdleCallback' in globalThis) {
    globalThis.requestIdleCallback(run, { timeout: 2_000 })
  } else {
    globalThis.setTimeout(run, 250)
  }
}

async function processNextThumbnailBackfill() {
  if (thumbnailBackfillRunningIds.size > 0) return

  const ids = await getNextThumbnailBackfillBatch()
  for (const id of ids) startThumbnailBackfill(id)

  if (thumbnailBackfillIds.size > 0) scheduleThumbnailBackfillTick()
}

async function getNextThumbnailBackfillBatch() {
  const candidates = getOrderedThumbnailBackfillIds().slice(0, MAX_THUMBNAIL_BACKFILL_CONCURRENT)
  if (candidates.length === 0) return []

  const sizes = await Promise.all(candidates.map(async (id) => {
    const image = await getImage(id)
    return { width: image?.width, height: image?.height }
  }))
  const concurrency = getThumbnailConcurrencyForBatch(sizes)
  const selected = candidates.slice(0, concurrency)
  for (const id of selected) thumbnailBackfillIds.delete(id)
  return selected
}

function getOrderedThumbnailBackfillIds() {
  const visible: string[] = []
  const background: string[] = []
  for (const [id, priority] of thumbnailBackfillIds) {
    if (priority === 'visible') visible.push(id)
    else background.push(id)
  }
  return [...visible, ...background]
}

function getThumbnailConcurrencyForBatch(sizes: Array<{ width?: number; height?: number }>) {
  let maxMegapixels = 0
  for (const { width, height } of sizes) {
    if (!width || !height) return 1
    maxMegapixels = Math.max(maxMegapixels, (width * height) / 1_000_000)
  }
  const megapixels = maxMegapixels
  if (megapixels >= 8) return 1
  if (megapixels >= 4) return 2
  if (megapixels >= 2) return 3
  return 4
}

function startThumbnailBackfill(id: string) {
  thumbnailBackfillRunningIds.add(id)

  void (async () => {
    if (getCachedThumbnail(id)) return

    const thumbnail = await getImageThumbnail(id)
    if (thumbnail?.thumbnailDataUrl) {
      cacheThumbnail(id, {
        dataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailVersion: thumbnail.thumbnailVersion,
      })
      notifyImageThumbnail(id, {
        dataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
      })
    }
  })().catch(() => {
    // Keep thumbnail generation best-effort; cards remain on placeholders if it fails.
  }).finally(() => {
    thumbnailBackfillRunningIds.delete(id)
    scheduleThumbnailBackfillTick()
  })
}

function orderImagesWithMaskFirst(images: InputImage[], maskTargetImageId: string | null | undefined) {
  if (!maskTargetImageId) return images
  const maskIdx = images.findIndex((img) => img.id === maskTargetImageId)
  if (maskIdx <= 0) return images
  const next = [...images]
  const [maskImage] = next.splice(maskIdx, 1)
  next.unshift(maskImage)
  return next
}

function isAgentTask(task: TaskRecord) {
  return task.sourceMode === 'agent' || Boolean(task.agentConversationId || task.agentRoundId)
}

function isGalleryTask(task: TaskRecord) {
  return !isAgentTask(task)
}

function showTaskCompletionNotification(title: string, body: string) {
  const settings = normalizeSettings(useStore.getState().settings)
  if (!settings.taskCompletionNotification) return
  showBrowserNotification(title, { body })
}

function countSuccessfulOutputImages(tasks: TaskRecord[]) {
  return tasks.reduce((count, task) => count + (task.status === 'done' && !isAgentTask(task) ? task.outputImages?.length ?? 0 : 0), 0)
}

function skipSupportPromptForImportedData(tasks: TaskRecord[]) {
  const count = countSuccessfulOutputImages(tasks)
  useStore.setState((state) => {
    if (state.supportPromptDismissed) return {}
    if (count <= SUPPORT_PROMPT_IMAGE_THRESHOLD) {
      return { supportPromptSkippedForImportedData: false }
    }
    if (state.supportPromptOpen) return {}
    return { supportPromptSkippedForImportedData: true }
  })
}

function showSupportPromptForExistingLocalData(tasks: TaskRecord[]) {
  // 禁用赞助提示弹窗
  return
}

function maybeOpenSupportPrompt(previousTasks: TaskRecord[], nextTasks: TaskRecord[], taskId: string) {
  // 禁用赞助提示弹窗
  return
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeAgentRound(value: unknown, fallbackIndex: number): AgentRound | null {
  if (!value || typeof value !== 'object') return null
  const round = value as Partial<AgentRound>
  if (typeof round.id !== 'string' || !round.id) return null
  if (typeof round.userMessageId !== 'string' || !round.userMessageId) return null

  const status = round.status === 'running'
    ? 'error'
    : round.status === 'error' || round.status === 'done'
    ? round.status
    : 'done'

  return {
    id: round.id,
    index: typeof round.index === 'number' ? round.index : fallbackIndex + 1,
    parentRoundId: typeof round.parentRoundId === 'string' ? round.parentRoundId : null,
    userMessageId: round.userMessageId,
    ...(typeof round.assistantMessageId === 'string' ? { assistantMessageId: round.assistantMessageId } : {}),
    prompt: typeof round.prompt === 'string' ? round.prompt : '',
    inputImageIds: normalizeStringArray(round.inputImageIds),
    maskTargetImageId: typeof round.maskTargetImageId === 'string' ? round.maskTargetImageId : null,
    maskImageId: typeof round.maskImageId === 'string' ? round.maskImageId : null,
    outputTaskIds: normalizeStringArray(round.outputTaskIds),
    ...(typeof round.responseId === 'string' ? { responseId: round.responseId } : {}),
    ...(Array.isArray(round.responseOutput) ? { responseOutput: round.responseOutput } : {}),
    status,
    error: status === 'error'
      ? typeof round.error === 'string' ? round.error : '上次请求已中断'
      : null,
    createdAt: typeof round.createdAt === 'number' ? round.createdAt : Date.now(),
    finishedAt: typeof round.finishedAt === 'number' ? round.finishedAt : null,
  }
}

function normalizeAgentMessage(value: unknown): AgentMessage | null {
  if (!value || typeof value !== 'object') return null
  const message = value as Partial<AgentMessage>
  if (typeof message.id !== 'string' || !message.id) return null
  if (message.role !== 'user' && message.role !== 'assistant') return null
  if (typeof message.roundId !== 'string' || !message.roundId) return null

  return {
    id: message.id,
    role: message.role,
    content: typeof message.content === 'string' ? message.content : '',
    roundId: message.roundId,
    ...(Array.isArray(message.inputImageIds) ? { inputImageIds: normalizeStringArray(message.inputImageIds) } : {}),
    maskTargetImageId: typeof message.maskTargetImageId === 'string' ? message.maskTargetImageId : null,
    maskImageId: typeof message.maskImageId === 'string' ? message.maskImageId : null,
    ...(Array.isArray(message.outputTaskIds) ? { outputTaskIds: normalizeStringArray(message.outputTaskIds) } : {}),
    createdAt: typeof message.createdAt === 'number' ? message.createdAt : Date.now(),
  }
}

function normalizeAgentConversations(value: unknown): AgentConversation[] {
  if (!Array.isArray(value)) return []

  const normalized = value
    .filter((item): item is AgentConversation => Boolean(item) && typeof item === 'object' && typeof (item as AgentConversation).id === 'string')
    .map((conversation, index) => {
      const normalizedRounds = Array.isArray(conversation.rounds)
        ? conversation.rounds.map(normalizeAgentRound).filter((round): round is AgentRound => Boolean(round))
        : []
      const hasBranchParents = normalizedRounds.some((round) => round.parentRoundId)
      const hasStoredActiveRound = typeof conversation.activeRoundId === 'string'
      const rounds = hasBranchParents || hasStoredActiveRound
        ? normalizedRounds
        : normalizedRounds.map((round, index) => ({
            ...round,
            parentRoundId: index > 0 ? normalizedRounds[index - 1].id : null,
          }))
      const roundIds = new Set(rounds.map((round) => round.id))
      const messages = Array.isArray(conversation.messages)
        ? conversation.messages
            .map(normalizeAgentMessage)
            .filter((message): message is AgentMessage => message != null && roundIds.has(message.roundId))
        : []
      return {
        id: conversation.id,
        title: typeof conversation.title === 'string' && conversation.title.trim() ? conversation.title : '新对话',
        order: typeof conversation.order === 'number' && Number.isFinite(conversation.order) ? conversation.order : index,
        activeRoundId: typeof conversation.activeRoundId === 'string' && roundIds.has(conversation.activeRoundId) ? conversation.activeRoundId : rounds[rounds.length - 1]?.id ?? null,
        createdAt: typeof conversation.createdAt === 'number' ? conversation.createdAt : Date.now(),
        updatedAt: typeof conversation.updatedAt === 'number' ? conversation.updatedAt : Date.now(),
        rounds,
        messages,
      }
    })

  const hasPersistedOrder = value.every((item) => isRecord(item) && typeof item.order === 'number' && Number.isFinite(item.order))
  return (hasPersistedOrder
    ? normalized.sort((a, b) => a.order - b.order)
    : normalized.sort((a, b) => b.updatedAt - a.updatedAt))
    .map((conversation, index) => ({ ...conversation, order: index }))
}

function scheduleAgentRoundSummaryToLocalFS(conversationId: string, roundId: string) {
  if (!isElectronEnv()) return Promise.resolve()

  agentRoundSummarySaveQueue = agentRoundSummarySaveQueue
    .catch(() => {})
    .then(async () => {
      const localSavePath = await getLocalSavePath()
      if (!localSavePath) return
      const state = useStore.getState()
      const conversation = state.agentConversations.find((item) => item.id === conversationId)
      const round = conversation?.rounds.find((item) => item.id === roundId)
      if (!conversation || !round) return
      const saved = await saveAgentRoundSummaryToLocal(conversation, round, state.tasks)
      if (!saved) useStore.getState().showToast('Agent 任务汇总文档保存失败', 'error')
    })
    .catch((error) => {
      console.error('保存 Agent 任务汇总文档失败:', error)
      useStore.getState().showToast('Agent 任务汇总文档保存失败', 'error')
    })
  return agentRoundSummarySaveQueue
}

function mergeImportedAgentConversations(current: AgentConversation[], imported: AgentConversation[]) {
  const merged = [...current]
  const indexes = new Map(merged.map((conversation, index) => [conversation.id, index]))

  for (const conversation of imported) {
    const index = indexes.get(conversation.id)
    if (index == null) {
      indexes.set(conversation.id, merged.length)
      merged.push(conversation)
    } else {
      merged[index] = conversation
    }
  }

  return merged
}

function mergeAgentConversationsForStorage(stored: AgentConversation[], legacy: AgentConversation[]) {
  const merged = new Map<string, AgentConversation>()
  for (const conversation of stored) merged.set(conversation.id, conversation)
  for (const conversation of legacy) {
    const existing = merged.get(conversation.id)
    if (!existing || conversation.updatedAt >= existing.updatedAt) {
      merged.set(conversation.id, conversation)
    }
  }
  return [...merged.values()]
    .sort((a, b) => a.order - b.order)
    .map((conversation, index) => ({ ...conversation, order: index }))
}

function getPersistableResponseOutputItem(item: ResponsesOutputItem): ResponsesOutputItem {
  if (item.type !== 'image_generation_call' || item.result == null) return item

  if (typeof item.result === 'string') {
    const { result: _result, ...rest } = item
    return rest
  }

  if (!isRecord(item.result)) return item
  const { b64_json: _b64Json, base64: _base64, image: _image, data: _data, ...restResult } = item.result
  if (Object.keys(restResult).length === 0) {
    const { result: _result, ...rest } = item
    return rest
  }

  return { ...item, result: restResult }
}

function getPersistableAgentConversations(conversations: AgentConversation[]): AgentConversation[] {
  return conversations.map((conversation) => ({
    ...conversation,
    rounds: conversation.rounds.map((round) => round.responseOutput?.length
      ? {
          ...round,
          responseOutput: round.responseOutput.map(getPersistableResponseOutputItem),
        }
      : round,
    ),
  }))
}

function stripPersistedAgentConversations(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((conversation) => {
    if (!isRecord(conversation) || !Array.isArray(conversation.rounds)) return conversation
    return {
      ...conversation,
      rounds: conversation.rounds.map((round) => {
        if (!isRecord(round) || !Array.isArray(round.responseOutput)) return round
        return {
          ...round,
          responseOutput: round.responseOutput.map((item) =>
            isRecord(item) ? getPersistableResponseOutputItem(item as ResponsesOutputItem) : item,
          ),
        }
      }),
    }
  })
}

export function migratePersistedState(persistedState: unknown): unknown {
  if (!isRecord(persistedState)) return persistedState
  const migrated: Record<string, unknown> = {
    ...persistedState,
    agentConversations: stripPersistedAgentConversations(persistedState.agentConversations),
  }
  // v4：外观设置 colorScheme -> skinId（非法值由 normalizeSettings 回退默认皮肤）
  if (isRecord(persistedState.settings)) {
    const settings = persistedState.settings as Record<string, unknown>
    if (settings.skinId === undefined && settings.colorScheme !== undefined) {
      migrated.settings = { ...settings, skinId: settings.colorScheme }
    }
  }
  // Migrate old data without workspaceTabs or with empty workspaceTabs: create a default tab from galleryInputDraft or current input state
  const hasWorkspaceTabsField = Array.isArray((persistedState as Record<string, unknown>).workspaceTabs)
  const hasValidWorkspaceTabs = hasWorkspaceTabsField && ((persistedState as Record<string, unknown>).workspaceTabs as unknown[]).length > 0
  if (!hasValidWorkspaceTabs) {
    const galleryDraft = isRecord(persistedState.galleryInputDraft) ? persistedState.galleryInputDraft : null
    const prompt = typeof persistedState.prompt === 'string' ? persistedState.prompt : (galleryDraft && typeof galleryDraft.prompt === 'string' ? galleryDraft.prompt : '')
    const inputImages = Array.isArray(persistedState.inputImages)
      ? persistedState.inputImages
      : (galleryDraft && Array.isArray(galleryDraft.inputImages) ? galleryDraft.inputImages : [])
    const inputImageFolder = isRecord(galleryDraft?.inputImageFolder) && typeof galleryDraft.inputImageFolder.path === 'string' && Array.isArray(galleryDraft.inputImageFolder.imageIds)
      ? { path: galleryDraft.inputImageFolder.path, imageIds: galleryDraft.inputImageFolder.imageIds.filter((id: unknown): id is string => typeof id === 'string') }
      : null
    const params = isRecord(persistedState.params) ? persistedState.params : (isRecord(galleryDraft?.params) ? galleryDraft.params : {})
    const now = Date.now()
    const defaultTab: WorkspaceTab = {
      id: Math.random().toString(36).slice(2, 9),
      name: '默认',
      groupId: null,
      prompt: String(prompt),
      inputImages: normalizeInputImages(inputImages),
      inputImageFolder,
      params: { ...DEFAULT_PARAMS, ...(isRecord(params) ? params : {}) },
      maskDraft: normalizeMaskDraft(galleryDraft?.maskDraft ?? persistedState.maskDraft),
      maskEditorImageId: typeof persistedState.maskEditorImageId === 'string' ? persistedState.maskEditorImageId : null,
    customOutputPath: typeof persistedState.customOutputPath === 'string' ? persistedState.customOutputPath : '',
    tasks: [],
      createdAt: now,
      updatedAt: now,
      order: 0,
    }
    migrated.workspaceTabs = [defaultTab]
    migrated.activeWorkspaceTabId = defaultTab.id
    migrated.workspaceTabGroups = []
    migrated.workspaceTabBarExpanded = true
  }
  return migrated
}

function normalizeFavoriteCollectionName(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function createDefaultFavoriteCollection(now = Date.now()): FavoriteCollection {
  return {
    id: DEFAULT_FAVORITE_COLLECTION_ID,
    name: DEFAULT_FAVORITE_COLLECTION_NAME,
    createdAt: now,
    updatedAt: now,
  }
}

function createDefaultScheduleState(now = new Date()): ScheduleState {
  return {
    rows: createDefaultScheduleRows(),
    items: [],
    activeWeekStart: formatDateKey(getWeekStartDate(now)),
    modalOpen: false,
    runningWeekStarts: [],
  }
}

function addScheduleDays(dateKey: string, days: number): string {
  const date = parseDateKey(dateKey)
  date.setDate(date.getDate() + days)
  return formatDateKey(date)
}

function formatFavoriteOutputDate(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function applyFavoriteOutputDateVariable(path: string | undefined, enabled: boolean): string {
  const value = path ?? ''
  if (enabled) return value.replace(/(?:19|20)\d{6}/, '{date}')
  return value.replace(/\{date\}/gi, formatFavoriteOutputDate())
}

function normalizeScheduleState(value: unknown, fallback = createDefaultScheduleState()): ScheduleState {
  if (!isRecord(value)) return fallback
  const legacyRunningWeekStart = typeof value.runningDate === 'string'
    ? formatDateKey(getWeekStartDate(parseDateKey(value.runningDate)))
    : null
  const runningWeekStarts = Array.isArray(value.runningWeekStarts)
    ? Array.from(new Set(value.runningWeekStarts.filter((weekStart): weekStart is string => typeof weekStart === 'string')))
    : legacyRunningWeekStart
      ? [legacyRunningWeekStart]
      : fallback.runningWeekStarts
  const rows = Array.isArray(value.rows)
    ? value.rows
        .filter((row): row is Record<string, unknown> => isRecord(row) && typeof row.id === 'string')
        .map((row, index) => ({
          id: String(row.id),
          name: typeof row.name === 'string' && row.name.trim() ? row.name : `任务 ${index + 1}`,
          order: typeof row.order === 'number' ? row.order : index,
        }))
    : fallback.rows
  const items = Array.isArray(value.items)
    ? value.items
        .filter((item): item is Record<string, unknown> =>
          isRecord(item) &&
          typeof item.id === 'string' &&
          typeof item.taskId === 'string' &&
          typeof item.date === 'string' &&
          typeof item.rowId === 'string',
        )
        .map((item, index): ScheduleItem => ({
          id: String(item.id),
          taskId: String(item.taskId),
          collectionId: typeof item.collectionId === 'string' ? item.collectionId : null,
          date: String(item.date),
          rowId: String(item.rowId),
          order: typeof item.order === 'number' ? item.order : index,
          count: Math.max(1, typeof item.count === 'number' ? Math.floor(item.count) : 1),
          time: typeof item.time === 'string' && item.time.trim() ? item.time : null,
          lastRunKey: typeof item.lastRunKey === 'string' ? item.lastRunKey : undefined,
          status: item.status === 'queued' || item.status === 'running' || item.status === 'done' || item.status === 'error' || item.status === 'idle' ? item.status : undefined,
          lastTaskIds: Array.isArray(item.lastTaskIds) ? item.lastTaskIds.filter((id): id is string => typeof id === 'string') : undefined,
          lastError: typeof item.lastError === 'string' ? item.lastError : undefined,
        }))
    : fallback.items
  return {
    rows: rows.length ? rows : fallback.rows,
    items,
    activeWeekStart: typeof value.activeWeekStart === 'string' ? value.activeWeekStart : fallback.activeWeekStart,
    modalOpen: Boolean(value.modalOpen),
    runningWeekStarts,
  }
}

function normalizeFavoriteCollections(value: unknown): FavoriteCollection[] {
  const now = Date.now()
  const collections = Array.isArray(value) ? value : []
  const normalized: FavoriteCollection[] = []
  const ids = new Set<string>()
  for (const item of collections) {
    if (!isRecord(item)) continue
    if (typeof item.id !== 'string' || !item.id.trim()) continue
    const id = item.id
    if (id === ALL_FAVORITES_COLLECTION_ID || ids.has(id)) continue
    const name = normalizeFavoriteCollectionName(typeof item.name === 'string' ? item.name : '')
    if (!name) continue
    ids.add(id)
    normalized.push({
      id,
      name: name.slice(0, 60),
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : now,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now,
    })
  }
  return normalized
}

function ensureDefaultFavoriteCollection(collections: FavoriteCollection[]) {
  if (collections.some((collection) => collection.id === DEFAULT_FAVORITE_COLLECTION_ID)) return collections
  return [createDefaultFavoriteCollection(), ...collections]
}

/** 确保"默认"收藏夹存在（用于兜底孤立收藏任务） */
function ensureDefaultNamedCollection(collections: FavoriteCollection[]) {
  if (getDefaultNamedFavoriteCollectionId(collections)) return collections
  return [createDefaultFavoriteCollection(), ...collections]
}

function getDefaultNamedFavoriteCollectionId(collections: FavoriteCollection[]) {
  return collections.find((collection) => collection.id === DEFAULT_FAVORITE_COLLECTION_ID)?.id
    ?? collections.find((collection) => collection.name === DEFAULT_FAVORITE_COLLECTION_NAME)?.id
    ?? null
}

function resolveDefaultFavoriteCollectionId(collections: FavoriteCollection[], preferredId: unknown) {
  if (preferredId === null) return null
  if (typeof preferredId === 'string' && collections.some((collection) => collection.id === preferredId)) return preferredId
  if (collections.some((collection) => collection.id === DEFAULT_FAVORITE_COLLECTION_ID)) return DEFAULT_FAVORITE_COLLECTION_ID
  return collections[0]?.id ?? null
}

function createAgentConversation(now = Date.now()): AgentConversation {
  return {
    id: genId(),
    title: '新对话',
    order: 0,
    activeRoundId: null,
    createdAt: now,
    updatedAt: now,
    rounds: [],
    messages: [],
  }
}

function createAgentConversationTitle(prompt: string, fallbackTitle: string) {
  const title = prompt.replace(/\s+/g, ' ').trim()
  if (!title) return fallbackTitle
  const chars = Array.from(title)
  if (chars.length <= AGENT_CONVERSATION_TITLE_MAX_LENGTH) return title
  return `${chars.slice(0, AGENT_CONVERSATION_TITLE_MAX_LENGTH - 3).join('')}...`
}

function isEmptyAgentConversation(conversation: AgentConversation) {
  return conversation.rounds.length === 0 && conversation.messages.length === 0 && !conversation.activeRoundId
}

function getLatestAgentConversation(conversations: AgentConversation[]) {
  return conversations.reduce<AgentConversation | null>((latest, conversation) => {
    if (!latest) return conversation
    if (conversation.updatedAt !== latest.updatedAt) return conversation.updatedAt > latest.updatedAt ? conversation : latest
    return conversation.createdAt > latest.createdAt ? conversation : latest
  }, null)
}

export function getPersistedState(state: AppState) {
  const settings = normalizeSettings(state.settings)
  const galleryInputDraft = getPersistableGalleryInputDraft(state)
  return {
    settings,
    params: state.params,
    customOutputPath: state.customOutputPath,
    ...(settings.persistInputOnRestart && (state.appMode === 'gallery' || galleryInputDraft)
      ? {
          prompt: galleryInputDraft?.prompt ?? '',
          inputImages: galleryInputDraft?.inputImages.map((img) => ({ id: img.id, dataUrl: '' })) ?? [],
        }
      : {}),
    dismissedCodexCliPrompts: state.dismissedCodexCliPrompts,
    appMode: state.appMode,
    galleryInputDraft: settings.persistInputOnRestart && galleryInputDraft
      ? { ...galleryInputDraft, inputImages: galleryInputDraft.inputImages.map((img) => ({ id: img.id, dataUrl: '' })), inputImageFolder: galleryInputDraft.inputImageFolder }
      : null,
    ...(agentConversationMigrationPending && !agentConversationPersistenceReady
      ? { agentConversations: getPersistableAgentConversations(state.agentConversations) }
      : {}),
    activeAgentConversationId: state.activeAgentConversationId,
    agentInputDrafts: getPersistableAgentInputDrafts(state),
    agentSidebarCollapsed: state.agentSidebarCollapsed,
    agentDesktopSidebarCollapsed: state.agentDesktopSidebarCollapsed,
    agentAssetTab: state.agentAssetTab,
    agentAssetPanelCollapsed: state.agentAssetPanelCollapsed,
    favoriteCollections: state.favoriteCollections,
    defaultFavoriteCollectionId: state.defaultFavoriteCollectionId,
    schedule: state.schedule,
    supportPromptDismissed: state.supportPromptDismissed,
    supportPromptOpen: state.supportPromptOpen,
    supportPromptSkippedForImportedData: state.supportPromptSkippedForImportedData,
    ...(wordLibraryMigrationPending && !wordLibraryPersistenceReady
      ? {
          wordLibraryGroups: state.wordLibraryGroups,
          wordLibraryEntries: state.wordLibraryEntries,
          wordGenerationBatches: state.wordGenerationBatches,
        }
      : {}),
    ...(state.workspaceTabs.length > 0
      ? {
          workspaceTabs: state.workspaceTabs.map((tab) => ({
            ...tab,
            inputImages: tab.inputImages.map((img) => ({ id: img.id, dataUrl: '' })),
            inputImageFolder: tab.inputImageFolder,
            tasks: [],
            _taskIds: tab.tasks.map((t) => t.id),
          })),
          activeWorkspaceTabId: state.activeWorkspaceTabId,
          workspaceTabGroups: state.workspaceTabGroups,
        }
      : {}),
    workspaceTabBarExpanded: state.workspaceTabBarExpanded,
    lastAutoBackupAt: state.lastAutoBackupAt,
    firstBackupReminderShown: state.firstBackupReminderShown,
    backupReminderCount: state.backupReminderCount,
  }
}

async function replaceStoredAgentConversations(conversations: AgentConversation[]) {
  await replaceAgentConversations(conversations.map(getPersistableAgentConversation))
}

function getPersistableAgentConversation(conversation: AgentConversation): AgentConversation {
  return getPersistableAgentConversations([conversation])[0]!
}

function normalizeTaskRecordFields(task: TaskRecord): TaskRecord {
  return {
    ...task,
    params: task.params ? { ...DEFAULT_PARAMS, ...task.params } : { ...DEFAULT_PARAMS },
    outputImages: Array.isArray(task.outputImages) ? task.outputImages : [],
    inputImageIds: Array.isArray(task.inputImageIds) ? task.inputImageIds : [],
  }
}

function mergePersistedState(persistedState: unknown, currentState: AppState): AppState {
  if (!persistedState || typeof persistedState !== 'object') return currentState

  const persisted = persistedState as Partial<AppState>
  const settings = normalizeSettings(persisted.settings ?? currentState.settings)
  setApiTransportMode(settings.apiTransportMode)
  const hasPersistedAgentConversations = Array.isArray(persisted.agentConversations)
  if (hasPersistedAgentConversations && normalizeAgentConversations(persisted.agentConversations).length > 0) {
    agentConversationMigrationPending = true
  }
  const agentConversations = hasPersistedAgentConversations
    ? normalizeAgentConversations(persisted.agentConversations)
    : currentState.agentConversations
  const activeAgentConversationId =
    typeof persisted.activeAgentConversationId === 'string' && (!hasPersistedAgentConversations || agentConversations.some((conversation) => conversation.id === persisted.activeAgentConversationId))
      ? persisted.activeAgentConversationId
      : agentConversations[0]?.id ?? null
  const appMode = persisted.appMode === 'agent' || persisted.appMode === 'postprocess' || persisted.appMode === 'strategy' || persisted.appMode === 'ordering'
    ? persisted.appMode
    : 'gallery'
  const galleryInputDraft = settings.persistInputOnRestart
    ? normalizeAgentInputDraft(persisted.galleryInputDraft ?? {
        prompt: persisted.prompt,
        inputImages: persisted.inputImages,
        maskDraft: null,
        maskEditorImageId: null,
      })
    : null
  const normalizedAgentInputDrafts = hasPersistedAgentConversations
    ? normalizeAgentInputDrafts(persisted.agentInputDrafts, agentConversations)
    : normalizeAgentInputDraftsByKey(persisted.agentInputDrafts)
  let agentInputDrafts = cleanStaleAgentInputDrafts(normalizedAgentInputDrafts, activeAgentConversationId)
  if (appMode === 'agent' && activeAgentConversationId && !agentInputDrafts[activeAgentConversationId] && settings.persistInputOnRestart && typeof persisted.prompt === 'string') {
    agentInputDrafts = {
      ...agentInputDrafts,
      [activeAgentConversationId]: normalizeAgentInputDraft({
        prompt: persisted.prompt,
        inputImages: persisted.inputImages,
        maskDraft: null,
        maskEditorImageId: null,
      }, Date.now()),
    }
  }
  const restoredAgentDraft = appMode === 'agent' && activeAgentConversationId
    ? agentInputDrafts[activeAgentConversationId] ?? null
    : null
  const favoriteCollections = Array.isArray(persisted.favoriteCollections)
    ? ensureDefaultFavoriteCollection(normalizeFavoriteCollections(persisted.favoriteCollections))
    : currentState.favoriteCollections
  const defaultFavoriteCollectionId = resolveDefaultFavoriteCollectionId(favoriteCollections, persisted.defaultFavoriteCollectionId)
  const schedule = normalizeScheduleState(persisted.schedule, currentState.schedule)
  if (Array.isArray(persisted.wordLibraryGroups) || Array.isArray(persisted.wordLibraryEntries)) {
    wordLibraryMigrationPending = true
  }
  const wordLibraryGroups = normalizeWordLibraryGroups(persisted.wordLibraryGroups, currentState.wordLibraryGroups)
  const persistedWordLibraryEntries = normalizeWordLibraryEntries(persisted.wordLibraryEntries, wordLibraryGroups)
  // Gallery 模式下顶层输入状态（params/inputImageFolder）应镜像活动 workspace 标签页，
  // 与 setAppMode 的恢复逻辑保持一致。
  const normalizedWorkspaceTabs = Array.isArray(persisted.workspaceTabs) && persisted.workspaceTabs.length > 0
    ? persisted.workspaceTabs.map((tab) => ({
        ...tab,
        inputImages: normalizeInputImages(tab.inputImages),
        inputImageFolder: isRecord(tab.inputImageFolder) && typeof tab.inputImageFolder.path === 'string' && Array.isArray(tab.inputImageFolder.imageIds)
          ? { path: tab.inputImageFolder.path, imageIds: tab.inputImageFolder.imageIds.filter((id: unknown): id is string => typeof id === 'string') }
          : null,
        params: isRecord(tab.params) ? { ...DEFAULT_PARAMS, ...tab.params } : { ...DEFAULT_PARAMS },
        maskDraft: normalizeMaskDraft(tab.maskDraft),
        customOutputPath: typeof tab.customOutputPath === 'string' ? tab.customOutputPath : '',
        tasks: Array.isArray(tab.tasks) ? tab.tasks.filter((t: any) => typeof t !== 'string').map(normalizeTaskRecordFields) : [],
        _taskIds: Array.isArray((tab as any)._taskIds) ? (tab as any)._taskIds : (Array.isArray(tab.tasks) ? tab.tasks.map((t: any) => typeof t === 'string' ? t : (t?.id ?? '')) : []),
      }))
    : currentState.workspaceTabs
  const persistedActiveWorkspaceTabId = typeof persisted.activeWorkspaceTabId === 'string' ? persisted.activeWorkspaceTabId : currentState.activeWorkspaceTabId
  const activeWorkspaceTabForRestore = appMode === 'gallery' && persistedActiveWorkspaceTabId
    ? normalizedWorkspaceTabs.find((t) => t.id === persistedActiveWorkspaceTabId) ?? null
    : null
  const restoredParams = activeWorkspaceTabForRestore
    ? activeWorkspaceTabForRestore.params
    : (isRecord(persisted.params) ? { ...DEFAULT_PARAMS, ...persisted.params } : currentState.params)
  const restoredInputImageFolder = activeWorkspaceTabForRestore
    ? activeWorkspaceTabForRestore.inputImageFolder
    : (restoredAgentDraft ? restoredAgentDraft.inputImageFolder ?? null : galleryInputDraft?.inputImageFolder ?? null)
  const restoredCustomOutputPath = activeWorkspaceTabForRestore
    ? activeWorkspaceTabForRestore.customOutputPath
    : (typeof persisted.customOutputPath === 'string' ? persisted.customOutputPath : currentState.customOutputPath)
  return {
    ...currentState,
    appMode,
    settings,
    dismissedCodexCliPrompts: persisted.dismissedCodexCliPrompts ?? currentState.dismissedCodexCliPrompts,
    galleryInputDraft: galleryInputDraft && !isEmptyAgentInputDraft(galleryInputDraft) ? galleryInputDraft : null,
    agentConversations,
    activeAgentConversationId,
    agentInputDrafts,
    agentSidebarCollapsed: Boolean(persisted.agentSidebarCollapsed),
    agentDesktopSidebarCollapsed: typeof persisted.agentDesktopSidebarCollapsed === 'boolean' ? persisted.agentDesktopSidebarCollapsed : false,
    agentAssetTab: persisted.agentAssetTab === 'references' ? 'references' : 'outputs',
    agentAssetPanelCollapsed: Boolean(persisted.agentAssetPanelCollapsed),
    favoriteCollections,
    defaultFavoriteCollectionId,
    schedule,
    activeFavoriteCollectionId: null,
    favoritePickerTaskIds: null,
    supportPromptDismissed: Boolean(persisted.supportPromptDismissed),
    supportPromptOpen: Boolean(persisted.supportPromptOpen),
    supportPromptSkippedForImportedData: Boolean(persisted.supportPromptSkippedForImportedData),
    wordLibraryGroups,
    wordLibraryEntries: Array.isArray(persisted.wordLibraryEntries) && persistedWordLibraryEntries.length > 0
      ? persistedWordLibraryEntries
      : currentState.wordLibraryEntries,
    wordGenerationBatches: Array.isArray(persisted.wordGenerationBatches)
      ? persisted.wordGenerationBatches.filter((batch): batch is WordGenerationBatch => isRecord(batch) && typeof batch.id === 'string' && typeof batch.skillName === 'string' && typeof batch.sourcePrompt === 'string').map((batch) => ({
          id: batch.id,
          skillName: batch.skillName,
          sourcePrompt: batch.sourcePrompt,
          referenceImageIds: Array.isArray(batch.referenceImageIds) ? batch.referenceImageIds.filter((id): id is string => typeof id === 'string') : [],
          entryIds: Array.isArray(batch.entryIds) ? batch.entryIds.filter((id): id is string => typeof id === 'string') : [],
          createdAt: typeof batch.createdAt === 'number' ? batch.createdAt : Date.now(),
          archivedAt: typeof batch.archivedAt === 'number' ? batch.archivedAt : null,
        }))
      : currentState.wordGenerationBatches,
    workspaceTabs: normalizedWorkspaceTabs,
    activeWorkspaceTabId: persistedActiveWorkspaceTabId,
    workspaceTabGroups: Array.isArray(persisted.workspaceTabGroups) && persisted.workspaceTabGroups.length > 0
      ? persisted.workspaceTabGroups.map((g) => ({
          id: String(g.id ?? Math.random().toString(36).slice(2, 9)),
          name: String(g.name ?? '未命名分组'),
          order: typeof g.order === 'number' ? g.order : 0,
          collapsed: Boolean(g.collapsed),
        }))
      : currentState.workspaceTabGroups,
    workspaceTabBarExpanded: typeof persisted.workspaceTabBarExpanded === 'boolean' ? persisted.workspaceTabBarExpanded : currentState.workspaceTabBarExpanded,
    lastAutoBackupAt: persisted.lastAutoBackupAt ?? currentState.lastAutoBackupAt,
    firstBackupReminderShown: Boolean(persisted.firstBackupReminderShown),
    backupReminderCount: typeof persisted.backupReminderCount === 'number' ? persisted.backupReminderCount : currentState.backupReminderCount,
    prompt: restoredAgentDraft ? restoredAgentDraft.prompt : galleryInputDraft?.prompt ?? '',
    inputImages: restoredAgentDraft ? restoredAgentDraft.inputImages : galleryInputDraft?.inputImages ?? [],
    inputImageFolder: restoredInputImageFolder,
    params: restoredParams,
    maskDraft: restoredAgentDraft ? restoredAgentDraft.maskDraft : galleryInputDraft?.maskDraft ?? null,
    maskEditorImageId: restoredAgentDraft ? restoredAgentDraft.maskEditorImageId : galleryInputDraft?.maskEditorImageId ?? null,
    customOutputPath: restoredCustomOutputPath,
  }
}

// ===== Store 类型 =====

interface PromptInputDialogConfig {
  title: string
  label: string
  initialValue?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
  action: (value: string) => void
  onCancel?: () => void
}

// ===== 变量条目编辑弹窗 =====

interface VarEntryEditorConfig {
  entryId?: string
  varName: string
  groupId: string
  entries: string[]
  onSave: (varName: string, groupId: string, entries: string[]) => void
}

interface AppState {
  // 模式
  appMode: AppMode
  setAppMode: (mode: AppMode) => void

  // 设置
  settings: AppSettings
  setSettings: (s: Partial<AppSettings>) => void
  dismissedCodexCliPrompts: string[]
  dismissCodexCliPrompt: (key: string) => void

  // 输入
  prompt: string
  setPrompt: (p: string) => void
  inputImages: InputImage[]
  addInputImage: (img: InputImage) => void
  replaceInputImage: (idx: number, img: InputImage) => void
  removeInputImage: (idx: number) => void
  clearInputImages: () => void
  setInputImages: (imgs: InputImage[], options?: { equivalentImageIds?: Record<string, string> }) => void
  moveInputImage: (fromIdx: number, toIdx: number) => void
  inputImageFolder: InputImageFolder | null
  setInputImageFolder: (folder: InputImageFolder | null) => void
  maskDraft: MaskDraft | null
  setMaskDraft: (draft: MaskDraft | null) => void
  clearMaskDraft: () => void
  maskEditorImageId: string | null
  setMaskEditorImageId: (id: string | null) => void
  galleryInputDraft: AgentInputDraft | null
  customOutputPath: string
  setCustomOutputPath: (path: string) => void

  // 参数
  params: TaskParams
  setParams: (p: Partial<TaskParams>) => void
  reusedTaskApiProfileId: string | null
  reusedTaskApiProfileName: string | null
  reusedTaskApiProfileMissing: boolean
  setReusedTaskApiProfile: (profileId: string | null, missing?: boolean, profileName?: string | null) => void

  // Agent
  agentConversations: AgentConversation[]
  agentConversationsLoaded: boolean
  activeAgentConversationId: string | null
  agentInputDrafts: Record<string, AgentInputDraft>
  agentSidebarCollapsed: boolean
  agentDesktopSidebarCollapsed: boolean
  agentAssetTab: 'references' | 'outputs'
  agentAssetPanelCollapsed: boolean
  agentMobileHeaderVisible: boolean
  agentEditingRoundId: string | null
  agentEditingConversationId: string | null
  agentGeneratingTitleIds: Record<string, true>
  createAgentConversation: () => string
  setActiveAgentConversationId: (id: string | null) => void
  setActiveAgentRoundId: (conversationId: string, roundId: string | null) => void
  renameAgentConversation: (id: string, title: string) => void
  deleteAgentConversation: (id: string) => void
  reorderAgentConversations: (sourceId: string, targetId: string, position?: 'before' | 'after') => void
  setAgentSidebarCollapsed: (collapsed: boolean) => void
  setAgentDesktopSidebarCollapsed: (collapsed: boolean) => void
  setAgentAssetTab: (tab: 'references' | 'outputs') => void
  setAgentAssetPanelCollapsed: (collapsed: boolean) => void
  setAgentMobileHeaderVisible: (visible: boolean) => void
  setAgentEditingRoundId: (id: string | null) => void
  setAgentEditingConversationId: (id: string | null) => void

  // 任务列表
  tasks: TaskRecord[]
  setTasks: (t: TaskRecord[]) => void
  favoriteCollections: FavoriteCollection[]
  setFavoriteCollections: (collections: FavoriteCollection[]) => void
  defaultFavoriteCollectionId: string | null
  setDefaultFavoriteCollectionId: (id: string | null) => void
  activeFavoriteCollectionId: string | null
  isManageCollectionsModalOpen: boolean
  setActiveFavoriteCollectionId: (id: string | null) => void
  openManageCollectionsModal: () => void
  closeManageCollectionsModal: () => void
  favoritePickerTaskIds: string[] | null
  openFavoritePicker: (taskIds: string[]) => void
  closeFavoritePicker: () => void
  schedule: ScheduleState
  setScheduleModalOpen: (open: boolean) => void
  setScheduleWeekStart: (weekStart: string) => void
  startScheduleWeek: (weekStart: string) => void
  stopScheduleWeek: (weekStart: string) => void
  copyPreviousWeekSchedule: () => string[]
  addScheduleRow: () => string
  updateScheduleRow: (id: string, name: string) => void
  removeScheduleRow: (id: string) => void
  addScheduleItem: (item: Omit<ScheduleItem, 'id' | 'order'> & { order?: number }) => string
  updateScheduleItem: (id: string, patch: Partial<Omit<ScheduleItem, 'id'>>) => void
  removeScheduleItem: (id: string) => void
  updateTaskFavoriteOutputPath: (taskId: string, outputPath: string) => void
  updateTaskFavoriteOutputDateVariable: (taskId: string, enabled: boolean) => void
  runScheduleItem: (id: string, now?: Date, countOverride?: number, appendToLastTaskIds?: boolean) => Promise<string | null>
  streamPreviews: Record<string, string>
  streamPreviewSlots: Record<string, Record<string, string>>
  setTaskStreamPreview: (taskId: string, image?: string, requestIndex?: number) => void

  // 搜索和筛选
  searchQuery: string
  setSearchQuery: (q: string) => void
  filterStatus: 'all' | 'running' | 'done' | 'error'
  setFilterStatus: (status: AppState['filterStatus']) => void
  filterFavorite: boolean
  setFilterFavorite: (f: boolean) => void

  // 多选
  selectedTaskIds: string[]
  setSelectedTaskIds: (ids: string[] | ((prev: string[]) => string[])) => void
  toggleTaskSelection: (id: string, force?: boolean) => void
  clearSelection: () => void
  selectedFavoriteCollectionIds: string[]
  setSelectedFavoriteCollectionIds: (ids: string[] | ((prev: string[]) => string[])) => void
  toggleFavoriteCollectionSelection: (id: string, force?: boolean) => void
  clearFavoriteCollectionSelection: () => void

  // UI
  detailTaskId: string | null
  detailReturnToSchedule: boolean
  setDetailTaskId: (id: string | null, options?: { returnToSchedule?: boolean }) => void
  lightboxImageId: string | null
  lightboxImageList: string[]
  setLightboxImageId: (id: string | null, list?: string[]) => void
  showSettings: boolean
  settingsTabRequest: SettingsTab | null
  setShowSettings: (v: boolean, tab?: SettingsTab) => void
  supportPromptOpen: boolean
  supportPromptDismissed: boolean
  supportPromptSkippedForImportedData: boolean
  setSupportPromptOpen: (v: boolean) => void
  dismissSupportPrompt: () => void

  // Toast
  toast: { message: string; type: ToastType } | null
  showToast: (message: string, type?: ToastType) => void

  // Confirm dialog
  confirmDialog: {
    title: string
    message: string
    checkbox?: {
      label: string
      defaultChecked?: boolean
      disabled?: boolean
      tone?: 'primary' | 'danger'
    }
    confirmText?: string
    cancelText?: string
    showCancel?: boolean
    buttons?: Array<{
      label: string
      tone?: 'primary' | 'secondary' | 'danger' | 'warning'
      action: (checkboxChecked?: boolean) => void
    }>
    icon?: 'info' | 'copy'
    minConfirmDelayMs?: number
    messageAlign?: 'left' | 'center'
    tone?: 'danger' | 'warning'
    action?: (checkboxChecked?: boolean) => void
    cancelAction?: (checkboxChecked?: boolean) => void
  } | null
  setConfirmDialog: (d: AppState['confirmDialog']) => void

  // Prompt input dialog
  promptInputDialog: PromptInputDialogConfig | null
  setPromptInputDialog: (config: PromptInputDialogConfig | null) => void

  // Random prompt generator
  randomPromptModalOpen: boolean
  setRandomPromptModalOpen: (open: boolean) => void

  // Word library sidebar
  wordLibrarySidebarOpen: boolean
  setWordLibrarySidebarOpen: (open: boolean) => void
  wordLibraryManagerOpen: boolean
  setWordLibraryManagerOpen: (open: boolean) => void

  // Word library (词条库)
  wordLibraryGroups: WordLibraryGroup[]
  wordLibraryEntries: WordLibraryEntry[]
  wordGenerationBatches: WordGenerationBatch[]
  wordLibraryEditEntryId: string | null
  setWordLibraryEditEntryId: (id: string | null) => void
  varEntryEditor: VarEntryEditorConfig | null
  setVarEntryEditor: (config: VarEntryEditorConfig | null) => void
  wordLibraryPromptSelectedVarName: string | null
  setWordLibraryPromptSelectedVarName: (varName: string | null) => void
  createWordLibraryGroup: (name: string, parentId?: string | null) => { id: string; name: string }
  renameWordLibraryGroup: (id: string, name: string) => void
  updateWordLibraryGroup: (id: string, patch: Partial<WordLibraryGroup>) => void
  deleteWordLibraryGroup: (id: string) => void
  mergeWordLibraryGroups: (sourceId: string, targetId: string) => void
  archiveWordLibraryGroup: (id: string, archived?: boolean) => void
  createWordLibraryEntry: (groupId: string, key?: string) => WordLibraryEntry
  updateWordLibraryEntry: (id: string, patch: Partial<WordLibraryEntry>) => void
  deleteWordLibraryEntry: (id: string) => void
  moveWordLibraryEntry: (entryId: string, targetGroupId: string) => void
  /** 批量软删除（进入回收站） */
  batchDeleteWordLibraryEntries: (ids: string[]) => void
  /** 批量移动到目标分组 */
  batchMoveWordLibraryEntries: (ids: string[], targetGroupId: string) => void
  /** 按给定 id 顺序重排置顶后的排序权重（仅更新 sortOrder） */
  reorderWordLibraryEntries: (orderedIds: string[]) => void
  toggleWordLibraryEntryPinned: (id: string) => void
  toggleWordLibraryEntryFavorite: (id: string) => void
  /** 批量追加标签（去重合并） */
  batchAddTagsToWordLibraryEntries: (ids: string[], tags: string[]) => void
  /** 从回收站恢复 */
  restoreWordLibraryEntries: (ids: string[]) => void
  /** 永久删除（真正移除） */
  destroyWordLibraryEntries: (ids: string[]) => void
  /** 清空回收站 */
  emptyWordLibraryTrash: () => void
  /** 记录一次使用（使用频率 +1） */
  touchWordLibraryEntryUsage: (id: string) => void
  createWordGenerationBatch: (input: Omit<WordGenerationBatch, 'id' | 'createdAt' | 'archivedAt'>) => WordGenerationBatch
  archiveWordGenerationBatch: (id: string, archived?: boolean) => void
  /** 导出当前词条库（含回收站）为可迁移的数据结构 */
  exportWordLibrary: () => WordLibraryExportData
  /** 导入词条库数据；strategy 为 'merge'（按 id 合并，保留既有）或 'replace'（整体替换） */
  importWordLibrary: (data: unknown, strategy: 'merge' | 'replace') => { added: number; updated: number; groupsAdded: number }
  /** 批量复制词条（生成带「副本」后缀的新词条，置顶状态/回收站状态均重置） */
  duplicateWordLibraryEntries: (ids: string[]) => number
  /** 批量置顶选中的词条 */
  batchPinWordLibraryEntries: (ids: string[]) => void
  /** 按给定 id 顺序重排分组（仅更新分组 sortOrder） */
  reorderWordLibraryGroups: (orderedIds: string[]) => void
  /** 清理回收站中超过保留期限（默认 30 天）的词条，返回清理数量 */
  cleanupExpiredWordLibraryTrash: () => number

  // Workspace tabs (工作区标签页)
  workspaceTabs: WorkspaceTab[]
  activeWorkspaceTabId: string | null
  workspaceTabGroups: WorkspaceTabGroup[]
  workspaceTabBarExpanded: boolean
  selectedWorkspaceTabIds: string[]
  workspaceTabManagerOpen: boolean
  setActiveWorkspaceTabId: (id: string | null) => void
  setWorkspaceTabBarExpanded: (expanded: boolean) => void
  setSelectedWorkspaceTabIds: (updater: string[] | ((prev: string[]) => string[])) => void
  toggleWorkspaceTabSelection: (id: string, force?: boolean) => void
  clearWorkspaceTabSelection: () => void
  setWorkspaceTabManagerOpen: (open: boolean) => void
  createWorkspaceTab: () => string
  closeWorkspaceTab: (id: string) => void
  duplicateWorkspaceTab: (id: string) => string
  renameWorkspaceTab: (id: string, name: string) => void
  reorderWorkspaceTabs: (tabs: WorkspaceTab[]) => void
  createWorkspaceTabGroup: (name: string) => string
  renameWorkspaceTabGroup: (id: string, name: string) => void
  deleteWorkspaceTabGroup: (id: string) => void
  moveWorkspaceTabToGroup: (tabId: string, groupId: string | null) => void
  updateWorkspaceTabState: (id: string, patch: Partial<WorkspaceTab>) => void
  saveCurrentStateToActiveTab: () => void

  // 自动备份
  lastAutoBackupAt: number
  setLastAutoBackupAt: (t: number) => void
  firstBackupReminderShown: boolean
  setFirstBackupReminderShown: (v: boolean) => void
  backupReminderCount: number
  setBackupReminderCount: (v: number) => void

  // Agent 流式文本缓冲（不参与持久化，避免频繁更新 agentConversations）
  agentStreamingTexts: Record<string, string>
  setAgentStreamingText: (conversationId: string, messageId: string, text: string) => void
  clearAgentStreamingText: (conversationId: string, messageId?: string) => void
}

function isImageReferencedByState(state: AppState, imageId: string) {
  if (state.inputImages.some((img) => img.id === imageId)) return true
  if (state.galleryInputDraft?.inputImages.some((img) => img.id === imageId)) return true
  if (Object.values(state.agentInputDrafts).some((draft) => draft.inputImages.some((img) => img.id === imageId))) return true
  if (state.workspaceTabs.some((tab) =>
    tab.inputImages.some((img) => img.id === imageId) ||
    tab.maskDraft?.targetImageId === imageId ||
    tab.tasks.some((task) =>
      task.inputImageIds?.includes(imageId) ||
      task.outputImages?.includes(imageId) ||
      task.streamPartialImageIds?.includes(imageId) ||
      task.maskTargetImageId === imageId ||
      task.maskImageId === imageId
    )
  )) return true
  if (state.tasks.some((task) =>
    task.inputImageIds.includes(imageId) ||
    task.outputImages.includes(imageId) ||
    task.streamPartialImageIds?.includes(imageId) ||
    task.maskTargetImageId === imageId ||
    task.maskImageId === imageId
  )) return true
  return state.agentConversations.some((conversation) =>
    conversation.rounds.some((round) =>
      round.inputImageIds.includes(imageId) ||
      round.maskTargetImageId === imageId ||
      round.maskImageId === imageId
    ) ||
    conversation.messages.some((message) =>
      message.inputImageIds?.includes(imageId) ||
      message.maskTargetImageId === imageId ||
      message.maskImageId === imageId
    ),
  )
}

export async function deleteImageIfUnreferenced(imageId: string) {
  imageCache.delete(imageId)
  thumbnailCache.delete(imageId)
  thumbnailBackfillIds.delete(imageId)
  thumbnailBackfillRunningIds.delete(imageId)
  thumbnailSubscribers.delete(imageId)
  if (isImageReferencedByState(useStore.getState(), imageId)) return
  try {
    const sopRuns = await getAllSopBatchSnapshots()
    if (sopRuns.some((run) => run.referenceImageIds.includes(imageId))) return
    await deleteImage(imageId)
  } catch {
    // 清理是内存/存储优化，失败不影响替换结果。
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/** 回收站词条保留期限：超过后自动清理（30 天） */
const WORD_LIBRARY_TRASH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function normalizeWordLibraryGroups(value: unknown, fallback: WordLibraryGroup[]): WordLibraryGroup[] {
  if (!Array.isArray(value)) return fallback
  const groups = value
    .map((group, index): WordLibraryGroup | null => {
      if (!isRecord(group) || typeof group.id !== 'string' || typeof group.name !== 'string') return null
      const sortOrder = typeof group.sortOrder === 'number' && Number.isFinite(group.sortOrder)
        ? group.sortOrder
        : index
      return {
        id: group.id,
        name: group.name,
        sortOrder,
        parentId: typeof group.parentId === 'string' ? group.parentId : null,
        description: typeof group.description === 'string' ? group.description : '',
        color: typeof group.color === 'string' ? group.color : '',
        archivedAt: typeof group.archivedAt === 'number' && Number.isFinite(group.archivedAt) ? group.archivedAt : null,
      }
    })
    .filter((group): group is WordLibraryGroup => group != null)
  return groups.length > 0 ? groups : fallback
}

function normalizeWordLibraryEntries(value: unknown, groups: WordLibraryGroup[]): WordLibraryEntry[] {
  if (!Array.isArray(value)) return []
  const fallbackGroupId = groups[0]?.id ?? 'default'
  const groupIds = new Set(groups.map((group) => group.id))
  const now = Date.now()
  return value
    .map((entry, index): WordLibraryEntry | null => {
      if (!isRecord(entry) || typeof entry.id !== 'string') return null
      const key = typeof entry.key === 'string' ? entry.key : ''
      const groupId = typeof entry.groupId === 'string' && groupIds.has(entry.groupId)
        ? entry.groupId
        : fallbackGroupId
      const drawCount = typeof entry.draw_count === 'number' && Number.isFinite(entry.draw_count)
        ? Math.max(1, Math.trunc(entry.draw_count))
        : 1
      const tags = Array.isArray(entry.tags)
        ? entry.tags.filter((tag): tag is string => typeof tag === 'string')
        : []
      const deletedAt = typeof entry.deletedAt === 'number' && Number.isFinite(entry.deletedAt)
        ? entry.deletedAt
        : null
      const createdAt = typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt) ? entry.createdAt : now
      const updatedAt = typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) ? entry.updatedAt : now
      return {
        id: entry.id,
        groupId,
        key,
        label: typeof entry.label === 'string' ? entry.label : key,
        entries: normalizeStringArray(entry.entries),
        draw_count: drawCount,
        sortOrder: typeof entry.sortOrder === 'number' && Number.isFinite(entry.sortOrder) ? entry.sortOrder : index,
        isPinned: entry.isPinned === true,
        isFavorite: entry.isFavorite === true,
        tags,
        deletedAt,
        createdAt,
        updatedAt,
        usageCount: typeof entry.usageCount === 'number' && Number.isFinite(entry.usageCount) ? entry.usageCount : 0,
        sourceSkillName: typeof entry.sourceSkillName === 'string' ? entry.sourceSkillName : undefined,
        generationBatchId: typeof entry.generationBatchId === 'string' ? entry.generationBatchId : undefined,
      }
    })
    .filter((entry): entry is WordLibraryEntry => entry != null)
}

export function getUniqueWordLibraryEntryKey(
  entries: Array<Pick<WordLibraryEntry, 'id' | 'key' | 'deletedAt'>>,
  requestedKey: string,
  excludeId?: string,
): string {
  const usedKeys = new Set(
    entries
      .filter((entry) => entry.deletedAt == null && entry.id !== excludeId)
      .map((entry) => entry.key),
  )
  if (!requestedKey || !usedKeys.has(requestedKey)) return requestedKey

  const suffixMatch = requestedKey.match(/^(.*?) \((\d+)\)$/)
  const baseKey = suffixMatch?.[1] || requestedKey
  let sequence = suffixMatch ? Number(suffixMatch[2]) + 1 : 2
  while (usedKeys.has(`${baseKey} (${sequence})`)) sequence += 1
  return `${baseKey} (${sequence})`
}

function mergeWordLibraryGroups(stored: WordLibraryGroup[], legacy: WordLibraryGroup[]): WordLibraryGroup[] {
  const merged = new Map<string, WordLibraryGroup>()
  for (const group of legacy) merged.set(group.id, group)
  for (const group of stored) merged.set(group.id, group)
  return [...merged.values()]
}

function mergeWordLibraryEntries(stored: WordLibraryEntry[], legacy: WordLibraryEntry[], groups: WordLibraryGroup[]): WordLibraryEntry[] {
  const normalizedLegacy = normalizeWordLibraryEntries(legacy, groups)
  const normalizedStored = normalizeWordLibraryEntries(stored, groups)
  const merged = new Map<string, WordLibraryEntry>()
  for (const entry of normalizedLegacy) merged.set(entry.id, entry)
  for (const entry of normalizedStored) merged.set(entry.id, entry)
  return [...merged.values()]
}

async function replaceStoredWordLibrary(groups: WordLibraryGroup[], entries: WordLibraryEntry[], batches: WordGenerationBatch[] = []) {
  await putWordLibraryState({ groups, entries, batches })
}

function normalizeInputImages(value: unknown): InputImage[] {
  if (!Array.isArray(value)) return []
  return value
    .map((img): InputImage | null => {
      if (!isRecord(img) || typeof img.id !== 'string') return null
      return { id: img.id, dataUrl: typeof img.dataUrl === 'string' ? img.dataUrl : '' }
    })
    .filter((img): img is InputImage => img != null)
}

function normalizeMaskDraft(value: unknown): MaskDraft | null {
  if (!isRecord(value)) return null
  if (typeof value.targetImageId !== 'string' || typeof value.maskDataUrl !== 'string') return null
  return {
    targetImageId: value.targetImageId,
    maskDataUrl: value.maskDataUrl,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  }
}

function createDefaultWorkspaceTab(options: {
  prompt?: unknown
  inputImages?: unknown
  inputImageFolder?: InputImageFolder | null
  params?: unknown
  maskDraft?: unknown
  maskEditorImageId?: unknown
  tasks?: TaskRecord[]
  now?: number
} = {}): WorkspaceTab {
  const now = options.now ?? Date.now()
  return {
    id: Math.random().toString(36).slice(2, 9),
    name: '默认',
    groupId: null,
    prompt: typeof options.prompt === 'string' ? options.prompt : '',
    inputImages: normalizeInputImages(options.inputImages),
    inputImageFolder: options.inputImageFolder ?? null,
    params: { ...DEFAULT_PARAMS, ...(isRecord(options.params) ? options.params : {}) },
    maskDraft: normalizeMaskDraft(options.maskDraft),
    maskEditorImageId: typeof options.maskEditorImageId === 'string' ? options.maskEditorImageId : null,
    customOutputPath: typeof (options as any).customOutputPath === 'string' ? (options as any).customOutputPath : '',
    tasks: options.tasks ?? [],
    createdAt: now,
    updatedAt: now,
    order: 0,
  }
}

function normalizeAgentInputDraft(value: unknown, fallbackUpdatedAt = Date.now()): AgentInputDraft {
  const draft = isRecord(value) ? value : {}
  const updatedAt = typeof draft.updatedAt === 'number' && Number.isFinite(draft.updatedAt) ? draft.updatedAt : fallbackUpdatedAt
  const folder = isRecord(draft.inputImageFolder) ? draft.inputImageFolder : null
  return {
    prompt: typeof draft.prompt === 'string' ? draft.prompt : '',
    inputImages: normalizeInputImages(draft.inputImages),
    inputImageFolder: folder && typeof folder.path === 'string' && Array.isArray(folder.imageIds)
      ? { path: folder.path, imageIds: folder.imageIds.filter((id: unknown): id is string => typeof id === 'string') }
      : null,
    maskDraft: normalizeMaskDraft(draft.maskDraft),
    maskEditorImageId: typeof draft.maskEditorImageId === 'string' ? draft.maskEditorImageId : null,
    updatedAt,
  }
}

function normalizeAgentInputDrafts(value: unknown, conversations: AgentConversation[]): Record<string, AgentInputDraft> {
  if (!isRecord(value)) return {}
  const conversationIds = new Set(conversations.map((conversation) => conversation.id))
  const drafts: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(value)) {
    if (!conversationIds.has(conversationId)) continue
    const normalized = normalizeAgentInputDraft(draft)
    if (!isEmptyAgentInputDraft(normalized)) drafts[conversationId] = normalized
  }
  return drafts
}

function normalizeAgentInputDraftsByKey(value: unknown): Record<string, AgentInputDraft> {
  if (!isRecord(value)) return {}
  const drafts: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(value)) {
    const normalized = normalizeAgentInputDraft(draft)
    if (!isEmptyAgentInputDraft(normalized)) drafts[conversationId] = normalized
  }
  return drafts
}

export function cleanStaleAgentInputDrafts(drafts: Record<string, AgentInputDraft>, activeConversationId: string | null, now = Date.now()) {
  const cutoff = now - AGENT_INPUT_DRAFT_RETENTION_MS
  const next: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(drafts)) {
    if (conversationId === activeConversationId || (draft.updatedAt ?? now) >= cutoff) {
      next[conversationId] = draft
    }
  }
  return next
}

function clearInputDraftState(): Pick<AgentInputDraft, 'prompt' | 'inputImages' | 'inputImageFolder' | 'maskDraft' | 'maskEditorImageId'> {
  return {
    prompt: '',
    inputImages: [],
    inputImageFolder: null,
    maskDraft: null,
    maskEditorImageId: null,
  }
}

function copyAgentInputDraft(draft: AgentInputDraft): AgentInputDraft {
  return {
    prompt: draft.prompt,
    inputImages: draft.inputImages.map((img) => ({ ...img })),
    inputImageFolder: draft.inputImageFolder,
    maskDraft: draft.maskDraft ? { ...draft.maskDraft } : null,
    maskEditorImageId: draft.maskEditorImageId,
    updatedAt: draft.updatedAt ?? Date.now(),
  }
}

function getCurrentAgentInputDraft(state: Pick<AppState, 'prompt' | 'inputImages' | 'inputImageFolder' | 'maskDraft' | 'maskEditorImageId'>): AgentInputDraft {
  return {
    prompt: state.prompt,
    inputImages: state.inputImages,
    inputImageFolder: state.inputImageFolder,
    maskDraft: state.maskDraft,
    maskEditorImageId: state.maskEditorImageId,
    updatedAt: Date.now(),
  }
}

function isEmptyAgentInputDraft(draft: AgentInputDraft) {
  return draft.prompt.length === 0 && draft.inputImages.length === 0 && !draft.inputImageFolder && !draft.maskDraft && !draft.maskEditorImageId
}

function setAgentInputDraft(drafts: Record<string, AgentInputDraft>, conversationId: string, draft: AgentInputDraft) {
  const next = { ...drafts }
  if (isEmptyAgentInputDraft(draft)) {
    delete next[conversationId]
  } else {
    next[conversationId] = copyAgentInputDraft(draft)
  }
  return next
}

function saveActiveAgentInputDrafts(state: Pick<AppState, 'appMode' | 'activeAgentConversationId' | 'agentInputDrafts' | 'prompt' | 'inputImages' | 'inputImageFolder' | 'maskDraft' | 'maskEditorImageId'>) {
  if (state.appMode !== 'agent' || !state.activeAgentConversationId) return state.agentInputDrafts
  
  const existingDraft = state.agentInputDrafts[state.activeAgentConversationId]
  if (existingDraft) {
    const hasChanges = 
      state.prompt !== existingDraft.prompt ||
      state.inputImages.length !== existingDraft.inputImages.length ||
      state.inputImages.some((img, idx) => img.id !== existingDraft.inputImages[idx]?.id) ||
      state.inputImageFolder?.path !== existingDraft.inputImageFolder?.path ||
      JSON.stringify(state.maskDraft) !== JSON.stringify(existingDraft.maskDraft) ||
      state.maskEditorImageId !== existingDraft.maskEditorImageId
    
    if (!hasChanges) {
      return state.agentInputDrafts
    }
  }
  
  return setAgentInputDraft(state.agentInputDrafts, state.activeAgentConversationId, getCurrentAgentInputDraft(state))
}

function saveGalleryInputDraft(state: Pick<AppState, 'appMode' | 'galleryInputDraft' | 'prompt' | 'inputImages' | 'inputImageFolder' | 'maskDraft' | 'maskEditorImageId'>) {
  if (state.appMode !== 'gallery') return state.galleryInputDraft
  const hasChanges = 
    state.prompt !== state.galleryInputDraft?.prompt ||
    state.inputImages.length !== state.galleryInputDraft?.inputImages.length ||
    state.inputImages.some((img, idx) => img.id !== state.galleryInputDraft?.inputImages[idx]?.id) ||
    state.inputImageFolder?.path !== state.galleryInputDraft?.inputImageFolder?.path ||
    JSON.stringify(state.maskDraft) !== JSON.stringify(state.galleryInputDraft?.maskDraft) ||
    state.maskEditorImageId !== state.galleryInputDraft?.maskEditorImageId

  if (!hasChanges && state.galleryInputDraft) {
    return state.galleryInputDraft
  }

  const draft = getCurrentAgentInputDraft(state)
  return isEmptyAgentInputDraft(draft) ? null : copyAgentInputDraft(draft)
}

function getPersistableGalleryInputDraft(state: AppState) {
  return saveGalleryInputDraft(state)
}

function restoreGalleryInputDraftState(draft: AgentInputDraft | null): Pick<AgentInputDraft, 'prompt' | 'inputImages' | 'inputImageFolder' | 'maskDraft' | 'maskEditorImageId'> {
  if (!draft) return clearInputDraftState()
  return {
    prompt: draft.prompt,
    inputImages: draft.inputImages.map((img) => ({ ...img })),
    inputImageFolder: draft.inputImageFolder ?? null,
    maskDraft: draft.maskDraft ? { ...draft.maskDraft } : null,
    maskEditorImageId: draft.maskEditorImageId,
  }
}

function restoreAgentInputDraftState(drafts: Record<string, AgentInputDraft>, conversationId: string | null): Pick<AgentInputDraft, 'prompt' | 'inputImages' | 'inputImageFolder' | 'maskDraft' | 'maskEditorImageId'> {
  const draft = conversationId ? drafts[conversationId] : null
  return restoreGalleryInputDraftState(draft ?? null)
}

function syncActiveInputDraft<T extends Partial<AgentInputDraft> & { inputImageFolder?: import('./types').InputImageFolder | null; params?: Partial<TaskParams>; customOutputPath?: string }>(
  state: AppState,
  patch: T,
): T & { agentInputDrafts?: Record<string, AgentInputDraft>; galleryInputDraft?: AgentInputDraft | null; workspaceTabs?: WorkspaceTab[] } {
  const draft: AgentInputDraft = {
    prompt: patch.prompt ?? state.prompt,
    inputImages: patch.inputImages ?? state.inputImages,
    inputImageFolder: patch.inputImageFolder !== undefined ? patch.inputImageFolder : state.inputImageFolder,
    maskDraft: patch.maskDraft !== undefined ? patch.maskDraft : state.maskDraft,
    maskEditorImageId: patch.maskEditorImageId !== undefined ? patch.maskEditorImageId : state.maskEditorImageId,
    customOutputPath: patch.customOutputPath !== undefined ? patch.customOutputPath : state.customOutputPath,
  }
  if (state.appMode === 'gallery') {
    const activeTabId = state.activeWorkspaceTabId
    if (activeTabId) {
      const activeTab = state.workspaceTabs.find((t) => t.id === activeTabId)
      if (activeTab) {
        const tabHasChanges =
          activeTab.prompt !== draft.prompt ||
          activeTab.inputImages.length !== draft.inputImages.length ||
          activeTab.inputImages.some((img, idx) => img.id !== draft.inputImages[idx]?.id) ||
          (patch.inputImageFolder !== undefined && activeTab.inputImageFolder?.path !== patch.inputImageFolder?.path) ||
          (patch.params !== undefined && JSON.stringify(activeTab.params) !== JSON.stringify({ ...state.params, ...patch.params })) ||
          JSON.stringify(activeTab.maskDraft) !== JSON.stringify(draft.maskDraft) ||
          activeTab.maskEditorImageId !== draft.maskEditorImageId ||
          (patch.customOutputPath !== undefined && activeTab.customOutputPath !== patch.customOutputPath)

        if (!tabHasChanges) {
          const existingDraft = state.galleryInputDraft
          const draftHasChanges =
            !existingDraft ||
            existingDraft.prompt !== draft.prompt ||
            existingDraft.inputImages.length !== draft.inputImages.length ||
            existingDraft.inputImages.some((img, idx) => img.id !== draft.inputImages[idx]?.id) ||
            existingDraft.inputImageFolder?.path !== draft.inputImageFolder?.path ||
            JSON.stringify(existingDraft.maskDraft) !== JSON.stringify(draft.maskDraft) ||
            existingDraft.maskEditorImageId !== draft.maskEditorImageId ||
            existingDraft.customOutputPath !== draft.customOutputPath

          if (!draftHasChanges) {
            return patch
          }
        }
      }
    }

    const updatedTabs = activeTabId
      ? state.workspaceTabs.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                prompt: draft.prompt,
                inputImages: draft.inputImages.map((img) => ({ ...img })),
                inputImageFolder: patch.inputImageFolder !== undefined ? patch.inputImageFolder : state.inputImageFolder,
                params: patch.params !== undefined ? { ...state.params, ...patch.params } : t.params,
                maskDraft: draft.maskDraft,
                maskEditorImageId: draft.maskEditorImageId,
                customOutputPath: patch.customOutputPath !== undefined ? patch.customOutputPath : t.customOutputPath,
                updatedAt: Date.now(),
              }
            : t,
        )
      : state.workspaceTabs
    return {
      ...patch,
      galleryInputDraft: isEmptyAgentInputDraft(draft) ? null : copyAgentInputDraft(draft),
      workspaceTabs: updatedTabs,
    }
  }
  if (!state.activeAgentConversationId) return patch
  
  const existingDraft = state.agentInputDrafts[state.activeAgentConversationId]
  if (existingDraft) {
    const draftHasChanges =
      existingDraft.prompt !== draft.prompt ||
      existingDraft.inputImages.length !== draft.inputImages.length ||
      existingDraft.inputImages.some((img, idx) => img.id !== draft.inputImages[idx]?.id) ||
      existingDraft.inputImageFolder?.path !== draft.inputImageFolder?.path ||
      JSON.stringify(existingDraft.maskDraft) !== JSON.stringify(draft.maskDraft) ||
      existingDraft.maskEditorImageId !== draft.maskEditorImageId
    
    if (!draftHasChanges) {
      return patch
    }
  }
  
  return {
    ...patch,
    agentInputDrafts: setAgentInputDraft(state.agentInputDrafts, state.activeAgentConversationId, draft),
  }
}

function getPersistableAgentInputDrafts(state: AppState) {
  const drafts = saveActiveAgentInputDrafts(state)
  const conversationIds = new Set(state.agentConversations.map((conversation) => conversation.id))
  const persistable: Record<string, AgentInputDraft> = {}
  for (const [conversationId, draft] of Object.entries(drafts)) {
    if (!conversationIds.has(conversationId) || isEmptyAgentInputDraft(draft)) continue
    persistable[conversationId] = {
      ...copyAgentInputDraft(draft),
      inputImages: draft.inputImages.map((img) => ({ id: img.id, dataUrl: '' })),
    }
  }
  return persistable
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Mode
      appMode: 'gallery',
      setAppMode: (appMode) => {
        if (appMode === 'gallery') {
          const state = get()
          const agentInputDrafts = saveActiveAgentInputDrafts(state)
          const galleryInputDraft = saveGalleryInputDraft(state)
          const restored = restoreGalleryInputDraftState(galleryInputDraft)
          set((state) => ({
            appMode,
            agentInputDrafts,
            galleryInputDraft,
            agentMobileHeaderVisible: true,
            selectedTaskIds: [],
            selectedFavoriteCollectionIds: [],
            agentEditingRoundId: null,
            ...restored,
          }))
          return
        }

        if (appMode === 'postprocess' || appMode === 'strategy' || appMode === 'ordering') {
          const state = get()
          const agentInputDrafts = saveActiveAgentInputDrafts(state)
          const galleryInputDraft = saveGalleryInputDraft(state)
          set({
            appMode,
            agentInputDrafts,
            galleryInputDraft,
            agentMobileHeaderVisible: true,
            selectedTaskIds: [],
            selectedFavoriteCollectionIds: [],
            agentEditingRoundId: null,
          })
          return
        }

        const state = get()
        const settings = normalizeSettings(state.settings)
        const agentProfile = getAgentTextApiProfile(settings)
        const agentValidationError = getAgentProfileValidationError(settings)

        if (!agentValidationError) {
          const galleryInputDraft = saveGalleryInputDraft(state)
          set((state) => ({
            appMode: 'agent',
            galleryInputDraft,
            agentMobileHeaderVisible: false,
            agentSidebarCollapsed: true,
            agentAssetPanelCollapsed: true,
            selectedTaskIds: [],
            selectedFavoriteCollectionIds: [],
            ...restoreAgentInputDraftState(state.agentInputDrafts, state.activeAgentConversationId),
          }))
          return
        }

        if (agentProfile.provider === 'openai' && agentProfile.apiMode !== 'responses') {
          state.setConfirmDialog({
            title: '需要 Responses API 配置',
            message: `Agent 配置「${agentProfile.name}」使用的是 Images API，仅支持生成图片，无 Agent 模式需要的对话能力。\n\n请前往 API 配置页，将 Agent 配置调整为 Responses API，或切换/新建一个支持 Responses API 的配置。`,
            confirmText: '去设置',
            cancelText: '取消',
            action: () => {
              useStore.getState().setShowSettings(true, 'agent')
            },
          })
          return
        }

        state.setConfirmDialog({
          title: 'Agent API 配置不完整',
          message: `${agentValidationError?.message ?? `Agent 配置「${agentProfile.name}」不支持 Responses API`}\n\n请前往 Agent 配置页完善配置。`,
          confirmText: '去设置',
          cancelText: '取消',
          action: () => {
            useStore.getState().setShowSettings(true, 'agent')
          },
        })
      },

      // Settings
      settings: { ...DEFAULT_SETTINGS },
      setSettings: (s) => set((st) => {
        const previous = normalizeSettings(st.settings)
        const incoming = s as Partial<AppSettings>
        const hasLegacyOverrides =
          incoming.baseUrl !== undefined ||
          incoming.apiKey !== undefined ||
          incoming.model !== undefined ||
          incoming.timeout !== undefined ||
          incoming.apiMode !== undefined ||
          incoming.codexCli !== undefined ||
          incoming.apiProxy !== undefined ||
          incoming.streamImages !== undefined ||
          incoming.streamPartialImages !== undefined
        const merged = normalizeSettings({ ...previous, ...incoming })
        if (hasLegacyOverrides && incoming.profiles === undefined) {
          merged.profiles = merged.profiles.map((profile) =>
            profile.id === merged.activeProfileId
              ? {
                  ...profile,
                  baseUrl: incoming.baseUrl ?? profile.baseUrl,
                  apiKey: incoming.apiKey ?? profile.apiKey,
                  model: incoming.model ?? profile.model,
                  timeout: incoming.timeout ?? profile.timeout,
                  apiMode: incoming.apiMode === 'images' || incoming.apiMode === 'responses' ? incoming.apiMode : profile.apiMode,
                  codexCli: incoming.codexCli ?? profile.codexCli,
                  apiProxy: incoming.apiProxy ?? profile.apiProxy,
                  streamImages: incoming.streamImages ?? profile.streamImages,
                  streamPartialImages: incoming.streamPartialImages ?? profile.streamPartialImages,
                }
              : profile,
          )
        }
        const settings = normalizeSettings(merged)
        setApiTransportMode(settings.apiTransportMode)
        const shouldClearReusedProfile = st.reusedTaskApiProfileId && settings.activeProfileId === st.reusedTaskApiProfileId
        return {
          settings,
          ...(shouldClearReusedProfile
            ? { reusedTaskApiProfileId: null, reusedTaskApiProfileName: null, reusedTaskApiProfileMissing: false }
            : {}),
        }
      }),
      dismissedCodexCliPrompts: [],
      dismissCodexCliPrompt: (key) => set((st) => ({
        dismissedCodexCliPrompts: st.dismissedCodexCliPrompts.includes(key)
          ? st.dismissedCodexCliPrompts
          : [...st.dismissedCodexCliPrompts, key],
      })),

      // Input
      prompt: '',
      setPrompt: (prompt) => set((s) => syncActiveInputDraft(s, { prompt })),
      inputImages: [],
      addInputImage: (img) =>
        set((s) => {
          if (s.inputImages.find((i) => i.id === img.id)) return s
          if (s.inputImages.length >= MAX_DIRECT_INPUT_IMAGES) return s
          return syncActiveInputDraft(s, { inputImages: [...s.inputImages, img] })
        }),
      replaceInputImage: (idx, img) => {
        let removedImageId: string | null = null
        set((s) => {
          if (idx < 0 || idx >= s.inputImages.length) return s
          const previous = s.inputImages[idx]
          if (!previous || previous.id === img.id) return s
          if (s.inputImages.some((item, itemIdx) => itemIdx !== idx && item.id === img.id)) return s
          removedImageId = previous.id
          const inputImages = s.inputImages.map((item, itemIdx) => itemIdx === idx ? img : item)
          const shouldClearMask = previous.id === s.maskDraft?.targetImageId
          return syncActiveInputDraft(s, {
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages, { [previous.id]: img.id }),
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          })
        })
        if (removedImageId) void deleteImageIfUnreferenced(removedImageId)
      },
      removeInputImage: (idx) =>
        set((s) => {
          const removed = s.inputImages[idx]
          const inputImages = s.inputImages.filter((_, i) => i !== idx)
          const shouldClearMask = removed?.id === s.maskDraft?.targetImageId
          return syncActiveInputDraft(s, {
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages),
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          })
        }),
      clearInputImages: () =>
        set((s) => {
          for (const img of s.inputImages) imageCache.delete(img.id)
          return syncActiveInputDraft(s, {
            inputImages: [],
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, []),
            maskDraft: null,
            maskEditorImageId: null,
          })
        }),
      setInputImages: (imgs, options) =>
        set((s) => {
          const inputImages = orderImagesWithMaskFirst(imgs.slice(0, MAX_DIRECT_INPUT_IMAGES), s.maskDraft?.targetImageId)
          const shouldClearMask =
            Boolean(s.maskDraft) && !inputImages.some((img) => img.id === s.maskDraft?.targetImageId)
          return syncActiveInputDraft(s, {
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages, options?.equivalentImageIds),
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          })
        }),
      moveInputImage: (fromIdx, toIdx) =>
        set((s) => {
          const images = [...s.inputImages]
          if (fromIdx < 0 || fromIdx >= images.length) return s
          const maskTargetImageId = s.maskDraft?.targetImageId
          if (maskTargetImageId && images[fromIdx]?.id === maskTargetImageId) return s
          const minTargetIdx = maskTargetImageId && images.some((img) => img.id === maskTargetImageId) ? 1 : 0
          const targetIdx = Math.max(minTargetIdx, Math.min(images.length, toIdx))
          const insertIdx = fromIdx < targetIdx ? targetIdx - 1 : targetIdx
          if (insertIdx === fromIdx) return s
          const [moved] = images.splice(fromIdx, 1)
          images.splice(insertIdx, 0, moved)
          return syncActiveInputDraft(s, {
            inputImages: images,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, images),
          })
        }),
      inputImageFolder: null,
      setInputImageFolder: (folder) =>
        set((s) => {
          if (folder) {
            for (const img of s.inputImages) imageCache.delete(img.id)
            return syncActiveInputDraft(s, {
              inputImageFolder: folder,
              inputImages: [],
              prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, []),
              maskDraft: null,
              maskEditorImageId: null,
            })
          }
          return syncActiveInputDraft(s, { inputImageFolder: null })
        }),
      maskDraft: null,
      setMaskDraft: (maskDraft) =>
        set((s) => {
          const inputImages = orderImagesWithMaskFirst(s.inputImages, maskDraft?.targetImageId)
          return syncActiveInputDraft(s, {
            maskDraft,
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages),
          })
        }),
      clearMaskDraft: () => set((s) => syncActiveInputDraft(s, { maskDraft: null })),
      maskEditorImageId: null,
      setMaskEditorImageId: (maskEditorImageId) => {
        if (maskEditorImageId) dismissAllTooltips()
        set((s) => syncActiveInputDraft(s, { maskEditorImageId }))
      },
      galleryInputDraft: null,

      customOutputPath: '',
      setCustomOutputPath: (path) => set((s) => syncActiveInputDraft(s, { customOutputPath: path })),
      
      // Params
      params: { ...DEFAULT_PARAMS },
      setParams: (p) => set((s) => syncActiveInputDraft(s, { params: { ...s.params, ...p } })),
      reusedTaskApiProfileId: null,
      reusedTaskApiProfileName: null,
      reusedTaskApiProfileMissing: false,
      setReusedTaskApiProfile: (profileId, missing = false, profileName = null) => set({
        reusedTaskApiProfileId: profileId,
        reusedTaskApiProfileName: profileName,
        reusedTaskApiProfileMissing: missing,
      }),

      // Agent
      agentConversations: [],
      agentConversationsLoaded: false,
      activeAgentConversationId: null,
      agentInputDrafts: {},
      agentSidebarCollapsed: true,
      agentDesktopSidebarCollapsed: false,
      agentAssetTab: 'outputs',
      agentAssetPanelCollapsed: false,
      agentMobileHeaderVisible: false,
      agentEditingRoundId: null,
      agentEditingConversationId: null,
      agentGeneratingTitleIds: {},
      createAgentConversation: () => {
        const now = Date.now()
        const latestConversation = getLatestAgentConversation(get().agentConversations)
        if (latestConversation && isEmptyAgentConversation(latestConversation)) {
          set((state) => {
            const agentInputDrafts = saveActiveAgentInputDrafts(state)
            return {
              agentConversations: state.agentConversations.map((conversation) =>
                conversation.id === latestConversation.id
                  ? { ...conversation, order: 0, createdAt: now, updatedAt: now }
                  : { ...conversation, order: conversation.order + 1 }
              ),
              activeAgentConversationId: latestConversation.id,
              agentInputDrafts,
              agentSidebarCollapsed: true,
              agentEditingRoundId: null,
              ...restoreAgentInputDraftState(agentInputDrafts, latestConversation.id),
            }
          })
          return latestConversation.id
        }

        const conversation = createAgentConversation(now)
        set((state) => {
          const agentInputDrafts = saveActiveAgentInputDrafts(state)
          return {
            agentConversations: [
              conversation,
              ...state.agentConversations.map((item) => ({ ...item, order: item.order + 1 })),
            ],
            activeAgentConversationId: conversation.id,
            agentInputDrafts,
            agentSidebarCollapsed: true,
            agentEditingRoundId: null,
            ...restoreAgentInputDraftState(agentInputDrafts, conversation.id),
          }
        })
        return conversation.id
      },
      setActiveAgentConversationId: (id) => set((state) => {
        if (state.activeAgentConversationId === id) {
          return state
        }
        const agentInputDrafts = saveActiveAgentInputDrafts(state)
        return {
          activeAgentConversationId: id,
          agentInputDrafts,
          agentSidebarCollapsed: true,
          agentAssetPanelCollapsed: true,
          agentEditingRoundId: null,
          ...restoreAgentInputDraftState(agentInputDrafts, id),
        }
      }),
      setActiveAgentRoundId: (conversationId, roundId) => set((state) => ({
        agentConversations: state.agentConversations.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, activeRoundId: roundId, updatedAt: Date.now() } : conversation,
        ),
      })),
      renameAgentConversation: (id, title) => set((state) => ({ agentConversations: state.agentConversations.map((c) => (c.id === id ? { ...c, title, updatedAt: Date.now() } : c)) })),
      deleteAgentConversation: (id) => set((state) => {
        const agentInputDrafts = { ...state.agentInputDrafts }
        delete agentInputDrafts[id]
        const activeDeleted = state.activeAgentConversationId === id
        const remainingConversations = state.agentConversations
          .filter((conversation) => conversation.id !== id)
          .map((conversation, index) => ({ ...conversation, order: index }))
        const nextActiveConversationId = activeDeleted
          ? remainingConversations.find((conversation) => conversation.order >= (state.agentConversations.find((conversation) => conversation.id === id)?.order ?? 0))?.id
            ?? remainingConversations.at(-1)?.id
            ?? null
          : state.activeAgentConversationId
        return {
          agentConversations: remainingConversations,
          activeAgentConversationId: nextActiveConversationId,
          agentInputDrafts,
          ...(activeDeleted ? restoreAgentInputDraftState(agentInputDrafts, nextActiveConversationId) : {}),
        }
      }),
      reorderAgentConversations: (sourceId, targetId, position = 'before') => set((state) => {
        if (sourceId === targetId) return state
        const conversations = [...state.agentConversations].sort((a, b) => a.order - b.order)
        const sourceIndex = conversations.findIndex((conversation) => conversation.id === sourceId)
        const targetIndex = conversations.findIndex((conversation) => conversation.id === targetId)
        if (sourceIndex < 0 || targetIndex < 0) return state
        const [source] = conversations.splice(sourceIndex, 1)
        const adjustedTargetIndex = conversations.findIndex((conversation) => conversation.id === targetId)
        conversations.splice(position === 'after' ? adjustedTargetIndex + 1 : adjustedTargetIndex, 0, source)
        return { agentConversations: conversations.map((conversation, index) => ({ ...conversation, order: index })) }
      }),
      setAgentSidebarCollapsed: (agentSidebarCollapsed) => set({ agentSidebarCollapsed }),
      setAgentDesktopSidebarCollapsed: (agentDesktopSidebarCollapsed) => set({ agentDesktopSidebarCollapsed }),
      setAgentAssetTab: (agentAssetTab) => set({ agentAssetTab }),
      setAgentAssetPanelCollapsed: (agentAssetPanelCollapsed) => set({ agentAssetPanelCollapsed }),
      setAgentMobileHeaderVisible: (agentMobileHeaderVisible) => set({ agentMobileHeaderVisible }),
      setAgentEditingRoundId: (agentEditingRoundId) => set({ agentEditingRoundId }),
      setAgentEditingConversationId: (agentEditingConversationId) => set({ agentEditingConversationId }),

      // Tasks
      tasks: [],
      setTasks: (tasks) => set(() => ({
        tasks,
        ...(countSuccessfulOutputImages(tasks) <= SUPPORT_PROMPT_IMAGE_THRESHOLD
          ? { supportPromptSkippedForImportedData: false }
          : {}),
      })),
      favoriteCollections: [createDefaultFavoriteCollection()],
      setFavoriteCollections: (favoriteCollections) => set((state) => {
        const nextCollections = ensureDefaultFavoriteCollection(normalizeFavoriteCollections(favoriteCollections))
        return {
          favoriteCollections: nextCollections,
          defaultFavoriteCollectionId: resolveDefaultFavoriteCollectionId(nextCollections, state.defaultFavoriteCollectionId),
        }
      }),
      defaultFavoriteCollectionId: DEFAULT_FAVORITE_COLLECTION_ID,
      setDefaultFavoriteCollectionId: (defaultFavoriteCollectionId) => set((state) => (
        defaultFavoriteCollectionId === null || state.favoriteCollections.some((collection) => collection.id === defaultFavoriteCollectionId)
          ? { defaultFavoriteCollectionId }
          : state
      )),
      activeFavoriteCollectionId: null,
      isManageCollectionsModalOpen: false,
      setActiveFavoriteCollectionId: (activeFavoriteCollectionId) => set({ activeFavoriteCollectionId, selectedTaskIds: [], selectedFavoriteCollectionIds: [] }),
      openManageCollectionsModal: () => set({ isManageCollectionsModalOpen: true }),
      closeManageCollectionsModal: () => set({ isManageCollectionsModalOpen: false }),
      favoritePickerTaskIds: null,
      openFavoritePicker: (taskIds) => {
        if (!taskIds.length) return
        dismissAllTooltips()
        set({ favoritePickerTaskIds: Array.from(new Set(taskIds)).filter(Boolean) })
      },
      closeFavoritePicker: () => set({ favoritePickerTaskIds: null }),
      schedule: createDefaultScheduleState(),
      setScheduleModalOpen: (modalOpen) => set((state) => ({
        schedule: { ...state.schedule, modalOpen },
      })),
      setScheduleWeekStart: (activeWeekStart) => set((state) => ({
        schedule: { ...state.schedule, activeWeekStart },
      })),
      startScheduleWeek: (weekStart) => set((state) => ({
        schedule: {
          ...state.schedule,
          runningWeekStarts: Array.from(new Set([...state.schedule.runningWeekStarts, weekStart])).sort(),
        },
      })),
      stopScheduleWeek: (weekStart) => set((state) => ({
        schedule: {
          ...state.schedule,
          runningWeekStarts: state.schedule.runningWeekStarts.filter((item) => item !== weekStart),
        },
      })),
      copyPreviousWeekSchedule: () => {
        const copiedIds: string[] = []
        set((state) => {
          const activeWeekStart = state.schedule.activeWeekStart
          const previousWeekStart = addScheduleDays(activeWeekStart, -7)
          const activeWeekEnd = addScheduleDays(activeWeekStart, 6)
          const previousWeekEnd = addScheduleDays(previousWeekStart, 6)
          const activeItems = state.schedule.items.filter((item) => item.date >= activeWeekStart && item.date <= activeWeekEnd)
          const previousItems = state.schedule.items
            .filter((item) => item.date >= previousWeekStart && item.date <= previousWeekEnd)
            .slice()
            .sort((a, b) => a.date.localeCompare(b.date) || a.rowId.localeCompare(b.rowId) || a.order - b.order)
          const orderByCell = new Map<string, number>()
          for (const item of activeItems) {
            const key = `${item.date}:${item.rowId}`
            orderByCell.set(key, Math.max(orderByCell.get(key) ?? -1, item.order))
          }
          const copiedItems = previousItems.map((item) => {
            const nextDate = addScheduleDays(item.date, 7)
            const cellKey = `${nextDate}:${item.rowId}`
            const order = (orderByCell.get(cellKey) ?? -1) + 1
            orderByCell.set(cellKey, order)
            const id = genId()
            copiedIds.push(id)
            return {
              id,
              taskId: item.taskId,
              collectionId: item.collectionId,
              date: nextDate,
              rowId: item.rowId,
              order,
              count: item.count,
              time: item.time,
              status: 'idle' as const,
            }
          })
          if (copiedItems.length === 0) return state
          return {
            schedule: {
              ...state.schedule,
              items: [...state.schedule.items, ...copiedItems],
            },
          }
        })
        return copiedIds
      },
      addScheduleRow: () => {
        const id = genId()
        set((state) => ({
          schedule: {
            ...state.schedule,
            rows: [
              ...state.schedule.rows,
              {
                id,
                name: `任务 ${state.schedule.rows.length + 1}`,
                order: state.schedule.rows.length,
              },
            ],
          },
        }))
        return id
      },
      updateScheduleRow: (id, name) => set((state) => {
        const normalizedName = name.trim()
        if (!normalizedName) return state
        return {
          schedule: {
            ...state.schedule,
            rows: state.schedule.rows.map((row) => row.id === id ? { ...row, name: normalizedName } : row),
          },
        }
      }),
      removeScheduleRow: (id) => set((state) => {
        if (state.schedule.rows.length <= 1) return state
        const rows = state.schedule.rows.filter((row) => row.id !== id)
        if (rows.length === state.schedule.rows.length) return state
        return {
          schedule: {
            ...state.schedule,
            rows: rows.map((row, index) => ({ ...row, order: index })),
            items: state.schedule.items.filter((item) => item.rowId !== id),
          },
        }
      }),
      addScheduleItem: (item) => {
        const id = genId()
        set((state) => {
          const sameCellItems = state.schedule.items.filter((existing) => existing.date === item.date && existing.rowId === item.rowId)
          const order = item.order ?? sameCellItems.reduce((max, existing) => Math.max(max, existing.order), -1) + 1
          const nextItem: ScheduleItem = {
            id,
            taskId: item.taskId,
            collectionId: item.collectionId,
            date: item.date,
            rowId: item.rowId,
            order,
            count: Math.max(1, Math.floor(item.count || 1)),
            time: item.time || null,
            status: 'idle',
          }
          return {
            schedule: {
              ...state.schedule,
              items: [...state.schedule.items, nextItem],
            },
          }
        })
        return id
      },
      updateScheduleItem: (id, patch) => set((state) => ({
        schedule: {
          ...state.schedule,
          items: state.schedule.items.map((item) => item.id === id
            ? {
                ...item,
                ...patch,
                count: patch.count === undefined ? item.count : Math.max(1, Math.floor(patch.count || 1)),
                time: patch.time === undefined ? item.time : (patch.time || null),
              }
            : item,
          ),
        },
      })),
      removeScheduleItem: (id) => set((state) => ({
        schedule: {
          ...state.schedule,
          items: state.schedule.items.filter((item) => item.id !== id),
        },
      })),
      updateTaskFavoriteOutputPath: (taskId, outputPath) => set((state) => {
        const patchTask = (task: TaskRecord) => task.id === taskId
          ? {
              ...task,
              favoriteOutputPath: task.favoriteOutputUseDateVariable
                ? applyFavoriteOutputDateVariable(outputPath, true)
                : outputPath,
            }
          : task
        return {
          tasks: state.tasks.map(patchTask),
          workspaceTabs: state.workspaceTabs.map((tab) => ({
            ...tab,
            tasks: tab.tasks.map(patchTask),
          })),
        }
      }),
      updateTaskFavoriteOutputDateVariable: (taskId, enabled) => set((state) => {
        const patchTask = (task: TaskRecord) => task.id === taskId
          ? {
              ...task,
              favoriteOutputPath: applyFavoriteOutputDateVariable(task.favoriteOutputPath, enabled),
              favoriteOutputUseDateVariable: enabled,
            }
          : task
        return {
          tasks: state.tasks.map(patchTask),
          workspaceTabs: state.workspaceTabs.map((tab) => ({
            ...tab,
            tasks: tab.tasks.map(patchTask),
          })),
        }
      }),
      runScheduleItem: async (id, now = new Date(), countOverride, appendToLastTaskIds = false) => {
        const state = useStore.getState()
        const item = state.schedule.items.find((scheduleItem) => scheduleItem.id === id)
        if (!item) return null
        const sourceTask = state.tasks.find((task) => task.id === item.taskId)
        if (!sourceTask || !sourceTask.isFavorite) {
          const message = '日程任务引用的收藏任务不存在'
          useStore.getState().updateScheduleItem(id, {
            status: 'error',
            lastError: message,
          })
          state.showToast(message, 'error')
          return null
        }

        useStore.getState().updateScheduleItem(id, {
          status: 'queued',
          lastError: undefined,
        })

        const inputImages = sourceTask.inputImageFolderPath
          ? []
          : (await Promise.all(sourceTask.inputImageIds.map(async (imageId) => {
              const dataUrl = getCachedImage(imageId) || (await getImage(imageId))?.dataUrl
              return dataUrl ? { id: imageId, dataUrl } : null
            }))).filter((image): image is InputImage => Boolean(image))
        const inputImageFolder = sourceTask.inputImageFolderPath
          ? { path: sourceTask.inputImageFolderPath, imageIds: sourceTask.inputImageIds }
          : null
        const maskDataUrl = sourceTask.maskImageId ? (getCachedImage(sourceTask.maskImageId) || (await getImage(sourceTask.maskImageId))?.dataUrl) : null
        const maskDraft = sourceTask.maskTargetImageId && maskDataUrl
          ? { targetImageId: sourceTask.maskTargetImageId, maskDataUrl, updatedAt: now.getTime() }
          : null
        const outputTarget = resolveScheduleOutputTarget({
          favoriteOutputPath: sourceTask.favoriteOutputPath,
          collectionId: item.collectionId,
          taskCollectionIds: sourceTask.favoriteCollectionIds,
          collections: state.favoriteCollections,
          defaultCollectionId: state.defaultFavoriteCollectionId,
        })

        try {
          const runCount = Math.max(1, Math.floor((countOverride ?? item.count) || 1))
          const taskId = await submitTaskWithData({
            prompt: sourceTask.prompt,
            inputImages,
            inputImageFolder,
            params: { ...sourceTask.params, n: runCount },
            maskDraft,
            scheduledOutputPath: 'path' in outputTarget ? outputTarget.path : undefined,
            scheduledOutputSubFolder: 'subFolder' in outputTarget ? outputTarget.subFolder : undefined,
          }, { useCurrentApiProfileWhenReusedMissing: true })
          if (!taskId) {
            useStore.getState().updateScheduleItem(id, { status: 'idle' })
            return null
          }
          const latestItem = useStore.getState().schedule.items.find((scheduleItem) => scheduleItem.id === id)
          useStore.getState().updateScheduleItem(id, {
            status: 'running',
            lastRunKey: getScheduleRunKey(item),
            lastTaskIds: appendToLastTaskIds ? [...(latestItem?.lastTaskIds ?? []), taskId] : [taskId],
            lastError: undefined,
          })
          return taskId
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          useStore.getState().updateScheduleItem(id, {
            status: 'error',
            lastRunKey: getScheduleRunKey(item),
            lastError: message,
          })
          state.showToast(message, 'error')
          return null
        }
      },
      streamPreviews: {},
      streamPreviewSlots: {},
      setTaskStreamPreview: (taskId, image, requestIndex = 0) => set((s) => {
        if (image) {
          const slotKey = String(requestIndex)
          const currentSlots = s.streamPreviewSlots[taskId] ?? {}
          if (s.streamPreviews[taskId] === image && currentSlots[slotKey] === image) return s
          return {
            streamPreviews: { ...s.streamPreviews, [taskId]: image },
            streamPreviewSlots: {
              ...s.streamPreviewSlots,
              [taskId]: { ...currentSlots, [slotKey]: image },
            },
          }
        }

        if (!(taskId in s.streamPreviews) && !(taskId in s.streamPreviewSlots)) return s
        const next = { ...s.streamPreviews }
        const nextSlots = { ...s.streamPreviewSlots }
        delete next[taskId]
        delete nextSlots[taskId]
        return { streamPreviews: next, streamPreviewSlots: nextSlots }
      }),

      // Search & Filter
      searchQuery: '',
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      filterStatus: 'all',
      setFilterStatus: (filterStatus) => set({ filterStatus }),
      filterFavorite: false,
      setFilterFavorite: (filterFavorite) => set(filterFavorite ? { filterFavorite, selectedTaskIds: [], selectedFavoriteCollectionIds: [] } : { filterFavorite, activeFavoriteCollectionId: null, selectedTaskIds: [], selectedFavoriteCollectionIds: [] }),

      // Selection
      selectedTaskIds: [],
      setSelectedTaskIds: (updater) => set((s) => ({
        selectedTaskIds: typeof updater === 'function' ? updater(s.selectedTaskIds) : updater
      })),
      toggleTaskSelection: (id, force) => set((s) => {
        const isSelected = s.selectedTaskIds.includes(id)
        const shouldSelect = force !== undefined ? force : !isSelected
        if (shouldSelect === isSelected) return s
        return {
          selectedTaskIds: shouldSelect
            ? [...s.selectedTaskIds, id]
            : s.selectedTaskIds.filter((x) => x !== id)
        }
      }),
      clearSelection: () => set({ selectedTaskIds: [] }),
      selectedFavoriteCollectionIds: [],
      setSelectedFavoriteCollectionIds: (updater) => set((s) => ({
        selectedFavoriteCollectionIds: typeof updater === 'function' ? updater(s.selectedFavoriteCollectionIds) : updater
      })),
      toggleFavoriteCollectionSelection: (id, force) => set((s) => {
        const isSelected = s.selectedFavoriteCollectionIds.includes(id)
        const shouldSelect = force !== undefined ? force : !isSelected
        if (shouldSelect === isSelected) return s
        return {
          selectedFavoriteCollectionIds: shouldSelect
            ? [...s.selectedFavoriteCollectionIds, id]
            : s.selectedFavoriteCollectionIds.filter((x) => x !== id)
        }
      }),
      clearFavoriteCollectionSelection: () => set({ selectedFavoriteCollectionIds: [] }),

      // UI
      detailTaskId: null,
      detailReturnToSchedule: false,
      setDetailTaskId: (detailTaskId, options) => {
        if (detailTaskId) dismissAllTooltips()
        set((state) => {
          if (detailTaskId) {
            return {
              detailTaskId,
              detailReturnToSchedule: Boolean(options?.returnToSchedule),
            }
          }
          return {
            detailTaskId: null,
            detailReturnToSchedule: false,
            schedule: state.detailReturnToSchedule
              ? { ...state.schedule, modalOpen: true }
              : state.schedule,
          }
        })
      },
      lightboxImageId: null,
      lightboxImageList: [],
      setLightboxImageId: (lightboxImageId, list) => {
        if (lightboxImageId) dismissAllTooltips()
        set({ lightboxImageId, lightboxImageList: list ?? (lightboxImageId ? [lightboxImageId] : []) })
      },
      showSettings: false,
      settingsTabRequest: null,
      setShowSettings: (showSettings, settingsTabRequest) => {
        if (showSettings) dismissAllTooltips()
        set({
          showSettings,
          ...(settingsTabRequest ? { settingsTabRequest } : {}),
          ...(!showSettings ? { settingsTabRequest: null } : {}),
        })
      },
      supportPromptOpen: false,
      supportPromptDismissed: false,
      supportPromptSkippedForImportedData: false,
      setSupportPromptOpen: (supportPromptOpen) => set({ supportPromptOpen }),
      dismissSupportPrompt: () => set({ supportPromptOpen: false, supportPromptDismissed: true }),

      // Toast
      toast: null,
      showToast: (message, type = 'info') => {
        const toastMessage = getToastMessage(message, type)
        const toast = { message: toastMessage, type }
        set({ toast })
        setTimeout(() => {
          set((s) => (s.toast === toast ? { toast: null } : s))
        }, 3000)
      },

      // Confirm
      confirmDialog: null,
      setConfirmDialog: (confirmDialog) => {
        if (confirmDialog) dismissAllTooltips()
        set({ confirmDialog })
      },

      // Prompt input
      promptInputDialog: null,
      setPromptInputDialog: (config) => {
        if (config) dismissAllTooltips()
        set({ promptInputDialog: config })
      },

      // Random prompt generator
      randomPromptModalOpen: false,
      setRandomPromptModalOpen: (open) => set({ randomPromptModalOpen: open }), 

      // Word library sidebar
      wordLibrarySidebarOpen: false,
      setWordLibrarySidebarOpen: (open) => set({ wordLibrarySidebarOpen: open }),
      wordLibraryManagerOpen: false,
      setWordLibraryManagerOpen: (open) => set({ wordLibraryManagerOpen: open }),

      // Word library
      wordLibraryGroups: [{ id: 'default', name: '默认分组', sortOrder: 0 }],
      wordLibraryEntries: [],
      wordGenerationBatches: [],
      wordLibraryEditEntryId: null,
      setWordLibraryEditEntryId: (id) => set({ wordLibraryEditEntryId: id }),
      varEntryEditor: null,
      setVarEntryEditor: (config) => set({ varEntryEditor: config }),
      wordLibraryPromptSelectedVarName: null,
      setWordLibraryPromptSelectedVarName: (varName) => set({ wordLibraryPromptSelectedVarName: varName }),
      createWordLibraryGroup: (name, parentId = null) => {
        const group = { id: Math.random().toString(36).slice(2, 9), name, sortOrder: Date.now(), parentId, description: '', color: '', archivedAt: null }
        set((s) => ({ wordLibraryGroups: [...s.wordLibraryGroups, group] }))
        return group
      },
      renameWordLibraryGroup: (id, name) =>
        set((s) => ({ wordLibraryGroups: s.wordLibraryGroups.map((g) => (g.id === id ? { ...g, name } : g)) })),
      updateWordLibraryGroup: (id, patch) =>
        set((s) => ({ wordLibraryGroups: s.wordLibraryGroups.map((g) => (g.id === id ? { ...g, ...patch } : g)) })),
      mergeWordLibraryGroups: (sourceId, targetId) => set((s) => ({
        wordLibraryGroups: s.wordLibraryGroups.filter((g) => g.id !== sourceId).map((g) => g.parentId === sourceId ? { ...g, parentId: null } : g),
        wordLibraryEntries: s.wordLibraryEntries.map((entry) => entry.groupId === sourceId ? { ...entry, groupId: targetId, updatedAt: Date.now() } : entry),
      })),
      archiveWordLibraryGroup: (id, archived = true) => set((s) => ({
        wordLibraryGroups: s.wordLibraryGroups.map((group) => group.id === id ? { ...group, archivedAt: archived ? Date.now() : null } : group),
      })),
      deleteWordLibraryGroup: (id) =>
        set((s) => {
          if (s.wordLibraryGroups.length <= 1) return s
          const targetGroup = s.wordLibraryGroups.find((group) => group.id !== id && group.name === '默认分组')
            ?? s.wordLibraryGroups.find((group) => group.id !== id)
          if (!targetGroup) return s
          return {
            wordLibraryGroups: s.wordLibraryGroups
              .filter((group) => group.id !== id)
              .map((group) => group.parentId === id ? { ...group, parentId: null } : group),
            wordLibraryEntries: s.wordLibraryEntries.map((entry) =>
              entry.groupId === id ? { ...entry, groupId: targetGroup.id, updatedAt: Date.now() } : entry
            ),
          }
        }),
      createWordLibraryEntry: (groupId, key) => {
        const id = Math.random().toString(36).slice(2, 9)
        const now = Date.now()
        const uniqueKey = getUniqueWordLibraryEntryKey(get().wordLibraryEntries, key ?? '')
        const entry: WordLibraryEntry = {
          id,
          groupId,
          key: uniqueKey,
          label: '',
          entries: [],
          draw_count: 1,
          sortOrder: now,
          isPinned: false,
          isFavorite: false,
          tags: [],
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
          usageCount: 0,
        }
        set((s) => ({ wordLibraryEntries: [...s.wordLibraryEntries, entry] }))
        return entry
      },
      updateWordLibraryEntry: (id, patch) =>
        set((s) => {
          const uniqueKey = typeof patch.key === 'string'
            ? getUniqueWordLibraryEntryKey(s.wordLibraryEntries, patch.key, id)
            : undefined
          const normalizedPatch = uniqueKey === undefined
            ? patch
            : { ...patch, key: uniqueKey, ...(patch.label === patch.key ? { label: uniqueKey } : {}) }
          return { wordLibraryEntries: s.wordLibraryEntries.map((e) => (e.id === id ? { ...e, ...normalizedPatch, updatedAt: Date.now() } : e)) }
        }),
      deleteWordLibraryEntry: (id) =>
        set((s) => ({ wordLibraryEntries: s.wordLibraryEntries.map((e) => (e.id === id ? { ...e, deletedAt: Date.now() } : e)) })),
      moveWordLibraryEntry: (entryId, targetGroupId) =>
        set((s) => ({ wordLibraryEntries: s.wordLibraryEntries.map((e) => (e.id === entryId ? { ...e, groupId: targetGroupId } : e)) })),
      batchDeleteWordLibraryEntries: (ids) => {
        const idSet = new Set(ids)
        const now = Date.now()
        set((s) => ({
          wordLibraryEntries: s.wordLibraryEntries.map((e) => (idSet.has(e.id) ? { ...e, deletedAt: now } : e)),
        }))
      },
      batchMoveWordLibraryEntries: (ids, targetGroupId) => {
        const idSet = new Set(ids)
        set((s) => ({
          wordLibraryEntries: s.wordLibraryEntries.map((e) =>
            idSet.has(e.id) ? { ...e, groupId: targetGroupId, updatedAt: Date.now() } : e
          ),
        }))
      },
      reorderWordLibraryEntries: (orderedIds) => {
        const orderMap = new Map<string, number>()
        orderedIds.forEach((id, index) => orderMap.set(id, index))
        set((s) => ({
          wordLibraryEntries: s.wordLibraryEntries.map((e) =>
            orderMap.has(e.id) ? { ...e, sortOrder: orderMap.get(e.id)! } : e
          ),
        }))
      },
      toggleWordLibraryEntryPinned: (id) =>
        set((s) => ({
          wordLibraryEntries: s.wordLibraryEntries.map((e) =>
            e.id === id
              ? { ...e, isPinned: !e.isPinned, sortOrder: e.isPinned ? e.sortOrder : -1e9 + s.wordLibraryEntries.length, updatedAt: Date.now() }
              : e
          ),
        })),
      toggleWordLibraryEntryFavorite: (id) =>
        set((s) => ({
          wordLibraryEntries: s.wordLibraryEntries.map((e) => (e.id === id ? { ...e, isFavorite: !e.isFavorite, updatedAt: Date.now() } : e)),
        })),
      batchAddTagsToWordLibraryEntries: (ids, tags) => {
        if (tags.length === 0) return
        const idSet = new Set(ids)
        const newTags = tags.map((t) => t.trim()).filter(Boolean)
        set((s) => ({
          wordLibraryEntries: s.wordLibraryEntries.map((e) => {
            if (!idSet.has(e.id)) return e
            const merged = [...e.tags]
            for (const t of newTags) if (!merged.includes(t)) merged.push(t)
            return { ...e, tags: merged, updatedAt: Date.now() }
          }),
        }))
      },
      restoreWordLibraryEntries: (ids) => {
        const idSet = new Set(ids)
        set((s) => ({
          wordLibraryEntries: s.wordLibraryEntries.map((e) => (idSet.has(e.id) ? { ...e, deletedAt: null, updatedAt: Date.now() } : e)),
        }))
      },
      destroyWordLibraryEntries: (ids) => {
        const idSet = new Set(ids)
        set((s) => ({ wordLibraryEntries: s.wordLibraryEntries.filter((e) => !idSet.has(e.id)) }))
      },
      emptyWordLibraryTrash: () =>
        set((s) => ({ wordLibraryEntries: s.wordLibraryEntries.filter((e) => e.deletedAt == null) })),
      touchWordLibraryEntryUsage: (id) =>
        set((s) => ({
          wordLibraryEntries: s.wordLibraryEntries.map((e) => (e.id === id ? { ...e, usageCount: e.usageCount + 1, updatedAt: Date.now() } : e)),
        })),
      createWordGenerationBatch: (input) => {
        const batch: WordGenerationBatch = { id: `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, createdAt: Date.now(), archivedAt: null, ...input }
        set((s) => ({ wordGenerationBatches: [batch, ...s.wordGenerationBatches] }))
        return batch
      },
      archiveWordGenerationBatch: (id, archived = true) => set((s) => ({
        wordGenerationBatches: s.wordGenerationBatches.map((batch) => batch.id === id ? { ...batch, archivedAt: archived ? Date.now() : null } : batch),
      })),
      exportWordLibrary: () => ({
        version: 1,
        exportedAt: Date.now(),
        groups: get().wordLibraryGroups,
        entries: get().wordLibraryEntries,
        batches: get().wordGenerationBatches,
      }),
      importWordLibrary: (data, strategy) => {
        if (!isRecord(data)) return { added: 0, updated: 0, groupsAdded: 0 }
        const incomingGroups = normalizeWordLibraryGroups(data.groups, [])
        const normalizedIncoming = normalizeWordLibraryEntries(data.entries, incomingGroups)
        if (strategy === 'replace') {
          set({ wordLibraryGroups: incomingGroups, wordLibraryEntries: normalizedIncoming })
          return { added: normalizedIncoming.length, updated: 0, groupsAdded: incomingGroups.length }
        }
        // merge：按 id 合并，导入数据覆盖同 id，新增 id 追加；既有未被导入覆盖的数据保留
        const groupMap = new Map(get().wordLibraryGroups.map((g) => [g.id, g]))
        let groupsAdded = 0
        for (const g of incomingGroups) {
          if (!groupMap.has(g.id)) groupsAdded++
          groupMap.set(g.id, g) // 分组名以导入为准
        }
        const entryMap = new Map(get().wordLibraryEntries.map((e) => [e.id, e]))
        let added = 0
        let updated = 0
        for (const e of normalizedIncoming) {
          if (entryMap.has(e.id)) updated++
          else added++
          entryMap.set(e.id, e)
        }
        set({
          wordLibraryGroups: [...groupMap.values()].sort((a, b) => a.sortOrder - b.sortOrder),
          wordLibraryEntries: [...entryMap.values()],
        })
        return { added, updated, groupsAdded }
      },
      duplicateWordLibraryEntries: (ids) => {
        const idSet = new Set(ids)
        const now = Date.now()
        const copies: WordLibraryEntry[] = []
        for (const e of get().wordLibraryEntries) {
          if (!idSet.has(e.id)) continue
          copies.push({
            ...e,
            id: Math.random().toString(36).slice(2, 9),
            key: `${e.key || '词条'} 副本`,
            isPinned: false,
            sortOrder: e.sortOrder + 0.5,
            deletedAt: null,
            createdAt: now,
            updatedAt: now,
            usageCount: 0,
          })
        }
        if (copies.length > 0) set((s) => ({ wordLibraryEntries: [...s.wordLibraryEntries, ...copies] }))
        return copies.length
      },
      batchPinWordLibraryEntries: (ids) => {
        const idSet = new Set(ids)
        const base = -1e9 + get().wordLibraryEntries.length
        let i = 0
        set((s) => ({
          wordLibraryEntries: s.wordLibraryEntries.map((e) =>
            idSet.has(e.id) ? { ...e, isPinned: true, sortOrder: base + i++, updatedAt: Date.now() } : e
          ),
        }))
      },
      reorderWordLibraryGroups: (orderedIds) => {
        const orderMap = new Map<string, number>()
        orderedIds.forEach((id, index) => orderMap.set(id, index))
        set((s) => ({
          wordLibraryGroups: s.wordLibraryGroups.map((g) =>
            orderMap.has(g.id) ? { ...g, sortOrder: orderMap.get(g.id)! } : g
          ),
        }))
      },
      cleanupExpiredWordLibraryTrash: () => {
        const cutoff = Date.now() - WORD_LIBRARY_TRASH_MAX_AGE_MS
        const before = get().wordLibraryEntries.length
        const remaining = get().wordLibraryEntries.filter((e) => e.deletedAt == null || e.deletedAt >= cutoff)
        if (remaining.length === before) return 0
        set({ wordLibraryEntries: remaining })
        return before - remaining.length
      },

      // Workspace tabs
      workspaceTabs: [],
      activeWorkspaceTabId: null,
      workspaceTabGroups: [],
      workspaceTabBarExpanded: true,
      selectedWorkspaceTabIds: [],
      workspaceTabManagerOpen: false,
      setActiveWorkspaceTabId: (id) => set((state) => {
        const currentTabId = state.activeWorkspaceTabId
        if (currentTabId === id) return state
        // Save current state to current tab
        const currentTab = currentTabId ? state.workspaceTabs.find((t) => t.id === currentTabId) : null
        const updatedTabs = currentTab
          ? state.workspaceTabs.map((t) =>
              t.id === currentTabId
                ? {
                    ...t,
                    prompt: state.prompt,
                    inputImages: state.inputImages.map((img) => ({ ...img })),
                    inputImageFolder: state.inputImageFolder,
                    params: { ...state.params },
                    maskDraft: state.maskDraft,
                  maskEditorImageId: state.maskEditorImageId,
                  customOutputPath: state.customOutputPath,
                  updatedAt: Date.now(),
                }
                : t,
            )
          : state.workspaceTabs
        // Restore state from target tab
        const targetTab = id ? updatedTabs.find((t) => t.id === id) : null
        if (targetTab) {
          return {
            activeWorkspaceTabId: id,
            workspaceTabs: updatedTabs,
            prompt: targetTab.prompt,
            inputImages: targetTab.inputImages.map((img) => ({ ...img })),
            inputImageFolder: targetTab.inputImageFolder,
            params: { ...targetTab.params },
            maskDraft: targetTab.maskDraft,
            maskEditorImageId: targetTab.maskEditorImageId,
            customOutputPath: targetTab.customOutputPath,
            galleryInputDraft: null,
          }
        }
        return { activeWorkspaceTabId: id, workspaceTabs: updatedTabs }
      }),
      setWorkspaceTabBarExpanded: (expanded) => set({ workspaceTabBarExpanded: expanded }),
      setSelectedWorkspaceTabIds: (updater) => set((s) => ({
        selectedWorkspaceTabIds: typeof updater === 'function' ? updater(s.selectedWorkspaceTabIds) : updater,
      })),
      toggleWorkspaceTabSelection: (id, force) => set((s) => {
        const isSelected = s.selectedWorkspaceTabIds.includes(id)
        const shouldSelect = force !== undefined ? force : !isSelected
        if (shouldSelect === isSelected) return s
        return {
          selectedWorkspaceTabIds: shouldSelect
            ? [...s.selectedWorkspaceTabIds, id]
            : s.selectedWorkspaceTabIds.filter((x) => x !== id),
        }
      }),
      clearWorkspaceTabSelection: () => set({ selectedWorkspaceTabIds: [] }),
      setWorkspaceTabManagerOpen: (open) => set({ workspaceTabManagerOpen: open }),
      createWorkspaceTab: () => {
        const state = get()
        const now = Date.now()
        const sourceTab = state.activeWorkspaceTabId
          ? state.workspaceTabs.find((t) => t.id === state.activeWorkspaceTabId)
          : null
        
        let newName = '默认'
        let counter = 1
        while (state.workspaceTabs.some((t) => t.name === newName)) {
          counter++
          newName = `默认 ${counter}`
        }

        const newTab: WorkspaceTab = {
          id: Math.random().toString(36).slice(2, 9),
          name: newName,
          groupId: null,
          prompt: sourceTab ? sourceTab.prompt : state.prompt,
          inputImages: sourceTab ? sourceTab.inputImages.map((img) => ({ ...img })) : state.inputImages.map((img) => ({ ...img })),
          inputImageFolder: sourceTab ? sourceTab.inputImageFolder : state.inputImageFolder,
          params: sourceTab ? { ...sourceTab.params } : { ...state.params },
          maskDraft: sourceTab ? sourceTab.maskDraft : state.maskDraft,
          maskEditorImageId: sourceTab ? sourceTab.maskEditorImageId : state.maskEditorImageId,
          customOutputPath: sourceTab ? sourceTab.customOutputPath : state.customOutputPath,
          tasks: [],
          createdAt: now,
          updatedAt: now,
          order: state.workspaceTabs.length,
        }
        set((s) => ({ workspaceTabs: [...s.workspaceTabs, newTab], activeWorkspaceTabId: newTab.id }))
        return newTab.id
      },
      closeWorkspaceTab: (id) => set((state) => {
        const tabs = state.workspaceTabs.filter((t) => t.id !== id)
        if (tabs.length === 0) {
          // Create a default tab if all closed
          const now = Date.now()
          const defaultTab: WorkspaceTab = {
            id: Math.random().toString(36).slice(2, 9),
            name: '默认',
            groupId: null,
            prompt: state.prompt,
            inputImages: state.inputImages.map((img) => ({ ...img })),
            inputImageFolder: state.inputImageFolder,
            params: { ...state.params },
            maskDraft: state.maskDraft,
            maskEditorImageId: state.maskEditorImageId,
            customOutputPath: state.customOutputPath,
            tasks: [],
            createdAt: now,
            updatedAt: now,
            order: 0,
          }
          return {
            workspaceTabs: [defaultTab],
            activeWorkspaceTabId: defaultTab.id,
            selectedWorkspaceTabIds: state.selectedWorkspaceTabIds.filter((x) => x !== id),
          }
        }
        let nextActiveId = state.activeWorkspaceTabId
        if (state.activeWorkspaceTabId === id) {
          const closedIndex = state.workspaceTabs.findIndex((t) => t.id === id)
          const nextIndex = closedIndex < tabs.length ? closedIndex : tabs.length - 1
          nextActiveId = tabs[nextIndex]?.id ?? tabs[0]?.id ?? null
        }
        return {
          workspaceTabs: tabs,
          activeWorkspaceTabId: nextActiveId,
          selectedWorkspaceTabIds: state.selectedWorkspaceTabIds.filter((x) => x !== id),
        }
      }),
      duplicateWorkspaceTab: (id) => {
        const state = get()
        const tab = state.workspaceTabs.find((t) => t.id === id)
        if (!tab) return ''
        const now = Date.now()
        const newTab: WorkspaceTab = {
          ...tab,
          id: Math.random().toString(36).slice(2, 9),
          name: `${tab.name} - 副本`,
          inputImages: tab.inputImages.map((img) => ({ ...img })),
          params: { ...tab.params },
          customOutputPath: tab.customOutputPath,
          tasks: tab.tasks.map((t) => ({ ...t })),
          createdAt: now,
          updatedAt: now,
          order: state.workspaceTabs.length,
        }
        set((s) => ({ workspaceTabs: [...s.workspaceTabs, newTab] }))
        return newTab.id
      },
      renameWorkspaceTab: (id, name) =>
        set((s) => ({
          workspaceTabs: s.workspaceTabs.map((t) => (t.id === id ? { ...t, name, updatedAt: Date.now() } : t)),
        })),
      reorderWorkspaceTabs: (tabs) => set({ workspaceTabs: tabs.map((t, i) => ({ ...t, order: i })) }),
      createWorkspaceTabGroup: (name) => {
        const id = Math.random().toString(36).slice(2, 9)
        const group: WorkspaceTabGroup = { id, name, order: 0, collapsed: false }
        set((s) => ({
          workspaceTabGroups: [...s.workspaceTabGroups, group].map((g, i) => ({ ...g, order: i })),
        }))
        return id
      },
      renameWorkspaceTabGroup: (id, name) =>
        set((s) => ({
          workspaceTabGroups: s.workspaceTabGroups.map((g) => (g.id === id ? { ...g, name } : g)),
        })),
      deleteWorkspaceTabGroup: (id) =>
        set((s) => ({
          workspaceTabGroups: s.workspaceTabGroups.filter((g) => g.id !== id),
          workspaceTabs: s.workspaceTabs.map((t) => (t.groupId === id ? { ...t, groupId: null } : t)),
        })),
      moveWorkspaceTabToGroup: (tabId, groupId) =>
        set((s) => ({
          workspaceTabs: s.workspaceTabs.map((t) => (t.id === tabId ? { ...t, groupId } : t)),
        })),
      updateWorkspaceTabState: (id, patch) =>
        set((s) => ({
          workspaceTabs: s.workspaceTabs.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)),
        })),
      saveCurrentStateToActiveTab: () => set((state) => {
        const currentTabId = state.activeWorkspaceTabId
        if (!currentTabId) return state
        const currentTab = state.workspaceTabs.find((t) => t.id === currentTabId)
        if (!currentTab) return state
        const hasChanges =
          currentTab.prompt !== state.prompt ||
          currentTab.inputImages.length !== state.inputImages.length ||
          currentTab.inputImages.some((img, idx) => img.id !== state.inputImages[idx]?.id) ||
          currentTab.inputImageFolder?.path !== state.inputImageFolder?.path ||
          JSON.stringify(currentTab.params) !== JSON.stringify(state.params) ||
          JSON.stringify(currentTab.maskDraft) !== JSON.stringify(state.maskDraft) ||
          currentTab.maskEditorImageId !== state.maskEditorImageId
        if (!hasChanges) return state
        return {
          workspaceTabs: state.workspaceTabs.map((t) =>
            t.id === currentTabId
              ? {
                  ...t,
                  prompt: state.prompt,
                  inputImages: state.inputImages.map((img) => ({ ...img })),
                  inputImageFolder: state.inputImageFolder,
                  params: { ...state.params },
                  maskDraft: state.maskDraft,
                  maskEditorImageId: state.maskEditorImageId,
                  customOutputPath: state.customOutputPath,
                  updatedAt: Date.now(),
                }
              : t,
          ),
      }
    }),

      // 自动备份
      lastAutoBackupAt: 0,
      setLastAutoBackupAt: (t) => set({ lastAutoBackupAt: t }),
      firstBackupReminderShown: false,
      setFirstBackupReminderShown: (v) => set({ firstBackupReminderShown: v }),
      backupReminderCount: 0,
      setBackupReminderCount: (v) => set({ backupReminderCount: v }),

      // Agent 流式文本缓冲（不参与持久化）
      agentStreamingTexts: {},
      setAgentStreamingText: (conversationId, messageId, text) => set((s) => ({
        agentStreamingTexts: {
          ...s.agentStreamingTexts,
          [`${conversationId}:${messageId}`]: text,
        },
      })),
      clearAgentStreamingText: (conversationId, messageId) => set((s) => {
        const keyPrefix = messageId ? `${conversationId}:${messageId}` : `${conversationId}:`
        const next = { ...s.agentStreamingTexts }
        if (messageId) {
          delete next[`${conversationId}:${messageId}`]
        } else {
          for (const key of Object.keys(next)) {
            if (key.startsWith(keyPrefix)) delete next[key]
          }
        }
        return { agentStreamingTexts: next }
      }),
    }),
    {
      name: 'gpt-image-playground',
      version: 4,
      migrate: (persistedState) => migratePersistedState(persistedState),
      partialize: getPersistedState,
      merge: mergePersistedState,
      storage: createJSONStorage(() => {
        const w = window as unknown as { electronAPI?: {
          getDefaultPath: () => Promise<string>
          readJsonText: (filePath: string) => Promise<string | null>
          writeJsonText: (filePath: string, content: string, backupIntervalOrSkip?: number | boolean) => Promise<boolean>
          isElectron: boolean
        } }
        const isElectronEnv = typeof w?.electronAPI !== 'undefined' && w.electronAPI?.isElectron === true
        if (!isElectronEnv) return localStorage
        const api = w.electronAPI!
        const fileName = 'gpt-image-playground.json'
        return {
          getItem: async (_name: string) => {
            const defaultPath = await api.getDefaultPath()
            const filePath = defaultPath.replace(/[\\/]local-saves$/, '') + '/' + fileName
            const result = await api.readJsonText(filePath)
            return result
          },
          setItem: async (_name: string, value: string) => {
            const defaultPath = await api.getDefaultPath()
            const filePath = defaultPath.replace(/[\\/]local-saves$/, '') + '/' + fileName
            const interval = useStore.getState().settings.backupInterval
            await api.writeJsonText(filePath, value, interval)
          },
          removeItem: async (_name: string) => {
            const defaultPath = await api.getDefaultPath()
            const filePath = defaultPath.replace(/[\\/]local-saves$/, '') + '/' + fileName
            try { await api.writeJsonText(filePath, '', true) } catch {}
          },
        }
      }),
    },
  ),
)

let lastStoredAgentConversations = useStore.getState().agentConversations
let agentConversationPersistRunning = false
let agentConversationPersistQueued = false
let agentConversationPersistDebounceTimer: ReturnType<typeof setTimeout> | null = null

async function flushAgentConversationsToIndexedDB() {
  if (agentConversationPersistRunning) {
    agentConversationPersistQueued = true
    return
  }

  agentConversationPersistRunning = true
  try {
    do {
      agentConversationPersistQueued = false
      const conversations = useStore.getState().agentConversations
      await replaceStoredAgentConversations(conversations)
      lastStoredAgentConversations = conversations
    } while (agentConversationPersistQueued || useStore.getState().agentConversations !== lastStoredAgentConversations)
  } finally {
    agentConversationPersistRunning = false
  }
}

useStore.subscribe((state) => {
  if (state.agentConversations === lastStoredAgentConversations) return
  if (!agentConversationPersistenceReady) {
    agentConversationPersistQueued = true
    return
  }
  // Debounce IndexedDB writes to avoid excessive serialization during streaming
  if (agentConversationPersistDebounceTimer) clearTimeout(agentConversationPersistDebounceTimer)
  agentConversationPersistDebounceTimer = setTimeout(() => {
    agentConversationPersistDebounceTimer = null
    void flushAgentConversationsToIndexedDB()
  }, 500)
})

let lastStoredWordLibraryGroups = useStore.getState().wordLibraryGroups
let lastStoredWordLibraryEntries = useStore.getState().wordLibraryEntries
let lastStoredWordGenerationBatches = useStore.getState().wordGenerationBatches
let wordLibraryPersistRunning = false
let wordLibraryPersistQueued = false
let wordLibraryPersistDebounceTimer: ReturnType<typeof setTimeout> | null = null

async function flushWordLibraryToIndexedDB() {
  if (wordLibraryPersistRunning) {
    wordLibraryPersistQueued = true
    return
  }

  wordLibraryPersistRunning = true
  try {
    do {
      wordLibraryPersistQueued = false
      const { wordLibraryGroups, wordLibraryEntries, wordGenerationBatches } = useStore.getState()
      await replaceStoredWordLibrary(wordLibraryGroups, wordLibraryEntries, wordGenerationBatches)
      lastStoredWordLibraryGroups = wordLibraryGroups
      lastStoredWordLibraryEntries = wordLibraryEntries
      lastStoredWordGenerationBatches = wordGenerationBatches
    } while (
      wordLibraryPersistQueued ||
      useStore.getState().wordLibraryGroups !== lastStoredWordLibraryGroups ||
      useStore.getState().wordLibraryEntries !== lastStoredWordLibraryEntries
      || useStore.getState().wordGenerationBatches !== lastStoredWordGenerationBatches
    )
  } finally {
    wordLibraryPersistRunning = false
  }
}

useStore.subscribe((state) => {
  if (state.wordLibraryGroups === lastStoredWordLibraryGroups && state.wordLibraryEntries === lastStoredWordLibraryEntries && state.wordGenerationBatches === lastStoredWordGenerationBatches) return
  if (!wordLibraryPersistenceReady) {
    wordLibraryPersistQueued = true
    return
  }
  if (wordLibraryPersistDebounceTimer) clearTimeout(wordLibraryPersistDebounceTimer)
  wordLibraryPersistDebounceTimer = setTimeout(() => {
    wordLibraryPersistDebounceTimer = null
    void flushWordLibraryToIndexedDB()
  }, 300)
})

// ===== Actions =====

let uid = 0
function genId(): string {
  return Date.now().toString(36) + (++uid).toString(36) + Math.random().toString(36).slice(2, 6)
}

function getPersistableRawResponsePayload(rawResponsePayload?: string) {
  if (!rawResponsePayload) return rawResponsePayload
  try {
    const payload = JSON.parse(rawResponsePayload) as { output?: unknown }
    if (!Array.isArray(payload.output)) return rawResponsePayload
    const output = payload.output.map((item) =>
      isRecord(item) ? getPersistableResponseOutputItem(item as ResponsesOutputItem) : item,
    )
    return JSON.stringify({ ...payload, output }, null, 2)
  } catch {
    return rawResponsePayload
  }
}

function getPersistableTask(task: TaskRecord): TaskRecord {
  const rawResponsePayload = getPersistableRawResponsePayload(task.rawResponsePayload)
  return rawResponsePayload === task.rawResponsePayload ? task : { ...task, rawResponsePayload }
}

export function putTask(task: TaskRecord): Promise<IDBValidKey> {
  return dbPutTask(getPersistableTask(task))
}

export function getCodexCliPromptKey(settings: AppSettings): string {
  const profile = getActiveApiProfile(settings)
  return `${profile.baseUrl}\n${profile.apiKey}`
}

function isOpenAITask(task: TaskRecord) {
  return (task.apiProvider ?? 'openai') !== 'fal'
}

function isRunningOpenAITask(task: TaskRecord) {
  return task.status === 'running' && isOpenAITask(task)
}

function isAsyncCustomProviderTask(settings: AppSettings, provider: string, hasInputImages: boolean) {
  const customProvider = getCustomProviderDefinition(settings, provider)
  if (!customProvider?.poll) return false
  const submitMapping = hasInputImages && customProvider.editSubmit ? customProvider.editSubmit : customProvider.submit
  return Boolean(submitMapping.taskIdPath)
}

export function markInterruptedOpenAIRunningTasks(tasks: TaskRecord[], now = Date.now()) {
  const interruptedTasks: TaskRecord[] = []
  const updatedTasks = tasks.map((task) => {
    const hasPersistedRemoteRequest = task.remoteGenerationRequests?.some((request) =>
      (request.provider === 'fal' || request.provider === 'custom') &&
      Boolean(request.remoteRequestId) &&
      (request.status === 'submitted' || request.status === 'running'),
    )
    if (!isRunningOpenAITask(task) || task.customTaskId || hasPersistedRemoteRequest) return task

    const updated: TaskRecord = {
      ...task,
      status: 'error',
      error: OPENAI_INTERRUPTED_ERROR,
      progressStage: 'stopped',
      progressUpdatedAt: now,
      falRecoverable: false,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    }
    interruptedTasks.push(updated)
    return updated
  })

  return { tasks: updatedTasks, interruptedTasks }
}

function clearOpenAIWatchdogTimer(taskId: string) {
  const timer = openAIWatchdogTimers.get(taskId)
  if (timer) clearTimeout(timer)
  openAIWatchdogTimers.delete(taskId)
}

function failOpenAITaskIfStillRunning(taskId: string, error: string, now = Date.now()) {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningOpenAITask(task)) return false

  const existingOutputImages = task.outputImages || []
  const hasSuccessfulImages = existingOutputImages.length > 0

  if (hasSuccessfulImages) {
    const totalRequested = task.params?.n ?? 1
    const successCount = existingOutputImages.length
    const failCount = Math.max(0, totalRequested - successCount)
    const batchItemStatuses: BatchItemStatus[] = Array.from({ length: totalRequested }, (_, i) =>
      i < successCount ? 'done' : 'error'
    )
    const batchItemErrors: BatchItemError[] = []
    for (let j = 0; j < failCount; j++) {
      batchItemErrors.push({ index: successCount + j, error })
    }

    updateTaskInStore(taskId, {
      status: 'done',
      error: undefined,
      batchItemStatuses,
      batchItemErrors: batchItemErrors.length > 0 ? batchItemErrors : undefined,
      falRecoverable: false,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    })
    const totalCount = batchItemStatuses.length
    useStore.getState().showToast(`生成超时，${successCount}/${totalCount} 张成功`, 'info')
  } else {
    updateTaskInStore(taskId, {
      status: 'error',
      error,
      falRecoverable: false,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    })
  }
  return true
}

function scheduleOpenAIWatchdog(taskId: string, timeoutSeconds: number, profile?: TimeoutStreamingHintProfile | null) {
  clearOpenAIWatchdogTimer(taskId)
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningOpenAITask(task)) return

  const timeoutMs = Math.max(0, timeoutSeconds * 1000)
  const timer = setTimeout(() => {
    openAIWatchdogTimers.delete(taskId)
    const failed = failOpenAITaskIfStillRunning(taskId, createOpenAITimeoutError(timeoutSeconds, profile))
    if (failed) useStore.getState().showToast('OpenAI 任务请求超时', 'error')
  }, timeoutMs)
  openAIWatchdogTimers.set(taskId, timer)
}

export function showCodexCliPrompt(force = false, reason = '接口返回的提示词已被改写') {
  const state = useStore.getState()
  const settings = state.settings
  const promptKey = getCodexCliPromptKey(settings)
  if (!force && (settings.codexCli || state.dismissedCodexCliPrompts.includes(promptKey))) return

  state.setConfirmDialog({
    title: '检测到 Codex CLI API',
    message: `${reason}，当前 API 来源很可能是 Codex CLI。\n\n是否开启 Codex CLI 兼容模式？开启后会禁用在此处无效的质量参数，并在 Images API 多图生成时使用并发请求，解决该 API 数量参数无效的问题。同时，提示词文本开头会加入简短的不改写要求，避免模型重写提示词，偏离原意。`,
    confirmText: '开启',
    action: () => {
      const state = useStore.getState()
      state.dismissCodexCliPrompt(promptKey)
      state.setSettings({ codexCli: true })
    },
    cancelAction: () => useStore.getState().dismissCodexCliPrompt(promptKey),
  })
}

function getFalRecoveryProfile(settings: AppSettings, task: TaskRecord) {
  const taskProfile = getTaskApiProfile(settings, task)
  if (taskProfile?.provider === 'fal') return taskProfile
  return null
}

function getCustomRecoveryProfile(settings: AppSettings, task: TaskRecord) {
  const provider = task.apiProvider
  if (!provider || provider === 'openai' || provider === 'fal') return null
  const taskProfile = getTaskApiProfile(settings, task)
  if (taskProfile?.provider === provider) return taskProfile
  return null
}

export function getTaskApiProfile(settings: AppSettings, task: TaskRecord): ApiProfile | null {
  const normalized = normalizeSettings(settings)
  const provider = task.apiProvider

  if (!task.apiProfileId) return null

  const byId = normalized.profiles.find((profile) => profile.id === task.apiProfileId)
  if (byId && (!provider || byId.provider === provider)) return byId
  return null
}

function createSettingsForApiProfile(settings: AppSettings, profile: ApiProfile): AppSettings {
  const normalized = normalizeSettings(settings)
  return normalizeSettings({
    ...normalized,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    timeout: profile.timeout,
    apiMode: profile.apiMode,
    codexCli: profile.codexCli,
    apiProxy: profile.apiProxy,
    profiles: normalized.profiles.map((item) => item.id === profile.id ? profile : item),
    activeProfileId: profile.id,
  })
}

function getReusedTaskApiProfile(settings: AppSettings, profileId: string | null): ApiProfile | null {
  if (!profileId) return null
  return normalizeSettings(settings).profiles.find((profile) => profile.id === profileId) ?? null
}

function getTaskApiProfileName(task: TaskRecord) {
  return task.apiProfileName || task.apiModel || '未知配置'
}

function isFalConnectionRecoverableError(err: unknown) {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') return true
  const message = err instanceof Error ? err.message : String(err)
  return /abort|network|failed to fetch|fetch failed|load failed|timeout|连接|断开|中断/i.test(message)
}

function isApiRequestNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) {
    const message = err.message.toLowerCase()
    return /failed to fetch|fetch failed|load failed|networkerror|network request failed/i.test(message)
  }
  return false
}

function isStreamingRelatedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /流式|stream/i.test(message)
}

function getStreamingErrorHint(err: unknown, profile?: Pick<ApiProfile, 'provider' | 'apiMode' | 'streamImages' | 'streamPartialImages'> | null): string {
  if (profile?.streamImages !== true) return ''
  if (!isStreamingRelatedError(err)) return ''
  return '\n提示：这可能是当前接口不支持流式传输导致的，可尝试关闭「流式传输」功能后重试。'
}

function getApiModeApiName(apiMode: ApiMode) {
  return apiMode === 'responses' ? 'Responses API' : 'Image API'
}

function getApiRequestNetworkErrorHint(
  err: unknown,
  createdAt: number,
  usesApiProxy: boolean,
  profile?: Pick<ApiProfile, 'provider' | 'apiMode' | 'streamImages' | 'streamPartialImages'> | null,
): string | null {
  if (!isApiRequestNetworkError(err)) return null

  const elapsedSeconds = Math.max(0, (Date.now() - createdAt) / 1000)

  if (elapsedSeconds <= 15) {
    if (usesApiProxy) {
      return '提示：请求立即失败，请检查 API 代理服务是否正常运行。'
    }
    const unsupportedApiHint = profile?.provider === 'openai'
      ? `\n· API 不支持 ${getApiModeApiName(profile.apiMode)}`
      : ''
    return `提示：请求立即失败，可能原因：\n· API 服务器不可达或地址有误，请检查 API URL 是否正确、服务是否正常运行${unsupportedApiHint}\n· 接口不支持浏览器跨域请求，可使用 Docker 部署版或本地运行版并配置 API 代理解决`
  }

  if (elapsedSeconds >= 55 && elapsedSeconds <= 75) {
    return `提示：请求等待约 60 秒后被断开，这通常是 Nginx 等反向代理的默认超时，而非接口本身报错。可调大代理的超时时间（如 proxy_read_timeout），或降低图片尺寸/质量后重试。${getTimeoutStreamingHint(profile)}`
  }

  if (elapsedSeconds >= 110 && elapsedSeconds <= 140) {
    return `提示：请求等待约 120 秒后被断开，这通常是 Cloudflare 等 CDN/网关的超时限制，而非接口本身报错。如果使用 Cloudflare，可考虑升级套餐或使用不经过 CDN 的直连地址。${getTimeoutStreamingHint(profile)}`
  }

  return `提示：请求等待较长时间后被断开，通常是反向代理或网关的超时限制，而非接口本身报错。可检查代理超时设置，或降低图片尺寸/质量后重试。${getTimeoutStreamingHint(profile)}`
}

function getRawErrorPayload(err: unknown): Pick<Partial<TaskRecord>, 'rawImageUrls' | 'rawResponsePayload'> {
  if (!(err instanceof Error)) return {}

  const rawImageUrls = 'rawImageUrls' in err ? (err as { rawImageUrls?: unknown }).rawImageUrls : undefined
  const rawResponsePayload = 'rawResponsePayload' in err ? (err as { rawResponsePayload?: unknown }).rawResponsePayload : undefined
  return {
    rawImageUrls: Array.isArray(rawImageUrls) && rawImageUrls.length ? rawImageUrls.filter((url): url is string => typeof url === 'string') : undefined,
    rawResponsePayload: typeof rawResponsePayload === 'string' ? rawResponsePayload : undefined,
  }
}

function clearFalRecoveryTimer(taskId: string) {
  const timer = falRecoveryTimers.get(taskId)
  if (timer) clearTimeout(timer)
  falRecoveryTimers.delete(taskId)
}

function scheduleFalRecovery(taskId: string, delayMs = FAL_RECOVERY_POLL_MS) {
  if (falRecoveryTimers.has(taskId)) return
  const timer = setTimeout(() => {
    falRecoveryTimers.delete(taskId)
    recoverFalTask(taskId)
  }, delayMs)
  falRecoveryTimers.set(taskId, timer)
}

function clearCustomRecoveryTimer(taskId: string) {
  const timer = customRecoveryTimers.get(taskId)
  if (timer) clearTimeout(timer)
  customRecoveryTimers.delete(taskId)
}

function scheduleCustomRecovery(taskId: string, delayMs = CUSTOM_RECOVERY_POLL_MS) {
  if (customRecoveryTimers.has(taskId)) return
  const timer = setTimeout(() => {
    customRecoveryTimers.delete(taskId)
    recoverCustomTask(taskId)
  }, delayMs)
  customRecoveryTimers.set(taskId, timer)
}

function hasActualParams(params: Partial<TaskParams> | undefined): params is Partial<TaskParams> {
  return Boolean(params && Object.keys(params).length > 0)
}

function firstActualParams(paramsList: Array<Partial<TaskParams> | undefined> | undefined): Partial<TaskParams> | undefined {
  return paramsList?.find(hasActualParams)
}

function mapActualParamsByImage(outputIds: string[], paramsList: Array<Partial<TaskParams> | undefined> | undefined) {
  const mapped = paramsList?.reduce<Record<string, Partial<TaskParams>>>((acc, params, index) => {
    const imgId = outputIds[index]
    if (imgId && hasActualParams(params)) acc[imgId] = params
    return acc
  }, {})
  return mapped && Object.keys(mapped).length > 0 ? mapped : undefined
}

export interface PreparedGeneratedImage {
  dataUrl: string
  actualParams?: Partial<TaskParams>
}

/**
 * 预处理（后处理）但不写入存储。
 * 拆分自 {@link processAndStoreGeneratedImage}，用于先校验 / 去重，再决定是否 commit。
 */
async function prepareGeneratedImage(
  dataUrl: string,
  params: TaskParams,
  originalActualParams?: Partial<TaskParams>,
): Promise<PreparedGeneratedImage> {
  const processed = await postprocessGeneratedImage(dataUrl, params)
  const actualParams = mergePostprocessedActualParams(originalActualParams, processed.actualParams)
  return { dataUrl: processed.dataUrl, actualParams }
}

/** 仅在校验通过（非重复）后调用：写入 IndexedDB（及内存缓存）。返回 imageId。 */
async function commitGeneratedImage(prepared: PreparedGeneratedImage): Promise<string> {
  const imgId = await storeImage(prepared.dataUrl, 'generated')
  cacheImage(imgId, prepared.dataUrl)
  return imgId
}

async function processAndStoreGeneratedImage(
  dataUrl: string,
  params: TaskParams,
  originalActualParams?: Partial<TaskParams>,
): Promise<{ id: string; dataUrl: string; actualParams?: Partial<TaskParams> }> {
  const prepared = await prepareGeneratedImage(dataUrl, params, originalActualParams)
  const id = await commitGeneratedImage(prepared)
  return { id, dataUrl: prepared.dataUrl, actualParams: prepared.actualParams }
}

async function readImageSizeParam(dataUrl: string): Promise<Partial<TaskParams> | undefined> {
  if (typeof Image === 'undefined') return undefined

  return new Promise((resolve) => {
    let settled = false
    const image = new Image()
    const finish = (params: Partial<TaskParams> | undefined) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(params)
    }
    const timer = setTimeout(() => finish(undefined), 2000)
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        finish({ size: `${image.naturalWidth}x${image.naturalHeight}` })
      } else {
        finish(undefined)
      }
    }
    image.onerror = () => finish(undefined)
    image.src = dataUrl
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      finish({ size: `${image.naturalWidth}x${image.naturalHeight}` })
    }
  })
}

async function readImageSizeParamsList(images: string[]): Promise<Array<Partial<TaskParams> | undefined>> {
  return Promise.all(images.map((image) => readImageSizeParam(image)))
}

async function resolveImageSizeParamsList(
  images: string[],
  preferred?: Array<Partial<TaskParams> | undefined>,
): Promise<Array<Partial<TaskParams> | undefined>> {
  if (preferred?.length === images.length && preferred.every(hasActualParams)) return preferred
  const fallback = await readImageSizeParamsList(images)
  return images.map((_, index) => hasActualParams(preferred?.[index]) ? preferred?.[index] : fallback[index])
}

async function completeRecoveredFalTask(task: TaskRecord, result: Awaited<ReturnType<typeof getFalQueuedImageResult>>) {
  const latest = useStore.getState().tasks.find((item) => item.id === task.id)
  if (!latest || latest.status === 'done') return

  const originalActualParamsList = await resolveImageSizeParamsList(result.images, result.actualParamsList)
  const outputIds: string[] = []
  const actualParamsList: Array<Partial<TaskParams> | undefined> = []
  for (let i = 0; i < result.images.length; i++) {
    const stored = await processAndStoreGeneratedImage(result.images[i], task.params, originalActualParamsList[i])
    outputIds.push(stored.id)
    actualParamsList.push(stored.actualParams)
  }

  updateTaskInStore(task.id, {
    outputImages: outputIds,
    actualParams: firstActualParams(actualParamsList),
    actualParamsByImage: mapActualParamsByImage(outputIds, actualParamsList),
    revisedPromptByImage: undefined,
    status: 'done',
    error: null,
    falRecoverable: false,
    finishedAt: Date.now(),
    elapsed: Date.now() - task.createdAt,
  })
  useStore.getState().showToast(`fal.ai 任务已恢复，共 ${outputIds.length} 张图片`, 'success')
  if (!isAgentTask(task)) showTaskCompletionNotification('图像生成完成', `fal.ai 任务已恢复，共 ${outputIds.length} 张图片。`)
  else void continueRecoveredAgentRound(task.id)
  void saveTaskToLocalFS(task.id)
}

async function recoverFalTask(taskId: string) {
  const { settings, tasks } = useStore.getState()
  const task = tasks.find((item) => item.id === taskId)
  if (!task || task.apiProvider !== 'fal' || !task.falRequestId || !task.falEndpoint || task.status === 'done') return

  const profile = getFalRecoveryProfile(settings, task)
  if (!profile) {
    scheduleFalRecovery(taskId)
    return
  }

  try {
    const result = await getFalQueuedImageResult(profile, task.falEndpoint, task.falRequestId, task.params)
    clearFalRecoveryTimer(taskId)
    await completeRecoveredFalTask(task, result)
    return
  } catch (err) {
    if (isFalConnectionRecoverableError(err)) {
      scheduleFalRecovery(taskId)
      return
    }

    clearFalRecoveryTimer(taskId)
    updateTaskInStore(taskId, {
      status: 'error',
      error: getFalErrorMessage(err) ?? (err instanceof Error ? err.message : String(err)),
      ...getRawErrorPayload(err),
      falRecoverable: false,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
    if (isAgentTask(task)) void continueRecoveredAgentRound(taskId)
  }
}

export function ensureImageStorageMigrated(): Promise<number> {
  if (!isElectronEnv()) return Promise.resolve(0)
  imageStorageMigrationPromise ??= (async () => {
    let migrated = 0
    await runMigration(
      'electron-image-files-v1',
      {
        get: getMigrationJournal,
        put: putMigrationJournal,
      },
      async ({ checkpoint }) => {
        migrated = await migrateLegacyImages({
          readBatch: getLegacyImageBatch,
          saveImage: (image) => image.dataUrl ? saveRawCacheImageToLocal(image.id, image.dataUrl) : Promise.resolve(null),
          replaceImage: putImage,
          onProgress: (count) => checkpoint(String(count)),
        })
      },
    )
    return migrated
  })().catch((error) => {
    imageStorageMigrationPromise = null
    throw error
  })
  return imageStorageMigrationPromise
}

/** 初始化：从 IndexedDB 加载任务，按需恢复输入图片，并清理孤立图片 */
export async function initStore(options: { safeMode?: boolean } = {}) {
  const legacyAgentConversations = normalizeAgentConversations(useStore.getState().agentConversations)
  const storedTasks = await loadTasksIncrementally((task) =>
    getPersistableTask(normalizeTaskRecordFields(task)))
  const storedAgentConversations = normalizeAgentConversations(await getAllAgentConversations())
  let loadedAgentConversations = mergeAgentConversationsForStorage(storedAgentConversations, legacyAgentConversations)
  const currentAgentConversations = normalizeAgentConversations(useStore.getState().agentConversations)
  loadedAgentConversations = mergeAgentConversationsForStorage(loadedAgentConversations, currentAgentConversations)
  const activeAgentConversationId = useStore.getState().activeAgentConversationId && loadedAgentConversations.some((conversation) => conversation.id === useStore.getState().activeAgentConversationId)
    ? useStore.getState().activeAgentConversationId
    : loadedAgentConversations[0]?.id ?? null
  if (loadedAgentConversations.length > 0 || legacyAgentConversations.length > 0) {
    useStore.setState((state) => {
      const agentInputDrafts = cleanStaleAgentInputDrafts(
        normalizeAgentInputDrafts(state.agentInputDrafts, loadedAgentConversations),
        activeAgentConversationId,
      )
      return {
        agentConversations: loadedAgentConversations,
        agentConversationsLoaded: true,
        activeAgentConversationId,
        agentInputDrafts,
        ...(state.appMode === 'agent' ? restoreAgentInputDraftState(agentInputDrafts, activeAgentConversationId) : {}),
      }
    })
    await replaceStoredAgentConversations(loadedAgentConversations)
  } else {
    useStore.setState({ agentConversationsLoaded: true })
  }
  const shouldRewritePersistedLocalState = agentConversationMigrationPending
  agentConversationPersistenceReady = true
  agentConversationMigrationPending = false
  if (agentConversationPersistQueued || useStore.getState().agentConversations !== lastStoredAgentConversations) {
    await flushAgentConversationsToIndexedDB()
  }
  if (shouldRewritePersistedLocalState) {
    // Force persist rewrite by touching a stable field without triggering reactive updates
    useStore.setState((state) => ({ agentConversationsLoaded: state.agentConversationsLoaded }))
  }
  const storedWordLibrary = await getWordLibraryState()
  const wordState = useStore.getState()
  const legacyWordGroups = normalizeWordLibraryGroups(wordState.wordLibraryGroups, wordState.wordLibraryGroups)
  const storedWordGroups = normalizeWordLibraryGroups(storedWordLibrary?.groups, legacyWordGroups)
  const mergedWordGroups = mergeWordLibraryGroups(storedWordGroups, legacyWordGroups)
  const mergedWordEntries = mergeWordLibraryEntries(storedWordLibrary?.entries ?? [], wordState.wordLibraryEntries, mergedWordGroups)
  useStore.setState({
    wordLibraryGroups: mergedWordGroups,
    wordLibraryEntries: mergedWordEntries,
  })
  const mergedWordBatches = storedWordLibrary?.batches ?? wordState.wordGenerationBatches
  useStore.setState({ wordGenerationBatches: mergedWordBatches })
  await replaceStoredWordLibrary(mergedWordGroups, mergedWordEntries, mergedWordBatches)
  const shouldRewriteWordLibraryLocalState = wordLibraryMigrationPending
  wordLibraryPersistenceReady = true
  wordLibraryMigrationPending = false
  lastStoredWordLibraryGroups = mergedWordGroups
  lastStoredWordLibraryEntries = mergedWordEntries
  lastStoredWordGenerationBatches = mergedWordBatches
  if (wordLibraryPersistQueued) {
    await flushWordLibraryToIndexedDB()
  }
  if (shouldRewriteWordLibraryLocalState) {
    useStore.setState((state) => ({ wordLibraryEditEntryId: state.wordLibraryEditEntryId }))
  }
  const { tasks: markedTasks, interruptedTasks } = markInterruptedOpenAIRunningTasks(storedTasks)
  const interruptedTaskIds = new Set(interruptedTasks.map((task) => task.id))
  const favoriteState = useStore.getState()
  const normalizedFavorites = normalizeLoadedFavoriteState(markedTasks.map(getPersistableTask), favoriteState.favoriteCollections, favoriteState.defaultFavoriteCollectionId)
  let tasks = normalizedFavorites.tasks
  if (normalizedFavorites.collections !== favoriteState.favoriteCollections) {
    favoriteState.setFavoriteCollections(normalizedFavorites.collections)
  }
  if (normalizedFavorites.defaultFavoriteCollectionId !== favoriteState.defaultFavoriteCollectionId) {
    useStore.getState().setDefaultFavoriteCollectionId(normalizedFavorites.defaultFavoriteCollectionId)
  }
  const tasksToWrite = tasks
    .filter((task, index) => normalizedFavorites.changed || interruptedTaskIds.has(task.id) || task.rawResponsePayload !== markedTasks[index]?.rawResponsePayload)
  if (tasksToWrite.length > 0) await batchPutTasks(tasksToWrite)
  for (const interruptedTask of interruptedTasks) {
    if (interruptedTask.outputImages?.length) {
      void saveTaskToLocalFS(interruptedTask.id)
      void saveTaskMetaToLocalFS(interruptedTask.id)
    }
  }
  useStore.getState().setTasks(tasks)
  // Assign gallery tasks to the default workspace tab on first load
  // and sync task state (e.g. running -> error) across all workspace tabs
  const galleryTasks = tasks.filter(isGalleryTask)
  let currentTabs = useStore.getState().workspaceTabs
  if (currentTabs.length === 0) {
    const state = useStore.getState()
    const defaultTab = createDefaultWorkspaceTab({
      prompt: state.prompt,
      inputImages: state.inputImages.map((img) => ({ ...img })),
      inputImageFolder: state.inputImageFolder,
      params: state.params,
      maskDraft: state.maskDraft,
      maskEditorImageId: state.maskEditorImageId,
      tasks: galleryTasks,
    })
    useStore.setState({
      workspaceTabs: [defaultTab],
      activeWorkspaceTabId: defaultTab.id,
      selectedWorkspaceTabIds: [],
    })
    currentTabs = [defaultTab]
  } else {
    // Sync task state changes (e.g. interrupted tasks) to existing tab tasks
    const taskMap = new Map(tasks.map((t) => [t.id, t]))
    const claimedTaskIds = new Set<string>()
    
    // 我们必须非常小心：
    // _taskIds 是持久化时保存的任务ID列表。
    // 但是，如果没有持久化 _taskIds（旧版本或者刚从 IndexedDB 恢复但还没触发持久化），
    // 那么 tab.tasks 里面可能包含了它应该有的任务。
    // 注意：Zustand Persist 会从 localStorage 读取 workspaceTabs，里面的 tab.tasks 可能是空数组（因为在 persist 阶段被置空了）
    // 所以，如果在 localStorage 里的 `_taskIds` 是一个空数组，这说明用户主动清空了该标签页的任务。
    
    // 首先恢复各个标签页的任务
    const updatedTabs = currentTabs.map((tab: any) => {
      let taskIds: string[] = []
      
      // 检查持久化状态中是否有 _taskIds
      if (Array.isArray(tab._taskIds)) {
        taskIds = tab._taskIds
      } else if (Array.isArray(tab.tasks)) {
        // 如果没有 _taskIds 但有 tasks，可能是旧数据或尚未初始化的状态
        taskIds = tab.tasks.map((t: any) => typeof t === 'string' ? t : (t?.id ?? ''))
      }
      
      // 尝试恢复任务：只有在 IndexedDB 中存在的任务才会被恢复
      const tabTasks = taskIds.map((id: string) => taskMap.get(id)).filter((t: any): t is TaskRecord => t !== undefined)
      
      // 记录已经被分配给某个标签页的任务 ID
      tabTasks.forEach((t: TaskRecord) => claimedTaskIds.add(t.id))

      return {
        ...tab,
        tasks: tabTasks,
        _taskIds: undefined, // 恢复完毕，清除中间字段
      }
    })
    
    // 找出所有画廊任务中没有被任何标签页认领的"孤儿任务"
    // 这些任务可能是因为版本升级、HMR 热更新导致 localStorage 保存失败、或者旧版本残留导致的
    const orphanTasks = galleryTasks.filter(t => !claimedTaskIds.has(t.id))
    
    if (orphanTasks.length > 0) {
      // 为了不打乱用户当前的标签页，我们把这些丢失的任务放进一个专门的"恢复的历史任务"标签页
      let recoveryTab = updatedTabs.find((t: any) => t.name === '恢复的历史任务')
      if (recoveryTab) {
        recoveryTab.tasks = [...orphanTasks, ...recoveryTab.tasks]
      } else {
        const newTab = createDefaultWorkspaceTab({
          prompt: '',
          inputImages: [],
          inputImageFolder: null,
          params: { ...DEFAULT_PARAMS },
          maskDraft: null,
          maskEditorImageId: null,
          tasks: orphanTasks,
        })
        newTab.name = '恢复的历史任务'
        updatedTabs.push(newTab)
      }
    }
    
    useStore.setState({ workspaceTabs: updatedTabs })
    currentTabs = updatedTabs
  }

  const batchBackfill = assignMissingGeneratedImageBatches(tasks, currentTabs)
  if (batchBackfill.changedTaskIds.length > 0) {
    const changedTaskIds = new Set(batchBackfill.changedTaskIds)
    await batchPutTasks(batchBackfill.tasks.filter((task) => changedTaskIds.has(task.id)))
  }
  tasks = batchBackfill.tasks
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  currentTabs = currentTabs.map((tab) => ({
    ...tab,
    tasks: tab.tasks.map((task) => taskById.get(task.id) ?? task),
  }))
  useStore.setState({ tasks, workspaceTabs: currentTabs })

  showSupportPromptForExistingLocalData(tasks)
  for (const task of tasks) {
    if (
      task.status === 'running' &&
      task.generationSlots?.length === Math.max(1, task.params.n || 1) &&
      Array.isArray(task.remoteGenerationRequests)
    ) {
      // New orchestrated batches restore every persisted request and slot through
      // executeTask. Do not also run the legacy single-request recovery below.
      void executeTask(task.id)
      continue
    }
    if (
      task.apiProvider === 'fal' &&
      task.falRequestId &&
      task.falEndpoint &&
      (task.status === 'running' || task.falRecoverable)
    ) {
      scheduleFalRecovery(task.id, 0)
    }
    if (
      task.customTaskId &&
      (task.status === 'running' || task.customRecoverable)
    ) {
      scheduleCustomRecovery(task.id, 0)
    }
  }

  // 收集所有任务引用的图片 id
  const referencedIds = new Set<string>()
  const state = useStore.getState()
  const persistedInputImages = state.inputImages
  const galleryInputDraft = state.galleryInputDraft
  const agentConversations = state.agentConversations
  const agentInputDrafts = state.agentInputDrafts
  for (const img of persistedInputImages) referencedIds.add(img.id)
  if (galleryInputDraft) {
    for (const img of galleryInputDraft.inputImages) referencedIds.add(img.id)
  }
  for (const draft of Object.values(agentInputDrafts)) {
    for (const img of draft.inputImages) referencedIds.add(img.id)
  }
  for (const conversation of agentConversations) {
    for (const round of conversation.rounds) {
      for (const id of round.inputImageIds) referencedIds.add(id)
    }
  }
  for (const t of tasks) {
    addTaskReferencedImageIds(referencedIds, t)
  }
  const sopRuns = await getAllSopBatchSnapshots()
  for (const run of sopRuns) {
    for (const imageId of run.referenceImageIds) referencedIds.add(imageId)
  }
  for (const tab of state.workspaceTabs) {
    for (const img of tab.inputImages) referencedIds.add(img.id)
    if (tab.inputImageFolder) {
      for (const id of tab.inputImageFolder.imageIds) referencedIds.add(id)
    }
  }

  // 只枚举 key 清理孤立图片，避免启动时把所有 4K 原图读进内存。
  const imageIds = await getAllImageIds()
  const orphanIds: string[] = []
  for (const imgId of imageIds) {
    if (!referencedIds.has(imgId)) {
      orphanIds.push(imgId)
    }
  }
  if (orphanIds.length > 0) {
    const orphanRecords = await batchGetImages(orphanIds)
    const expiredOrphanIds = orphanIds.filter((id) => {
      const image = orphanRecords.get(id)
      return image ? shouldDeleteOrphanImage(image, Date.now(), 7) : false
    })
    if (expiredOrphanIds.length > 0) await batchDeleteImages(expiredOrphanIds)
  }

  const idsToFetch = new Set<string>()
  for (const img of persistedInputImages) {
    if (!img.dataUrl) idsToFetch.add(img.id)
  }
  if (galleryInputDraft) {
    for (const img of galleryInputDraft.inputImages) {
      if (!img.dataUrl) idsToFetch.add(img.id)
    }
  }
  for (const [conversationId, draft] of Object.entries(agentInputDrafts)) {
    for (const img of draft.inputImages) {
      if (!img.dataUrl) idsToFetch.add(img.id)
    }
  }
  for (const round of agentConversations.flatMap(c => c.rounds)) {
    for (const id of round.inputImageIds) idsToFetch.add(id)
  }
  for (const tab of state.workspaceTabs) {
    for (const img of tab.inputImages) {
      if (!img.dataUrl) idsToFetch.add(img.id)
    }
  }
  const imageMap = idsToFetch.size > 0 ? await batchGetImages([...idsToFetch]) : new Map<string, StoredImage>()

  const restoredInputImages: InputImage[] = []
  for (const img of persistedInputImages) {
    if (img.dataUrl) {
      restoredInputImages.push(img)
      cacheImage(img.id, img.dataUrl)
      continue
    }
    const storedImage = imageMap.get(img.id)
    if (storedImage?.dataUrl) {
      restoredInputImages.push({ ...img, dataUrl: storedImage.dataUrl })
      cacheImage(img.id, storedImage.dataUrl)
    }
  }
  if (restoredInputImages.length !== persistedInputImages.length || restoredInputImages.some((img, index) => img.dataUrl !== persistedInputImages[index]?.dataUrl)) {
    useStore.getState().setInputImages(restoredInputImages)
  }

  if (galleryInputDraft) {
    const restoredGalleryImages: InputImage[] = []
    for (const img of galleryInputDraft.inputImages) {
      if (img.dataUrl) {
        restoredGalleryImages.push(img)
        cacheImage(img.id, img.dataUrl)
        continue
      }
      const storedImage = imageMap.get(img.id)
      if (storedImage?.dataUrl) {
        restoredGalleryImages.push({ ...img, dataUrl: storedImage.dataUrl })
        cacheImage(img.id, storedImage.dataUrl)
      }
    }
    const shouldClearMask = Boolean(galleryInputDraft.maskDraft) && !restoredGalleryImages.some((img) => img.id === galleryInputDraft.maskDraft?.targetImageId)
    const restoredGalleryDraft: AgentInputDraft = {
      ...galleryInputDraft,
      inputImages: restoredGalleryImages,
      prompt: remapImageMentionsForOrder(galleryInputDraft.prompt, galleryInputDraft.inputImages, restoredGalleryImages),
      ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
    }
    const galleryDraftsChanged =
      restoredGalleryImages.length !== galleryInputDraft.inputImages.length ||
      restoredGalleryImages.some((img, index) => img.dataUrl !== galleryInputDraft.inputImages[index]?.dataUrl) ||
      shouldClearMask
    if (galleryDraftsChanged) {
      const latestState = useStore.getState()
      const nextGalleryInputDraft = isEmptyAgentInputDraft(restoredGalleryDraft) ? null : restoredGalleryDraft
      useStore.setState({
        galleryInputDraft: nextGalleryInputDraft,
        ...(latestState.appMode === 'gallery'
          ? restoreGalleryInputDraftState(nextGalleryInputDraft)
          : {}),
      })
    }
  }

  const restoredAgentInputDrafts: Record<string, AgentInputDraft> = {}
  let agentDraftsChanged = false
  for (const [conversationId, draft] of Object.entries(agentInputDrafts)) {
    const restoredDraftImages: InputImage[] = []
    for (const img of draft.inputImages) {
      if (img.dataUrl) {
        restoredDraftImages.push(img)
        cacheImage(img.id, img.dataUrl)
        continue
      }
      const storedImage = imageMap.get(img.id)
      if (storedImage?.dataUrl) {
        restoredDraftImages.push({ ...img, dataUrl: storedImage.dataUrl })
        cacheImage(img.id, storedImage.dataUrl)
      }
    }

    const shouldClearMask = Boolean(draft.maskDraft) && !restoredDraftImages.some((img) => img.id === draft.maskDraft?.targetImageId)
    const restoredDraft: AgentInputDraft = {
      ...draft,
      inputImages: restoredDraftImages,
      prompt: remapImageMentionsForOrder(draft.prompt, draft.inputImages, restoredDraftImages),
      ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
    }
    if (!isEmptyAgentInputDraft(restoredDraft)) restoredAgentInputDrafts[conversationId] = restoredDraft
    if (
      restoredDraftImages.length !== draft.inputImages.length ||
      restoredDraftImages.some((img, index) => img.dataUrl !== draft.inputImages[index]?.dataUrl) ||
      shouldClearMask
    ) {
      agentDraftsChanged = true
    }
  }
  if (agentDraftsChanged) {
    const latestState = useStore.getState()
    useStore.setState({
      agentInputDrafts: restoredAgentInputDrafts,
      ...(latestState.appMode === 'agent'
        ? restoreAgentInputDraftState(restoredAgentInputDrafts, latestState.activeAgentConversationId)
        : {}),
    })
  }
  if (!options.safeMode) void ensureImageStorageMigrated().catch((error) => {
    console.error('图片存储迁移失败:', error)
  })
}

export async function migrateLocalSaveRoot(newRoot: string): Promise<void> {
  const previousRoot = await getLocalSavePath()
  if (!previousRoot || previousRoot === newRoot) {
    await setLocalSavePath(newRoot)
    return
  }
  const mappings = await copyRawCacheImagesToRoot(newRoot)
  const mappedSources = new Set(mappings.map((mapping) => mapping.from.toLowerCase()))
  const unmappedPaths = (await getAllLocalImagePaths())
    .filter((localPath) => !mappedSources.has(localPath.toLowerCase()))
  if (unmappedPaths.length > 0) {
    throw new Error(`仍有 ${unmappedPaths.length} 个历史图片文件不在当前缓存目录中，请先导出完整备份后再迁移保存目录`)
  }
  await setLocalSavePath(newRoot)
  try {
    await updateImageLocalPaths(mappings)
  } catch (error) {
    await setLocalSavePath(previousRoot)
    throw error
  }
}

/** 提交新任务（使用显式数据，不依赖全局状态） */
export async function submitTaskWithData(
  data: {
    prompt: string
    inputImages: InputImage[]
    inputImageFolder: InputImageFolder | null
    params: TaskParams
    maskDraft: MaskDraft | null
    targetTabId?: string | null
    scheduledOutputPath?: string
    scheduledOutputSubFolder?: string
    apiProfileId?: string
    sopBatch?: TaskRecord['sopBatch']
  },
  options: { allowFullMask?: boolean; useCurrentApiProfileWhenReusedMissing?: boolean; silentSuccess?: boolean } = {},
) {
  const { settings, reusedTaskApiProfileId, reusedTaskApiProfileName, reusedTaskApiProfileMissing, showToast, setConfirmDialog } =
    useStore.getState()

  const { prompt, inputImages, inputImageFolder, params, maskDraft, targetTabId, scheduledOutputPath, scheduledOutputSubFolder, apiProfileId, sopBatch } = data

  const normalizedSettings = normalizeSettings(settings)
  let activeProfile = getActiveApiProfile(settings)
  if (apiProfileId) {
    activeProfile = normalizedSettings.profiles.find((profile) => profile.id === apiProfileId) ?? activeProfile
  }
  let requestSettings = createSettingsForApiProfile(normalizedSettings, activeProfile)
  if (!apiProfileId && normalizedSettings.reuseTaskApiProfileTemporarily && (reusedTaskApiProfileId || reusedTaskApiProfileMissing)) {
    const reusedProfile = getReusedTaskApiProfile(normalizedSettings, reusedTaskApiProfileId)
    if (!reusedProfile) {
      if (options.useCurrentApiProfileWhenReusedMissing) {
        useStore.getState().setReusedTaskApiProfile(null)
      } else {
        setConfirmDialog({
          title: '找不到 API 配置',
          message: `找不到复用任务所使用的 API 配置「${reusedTaskApiProfileName || '未知配置'}」，要使用当前的 API 配置「${activeProfile.name}」提交任务吗？`,
          confirmText: '使用当前配置提交',
          cancelText: '放弃提交',
          action: () => {
            void submitTaskWithData(data, { ...options, useCurrentApiProfileWhenReusedMissing: true })
          },
        })
        return
      }
    } else {
      activeProfile = reusedProfile
      requestSettings = createSettingsForApiProfile(normalizedSettings, reusedProfile)
    }
  }

  if (validateApiProfile(activeProfile)) {
    showToast(`请先完善请求 API 配置：${validateApiProfile(activeProfile)}`, 'error')
    useStore.getState().setShowSettings(true)
    return
  }

  if (!prompt.trim()) {
    showToast('请输入提示词', 'error')
    return
  }

  if (params.reference_mode === 'all') {
    const inputCount = inputImageFolder?.imageIds.length ?? inputImages.length
    if (inputCount > MAX_ALL_REFERENCE_IMAGES) {
      showToast(`同时参考全部最多支持 ${MAX_ALL_REFERENCE_IMAGES} 张图片，请减少图片或切换为逐张参考`, 'error')
      return
    }

    try {
      const inputDataUrls = inputImageFolder
        ? await Promise.all(inputImageFolder.imageIds.map(async (imageId) => {
            const dataUrl = await ensureImageCached(imageId)
            if (!dataUrl) throw new Error('输入图片已不存在')
            return dataUrl
          }))
        : inputImages.map((image) => image.dataUrl)
      const totalBytes = inputDataUrls.reduce((sum, dataUrl) => sum + getDataUrlDecodedByteSize(dataUrl), 0) +
        (maskDraft ? getDataUrlDecodedByteSize(maskDraft.maskDataUrl) : 0)
      if (totalBytes > MAX_ALL_REFERENCE_PAYLOAD_BYTES) {
        showToast(
          `同时参考全部的图片总大小不能超过 ${formatInputImageLimitBytes(MAX_ALL_REFERENCE_PAYLOAD_BYTES)}，请压缩图片、减少图片或切换为逐张参考`,
          'error',
        )
        return
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
  }

  let orderedInputImages = inputImages
  let maskImageId: string | null = null
  let maskTargetImageId: string | null = null

  if (maskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(inputImages, maskDraft.targetImageId)
      const coverage = await validateMaskMatchesImage(maskDraft.maskDataUrl, orderedInputImages[0].dataUrl)
      if (coverage === 'full' && !options.allowFullMask) {
        setConfirmDialog({
          title: '确认编辑整张图片？',
          message: '当前遮罩覆盖了整张图片，提交后可能会重绘全部内容。是否继续？',
          confirmText: '继续提交',
          tone: 'warning',
          action: () => {
            void submitTaskWithData(data, { allowFullMask: true })
          },
        })
        return
      }
      maskImageId = await storeImage(maskDraft.maskDataUrl, 'mask')
      cacheImage(maskImageId, maskDraft.maskDataUrl)
      maskTargetImageId = maskDraft.targetImageId
    } catch (err) {
      if (!inputImages.some((img) => img.id === maskDraft.targetImageId)) {
        useStore.getState().clearMaskDraft()
      }
      showToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
  }

  // 持久化输入图片到 IndexedDB（此前只在内存缓存中）
  for (const img of orderedInputImages) {
    await storeImage(img.dataUrl)
  }

  if (inputImageFolder) {
    for (const imgId of inputImageFolder.imageIds) {
      const dataUrl = imageCache.get(imgId)
      if (dataUrl) await storeImage(dataUrl)
    }
  }

  const hasInputImages = orderedInputImages.length > 0 || (inputImageFolder ? inputImageFolder.imageIds.length > 0 : false)
  const normalizedParams = normalizeParamsForSettings(params, requestSettings, { hasInputImages })

  const taskState = useStore.getState()
  const tabIdToUpdate = targetTabId ?? taskState.activeWorkspaceTabId ?? taskState.workspaceTabs[0]?.id ?? null
  const createdAt = Date.now()
  const taskId = genId()
  const filenameBatch = getNextTaskFilenameBatch(createdAt, tabIdToUpdate)
  const task: TaskRecord = {
    id: taskId,
    prompt: prompt.trim(),
    sopBatch,
    params: normalizedParams,
    adNegativeRuleSnapshot: createAdNegativeRuleSnapshot(normalizedSettings, normalizedParams.adNegativeRuleId),
    apiProvider: activeProfile.provider,
    apiProfileId: activeProfile.id,
    apiProfileName: activeProfile.name,
    apiMode: activeProfile.apiMode,
    apiModel: activeProfile.model,
    inputImageIds: inputImageFolder ? inputImageFolder.imageIds : orderedInputImages.map((i) => i.id),
    inputImageFolderPath: inputImageFolder?.path ?? undefined,
    maskTargetImageId,
    maskImageId,
    outputImages: [],
    filenameBatch,
    status: 'running',
    error: null,
    progressStage: 'queued',
    progressUpdatedAt: Date.now(),
    createdAt,
    finishedAt: null,
    elapsed: null,
    scheduledOutputPath,
    scheduledOutputSubFolder,
    localSaveBatchFolder: getTaskLocalSaveBatchFolder(createdAt, filenameBatch),
  }

  const latestTasks = useStore.getState().tasks
  const newTasks = [task, ...latestTasks]
  useStore.getState().setTasks(newTasks)
  // Also add to target workspace tab (or active tab if not specified)
  if (tabIdToUpdate) {
    useStore.setState((state) => ({
      workspaceTabs: state.workspaceTabs.map((t) =>
        t.id === tabIdToUpdate ? { ...t, tasks: [task, ...t.tasks] } : t,
      ),
    }))
  } else {
    // If no tab is active, try to add to the first tab (usually "默认" / "标签 1")
    useStore.setState((state) => {
      if (state.workspaceTabs.length === 0) return state
      const firstTabId = state.workspaceTabs[0].id
      return {
        workspaceTabs: state.workspaceTabs.map((t) =>
          t.id === firstTabId ? { ...t, tasks: [task, ...t.tasks] } : t,
        ),
      }
    })
  }
  await putTask(task)
  if (!options.silentSuccess) useStore.getState().showToast('任务已提交', 'success')

  // 异步调用 API
  executeTask(taskId)
  return taskId
}

/** 提交新任务 */
export async function submitTask(options: { allowFullMask?: boolean; useCurrentApiProfileWhenReusedMissing?: boolean } = {}) {
  const state = useStore.getState()
  const { prompt, inputImages, inputImageFolder, params, maskDraft, customOutputPath } = state
  
  // 查找当前激活的标签页
  const activeTab = state.workspaceTabs.find(tab => tab.id === state.activeWorkspaceTabId)
  
  // 修复：只有自定义输出路径被设置时才使用，否则使用标签页名称作为子文件夹
  const scheduledOutputPath = customOutputPath.trim() ? customOutputPath : undefined
  const scheduledOutputSubFolder = activeTab ? activeTab.name : undefined

  await submitTaskWithData({ 
    prompt, 
    inputImages, 
    inputImageFolder, 
    params, 
    maskDraft, 
    scheduledOutputPath,
    scheduledOutputSubFolder 
  }, options)
}

function getActiveAgentConversation(): AgentConversation {
  const state = useStore.getState()
  const existing = state.agentConversations.find((conversation) => conversation.id === state.activeAgentConversationId)
  if (existing) return existing

  const id = state.createAgentConversation()
  return useStore.getState().agentConversations.find((conversation) => conversation.id === id)!
}

function updateAgentConversation(conversationId: string, updater: (conversation: AgentConversation) => AgentConversation) {
  useStore.setState((state) => ({
    agentConversations: state.agentConversations.map((conversation) =>
      conversation.id === conversationId ? updater(conversation) : conversation,
    ),
  }))
}

function getAgentRoundControllerKey(conversationId: string, roundId: string) {
  return `${conversationId}:${roundId}`
}

function createAgentAbortError() {
  return new DOMException('Agent 请求已停止', 'AbortError')
}

function createAgentRecoveryPauseError() {
  const error = new Error('Agent recovery paused')
  error.name = AGENT_RECOVERY_PAUSE_ERROR
  return error
}

function isAgentRecoveryPauseError(error: unknown) {
  return error instanceof Error && error.name === AGENT_RECOVERY_PAUSE_ERROR
}

function appendAgentStoppedMessage(content: string) {
  const trimmed = content.trimEnd()
  if (!trimmed) return AGENT_STOPPED_MESSAGE
  if (trimmed.endsWith(AGENT_STOPPED_MESSAGE)) return trimmed
  return `${trimmed}\n\n${AGENT_STOPPED_MESSAGE}`
}

function markAgentRoundTasksStopped(conversationId: string, roundId: string, now = Date.now()) {
  const runningTasks = useStore.getState().tasks.filter((task) =>
    task.status === 'running' &&
    task.agentConversationId === conversationId &&
    task.agentRoundId === roundId,
  )

  for (const task of runningTasks) {
    updateTaskInStore(task.id, {
      status: 'error',
      error: AGENT_STOPPED_MESSAGE,
      falRecoverable: false,
      customRecoverable: false,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    })
  }
  return runningTasks.length > 0
}

function markAgentRoundStopped(conversationId: string, roundId: string) {
  const now = Date.now()
  const stoppedTasks = markAgentRoundTasksStopped(conversationId, roundId, now)
  let stoppedRound = false
  // Flush any pending streaming text before updating conversation state
  const conversation = useStore.getState().agentConversations.find((item) => item.id === conversationId)
  const round = conversation?.rounds.find((item) => item.id === roundId)
  const assistantMessage = round
    ? (round.assistantMessageId
      ? conversation?.messages.find((message) => message.id === round.assistantMessageId)
      : conversation?.messages.find((message) => message.roundId === round.id && message.role === 'assistant'))
    : undefined
  if (assistantMessage) {
    flushAgentAssistantMessageContent(conversationId, assistantMessage.id)
    useStore.getState().clearAgentStreamingText(conversationId, assistantMessage.id)
  }
  updateAgentConversation(conversationId, (current) => {
    const round = current.rounds.find((item) => item.id === roundId)
    if (!round || round.status !== 'running') return current

    stoppedRound = true
    const existingAssistantMessage = current.messages.find((message) => message.roundId === roundId && message.role === 'assistant')
    const assistantMessageId = existingAssistantMessage?.id ?? genId()
    return {
      ...current,
      updatedAt: now,
      rounds: current.rounds.map((item) =>
        item.id === roundId
          ? {
              ...item,
              ...(assistantMessageId ? { assistantMessageId } : {}),
              status: 'error',
              error: AGENT_STOPPED_MESSAGE,
              finishedAt: now,
            }
          : item,
      ),
      messages: existingAssistantMessage
        ? current.messages.map((message) =>
            message.id === existingAssistantMessage.id
              ? { ...message, content: appendAgentStoppedMessage(message.content) }
              : message,
          )
        : [
            ...current.messages,
            {
              id: assistantMessageId,
              role: 'assistant',
              content: AGENT_STOPPED_MESSAGE,
              roundId,
              createdAt: now,
            },
          ],
    }
  })
  return stoppedRound || stoppedTasks
}

// ===== Agent streaming text debounce =====
const agentTextFlushTimers = new Map<string, ReturnType<typeof setTimeout>>()
const agentTextBuffers = new Map<string, string>()

function getAgentTextFlushKey(conversationId: string, messageId: string) {
  return `${conversationId}:${messageId}`
}

function flushAgentAssistantMessageContent(conversationId: string, messageId: string) {
  const key = getAgentTextFlushKey(conversationId, messageId)
  const delta = agentTextBuffers.get(key)
  agentTextBuffers.delete(key)
  agentTextFlushTimers.delete(key)
  if (!delta) return
  updateAgentConversation(conversationId, (current) => ({
    ...current,
    updatedAt: Date.now(),
    messages: current.messages.map((message) =>
      message.id === messageId
        ? { ...message, content: `${message.content}${delta}` }
        : message,
    ),
  }))
}

function appendAgentAssistantMessageContent(conversationId: string, messageId: string, delta: string) {
  if (!delta) return
  const key = getAgentTextFlushKey(conversationId, messageId)
  const existing = agentTextBuffers.get(key) ?? ''
  agentTextBuffers.set(key, existing + delta)
  // Update lightweight streaming text state immediately for UI responsiveness
  useStore.getState().setAgentStreamingText(conversationId, messageId, existing + delta)
  // Debounce heavy agentConversations update
  const existingTimer = agentTextFlushTimers.get(key)
  if (existingTimer) clearTimeout(existingTimer)
  agentTextFlushTimers.set(
    key,
    setTimeout(() => flushAgentAssistantMessageContent(conversationId, messageId), 80),
  )
}

function clearAgentTextFlushTimer(conversationId: string, messageId: string) {
  const key = getAgentTextFlushKey(conversationId, messageId)
  const timer = agentTextFlushTimers.get(key)
  if (timer) clearTimeout(timer)
  agentTextFlushTimers.delete(key)
  agentTextBuffers.delete(key)
}

async function generateAgentConversationTitle(
  conversationId: string,
  prompt: string,
  inputImageIds: string[],
  requestSettings: AppSettings,
  activeProfile: ApiProfile,
  fallbackTitle: string,
) {
  useStore.setState((state) => {
    const next = { ...state.agentGeneratingTitleIds, [conversationId]: true as const }
    return { agentGeneratingTitleIds: next }
  })
  try {
    const imageDataUrls = await readAgentImageDataUrls(inputImageIds)
    const title = await callAgentConversationTitleApi({
      settings: requestSettings,
      profile: activeProfile,
      prompt,
      imageDataUrls,
    })
    if (!title || title === fallbackTitle) return

    updateAgentConversation(conversationId, (current) => {
      const firstRound = current.rounds[0]
      if (!firstRound || firstRound.prompt !== prompt || current.title !== fallbackTitle) return current
      return { ...current, title, updatedAt: Date.now() }
    })
  } catch {
    // Title generation is best-effort; keep the local fallback title on failure.
  } finally {
    useStore.setState((state) => {
      const next = { ...state.agentGeneratingTitleIds }
      delete next[conversationId]
      return { agentGeneratingTitleIds: next }
    })
  }
}

export function stopAgentResponse(conversationId = useStore.getState().activeAgentConversationId) {
  if (!conversationId) return
  const conversation = useStore.getState().agentConversations.find((item) => item.id === conversationId)
  if (!conversation) return
  const activeRunningRound = [...getActiveAgentRounds(conversation)].reverse().find((round) => round.status === 'running')
  const runningRound = activeRunningRound ?? conversation.rounds.find((round) => round.status === 'running')
  if (!runningRound) return

  // Clear any pending streaming text flush and buffer
  const assistantMessage = runningRound.assistantMessageId
    ? conversation.messages.find((message) => message.id === runningRound.assistantMessageId)
    : conversation.messages.find((message) => message.roundId === runningRound.id && message.role === 'assistant')
  if (assistantMessage) {
    clearAgentTextFlushTimer(conversationId, assistantMessage.id)
    useStore.getState().clearAgentStreamingText(conversationId, assistantMessage.id)
  }

  const controller = agentRoundControllers.get(getAgentRoundControllerKey(conversationId, runningRound.id))
  if (controller) {
    controller.abort()
    if (markAgentRoundStopped(conversationId, runningRound.id)) {
      useStore.getState().showToast('已停止生成', 'info')
    }
    return
  }

  markAgentRoundStopped(conversationId, runningRound.id)
  useStore.getState().showToast('已停止生成', 'info')
}

function getAgentRoundChildren(conversation: AgentConversation, parentRoundId: string | null) {
  return conversation.rounds.filter((round) => (round.parentRoundId ?? null) === parentRoundId)
}

function getLatestAgentLeafId(conversation: AgentConversation, startRoundId: string | null = null): string | null {
  let currentId = startRoundId
  if (!currentId) {
    const roots = getAgentRoundChildren(conversation, null)
    currentId = roots[roots.length - 1]?.id ?? null
  }

  while (currentId) {
    const children = getAgentRoundChildren(conversation, currentId)
    const nextId = children[children.length - 1]?.id ?? null
    if (!nextId) return currentId
    currentId = nextId
  }

  return null
}

export function getAgentRoundPath(conversation: AgentConversation, roundId: string | null): AgentRound[] {
  if (!roundId) return []
  const byId = new Map(conversation.rounds.map((round) => [round.id, round]))
  const path: AgentRound[] = []
  const seen = new Set<string>()
  let current = byId.get(roundId) ?? null

  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentRoundId ? byId.get(current.parentRoundId) ?? null : null
  }

  return path
}

export function getActiveAgentRounds(conversation: AgentConversation): AgentRound[] {
  const activeRoundId = conversation.activeRoundId && conversation.rounds.some((round) => round.id === conversation.activeRoundId)
    ? conversation.activeRoundId
    : getLatestAgentLeafId(conversation)
  return getAgentRoundPath(conversation, activeRoundId ?? null)
}

function reindexAgentRounds(conversation: AgentConversation): AgentConversation {
  const indexById = new Map<string, number>()
  const visit = (parentRoundId: string | null, depth: number) => {
    for (const child of getAgentRoundChildren(conversation, parentRoundId)) {
      indexById.set(child.id, depth)
      visit(child.id, depth + 1)
    }
  }
  visit(null, 1)
  return {
    ...conversation,
    rounds: conversation.rounds.map((round) => ({
      ...round,
      index: indexById.get(round.id) ?? round.index,
    })),
  }
}

export function remapAgentRoundMentionsForPathChange(content: string, oldPath: AgentRound[], newPath: AgentRound[]) {
  if (!content || oldPath.length === 0) return content
  const newIndexByRoundId = new Map(newPath.map((round, index) => [round.id, index + 1]))
  return content.replace(AGENT_ROUND_IMAGE_MENTION_RE, (match, roundNumber: string, imageNumber: string) => {
    const oldRound = oldPath[Number(roundNumber) - 1]
    if (!oldRound) return match
    const newRoundIndex = newIndexByRoundId.get(oldRound.id)
    if (!newRoundIndex) return `@已删除轮次图${imageNumber}`
    return `@第${newRoundIndex}轮图${imageNumber}`
  })
}

export function deleteAgentRoundFromConversation(conversation: AgentConversation, roundId: string, now = Date.now()): AgentConversation {
  const targetRound = conversation.rounds.find((round) => round.id === roundId)
  if (!targetRound) return conversation

  const oldPathByRoundId = new Map(conversation.rounds.map((round) => [round.id, getAgentRoundPath(conversation, round.id)]))
  const rounds = conversation.rounds
    .filter((candidate) => candidate.id !== roundId)
    .map((candidate) =>
      candidate.parentRoundId === roundId
        ? { ...candidate, parentRoundId: targetRound.parentRoundId ?? null }
        : candidate,
    )
  const messages = conversation.messages.filter((candidate) => candidate.roundId !== roundId)
  const nextConversation = reindexAgentRounds({
    ...conversation,
    rounds,
    messages,
    activeRoundId: conversation.activeRoundId === roundId ? null : conversation.activeRoundId ?? null,
  })
  const newPathByRoundId = new Map(nextConversation.rounds.map((round) => [round.id, getAgentRoundPath(nextConversation, round.id)]))
  const remappedMessages = nextConversation.messages.map((message) => {
    if (!message.roundId) return message
    const oldPath = oldPathByRoundId.get(message.roundId) ?? []
    const newPath = newPathByRoundId.get(message.roundId) ?? []
    const content = remapAgentRoundMentionsForPathChange(message.content, oldPath, newPath)
    return content === message.content ? message : { ...message, content }
  })
  const withRemappedMessages = { ...nextConversation, messages: remappedMessages }
  const activeRounds = getActiveAgentRounds(withRemappedMessages)
  return {
    ...withRemappedMessages,
    activeRoundId: withRemappedMessages.activeRoundId ?? activeRounds[activeRounds.length - 1]?.id ?? null,
    updatedAt: now,
  }
}

export function getAgentSiblingRounds(conversation: AgentConversation, round: AgentRound) {
  return getAgentRoundChildren(conversation, round.parentRoundId ?? null)
}

export function getAgentBranchLeafId(conversation: AgentConversation, roundId: string) {
  return getLatestAgentLeafId(conversation, roundId) ?? roundId
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)))
}

function addAgentReferencedImageIds(target: Set<string>, conversations = useStore.getState().agentConversations, inputDrafts = useStore.getState().agentInputDrafts) {
  for (const conversation of conversations) {
    for (const round of conversation.rounds) {
      for (const id of round.inputImageIds) target.add(id)
      if (round.maskImageId) target.add(round.maskImageId)
    }
    for (const message of conversation.messages) {
      if (message.maskImageId) target.add(message.maskImageId)
    }
  }
  for (const draft of Object.values(inputDrafts)) {
    for (const img of draft.inputImages) target.add(img.id)
  }
}

function addInputDraftReferencedImageIds(target: Set<string>, draft: AgentInputDraft | null) {
  if (!draft) return
  for (const img of draft.inputImages) target.add(img.id)
}

function addTaskReferencedImageIds(target: Set<string>, task: TaskRecord) {
  for (const id of task.inputImageIds || []) target.add(id)
  if (task.maskImageId) target.add(task.maskImageId)
  for (const id of task.outputImages || []) target.add(id)
  for (const id of task.streamPartialImageIds || []) target.add(id)
}

function addSopRunReferencedImageIds(target: Set<string>, runs: SopBatchSnapshot[]) {
  for (const run of runs) {
    for (const imageId of run.referenceImageIds) target.add(imageId)
  }
}

async function deleteUnreferencedImageIds(imageIds: Iterable<string>) {
  const candidates = Array.from(new Set(Array.from(imageIds).filter(Boolean)))
  if (candidates.length === 0) return

  const { tasks, inputImages, galleryInputDraft } = useStore.getState()
  const stillUsed = new Set<string>()
  for (const task of tasks) addTaskReferencedImageIds(stillUsed, task)
  addAgentReferencedImageIds(stillUsed)
  addInputDraftReferencedImageIds(stillUsed, galleryInputDraft)
  for (const img of inputImages) stillUsed.add(img.id)
  addSopRunReferencedImageIds(stillUsed, await getAllSopBatchSnapshots())

  for (const imgId of candidates) {
    if (stillUsed.has(imgId)) continue
    await deleteImage(imgId)
    imageCache.delete(imgId)
    thumbnailCache.delete(imgId)
  }
}

export async function cleanupAllOrphanedImages(): Promise<number> {
  const orphanIds = await getAllOrphanedImageIds()
  for (const imgId of orphanIds) {
    await deleteImage(imgId)
    imageCache.delete(imgId)
    thumbnailCache.delete(imgId)
  }
  return orphanIds.length
}

export async function getAllOrphanedImageIds(): Promise<string[]> {
  const allImageIds = await getAllImageIds()
  const { tasks, inputImages, galleryInputDraft, workspaceTabs } = useStore.getState()
  const stillUsed = new Set<string>()
  for (const task of tasks) addTaskReferencedImageIds(stillUsed, task)
  addAgentReferencedImageIds(stillUsed)
  addInputDraftReferencedImageIds(stillUsed, galleryInputDraft)
  for (const img of inputImages) stillUsed.add(img.id)
  addSopRunReferencedImageIds(stillUsed, await getAllSopBatchSnapshots())
  for (const tab of workspaceTabs) {
    for (const image of tab.inputImages) stillUsed.add(image.id)
    for (const imageId of tab.inputImageFolder?.imageIds ?? []) stillUsed.add(imageId)
  }
  return allImageIds.filter((imageId) => !stillUsed.has(imageId))
}

async function persistTaskStreamPartialImage(taskId: string, dataUrl: string) {
  try {
    const imgId = await storeImage(dataUrl, 'generated')
    cacheImage(imgId, dataUrl)

    const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
    if (!latestTask || latestTask.status === 'done') {
      await deleteUnreferencedImageIds([imgId])
      return
    }

    const currentIds = latestTask.streamPartialImageIds || []
    if (currentIds.includes(imgId)) return
    const nextIds = [...currentIds, imgId]
    const retainedIds = nextIds.slice(-MAX_RETAINED_STREAM_PARTIAL_IMAGES)
    const discardedIds = nextIds.slice(0, Math.max(0, nextIds.length - retainedIds.length))
    updateTaskInStore(taskId, { streamPartialImageIds: retainedIds })
    if (discardedIds.length > 0) await deleteUnreferencedImageIds(discardedIds)
  } catch (err) {
    console.error(err)
  }
}

async function readAgentImageDataUrls(ids: string[]) {
  const dataUrls: string[] = []
  for (const id of ids) {
    const dataUrl = await ensureImageCached(id)
    if (dataUrl) dataUrls.push(dataUrl)
  }
  return dataUrls
}

async function createAgentUserInputItem(conversation: AgentConversation, round: AgentRound, message: AgentMessage, tasks: TaskRecord[]) {
  const imageDataUrls = await readAgentImageDataUrls(round.inputImageIds)
  const rounds = getAgentRoundPath(conversation, round.id)
  const text = replaceAgentPromptImageReferencesForApi(message.content, round, rounds, tasks)
  const referenceText = round.inputImageIds.length > 0
    ? `\n\n<available_refs>${round.inputImageIds.map((_, index) => `\n  <ref id="${getAgentCurrentReferenceId(round, index)}" />`).join('')}\n</available_refs>`
    : ''
  return {
    role: 'user',
    content: [
      { type: 'input_text', text: `${text}${referenceText}` },
      ...imageDataUrls.map((dataUrl) => ({ type: 'input_image', image_url: dataUrl })),
    ],
  }
}

async function createAgentGeneratedImagesInputItem(round: AgentRound, tasks: TaskRecord[]) {
  const contentParts: Array<{ type: string; text?: string; image_url?: string }> = []
  let imageIndex = 0
  for (const taskId of round.outputTaskIds) {
    const task = tasks.find((item) => item.id === taskId)
    if (!task) {
      contentParts.push({ type: 'input_text', text: `<removed_ref id="${getAgentGeneratedImageReferenceId(round, imageIndex)}" />` })
      imageIndex += 1
      continue
    }
    for (const imageId of task.outputImages || []) {
      const dataUrl = await ensureImageCached(imageId)
      if (dataUrl) {
        contentParts.push({ type: 'input_image', image_url: dataUrl })
      }
      const refId = getAgentGeneratedImageReferenceId(round, imageIndex)
      const prompt = truncateAgentReferencePrompt(task.prompt || '')
      const promptAttribute = prompt ? ` prompt="${escapeXmlAttribute(prompt)}"` : ''
      contentParts.push({ type: 'input_text', text: `<ref id="${refId}"${promptAttribute} />` })
      imageIndex += 1
    }
  }
  if (contentParts.length === 0) return null
  return { role: 'user', content: contentParts }
}

async function createAgentBatchImagesInputItem(round: AgentRound, tasks: TaskRecord[], batchTaskIds: string[]) {
  const contentParts: Array<{ type: string; text?: string; image_url?: string }> = []
  // Count existing images in the round to compute correct imageIndex offset
  let baseImageIndex = 0
  for (const taskId of round.outputTaskIds) {
    if (batchTaskIds.includes(taskId)) break
    const task = tasks.find((item) => item.id === taskId)
    baseImageIndex += task ? (task.outputImages?.length ?? 0) : 1
  }
  let imageIndex = baseImageIndex
  for (const taskId of batchTaskIds) {
    const task = tasks.find((item) => item.id === taskId)
    if (!task || task.status !== 'done') continue
    for (const imgId of task.outputImages) {
      const dataUrl = await ensureImageCached(imgId)
      if (dataUrl) {
        contentParts.push({ type: 'input_image', image_url: dataUrl })
      }
      const refId = getAgentGeneratedImageReferenceId(round, imageIndex)
      const prompt = truncateAgentReferencePrompt(task.prompt || '')
      const promptAttribute = prompt ? ` prompt="${escapeXmlAttribute(prompt)}"` : ''
      contentParts.push({ type: 'input_text', text: `<ref id="${refId}"${promptAttribute} />` })
      imageIndex += 1
    }
  }
  if (contentParts.length === 0) return null
  return { role: 'user', content: contentParts }
}

function escapeXmlAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function truncateAgentReferencePrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  return normalized.length > 1200 ? `${normalized.slice(0, 1200)}...` : normalized
}

function createAgentAssistantFallbackItem(text: string) {
  return {
    role: 'assistant',
    content: [{ type: 'output_text', text }],
  }
}

function parseResponseOutputFromPayload(rawResponsePayload?: string): ResponsesOutputItem[] | null {
  if (!rawResponsePayload) return null
  try {
    const payload = JSON.parse(rawResponsePayload) as { output?: unknown }
    return Array.isArray(payload.output) ? payload.output as ResponsesOutputItem[] : null
  } catch {
    return null
  }
}

function sanitizeResponseOutputItemForInput(item: ResponsesOutputItem): unknown | null {
  if (item.type === 'web_search_call') return null
  if (item.type === 'image_generation_call') return null

  if (item.type === 'message') {
    const content = (item.content ?? [])
      .map((part) => {
        if (typeof part.text !== 'string') return null
        if (part.type === 'output_text' || part.type === 'text') {
          return { type: 'output_text', text: part.text }
        }
        return null
      })
      .filter((part): part is { type: 'output_text'; text: string } => Boolean(part))

    return content.length > 0 ? { role: 'assistant', content } : null
  }

  return item
}

function filterAgentRoundResponseOutputForInput(_round: AgentRound, _tasks: TaskRecord[], output: ResponsesOutputItem[]) {
  // image_generation_call items are now dropped by sanitizeResponseOutputItemForInput;
  // this filter is kept as a structural pass-through for future use.
  return output
}

function scrubResponseOutputForDeletedAgentTasks(round: AgentRound, output: ResponsesOutputItem[], deletedTasks: TaskRecord[]) {
  const deletedTaskIds = new Set(deletedTasks.map((task) => task.id))
  const deletedToolCallIds = new Set(
    deletedTasks
      .filter((task) => task.agentRoundId === round.id && task.agentToolCallId)
      .map((task) => task.agentToolCallId!),
  )
  if (deletedTaskIds.size === 0) return output

  let anonymousImageIndex = 0
  return output.filter((item) => {
    if (item.type !== 'image_generation_call') return true

    if (typeof item.id === 'string' && item.id) {
      return !deletedToolCallIds.has(item.id)
    }

    const taskId = round.outputTaskIds[anonymousImageIndex]
    anonymousImageIndex += 1
    return !deletedTaskIds.has(taskId)
  })
}

function scrubAgentConversationsForDeletedTasks(conversations: AgentConversation[], deletedTasks: TaskRecord[]) {
  if (deletedTasks.length === 0) return conversations

  return conversations.map((conversation) => ({
    ...conversation,
    rounds: conversation.rounds.map((round) => {
      const roundDeletedTasks = deletedTasks.filter((task) => round.outputTaskIds.includes(task.id))
      if (roundDeletedTasks.length === 0 || !round.responseOutput?.length) return round
      return {
        ...round,
        responseOutput: scrubResponseOutputForDeletedAgentTasks(round, round.responseOutput, roundDeletedTasks),
      }
    }),
  }))
}

function scrubTaskRawResponsePayloadForDeletedTasks(task: TaskRecord, conversations: AgentConversation[], deletedTasks: TaskRecord[]) {
  if (!task.rawResponsePayload || !task.agentRoundId) return task

  const round = conversations
    .flatMap((conversation) => conversation.rounds)
    .find((item) => item.id === task.agentRoundId)
  if (!round) return task

  const roundDeletedTasks = deletedTasks.filter((item) => round.outputTaskIds.includes(item.id))
  if (roundDeletedTasks.length === 0) return task

  try {
    const payload = JSON.parse(task.rawResponsePayload) as ResponsesApiResponse
    if (!Array.isArray(payload.output)) return task
    const output = scrubResponseOutputForDeletedAgentTasks(round, payload.output, roundDeletedTasks)
    if (output.length === payload.output.length) return task
    return { ...task, rawResponsePayload: JSON.stringify({ ...payload, output }, null, 2) }
  } catch {
    return task
  }
}

async function scrubAgentOutputPayloadsForDeletedTasks(deletedTasks: TaskRecord[], remainingTasks: TaskRecord[]) {
  if (deletedTasks.length === 0) return remainingTasks

  const conversations = scrubAgentConversationsForDeletedTasks(useStore.getState().agentConversations, deletedTasks)
  const scrubbedTasks = remainingTasks.map((task) => scrubTaskRawResponsePayloadForDeletedTasks(task, conversations, deletedTasks))
  useStore.setState({ agentConversations: conversations })

  for (const task of scrubbedTasks) {
    const previous = remainingTasks.find((item) => item.id === task.id)
    if (previous?.rawResponsePayload !== task.rawResponsePayload) await putTask(task)
  }

  return scrubbedTasks
}

function sanitizeResponseOutputForInput(output: ResponsesOutputItem[], options: { allowPendingFunctionCalls?: boolean } = {}) {
  const items = output
    .map(sanitizeResponseOutputItemForInput)
    .filter((item): item is unknown => item != null)
  if (options.allowPendingFunctionCalls) return items

  const functionCallIds = new Set<string>()
  const functionOutputCallIds = new Set<string>()
  for (const item of items) {
    if (!isRecord(item)) continue
    const callId = typeof item.call_id === 'string' ? item.call_id : ''
    if (!callId) continue
    if (item.type === 'function_call') functionCallIds.add(callId)
    if (item.type === 'function_call_output') functionOutputCallIds.add(callId)
  }

  return items.filter((item) => {
    if (!isRecord(item)) return true
    const callId = typeof item.call_id === 'string' ? item.call_id : ''
    if (item.type === 'function_call') return callId && functionOutputCallIds.has(callId)
    if (item.type === 'function_call_output') return callId && functionCallIds.has(callId)
    return true
  })
}

function mergeResponseOutputItems(previous: ResponsesOutputItem[], next: ResponsesOutputItem[]) {
  const merged = [...previous]
  for (const item of next) {
    const index = item.id ? merged.findIndex((existing) => existing.id === item.id) : -1
    if (index >= 0) merged[index] = item
    else merged.push(item)
  }
  return merged
}

function countResponseToolCalls(output: ResponsesOutputItem[]) {
  return output.filter((item) => item.type === 'image_generation_call').length
}

function countResponseImageCalls(output: ResponsesOutputItem[]) {
  return output.filter((item) => item.type === 'image_generation_call').length
}

function createAgentContinuationInputItem(newImageRefs: string[], toolCallsUsed: number, maxToolCalls: number) {
  const lines = [
    '[System] The app has saved your generated outputs and is continuing the same Agent turn.',
  ]
  if (newImageRefs.length > 0) {
    lines.push(
      `The following image ref ids are now available for you to reference in subsequent image_generation prompts: ${newImageRefs.join(', ')}`,
    )
  }
  lines.push(
    'Continue generating. Do NOT repeat what you already said in earlier responses.',
    'If you still need another round after this (e.g. more dependent images), call continue_generation.',
    `Tool-call budget: ${toolCallsUsed}/${maxToolCalls} used.`,
  )
  return {
    role: 'user',
    content: [{
      type: 'input_text',
      text: lines.join('\n'),
    }],
  }
}

function buildAgentContinuationInput(baseInput: unknown[], round: AgentRound, tasks: TaskRecord[], currentRoundOutput: ResponsesOutputItem[], toolCallsUsed: number, maxToolCalls: number) {
  const input = [...baseInput, ...sanitizeResponseOutputForInput(currentRoundOutput, { allowPendingFunctionCalls: true })]
  const newImageRefs = collectAgentRoundOutputImageSlots(round, tasks)
    .map((imageId, index) => imageId ? `<ref id="${getAgentGeneratedImageReferenceId(round, index)}" />` : null)
    .filter((ref): ref is string => Boolean(ref))
  input.push(createAgentContinuationInputItem(newImageRefs, toolCallsUsed, maxToolCalls))
  return input
}

function getAgentRoundResponseOutput(round: AgentRound, tasks: TaskRecord[]): ResponsesOutputItem[] | null {
  if (round.responseOutput?.length) return round.responseOutput

  for (const taskId of round.outputTaskIds) {
    const task = tasks.find((item) => item.id === taskId)
    const output = parseResponseOutputFromPayload(task?.rawResponsePayload)
    if (output?.length) return output
  }

  return null
}

async function buildAgentApiInput(conversation: AgentConversation, currentRound: AgentRound, tasks: TaskRecord[]): Promise<unknown[]> {
  const input: unknown[] = []
  const rounds = getAgentRoundPath(conversation, currentRound.id)

  for (const round of rounds) {
    const userMessage = conversation.messages.find((message) => message.id === round.userMessageId)
    if (!userMessage) continue

    input.push(await createAgentUserInputItem(conversation, round, userMessage, tasks))
    if (round.id === currentRound.id) continue

    const output = getAgentRoundResponseOutput(round, tasks)
    if (output?.length) {
      const sanitizedOutput = sanitizeResponseOutputForInput(filterAgentRoundResponseOutputForInput(round, tasks, output))
      if (sanitizedOutput.length > 0) {
        input.push(...sanitizedOutput)
      } else {
        // All output items were filtered (e.g. only image_generation_call); add fallback
        const assistantMessage = round.assistantMessageId
          ? conversation.messages.find((message) => message.id === round.assistantMessageId)
          : null
        input.push(createAgentAssistantFallbackItem(
          assistantMessage?.content || '图像已生成。',
        ))
      }
    } else {
      const assistantMessage = round.assistantMessageId
        ? conversation.messages.find((message) => message.id === round.assistantMessageId)
        : null
      input.push(createAgentAssistantFallbackItem(
        assistantMessage?.content || '[No text response]',
      ))
    }

    // Inject generated images as a separate user message with input_image parts
    if (round.outputTaskIds.length > 0) {
      const imagesItem = await createAgentGeneratedImagesInputItem(round, tasks)
      if (imagesItem) input.push(imagesItem)
    }
  }

  return input
}

function getAgentFunctionOutputCallIds(output: ResponsesOutputItem[]) {
  return new Set(output
    .filter((item) => item.type === 'function_call_output' && item.call_id)
    .map((item) => item.call_id!))
}

function createAgentRecoveredToolOutputs(round: AgentRound, tasks: TaskRecord[]) {
  const output = round.responseOutput ?? []
  if (output.length === 0) return null

  const existingOutputCallIds = getAgentFunctionOutputCallIds(output)
  const additions: ResponsesOutputItem[] = []
  const recoveredTaskIds: string[] = []
  let hasPendingRecoverableCall = false
  let allSuccessful = true

  for (const item of output) {
    if (item.type !== 'function_call' || !item.call_id || existingOutputCallIds.has(item.call_id)) continue

    if (item.name === 'generate_image') {
      let imageId = 'image'
      try {
        const value = JSON.parse(item.arguments ?? '{}') as Record<string, unknown>
        if (typeof value.id === 'string' && value.id.trim()) imageId = value.id.trim()
      } catch {
        // Keep the stable fallback id when persisted arguments are malformed.
      }
      const task = tasks.find((candidate) => candidate.agentRoundId === round.id && candidate.agentToolCallId === item.call_id)
      if (!task || task.status === 'running' || task.falRecoverable || task.customRecoverable) {
        hasPendingRecoverableCall = true
        continue
      }

      recoveredTaskIds.push(task.id)
      const ok = task.status === 'done' && task.outputImages.length > 0
      if (!ok) allSuccessful = false
      additions.push({
        type: 'function_call_output',
        call_id: item.call_id,
        output: JSON.stringify({
          id: imageId,
          status: ok ? 'done' : 'error',
          ...(ok ? {} : { error: task.error || '图像生成失败' }),
        }),
      })
      continue
    }

    if (item.name === 'generate_image_batch') {
      const batchPlan = parseBatchImageCallArguments(item.arguments ?? '')
      if (!batchPlan) continue
      const batchItems = batchPlan.images

      const batchTasks = round.outputTaskIds
        .map((taskId) => tasks.find((task) => task.id === taskId))
        .filter((task): task is TaskRecord => Boolean(task && task.agentBatchCallId === item.call_id))
      if (batchTasks.length < batchItems.length || batchTasks.some((task) => task.status === 'running' || task.falRecoverable || task.customRecoverable)) {
        hasPendingRecoverableCall = true
        continue
      }

      recoveredTaskIds.push(...batchTasks.map((task) => task.id))
      const images = batchItems.map((batchItem, index) => {
        const task = batchTasks[index]
        const ok = task?.status === 'done' && task.outputImages.length > 0
        if (!ok) allSuccessful = false
        return {
          id: batchItem.id,
          status: ok ? 'done' : 'error',
          ...(ok ? {} : { error: task?.error || '图像生成失败' }),
        }
      })
      additions.push({
        type: 'function_call_output',
        call_id: item.call_id,
        output: JSON.stringify({ images }),
      })
    }
  }

  if (hasPendingRecoverableCall || additions.length === 0) return null
  return { additions, recoveredTaskIds, allSuccessful }
}

function createReadyAgentRecoveredToolState(round: AgentRound, tasks: TaskRecord[]) {
  const recovered = createAgentRecoveredToolOutputs(round, tasks)
  if (recovered) return recovered
  if (!round.responseOutput?.length || round.outputTaskIds.length === 0) return null

  const outputCallIds = getAgentFunctionOutputCallIds(round.responseOutput)
  const pendingFunctionCall = round.responseOutput.some((item) =>
    item.type === 'function_call' &&
    (item.name === 'generate_image' || item.name === 'generate_image_batch') &&
    item.call_id &&
    !outputCallIds.has(item.call_id),
  )
  if (pendingFunctionCall) return null

  const roundTasks = round.outputTaskIds
    .map((taskId) => tasks.find((task) => task.id === taskId))
    .filter((task): task is TaskRecord => Boolean(task))
  if (roundTasks.length === 0 || roundTasks.some((task) => task.status === 'running' || task.falRecoverable || task.customRecoverable)) return null

  return {
    additions: [] as ResponsesOutputItem[],
    recoveredTaskIds: roundTasks.map((task) => task.id),
    allSuccessful: roundTasks.every((task) => task.status === 'done' && task.outputImages.length > 0),
  }
}

function appendAgentRecoveredToolOutputs(conversationId: string, roundId: string, additions: ResponsesOutputItem[]) {
  updateAgentConversation(conversationId, (current) => ({
    ...current,
    updatedAt: Date.now(),
    rounds: current.rounds.map((round) => {
      if (round.id !== roundId) return round
      const output = round.responseOutput ?? []
      const existingOutputCallIds = getAgentFunctionOutputCallIds(output)
      const nextAdditions = additions.filter((item) => item.call_id && !existingOutputCallIds.has(item.call_id))
      return nextAdditions.length > 0 ? { ...round, responseOutput: [...output, ...nextAdditions] } : round
    }),
  }))
}

function getAgentRecoveredToolCallCount(output: ResponsesOutputItem[], tasks: TaskRecord[]) {
  const functionCallCount = output
    .filter((item) => item.type === 'function_call_output')
    .reduce((count, item) => {
      if (!item.output) return count
      try {
        const payload = JSON.parse(item.output) as { images?: unknown[]; status?: string }
        if (Array.isArray(payload.images)) {
          return count + payload.images.filter((image) => isRecord(image) && image.status === 'done').length
        }
        return payload.status === 'done' ? count + 1 : count
      } catch {
        return count
      }
    }, 0)
  return Math.max(functionCallCount + countResponseToolCalls(output), tasks.filter((task) => task.status === 'done').length)
}

function getAgentRecoveredFailureError(round: AgentRound, tasks: TaskRecord[]) {
  const failedTasks = round.outputTaskIds
    .map((taskId) => tasks.find((task) => task.id === taskId))
    .filter((task): task is TaskRecord => Boolean(task && task.status === 'error' && !task.falRecoverable && !task.customRecoverable))
  if (failedTasks.length === 0) return '图像生成失败'
  if (failedTasks.length === 1) return failedTasks[0].error || '图像生成失败'
  return '部分图像生成任务失败。'
}

async function continueRecoveredAgentRound(taskId: string) {
  const state = useStore.getState()
  const task = state.tasks.find((item) => item.id === taskId)
  if (!task?.agentConversationId || !task.agentRoundId) return

  const key = getAgentRoundControllerKey(task.agentConversationId, task.agentRoundId)
  if (agentRoundControllers.has(key) || agentRecoveryContinuations.has(key)) return

  agentRecoveryContinuations.add(key)
  try {
    const latestState = useStore.getState()
    const conversation = latestState.agentConversations.find((item) => item.id === task.agentConversationId)
    const round = conversation?.rounds.find((item) => item.id === task.agentRoundId)
    if (!conversation || !round || round.status === 'done' || round.error === AGENT_STOPPED_MESSAGE) return

    const failRound = (error: string) => updateAgentConversation(conversation.id, (current) => ({
      ...current,
      updatedAt: Date.now(),
      rounds: current.rounds.map((currentRound) => currentRound.id === round.id
        ? { ...currentRound, status: 'error', error, finishedAt: Date.now() }
        : currentRound),
    }))

    const recovered = createReadyAgentRecoveredToolState(round, latestState.tasks)
    if (!recovered) return
    appendAgentRecoveredToolOutputs(conversation.id, round.id, recovered.additions)

    const updatedState = useStore.getState()
    const updatedConversation = updatedState.agentConversations.find((item) => item.id === conversation.id)
    const updatedRound = updatedConversation?.rounds.find((item) => item.id === round.id)
    if (!updatedConversation || !updatedRound) return
    if (!recovered.allSuccessful) {
      failRound(getAgentRecoveredFailureError(updatedRound, updatedState.tasks))
      return
    }

    const normalizedSettings = normalizeSettings(updatedState.settings)
    const validationError = getAgentProfileValidationError(normalizedSettings)
    if (validationError) {
      failRound(`无法继续恢复任务：${validationError.message}`)
      return
    }
    const activeProfile = getAgentTextApiProfile(normalizedSettings)
    const imageProfile = getAgentImageApiProfile(normalizedSettings)
    if (!activeProfile || !imageProfile) {
      failRound('Agent API 配置不存在，无法继续恢复任务。')
      return
    }

    const roundTasks = updatedState.tasks.filter((item) => item.agentRoundId === round.id)
    const resumeParams = roundTasks.find((item) => item.params)?.params
      ?? normalizeParamsForSettings(updatedState.params, createSettingsForApiProfile(normalizedSettings, imageProfile), { hasInputImages: round.inputImageIds.length > 0 })
    const toolCallsUsed = getAgentRecoveredToolCallCount(updatedRound.responseOutput ?? [], roundTasks)

    updateAgentConversation(conversation.id, (current) => ({
      ...current,
      updatedAt: Date.now(),
      rounds: current.rounds.map((currentRound) => currentRound.id === round.id
        ? { ...currentRound, status: 'running', error: null, finishedAt: null }
        : currentRound),
    }))

    void executeAgentRound(
      conversation.id,
      round.id,
      resumeParams,
      createSettingsForApiProfile(normalizedSettings, activeProfile),
      activeProfile,
      imageProfile,
      { responseOutput: updatedRound.responseOutput ?? [], recoveredTaskIds: recovered.recoveredTaskIds, toolCallsUsed },
    )
  } finally {
    agentRecoveryContinuations.delete(key)
  }
}

export async function submitAgentMessage() {
  const state = useStore.getState()
  const { settings, prompt, inputImages, maskDraft, params, showToast } = state
  const normalizedSettings = normalizeSettings(settings)
  const agentValidationError = getAgentProfileValidationError(normalizedSettings)
  if (agentValidationError) {
    showToast(`请先完善 Agent API 配置：${agentValidationError.message}`, 'error')
    state.setShowSettings(true, 'agent')
    return
  }
  const activeProfile = getAgentTextApiProfile(normalizedSettings)
  const imageProfile = getAgentImageApiProfile(normalizedSettings)

  const trimmedPrompt = prompt.trim()
  if (!trimmedPrompt) {
    showToast('请输入消息', 'error')
    return
  }

  const conversation = getActiveAgentConversation()
  if (conversation.rounds.some((round) => round.status === 'running')) {
    showToast('请等待生成完成，或先停止生成', 'info')
    return
  }

  let orderedInputImages = inputImages
  let maskImageId: string | null = null
  let maskTargetImageId: string | null = null

  if (maskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(inputImages, maskDraft.targetImageId)
      await validateMaskMatchesImage(maskDraft.maskDataUrl, orderedInputImages[0].dataUrl)
      maskImageId = await storeImage(maskDraft.maskDataUrl, 'mask')
      cacheImage(maskImageId, maskDraft.maskDataUrl)
      maskTargetImageId = maskDraft.targetImageId
    } catch (err) {
      if (!inputImages.some((img) => img.id === maskDraft.targetImageId)) {
        state.clearMaskDraft()
      }
      showToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
  }

  const inputImageIds = uniqueIds(orderedInputImages.map((image) => image.id))

  for (const image of orderedInputImages) {
    await storeImage(image.dataUrl)
  }

  const requestSettings = createSettingsForApiProfile(normalizedSettings, activeProfile)
  const imageRequestSettings = createSettingsForApiProfile(normalizedSettings, imageProfile)
  const now = Date.now()
  const editingRound = state.agentEditingRoundId
    ? conversation.rounds.find((item) => item.id === state.agentEditingRoundId) ?? null
    : null
  const editingRoundAssistantMessage = editingRound?.assistantMessageId
    ? conversation.messages.find((message) => message.id === editingRound.assistantMessageId) ?? null
    : conversation.messages.find((message) => message.roundId === editingRound?.id && message.role === 'assistant') ?? null
  const editingRoundHasAssistantMessage = Boolean(editingRoundAssistantMessage)
  const editingRoundHasErrorAssistantMessage = Boolean(
    editingRound?.status === 'error' && editingRoundAssistantMessage?.content.startsWith('请求失败：'),
  )
  const editingRoundHasChildren = editingRound
    ? conversation.rounds.some((round) => (round.parentRoundId ?? null) === editingRound.id)
    : false
  const shouldAppendToEditingRound = Boolean(
    editingRound && !editingRoundHasChildren && (!editingRoundHasAssistantMessage || editingRoundHasErrorAssistantMessage),
  )
  const roundId = shouldAppendToEditingRound && editingRound ? editingRound.id : genId()
  const userMessageId = shouldAppendToEditingRound && editingRound ? editingRound.userMessageId : genId()
  const activeRounds = getActiveAgentRounds(conversation)
  const activeLeafId = activeRounds[activeRounds.length - 1]?.id ?? null
  const parentRoundId = editingRound ? editingRound.parentRoundId ?? null : activeLeafId
  const parentPath = parentRoundId ? getAgentRoundPath(conversation, parentRoundId) : []
  const normalizedParams = {
    ...normalizeParamsForSettings(params, imageRequestSettings, { hasInputImages: inputImageIds.length > 0 }),
    n: DEFAULT_PARAMS.n,
  }
  const round: AgentRound = {
    id: roundId,
    index: shouldAppendToEditingRound && editingRound ? editingRound.index : parentPath.length + 1,
    parentRoundId,
    ...(editingRoundHasErrorAssistantMessage && editingRoundAssistantMessage ? { assistantMessageId: editingRoundAssistantMessage.id } : {}),
    userMessageId,
    prompt: trimmedPrompt,
    inputImageIds,
    maskTargetImageId,
    maskImageId,
    outputTaskIds: [],
    status: 'running',
    error: null,
    createdAt: now,
    finishedAt: null,
  }
  const userMessage: AgentMessage = {
    id: userMessageId,
    role: 'user',
    content: trimmedPrompt,
    roundId,
    inputImageIds,
    maskTargetImageId,
    maskImageId,
    createdAt: now,
  }

  let fallbackTitle: string | null = null
  updateAgentConversation(conversation.id, (current) => {
    const nextTitle = current.rounds.length === 0 ? createAgentConversationTitle(trimmedPrompt, current.title) : current.title
    if (current.rounds.length === 0) fallbackTitle = nextTitle
    const messages = shouldAppendToEditingRound
      ? current.messages.some((message) => message.id === userMessageId)
        ? current.messages.map((message) => {
            if (message.id === userMessageId) return userMessage
            if (editingRoundHasErrorAssistantMessage && message.id === editingRoundAssistantMessage?.id) {
              return { ...message, content: '', outputTaskIds: [] }
            }
            return message
          })
        : [...current.messages, userMessage]
      : [...current.messages, userMessage]

    return {
      ...current,
      title: nextTitle,
      activeRoundId: roundId,
      updatedAt: now,
      rounds: shouldAppendToEditingRound
        ? current.rounds.map((item) => item.id === roundId ? round : item)
        : [...current.rounds, round],
      messages,
    }
  })

  state.setPrompt('')
  state.clearInputImages()
  state.clearMaskDraft()
  state.setAgentEditingRoundId(null)

  if (fallbackTitle) {
    void generateAgentConversationTitle(conversation.id, trimmedPrompt, inputImageIds, requestSettings, activeProfile, fallbackTitle)
  }

  void executeAgentRound(conversation.id, roundId, normalizedParams, requestSettings, activeProfile, imageProfile)
}

export async function regenerateAgentAssistantMessage(conversationId: string, roundId: string) {
  const state = useStore.getState()
  const { settings, params, showToast } = state
  const normalizedSettings = normalizeSettings(settings)
  const agentValidationError = getAgentProfileValidationError(normalizedSettings)
  if (agentValidationError) {
    showToast(`请先完善 Agent API 配置：${agentValidationError.message}`, 'error')
    state.setShowSettings(true, 'agent')
    return
  }
  const activeProfile = getAgentTextApiProfile(normalizedSettings)
  const imageProfile = getAgentImageApiProfile(normalizedSettings)

  const conversation = state.agentConversations.find((item) => item.id === conversationId)
  const sourceRound = conversation?.rounds.find((item) => item.id === roundId) ?? null
  const sourceUserMessage = sourceRound
    ? conversation?.messages.find((message) => message.id === sourceRound.userMessageId) ?? null
    : null
  if (!conversation || !sourceRound || !sourceUserMessage) {
    showToast('找不到要重新生成的 Agent 消息', 'error')
    return
  }

  if (conversation.rounds.some((round) => round.status === 'running')) {
    showToast('请等待生成完成，或先停止生成', 'info')
    return
  }

  const inputImageIds = uniqueIds(sourceRound.inputImageIds)
  const requestSettings = createSettingsForApiProfile(normalizedSettings, activeProfile)
  const imageRequestSettings = createSettingsForApiProfile(normalizedSettings, imageProfile)
  const normalizedParams = {
    ...normalizeParamsForSettings(params, imageRequestSettings, { hasInputImages: inputImageIds.length > 0 }),
    n: DEFAULT_PARAMS.n,
  }
  const now = Date.now()
  if (sourceRound.status === 'error') {
    const assistantMessageId = sourceRound.assistantMessageId
      ?? conversation.messages.find((message) => message.roundId === sourceRound.id && message.role === 'assistant')?.id
    updateAgentConversation(conversationId, (current) => ({
      ...current,
      activeRoundId: sourceRound.id,
      updatedAt: now,
      rounds: current.rounds.map((round) =>
        round.id === sourceRound.id
          ? {
              ...round,
              outputTaskIds: [],
              responseId: undefined,
              responseOutput: undefined,
              status: 'running',
              error: null,
              finishedAt: null,
            }
          : round,
      ),
      messages: assistantMessageId
        ? current.messages.map((message) =>
            message.id === assistantMessageId ? { ...message, content: '', outputTaskIds: [] } : message,
          )
        : current.messages,
    }))
    state.setAgentEditingRoundId(null)
    void executeAgentRound(conversationId, sourceRound.id, normalizedParams, requestSettings, activeProfile, imageProfile)
    return
  }

  const newRoundId = genId()
  const newUserMessageId = genId()
  const newRound: AgentRound = {
    id: newRoundId,
    index: sourceRound.index,
    parentRoundId: sourceRound.parentRoundId ?? null,
    userMessageId: newUserMessageId,
    prompt: sourceRound.prompt || sourceUserMessage.content.trim(),
    inputImageIds,
    maskTargetImageId: sourceRound.maskTargetImageId ?? sourceUserMessage.maskTargetImageId ?? null,
    maskImageId: sourceRound.maskImageId ?? sourceUserMessage.maskImageId ?? null,
    outputTaskIds: [],
    status: 'running',
    error: null,
    createdAt: now,
    finishedAt: null,
  }
  const newUserMessage: AgentMessage = {
    id: newUserMessageId,
    role: 'user',
    content: sourceUserMessage.content,
    roundId: newRoundId,
    inputImageIds,
    maskTargetImageId: sourceRound.maskTargetImageId ?? sourceUserMessage.maskTargetImageId ?? null,
    maskImageId: sourceRound.maskImageId ?? sourceUserMessage.maskImageId ?? null,
    createdAt: now,
  }

  updateAgentConversation(conversationId, (current) => ({
    ...current,
    activeRoundId: newRoundId,
    updatedAt: now,
    rounds: [...current.rounds, newRound],
    messages: [...current.messages, newUserMessage],
  }))
  state.setAgentEditingRoundId(null)
  void executeAgentRound(conversationId, newRoundId, normalizedParams, requestSettings, activeProfile, imageProfile)
}

async function executeAgentRound(
  conversationId: string,
  roundId: string,
  params: TaskParams,
  requestSettings: AppSettings,
  activeProfile: ApiProfile,
  imageProfile: ApiProfile,
  resume?: { responseOutput: ResponsesOutputItem[]; recoveredTaskIds: string[]; toolCallsUsed: number },
) {
  const startedAt = Date.now()
  const imageRequestSettings = createSettingsForApiProfile(requestSettings, imageProfile)
  const controller = new AbortController()
  const controllerKey = getAgentRoundControllerKey(conversationId, roundId)
  agentRoundControllers.set(controllerKey, controller)
  try {
    const latestState = useStore.getState()
    const conversation = latestState.agentConversations.find((item) => item.id === conversationId)
    if (!conversation) return
    const round = conversation.rounds.find((item) => item.id === roundId)
    const userMessage = round ? conversation.messages.find((message) => message.id === round.userMessageId) : null
    if (!round || !userMessage) return
    void scheduleAgentRoundSummaryToLocalFS(conversationId, roundId)
    const maskDataUrl = round.maskImageId ? await ensureImageCached(round.maskImageId) : undefined
    if (round.maskImageId && !maskDataUrl) throw new Error('遮罩图片已不存在')

    const apiInput = await buildAgentApiInput(conversation, round, latestState.tasks)
    if (controller.signal.aborted) throw createAgentAbortError()
    const existingAssistantMessage = round.assistantMessageId
      ? conversation.messages.find((message) => message.id === round.assistantMessageId) ?? null
      : conversation.messages.find((message) => message.roundId === roundId && message.role === 'assistant') ?? null
    const assistantMessageId = existingAssistantMessage?.id ?? genId()
    const resumedAssistantContent = resume ? existingAssistantMessage?.content.trim() ?? '' : ''
    const shouldStreamAssistantMessage = activeProfile.streamImages === true
    const streamingTaskIds: string[] = resume ? [...round.outputTaskIds] : []
    const taskIdByToolCallId = new Map<string, string>()

    const attachTaskToAgentRound = (taskId: string) => {
      if (streamingTaskIds.includes(taskId)) return
      streamingTaskIds.push(taskId)
      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) =>
          item.id === roundId
            ? { ...item, outputTaskIds: item.outputTaskIds.includes(taskId) ? item.outputTaskIds : [...item.outputTaskIds, taskId] }
            : item,
        ),
        messages: current.messages.map((message) =>
          message.id === assistantMessageId
            ? { ...message, outputTaskIds: [...new Set([...(message.outputTaskIds ?? []), taskId])] }
            : message,
        ),
      }))
    }

    const ensureStreamingAgentTask = async (
      toolCallId: string,
      taskPrompt = '',
      inputImageIds = round.inputImageIds ?? [],
      options: { createdAt?: number; agentBatchCallId?: string; maskTargetImageId?: string | null; maskImageId?: string | null; taskParams?: TaskParams } = {},
    ) => {
      const existingTaskId = taskIdByToolCallId.get(toolCallId)
      if (existingTaskId) return existingTaskId

      const existingTask = useStore.getState().tasks.find((task) => task.agentToolCallId === toolCallId)
      if (existingTask) {
        taskIdByToolCallId.set(toolCallId, existingTask.id)
        attachTaskToAgentRound(existingTask.id)
        return existingTask.id
      }

      const createdAt = options.createdAt ?? Date.now()
      const filenameBatch = getNextTaskFilenameBatch(createdAt, null, 'image')
      const task: TaskRecord = {
        id: genId(),
        prompt: taskPrompt,
        params: options.taskParams ?? { ...params, n: 1 },
        adNegativeRuleSnapshot: createAdNegativeRuleSnapshot(requestSettings, params.adNegativeRuleId),
        apiProvider: imageProfile.provider,
        apiProfileId: imageProfile.id,
        apiProfileName: imageProfile.name,
        apiMode: imageProfile.apiMode,
        apiModel: imageProfile.model,
        inputImageIds,
        maskTargetImageId: options.maskTargetImageId !== undefined ? options.maskTargetImageId : round.maskTargetImageId ?? null,
        maskImageId: options.maskImageId !== undefined ? options.maskImageId : round.maskImageId ?? null,
        outputImages: [],
        filenameBatch,
        status: 'running',
        error: null,
        createdAt,
        finishedAt: null,
        elapsed: null,
        sourceMode: 'agent',
        localSaveBatchFolder: getTaskLocalSaveBatchFolder(createdAt, filenameBatch),
        agentConversationId: conversationId,
        agentRoundId: roundId,
        agentMessageId: assistantMessageId,
        agentToolCallId: toolCallId,
        ...(options.agentBatchCallId ? { agentBatchCallId: options.agentBatchCallId } : {}),
      }

      taskIdByToolCallId.set(toolCallId, task.id)
      useStore.getState().setTasks([task, ...useStore.getState().tasks])
      attachTaskToAgentRound(task.id)
      await putTask(task)
      void scheduleAgentRoundSummaryToLocalFS(conversationId, roundId)
      return task.id
    }

    const completeAgentImageTask = async (image: AgentApiResultImage, rawResponsePayload?: string) => {
      const toolCallId = image.toolCallId ?? genId()
      const taskId = await ensureStreamingAgentTask(toolCallId)
      const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
      if (latestTask?.status === 'done' && (latestTask.outputImages?.length ?? 0) > 0) return taskId

      const stored = await processAndStoreGeneratedImage(image.dataUrl, params, image.actualParams)
      const imgId = stored.id
      const actualParams: Partial<TaskParams> = {
        ...(Object.keys(stored.actualParams ?? {}).length ? stored.actualParams : {}),
        n: 1,
      }
      updateTaskInStore(taskId, {
        prompt: image.revisedPrompt ?? latestTask?.prompt ?? '',
        outputImages: [imgId],
        actualParams,
        actualParamsByImage: { [imgId]: actualParams },
        revisedPromptByImage: image.revisedPrompt ? { [imgId]: image.revisedPrompt } : undefined,
        rawResponsePayload,
        status: 'done',
        error: null,
        finishedAt: Date.now(),
        elapsed: Date.now() - (latestTask?.createdAt ?? startedAt),
        agentToolAction: image.action,
      })
      useStore.getState().setTaskStreamPreview(taskId)
      void saveTaskToLocalFS(taskId).then(() => scheduleAgentRoundSummaryToLocalFS(conversationId, roundId))
      return taskId
    }

    const failAgentImageTask = (toolCallId: string, error: string, rawResponsePayload?: string) => {
      const taskId = taskIdByToolCallId.get(toolCallId)
      if (!taskId) return
      const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
      if (!latestTask || latestTask.status !== 'running') return

      useStore.getState().setTaskStreamPreview(taskId)
      updateTaskInStore(taskId, {
        status: 'error',
        error,
        rawResponsePayload,
        falRecoverable: false,
        customRecoverable: false,
        finishedAt: Date.now(),
        elapsed: Date.now() - latestTask.createdAt,
      })
      void saveTaskToLocalFS(taskId).then(() => scheduleAgentRoundSummaryToLocalFS(conversationId, roundId))
    }

    const pauseAgentImageTaskForRecovery = (toolCallId: string, error: unknown) => {
      const taskId = taskIdByToolCallId.get(toolCallId)
      if (!taskId || !isFalConnectionRecoverableError(error)) return false
      const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
      if (!latestTask || latestTask.status !== 'running') return false

      if (latestTask.apiProvider === 'fal' && latestTask.falRequestId && latestTask.falEndpoint) {
        useStore.getState().setTaskStreamPreview(taskId)
        updateTaskInStore(taskId, {
          status: 'error',
          error: '与 fal.ai 的连接已断开，之后会继续查询任务结果。',
          falRecoverable: true,
          finishedAt: Date.now(),
          elapsed: Date.now() - latestTask.createdAt,
        })
        scheduleFalRecovery(taskId)
        return true
      }

      if (latestTask.customTaskId) {
        useStore.getState().setTaskStreamPreview(taskId)
        updateTaskInStore(taskId, {
          status: 'error',
          error: '与自定义异步任务的连接已断开，之后会继续查询任务结果。',
          customRecoverable: true,
          finishedAt: Date.now(),
          elapsed: Date.now() - latestTask.createdAt,
        })
        scheduleCustomRecovery(taskId)
        return true
      }

      return false
    }

    if (shouldStreamAssistantMessage) {
      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) =>
          item.id === roundId ? { ...item, assistantMessageId } : item,
        ),
        messages: current.messages.some((message) => message.id === assistantMessageId)
          ? current.messages.map((message) => message.id === assistantMessageId
            ? resume
              ? { ...message, outputTaskIds: [...new Set([...(message.outputTaskIds ?? []), ...round.outputTaskIds])] }
              : { ...message, content: '', outputTaskIds: [] }
            : message)
          : [
              ...current.messages,
              {
                id: assistantMessageId,
                role: 'assistant',
                content: '',
                roundId,
                createdAt: Date.now(),
              },
            ],
      }))
    }
    const maxToolCalls = Number.isFinite(requestSettings.agentMaxToolRounds)
      ? Math.max(1, Math.trunc(requestSettings.agentMaxToolRounds))
      : DEFAULT_AGENT_MAX_TOOL_ROUNDS
    let accumulatedOutputItems: ResponsesOutputItem[] = resume?.responseOutput ?? []
    let accumulatedText = resumedAssistantContent
    const textSegments: string[] = resumedAssistantContent ? [resumedAssistantContent] : []
    let lastResponseId: string | undefined = round.responseId
    let toolCallsUsed = resume?.toolCallsUsed ?? 0
    let apiInputForTurn = apiInput
    if (resume) {
      apiInputForTurn = buildAgentContinuationInput(apiInput, round, useStore.getState().tasks, accumulatedOutputItems, toolCallsUsed, maxToolCalls)
      const recoveredImagesItem = await createAgentBatchImagesInputItem(round, useStore.getState().tasks, resume.recoveredTaskIds)
      if (recoveredImagesItem) apiInputForTurn.splice(apiInputForTurn.length - 1, 0, recoveredImagesItem)
    }
    let reachedToolLimit = resume ? toolCallsUsed >= maxToolCalls : false
    let pendingToolTextSeparator = false

    // Helper: resolve reference image ids to data URLs for batch image calls
    const resolveReferenceImages = async (referenceIds: string[]): Promise<{ dataUrls: string[]; imageIds: string[] }> => {
      const dataUrls: string[] = []
      const imageIds: string[] = []
      for (const refId of referenceIds) {
        // Resolve both generated image refs and current/user input refs from XML tags.
        const latestConv = useStore.getState().agentConversations.find((item) => item.id === conversationId)
        if (!latestConv) continue
        for (const r of getAgentRoundPath(latestConv, roundId)) {
          for (let imgIdx = 0; imgIdx < r.inputImageIds.length; imgIdx++) {
            const currentRefId = getAgentCurrentReferenceId(r, imgIdx)
            if (currentRefId === refId) {
              const imageId = r.inputImageIds[imgIdx]
              const dataUrl = await ensureImageCached(imageId)
              if (dataUrl) dataUrls.push(dataUrl)
              imageIds.push(imageId)
            }
          }
          const outputImages = collectAgentRoundOutputImageSlots(r, useStore.getState().tasks)
          for (let imgIdx = 0; imgIdx < outputImages.length; imgIdx++) {
            const generatedRefId = getAgentGeneratedImageReferenceId(r, imgIdx)
            if (generatedRefId === refId) {
              const imageId = outputImages[imgIdx]
              if (!imageId) continue
              const dataUrl = await ensureImageCached(imageId)
              if (dataUrl) dataUrls.push(dataUrl)
              imageIds.push(imageId)
            }
          }
        }
      }
      return { dataUrls, imageIds }
    }

    const parseSingleImageCallArguments = (args: string): { id: string; prompt: string } | null => {
      try {
        const parsed = JSON.parse(args) as Record<string, unknown>
        const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : ''
        if (!prompt) return null
        const id = typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id.trim() : 'image'
        return { id, prompt }
      } catch {
        return null
      }
    }

    const callHybridImageApiSingle = async (opts: {
      taskId: string
      prompt: string
      referenceImageDataUrls: string[]
      taskParams: TaskParams
      signal: AbortSignal
      onPartialImage?: (event: { image: string; partialImageIndex?: number }) => void
    }) => {
      let requestProgressed = false
      const result = await retryTransientRequest(() => callImageApi({
        settings: imageRequestSettings,
        prompt: replaceImageMentionsForApi(opts.prompt, opts.referenceImageDataUrls.length),
        params: opts.taskParams,
        inputImageDataUrls: opts.referenceImageDataUrls,
        onPartialImage: opts.onPartialImage
          ? (partial) => {
              requestProgressed = true
              opts.onPartialImage?.({ image: partial.image, partialImageIndex: partial.partialImageIndex ?? partial.requestIndex })
            }
          : undefined,
        onFalRequestEnqueued: (request) => {
          requestProgressed = true
          return updateTaskInStore(opts.taskId, {
            falRequestId: request.requestId,
            falEndpoint: request.endpoint,
            falRecoverable: false,
          })
        },
        onCustomTaskEnqueued: (request) => {
          requestProgressed = true
          return updateTaskInStore(opts.taskId, {
            customTaskId: request.taskId,
            customRecoverable: false,
          })
        },
      }), {
        maxRetries: normalizeMaxRetries(imageProfile.maxRetries),
        signal: opts.signal,
        shouldRetry: (error) => !requestProgressed && isRetryableError(error),
      })
      if (opts.signal.aborted) throw createAgentAbortError()
      const dataUrl = result.images[0]
      return {
        image: dataUrl ? {
          dataUrl,
          actualParams: result.actualParamsList?.[0] ?? result.actualParams,
          revisedPrompt: result.revisedPrompts?.[0] ?? opts.prompt,
        } satisfies AgentApiResultImage : null,
        error: dataUrl ? null : '接口未返回图片数据',
        rawResponsePayload: JSON.stringify({
          imageCount: result.images.length,
          actualParams: result.actualParams,
          actualParamsList: result.actualParamsList,
          revisedPrompts: result.revisedPrompts,
          rawImageUrls: result.rawImageUrls,
        }, null, 2),
      }
    }

    const executeSingleImageFunctionCall = async (functionCallItem: ResponsesOutputItem): Promise<string> => {
      const item = parseSingleImageCallArguments(functionCallItem.arguments ?? '')
      if (!item) return JSON.stringify({ error: 'Invalid or empty image arguments' })
      const referenceIds = uniqueIds(extractAgentReferenceIds(item.prompt))
      const references = await resolveReferenceImages(referenceIds)
      const toolCallId = functionCallItem.call_id || genId()
      const taskParams = {
        ...normalizeParamsForSettings(params, imageRequestSettings, { hasInputImages: references.dataUrls.length > 0 }),
        n: 1,
      }
      const taskId = await ensureStreamingAgentTask(toolCallId, item.prompt, references.imageIds, {
        createdAt: Date.now(),
        taskParams,
        maskTargetImageId: null,
        maskImageId: null,
      })

      try {
        const result = await callHybridImageApiSingle({
          taskId,
          prompt: appendAdNegativeRule(item.prompt, getAdNegativeRule(requestSettings, params.adNegativeRuleId).content),
          referenceImageDataUrls: references.dataUrls,
          taskParams,
          signal: controller.signal,
          onPartialImage: ({ image, partialImageIndex }) => {
            const taskId = taskIdByToolCallId.get(toolCallId)
            if (taskId) useStore.getState().setTaskStreamPreview(taskId, image, partialImageIndex)
          },
        })
        if (controller.signal.aborted) throw createAgentAbortError()
        if (result.image) {
          await completeAgentImageTask({ ...result.image, toolCallId }, result.rawResponsePayload)
          toolCallsUsed += 1
          return JSON.stringify({ id: item.id, status: 'done' })
        }
        failAgentImageTask(toolCallId, result.error ?? '图像生成失败', result.rawResponsePayload)
        return JSON.stringify({ id: item.id, status: 'error', error: result.error })
      } catch (error) {
        if (controller.signal.aborted) throw createAgentAbortError()
        if (pauseAgentImageTaskForRecovery(toolCallId, error)) throw createAgentRecoveryPauseError()
        const message = error instanceof Error ? error.message : String(error)
        failAgentImageTask(toolCallId, message)
        return JSON.stringify({ id: item.id, status: 'error', error: message })
      }
    }

    // Helper: execute a generate_image_batch function call concurrently
    const executeBatchFunctionCall = async (functionCallItem: ResponsesOutputItem): Promise<{
      output: string
      finalizeAfterBatch: boolean
      totalCount: number
      successCount: number
      failureCount: number
    }> => {
      const callId = functionCallItem.call_id ?? ''
      const args = functionCallItem.arguments ?? ''
      const batchPlan = parseBatchImageCallArguments(args)

      if (!batchPlan) {
        return {
          output: JSON.stringify({ error: 'Invalid batch arguments: requested_count must match a non-empty images array with unique ids and prompts' }),
          finalizeAfterBatch: false,
          totalCount: 0,
          successCount: 0,
          failureCount: 0,
        }
      }
      const batchItems = batchPlan.images.map((item) => ({
        ...item,
        prompt: [batchPlan.sharedPrompt, item.prompt].filter(Boolean).join('\n\n'),
      }))

      // Create task cards in model-provided order before starting network calls.
      const batchExecutionItems = []
      for (const item of batchItems) {
        const referenceIds = uniqueIds(extractAgentReferenceIds(item.prompt))
        const references = await resolveReferenceImages(referenceIds)
        const batchToolCallId = genId()
        const taskParams = requestSettings.agentApiConfigMode === 'hybrid'
          ? { ...normalizeParamsForSettings(params, imageRequestSettings, { hasInputImages: references.dataUrls.length > 0 }), n: 1 }
          : { ...params, n: 1 }
        await ensureStreamingAgentTask(batchToolCallId, item.prompt, references.imageIds, {
          createdAt: Date.now(),
          taskParams,
          maskTargetImageId: null,
          maskImageId: null,
          ...(callId ? { agentBatchCallId: callId } : {}),
        })
        batchExecutionItems.push({ item, batchToolCallId, references, referenceIds, taskParams })
      }

      // Fire all batch items concurrently after all cards are visible.
      const batchResults = await runWithConcurrencyAndRetry(
        batchExecutionItems,
        imageProfile.maxConcurrent ?? 1,
        requestSettings.agentApiConfigMode === 'hybrid' ? 0 : imageProfile.maxRetries ?? 0,
        async ({ item, batchToolCallId, references, referenceIds, taskParams }) => {
          const prompt = appendAdNegativeRule(item.prompt, getAdNegativeRule(requestSettings, params.adNegativeRuleId).content)
          const batchResult = requestSettings.agentApiConfigMode === 'hybrid'
            ? {
                batchItemId: item.id,
                ...(await callHybridImageApiSingle({
                  taskId: taskIdByToolCallId.get(batchToolCallId)!,
                  prompt,
                  referenceImageDataUrls: references.dataUrls,
                  taskParams,
                  signal: controller.signal,
                  onPartialImage: ({ image, partialImageIndex }) => {
                    const taskId = taskIdByToolCallId.get(batchToolCallId)
                    if (taskId) useStore.getState().setTaskStreamPreview(taskId, image, partialImageIndex)
                  },
                })),
              }
            : await callBatchImageSingle({
            profile: imageProfile,
            params: taskParams,
            batchItemId: item.id,
            prompt,
            referenceImageDataUrls: references.dataUrls,
            referenceIds,
            allowPromptRewrite: requestSettings.allowPromptRewrite,
            signal: controller.signal,
            onImageToolStarted: shouldStreamAssistantMessage
              ? async () => {
                  if (controller.signal.aborted) return
                }
              : undefined,
            onPartialImage: shouldStreamAssistantMessage
              ? async ({ image, partialImageIndex }) => {
                  if (controller.signal.aborted) return
                  const taskId = taskIdByToolCallId.get(batchToolCallId)
                  if (taskId) {
                    useStore.getState().setTaskStreamPreview(taskId, image, partialImageIndex)
                    if (partialImageIndex === 0 || partialImageIndex == null) {
                      void persistTaskStreamPartialImage(taskId, image)
                    }
                  }
                }
              : undefined,
            onImageToolCompleted: shouldStreamAssistantMessage
              ? async (image) => {
                  if (controller.signal.aborted) return
                  await completeAgentImageTask({ ...image, toolCallId: batchToolCallId })
                }
              : undefined,
          })

          if (batchResult.error) {
            throw new Error(batchResult.error)
          }

          if (batchResult.image) {
            await completeAgentImageTask({ ...batchResult.image, toolCallId: batchToolCallId }, batchResult.rawResponsePayload)
          }

          return batchResult
        }
      )

      let pausedForRecovery = false
      for (let i = 0; i < batchResults.length; i++) {
        const settled = batchResults[i]
        const { batchToolCallId } = batchExecutionItems[i]
        const taskId = taskIdByToolCallId.get(batchToolCallId)
        if (!taskId) continue

        if (settled.status === 'rejected' && (isAgentRecoveryPauseError(settled.reason) || pauseAgentImageTaskForRecovery(batchToolCallId, settled.reason))) {
          pausedForRecovery = true
          continue
        }
        
        let errorMsg: string | undefined
        let rawPayload: string | undefined
        
        if (settled.status === 'fulfilled') {
          const r = settled.value
          if (!r.image && r.error) {
            errorMsg = r.error
            rawPayload = r.rawResponsePayload
          }
        } else {
          errorMsg = settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
        }

        if (errorMsg) {
          const latestTask = useStore.getState().tasks.find((t) => t.id === taskId)
          if (latestTask && latestTask.status === 'running') {
            updateTaskInStore(taskId, {
              status: 'error',
              error: errorMsg,
              rawResponsePayload: rawPayload,
              finishedAt: Date.now(),
              elapsed: Date.now() - (latestTask.createdAt ?? startedAt),
            })
            useStore.getState().setTaskStreamPreview(taskId)
            void saveTaskToLocalFS(taskId).then(() => scheduleAgentRoundSummaryToLocalFS(conversationId, roundId))
          }
        }
      }

      if (pausedForRecovery) throw createAgentRecoveryPauseError()

      // Build function_call_output
      const outputImages: Array<{ id: string; status: string; error?: string }> = []
      for (let i = 0; i < batchItems.length; i++) {
        const settled = batchResults[i]
        const batchItem = batchItems[i]
        if (settled.status === 'fulfilled') {
          const r = settled.value
          outputImages.push({
            id: r.batchItemId,
            status: r.image ? 'done' : 'error',
            ...(r.error ? { error: r.error } : {}),
          })
        } else {
          outputImages.push({
            id: batchItem.id,
            status: 'error',
            error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
          })
        }
      }

      const successCount = outputImages.filter((img) => img.status === 'done').length
      toolCallsUsed += successCount

      return {
        output: JSON.stringify({ images: outputImages }),
        finalizeAfterBatch: batchPlan.finalizeAfterBatch,
        totalCount: outputImages.length,
        successCount,
        failureCount: outputImages.length - successCount,
      }
    }

    while (true) {
      if (controller.signal.aborted) throw createAgentAbortError()
      const textBeforeResponse = accumulatedText
      let currentResponseOutputItems: ResponsesOutputItem[] = []
      let agentAttemptProgressed = false
      const result = await retryTransientRequest(() => {
        agentAttemptProgressed = false
        const callAgent = requestSettings.agentTextProtocol === 'chat-completions'
          ? callAgentChatCompletionsApi
          : callAgentResponsesApi
        return callAgent({
          settings: requestSettings,
          profile: activeProfile,
          params,
          input: apiInputForTurn,
          maskDataUrl,
          signal: controller.signal,
          onTextDelta: shouldStreamAssistantMessage
          ? (delta) => {
              if (controller.signal.aborted) return
              agentAttemptProgressed = true
              if (pendingToolTextSeparator && delta && accumulatedText.trim()) {
                accumulatedText += '\n\n'
                appendAgentAssistantMessageContent(conversationId, assistantMessageId, '\n\n')
              }
              pendingToolTextSeparator = false
              accumulatedText += delta
              appendAgentAssistantMessageContent(conversationId, assistantMessageId, delta)
            }
          : undefined,
          onOutputItems: shouldStreamAssistantMessage
          ? (outputItems) => {
              if (controller.signal.aborted) return
              agentAttemptProgressed = true
              currentResponseOutputItems = outputItems
              // Debounce output items updates to avoid excessive store updates
              const existingTimer = agentTextFlushTimers.get(getAgentTextFlushKey(conversationId, roundId + ':outputItems'))
              if (existingTimer) clearTimeout(existingTimer)
              agentTextFlushTimers.set(
                getAgentTextFlushKey(conversationId, roundId + ':outputItems'),
                setTimeout(() => {
                  updateAgentConversation(conversationId, (current) => ({
                    ...current,
                    rounds: current.rounds.map((item) => item.id === roundId ? { ...item, responseOutput: mergeResponseOutputItems(accumulatedOutputItems, outputItems) } : item),
                  }))
                }, 120),
              )
            }
          : undefined,
          onImageToolStarted: shouldStreamAssistantMessage
          ? async ({ toolCallId }) => {
              if (controller.signal.aborted) return
              agentAttemptProgressed = true
              await ensureStreamingAgentTask(toolCallId)
            }
          : undefined,
          onImagePartialImage: shouldStreamAssistantMessage
          ? async ({ toolCallId, image, partialImageIndex }) => {
              if (controller.signal.aborted) return
              agentAttemptProgressed = true
              const taskId = await ensureStreamingAgentTask(toolCallId)
              if (controller.signal.aborted) return
              useStore.getState().setTaskStreamPreview(taskId, image, partialImageIndex)
              if (partialImageIndex === 0 || partialImageIndex == null) {
                void persistTaskStreamPartialImage(taskId, image)
              }
            }
          : undefined,
          onImageToolCompleted: shouldStreamAssistantMessage
          ? async (image) => {
              if (controller.signal.aborted) return
              agentAttemptProgressed = true
              await completeAgentImageTask(image)
            }
          : undefined,
          onImageToolFailed: shouldStreamAssistantMessage
          ? async ({ toolCallId, error }) => {
              if (controller.signal.aborted) return
              agentAttemptProgressed = true
              await ensureStreamingAgentTask(toolCallId)
              if (controller.signal.aborted) return
              failAgentImageTask(toolCallId, error)
            }
          : undefined,
        })
      }, {
        maxRetries: normalizeMaxRetries(activeProfile.maxRetries),
        signal: controller.signal,
        shouldRetry: (error) => !agentAttemptProgressed && isRetryableError(error),
      })
      if (controller.signal.aborted) throw createAgentAbortError()

      lastResponseId = result.responseId ?? lastResponseId
      currentResponseOutputItems = currentResponseOutputItems.length ? currentResponseOutputItems : result.outputItems ?? []
      accumulatedOutputItems = mergeResponseOutputItems(accumulatedOutputItems, currentResponseOutputItems)
      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) => item.id === roundId
          ? { ...item, responseId: lastResponseId, responseOutput: accumulatedOutputItems }
          : item),
      }))

      // Force flush any pending text delta before processing the response
      flushAgentAssistantMessageContent(conversationId, assistantMessageId)
      const outputItemsKey = getAgentTextFlushKey(conversationId, roundId + ':outputItems')
      const outputItemsTimer = agentTextFlushTimers.get(outputItemsKey)
      if (outputItemsTimer) {
        clearTimeout(outputItemsTimer)
        agentTextFlushTimers.delete(outputItemsKey)
      }

      const responseText = result.text.trim()
      if (responseText && accumulatedText === textBeforeResponse) {
        const textToAppend = accumulatedText ? `\n\n${responseText}` : responseText
        accumulatedText += textToAppend
        if (shouldStreamAssistantMessage) appendAgentAssistantMessageContent(conversationId, assistantMessageId, textToAppend)
      }
      const newTextInThisResponse = accumulatedText.slice(textBeforeResponse.length).trim()
      if (newTextInThisResponse) textSegments.push(newTextInThisResponse)

      // Process built-in image_generation_call results (single images)
      for (const image of result.images) {
        if (image.toolCallId && taskIdByToolCallId.has(image.toolCallId)) {
          const completedTaskId = await completeAgentImageTask(image, result.rawResponsePayload)
          const promptRefIds = uniqueIds(extractAgentReferenceIds(image.revisedPrompt ?? ''))
          if (promptRefIds.length > 0) {
            const promptRefs = await resolveReferenceImages(promptRefIds)
            if (promptRefs.imageIds.length > 0) {
              const latestTask = useStore.getState().tasks.find((t) => t.id === completedTaskId)
              if (latestTask) {
                const mergedInputIds = uniqueIds([...latestTask.inputImageIds, ...promptRefs.imageIds])
                if (mergedInputIds.length !== latestTask.inputImageIds.length) {
                  updateTaskInStore(completedTaskId, { inputImageIds: mergedInputIds })
                }
              }
            }
          }
          continue
        }
        const promptRefIds = uniqueIds(extractAgentReferenceIds(image.revisedPrompt ?? ''))
        const promptRefs = await resolveReferenceImages(promptRefIds)
        const stored = await processAndStoreGeneratedImage(image.dataUrl, params, image.actualParams)
        const imgId = stored.id
        const actualParams: Partial<TaskParams> = {
          ...(Object.keys(stored.actualParams ?? {}).length ? stored.actualParams : {}),
          n: 1,
        }
        const filenameBatch = getNextTaskFilenameBatch(startedAt, null, 'image')
        const task: TaskRecord = {
          id: genId(),
          prompt: image.revisedPrompt ?? round?.prompt ?? userMessage.content,
          params,
          apiProvider: imageProfile.provider,
          apiProfileId: imageProfile.id,
          apiProfileName: imageProfile.name,
          apiMode: imageProfile.apiMode,
          apiModel: imageProfile.model,
          inputImageIds: uniqueIds([...(round?.inputImageIds ?? []), ...promptRefs.imageIds]),
          maskTargetImageId: round?.maskTargetImageId ?? null,
          maskImageId: round?.maskImageId ?? null,
          outputImages: [imgId],
          filenameBatch,
          actualParams,
          actualParamsByImage: { [imgId]: actualParams },
          revisedPromptByImage: image.revisedPrompt ? { [imgId]: image.revisedPrompt } : undefined,
          rawResponsePayload: result.rawResponsePayload,
          status: 'done',
          error: null,
          createdAt: startedAt,
          finishedAt: Date.now(),
          elapsed: Date.now() - startedAt,
          sourceMode: 'agent',
          localSaveBatchFolder: getTaskLocalSaveBatchFolder(startedAt, filenameBatch),
          agentConversationId: conversationId,
          agentRoundId: roundId,
          agentMessageId: assistantMessageId,
          agentToolCallId: image.toolCallId,
          agentToolAction: image.action,
        }
        useStore.getState().setTasks([task, ...useStore.getState().tasks])
        attachTaskToAgentRound(task.id)
        await putTask(task)
        void saveTaskToLocalFS(task.id).then(() => scheduleAgentRoundSummaryToLocalFS(conversationId, roundId))
      }

      if (result.rawResponsePayload && streamingTaskIds.length > 0) {
        for (const taskId of streamingTaskIds) {
          const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
          if (latestTask && !latestTask.rawResponsePayload) updateTaskInStore(taskId, { rawResponsePayload: result.rawResponsePayload })
        }
      }

      for (const taskId of streamingTaskIds) {
        const latestTask = useStore.getState().tasks.find((t) => t.id === taskId)
        if (latestTask && latestTask.status === 'running') {
          updateTaskInStore(taskId, {
            status: 'error',
            error: '接口未返回图片数据',
            finishedAt: Date.now(),
            elapsed: Date.now() - (latestTask.createdAt ?? startedAt),
          })
          useStore.getState().setTaskStreamPreview(taskId)
          void saveTaskToLocalFS(taskId).then(() => scheduleAgentRoundSummaryToLocalFS(conversationId, roundId))
        }
      }

      // Check for function calls that require continuation
      const singleImageFunctionCalls = currentResponseOutputItems.filter(
        (item) => item.type === 'function_call' && item.name === 'generate_image',
      )
      const batchFunctionCalls = currentResponseOutputItems.filter(
        (item) => item.type === 'function_call' && item.name === 'generate_image_batch',
      )
      const continueFunctionCalls = currentResponseOutputItems.filter(
        (item) => item.type === 'function_call' && item.name === 'continue_generation',
      )

      // Count built-in tool calls (image_generation, web_search) for budget tracking
      const responseToolCalls = countResponseToolCalls(currentResponseOutputItems)
      toolCallsUsed += responseToolCalls

      // Collect function_call_output items for all function calls that need responses
      const functionCallOutputs: ResponsesOutputItem[] = []

      const singleImageResults = await runWithConcurrencyAndRetry(
        singleImageFunctionCalls,
        imageProfile.maxConcurrent ?? 1,
        0,
        executeSingleImageFunctionCall,
      )
      for (let index = 0; index < singleImageFunctionCalls.length; index++) {
        const fc = singleImageFunctionCalls[index]
        const result = singleImageResults[index]
        if (result.status === 'rejected') throw result.reason
        functionCallOutputs.push({
          type: 'function_call_output',
          call_id: fc.call_id,
          output: result.value,
        })
      }

      const batchExecutionResults = []
      if (batchFunctionCalls.length > 0) {
        for (const fc of batchFunctionCalls) {
          const batchExecution = await executeBatchFunctionCall(fc)
          batchExecutionResults.push(batchExecution)
          functionCallOutputs.push({
            type: 'function_call_output',
            call_id: fc.call_id,
            output: batchExecution.output,
          })
        }
      }

      for (const fc of continueFunctionCalls) {
        functionCallOutputs.push({
          type: 'function_call_output',
          call_id: fc.call_id,
          output: JSON.stringify({ status: 'continued' }),
        })
      }

      // If no function calls need output → model decided the task is done → break
      if (functionCallOutputs.length === 0) {
        updateAgentConversation(conversationId, (current) => ({
          ...current,
          updatedAt: Date.now(),
          rounds: current.rounds.map((item) => item.id === roundId ? { ...item, responseId: lastResponseId, responseOutput: accumulatedOutputItems } : item),
        }))
        break
      }

      const accumulatedOutputItemsWithFunctionOutputs = mergeResponseOutputItems(accumulatedOutputItems, functionCallOutputs)

      updateAgentConversation(conversationId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rounds: current.rounds.map((item) => item.id === roundId ? { ...item, responseId: lastResponseId, responseOutput: accumulatedOutputItemsWithFunctionOutputs } : item),
      }))

      const terminalBatch = batchExecutionResults.length === 1
        && batchFunctionCalls.length === 1
        && singleImageFunctionCalls.length === 0
        && continueFunctionCalls.length === 0
        && result.images.length === 0
        && batchExecutionResults[0].finalizeAfterBatch
        ? batchExecutionResults[0]
        : null
      if (terminalBatch) {
        const summary = terminalBatch.failureCount === 0
          ? `批量生成完成，共 ${terminalBatch.successCount} 张图片。`
          : `批量生成完成：${terminalBatch.successCount} 张成功，${terminalBatch.failureCount} 张失败。`
        const textToAppend = accumulatedText ? `\n\n${summary}` : summary
        accumulatedText += textToAppend
        textSegments.push(summary)
        if (shouldStreamAssistantMessage) appendAgentAssistantMessageContent(conversationId, assistantMessageId, textToAppend)
        accumulatedOutputItems = accumulatedOutputItemsWithFunctionOutputs
        break
      }

      if (toolCallsUsed >= maxToolCalls) {
        reachedToolLimit = true
        break
      }

      // Build continuation input with function call outputs and available refs
      const latestConversation = useStore.getState().agentConversations.find((item) => item.id === conversationId)
      const latestRound = latestConversation?.rounds.find((item) => item.id === roundId)
      if (!latestRound) break

      const continuationBase = buildAgentContinuationInput(
        apiInput,
        latestRound,
        useStore.getState().tasks,
        accumulatedOutputItems,
        toolCallsUsed,
        maxToolCalls,
      )
      // Insert function_call_output items before the continuation system message
      continuationBase.splice(continuationBase.length - 1, 0, ...functionCallOutputs)
      // Inject batch-generated images as input_image user message for model visibility
      const batchImagesItem = await createAgentBatchImagesInputItem(latestRound, useStore.getState().tasks, streamingTaskIds)
      if (batchImagesItem) continuationBase.splice(continuationBase.length - 1, 0, batchImagesItem)
      apiInputForTurn = continuationBase
      accumulatedOutputItems = accumulatedOutputItemsWithFunctionOutputs
      pendingToolTextSeparator = true
    }

    const taskIds: string[] = [...streamingTaskIds]
    const outputIds = taskIds.flatMap((taskId) => useStore.getState().tasks.find((task) => task.id === taskId)?.outputImages ?? [])
    const limitNotice = reachedToolLimit ? `已达到最大工具调用次数（${maxToolCalls}），已停止自动续跑。` : ''
    const joinedText = textSegments.join('\n\n').trim()
    const finalContent = [joinedText, limitNotice]
      .filter(Boolean)
      .join(joinedText ? '\n\n' : '')
      || (taskIds.length > 0 || outputIds.length > 0 ? '图像已生成。' : '')

    const assistantMessage: AgentMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: finalContent,
      roundId,
      outputTaskIds: taskIds,
      createdAt: Date.now(),
    }

    updateAgentConversation(conversationId, (current) => ({
      ...current,
      updatedAt: Date.now(),
      rounds: current.rounds.map((round) =>
        round.id === roundId
          ? {
              ...round,
              assistantMessageId,
              outputTaskIds: taskIds,
              responseId: lastResponseId,
              responseOutput: accumulatedOutputItems,
              status: 'done',
              error: null,
              finishedAt: Date.now(),
            }
          : round,
      ),
      messages: current.messages.some((message) => message.id === assistantMessageId)
        ? current.messages.map((message) => message.id === assistantMessageId ? assistantMessage : message)
        : [...current.messages, assistantMessage],
    }))

    useStore.getState().showToast(outputIds.length > 0 ? 'Agent 已生成图片' : 'Agent 已回复', 'success')
    showTaskCompletionNotification(
      outputIds.length > 0 ? 'Agent 已生成图片' : 'Agent 已回复',
      outputIds.length > 0 ? `Agent 回复已结束，共生成 ${outputIds.length} 张图片。` : 'Agent 回复已结束。',
    )
    void saveAgentConversationToLocalFS(conversationId)
  } catch (err) {
    if (controller.signal.aborted) {
      if (markAgentRoundStopped(conversationId, roundId)) {
        useStore.getState().showToast('已停止生成', 'info')
      }
      return
    }

    if (isAgentRecoveryPauseError(err)) return

    let message = err instanceof Error ? err.message : String(err)
    const usesApiProxy = activeProfile.apiProxy ?? requestSettings.apiProxy
    const networkErrorHint = getApiRequestNetworkErrorHint(err, startedAt, usesApiProxy, activeProfile)
    if (networkErrorHint && !message.includes(IMAGE_FETCH_CORS_HINT)) {
      message += `\n${networkErrorHint}`
    }
    const streamingHint = getStreamingErrorHint(err, activeProfile)
    if (streamingHint && !message.includes(streamingHint)) {
      message += streamingHint
    }

    updateAgentConversation(conversationId, (current) => {
      const failedRound = current.rounds.find((round) => round.id === roundId)
      const existingAssistantMessage = failedRound?.assistantMessageId
        ? current.messages.find((item) => item.id === failedRound.assistantMessageId)
        : current.messages.find((item) => item.roundId === roundId && item.role === 'assistant')
      const errorContent = `请求失败：${message}`

      return {
        ...current,
        title: current.rounds.length === 1 && current.rounds[0].id === roundId ? '新对话' : current.title,
        updatedAt: Date.now(),
        rounds: current.rounds.map((round) =>
          round.id === roundId
            ? {
                ...round,
                ...(existingAssistantMessage ? { assistantMessageId: existingAssistantMessage.id } : {}),
                status: 'error',
                error: message,
                finishedAt: Date.now(),
              }
            : round,
        ),
        messages: existingAssistantMessage
          ? current.messages.map((item) => item.id === existingAssistantMessage.id ? { ...item, content: errorContent } : item)
          : [
              ...current.messages,
              {
                id: genId(),
                role: 'assistant',
                content: errorContent,
                roundId,
                createdAt: Date.now(),
              },
            ],
      }
    })
    useStore.getState().showToast(`Agent 请求失败：${message}`, 'error')
  } finally {
    void scheduleAgentRoundSummaryToLocalFS(conversationId, roundId)
    if (agentRoundControllers.get(controllerKey) === controller) {
      agentRoundControllers.delete(controllerKey)
    }
  }
}

async function executeTask(taskId: string) {
  const { settings } = useStore.getState()
  const task = useStore.getState().tasks.find((t) => t.id === taskId)
  if (!task) return
  const taskParams = task.params
  const taskProfile = getTaskApiProfile(settings, task)
  if (!taskProfile && task.apiProfileId) {
    updateTaskInStore(taskId, {
      status: 'error',
      error: '找不到此任务所使用的 API 配置。',
      progressStage: 'failed',
      progressUpdatedAt: Date.now(),
      falRecoverable: false,
      customRecoverable: false,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
    return
  }
  const activeProfile = taskProfile ?? getActiveApiProfile(settings)
  const requestSettings = createSettingsForApiProfile(settings, activeProfile)
  const taskProvider = task.apiProvider ?? activeProfile.provider
  updateTaskProgress(taskId, 'requesting')
  let falRequestInfo: { requestId: string; endpoint: string } | null = task.falRequestId && task.falEndpoint
        ? { requestId: task.falRequestId, endpoint: task.falEndpoint }
    : null
  let customTaskInfo: { taskId: string } | null = task.customTaskId
    ? { taskId: task.customTaskId }
    : null

  if (taskProvider !== 'fal' && !isAsyncCustomProviderTask(requestSettings, taskProvider, task.inputImageIds.length > 0)) {
    scheduleOpenAIWatchdog(taskId, activeProfile.timeout, activeProfile)
  }

  try {
    // 获取输入图片 data URLs
    const inputDataUrls: string[] = []
    for (const imgId of task.inputImageIds) {
      const dataUrl = await ensureImageCached(imgId)
      if (!dataUrl) throw new Error('输入图片已不存在')
      inputDataUrls.push(dataUrl)
    }
    let maskDataUrl: string | undefined
    if (task.maskImageId) {
      maskDataUrl = await ensureImageCached(task.maskImageId)
      if (!maskDataUrl) throw new Error('遮罩图片已不存在')
    }

    const n = task.params.n > 0 ? task.params.n : 1
    const useFolderMode = shouldCycleReferenceImages(task.params.reference_mode, task.inputImageIds.length, n)
    const variableResolver = { wordLibraryEntries: useStore.getState().wordLibraryEntries.filter((e) => e.deletedAt == null) }

    const maxConcurrent = normalizeMaxConcurrent(activeProfile.maxConcurrent)
    const maxRetries = normalizeMaxRetries(activeProfile.maxRetries)

    const apiMaxN = getApiMaxN(activeProfile)

    async function executeInBatches<T>(
      items: T[],
      batchHandler: (item: T, index: number) => Promise<CallApiResult>,
      expectedImagesPerItem: number | ((item: T, index: number) => number) = 1,
    ): Promise<CallApiResult & { batchItemStatuses?: BatchItemStatus[]; batchItemErrors?: BatchItemError[] }> {
      if (items.length === 0) return { images: [] }

      const totalBatches = items.length
      const getExpectedImages = (item: T, index: number) => Math.max(1, Math.floor(
        typeof expectedImagesPerItem === 'function' ? expectedImagesPerItem(item, index) : expectedImagesPerItem,
      ))
      const imageBaseIndexes = items.reduce<number[]>((indexes, item, index) => {
        const previousBase = indexes[index - 1] ?? 0
        const previousCount = index === 0 ? 0 : getExpectedImages(items[index - 1], index - 1)
        indexes.push(previousBase + previousCount)
        return indexes
      }, [])
      const totalImages = items.reduce((count, item, index) => count + getExpectedImages(item, index), 0)
      let allImages: string[] = []
      let allActualParamsList: Array<Partial<TaskParams> | undefined> = []
      let allRevisedPrompts: Array<string | undefined> = []
      let allRawImageUrls: string[] = []
      let firstActualParamsValue: Partial<TaskParams> | undefined
      let successBatchCount = 0
      let failureBatchCount = 0
      const imageStatuses: BatchItemStatus[] = new Array(totalImages).fill('done')
      const imageErrors: BatchItemError[] = []

      async function retryItem(fn: () => Promise<CallApiResult>): Promise<CallApiResult> {
        let lastError: unknown
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (attempt > 0) {
            const delayMs = Math.min(30_000, 1000 * Math.pow(2, attempt - 1))
            release()
            try {
              await new Promise((resolve) => setTimeout(resolve, delayMs))
            } finally {
              await acquire()
            }
          }
          try {
            return await fn()
          } catch (err) {
            lastError = err
            if (attempt < maxRetries && isRetryableError(err)) continue
            throw err
          }
        }
        throw lastError
      }

      let activeCount = 0
      const waitQueue: Array<() => void> = []

      async function acquire() {
        if (activeCount < maxConcurrent) {
          activeCount++
          return
        }
        await new Promise<void>((resolve) => waitQueue.push(resolve))
      }

      function release() {
        activeCount--
        if (waitQueue.length > 0 && activeCount < maxConcurrent) {
          activeCount++
          const next = waitQueue.shift()!
          next()
        }
      }

      async function storeBatchResult(result: CallApiResult, item: T, index: number) {
        const imageBaseIndex = imageBaseIndexes[index]
        const expectedImages = getExpectedImages(item, index)

        const itemImages = result.images
        const itemActualParamsList = result.actualParamsList?.length
          ? result.actualParamsList
          : result.images.map(() => result.actualParams)
        const itemRevisedPrompts = result.revisedPrompts?.length
          ? result.revisedPrompts
          : result.images.map(() => undefined)
        const itemRawImageUrls = result.rawImageUrls ?? []

        const newOutputIds: string[] = []
        const processedActualParamsList: Array<Partial<TaskParams> | undefined> = []
        for (let i = 0; i < itemImages.length; i++) {
          const stored = await processAndStoreGeneratedImage(itemImages[i], taskParams, itemActualParamsList[i])
          newOutputIds.push(stored.id)
          processedActualParamsList.push(stored.actualParams)
        }

        allImages = allImages.concat(itemImages)
        allActualParamsList = allActualParamsList.concat(processedActualParamsList)
        allRevisedPrompts = allRevisedPrompts.concat(itemRevisedPrompts)
        allRawImageUrls = allRawImageUrls.concat(itemRawImageUrls)
        if (!firstActualParamsValue) {
          firstActualParamsValue = firstActualParams(processedActualParamsList) ?? result.actualParams
        }
        if (itemImages.length > 0) successBatchCount++
        if (itemImages.length < expectedImages) {
          failureBatchCount++
          const missingCount = expectedImages - itemImages.length
          const errorMsg = `服务商返回的图片数量少于请求数量：请求 ${expectedImages} 张，实际返回 ${itemImages.length} 张。`
          for (let j = 0; j < missingCount; j++) {
            const missingIndex = imageBaseIndex + itemImages.length + j
            imageStatuses[missingIndex] = 'error'
            imageErrors.push({ index: missingIndex, error: errorMsg })
          }
        }
        const currentTask = useStore.getState().tasks.find((t) => t.id === taskId)
        if (currentTask && currentTask.status === 'running') {
          const existingOutputIds = currentTask.outputImages || []
          updateTaskProgress(taskId, 'generating')
          updateTaskInStore(taskId, {
            outputImages: [...existingOutputIds, ...newOutputIds],
          })
          void saveTaskImagesToLocalFS(taskId, newOutputIds, existingOutputIds.length)
          scheduleOpenAIWatchdog(taskId, activeProfile.timeout, activeProfile)
        }
      }

      function recordBatchFailure(error: unknown, itemOrIndex: T | number, maybeIndex?: number) {
        const index = typeof maybeIndex === 'number' ? maybeIndex : Number(itemOrIndex)
        const item = typeof maybeIndex === 'number' ? itemOrIndex as T : items[index]
        const imageBaseIndex = imageBaseIndexes[index]
        const expectedImages = getExpectedImages(item, index)
        failureBatchCount++
        const errorMsg = error instanceof Error ? error.message : String(error)
        for (let j = 0; j < expectedImages; j++) {
          imageStatuses[imageBaseIndex + j] = 'error'
          imageErrors.push({ index: imageBaseIndex + j, error: errorMsg })
        }
      }

      await Promise.allSettled(
        items.map(async (item, index) => {
          const latestTaskCheck = useStore.getState().tasks.find((t) => t.id === taskId)
          if (!latestTaskCheck || latestTaskCheck.status !== 'running') {
            recordBatchFailure(new Error('任务已中止'), index)
            return
          }

          if (!useFolderMode && allImages.length >= totalImages) {
            return
          }

          await acquire()
          try {
            if (!useFolderMode && allImages.length >= totalImages) {
              return
            }
            const result = await retryItem(() => batchHandler(item, index))
            await storeBatchResult(result, item, index)
          } catch (err) {
            recordBatchFailure(err, item, index)
          } finally {
            release()
          }
        }),
      )

      if (successBatchCount === 0) {
        throw new Error('所有请求均失败')
      }

      const actualParams = { ...firstActualParamsValue, n: allImages.length }
      return {
        images: allImages,
        actualParams,
        actualParamsList: allActualParamsList,
        revisedPrompts: allRevisedPrompts,
        ...(allRawImageUrls.length ? { rawImageUrls: allRawImageUrls } : {}),
        ...(failureBatchCount > 0 ? { batchItemStatuses: imageStatuses, batchItemErrors: imageErrors } : {}),
      }
    }

    /**
     * 多图（n>1）的编排执行：使用纯函数编排器保证数量、去重与补偿。
     * - 按供应商能力拆分首轮请求（fal 每请求最多 4 张，OpenAI 兼容每请求 1 张）。
     * - 欠交付 / 完全重复 -> 自动创建单张补偿请求（n=1）。
     * - 每张图先预处理 + 指纹校验，确认非重复后才 commit（只写入一次）。
     * - 每个远端请求独立持久化 request id，支持崩溃后恢复。
     * 返回与 CallApiResult 兼容的结构，复用下方既有的最终化逻辑。
     */
    async function executeOrchestratedBatch(): Promise<
      CallApiResult & {
        outputImages?: string[]
        batchItemStatuses?: BatchItemStatus[]
        batchItemErrors?: BatchItemError[]
        status?: 'running' | 'done' | 'partial-failure' | 'error' | 'cancelled'
        error?: string
      }
    > {
      if (!task) {
        return {
          images: [],
          actualParams: { n: 0 },
          actualParamsList: [],
          revisedPrompts: [],
          status: 'error' as const,
          error: '任务不存在',
        }
      }
      const isAsyncCustom = taskProvider !== 'fal' && isAsyncCustomProviderTask(requestSettings, taskProvider, inputDataUrls.length > 0)
      const capabilities: ImageProviderCapabilities = {
        maxImagesPerRequest: useFolderMode ? 1 : apiMaxN,
        supportsSeed: taskProvider === 'fal',
        supportsAsyncRecovery: taskProvider === 'fal' || isAsyncCustom,
        supportsCancel: taskProvider === 'fal' || isAsyncCustom,
      }
      const policy: GenerationPolicy = createGenerationPolicy(n, {
        maxConcurrent,
        transientRetries: maxRetries,
        replacementAttempts: 2,
        rejectExactDuplicates: true,
        rejectNearDuplicates: false,
        nearDuplicateThreshold: 0,
        capabilities,
      })
      const canResume = task.generationSlots?.length === n && Array.isArray(task.remoteGenerationRequests)
      let state: GenerationState = canResume
        ? {
            requestedCount: n,
            slots: task.generationSlots!.map((slot) => ({ ...slot })),
            remoteRequests: task.remoteGenerationRequests!.map((request) => ({ ...request, slotIndexes: [...request.slotIndexes] })),
            replacementCount: 0,
            duplicateCount: 0,
            nearDuplicateCount: 0,
            providerFailureCount: 0,
            status: 'running',
          }
        : createInitialGenerationState(n)

      // A renderer crash can happen after creating a local request record but before
      // the provider returns its remote id. That request cannot be recovered, so make
      // its slots eligible for a bounded replacement instead of leaving them in flight forever.
      if (canResume) {
        const unrecoverableIds = new Set(
          state.remoteRequests
            .filter((request) =>
              (request.status === 'created' || request.status === 'submitted' || request.status === 'running') &&
              !request.remoteRequestId,
            )
            .map((request) => request.id),
        )
        if (unrecoverableIds.size > 0) {
          const affectedSlots = new Set(
            state.remoteRequests
              .filter((request) => unrecoverableIds.has(request.id))
              .flatMap((request) => request.slotIndexes),
          )
          state = {
            ...state,
            remoteRequests: state.remoteRequests.map((request) =>
              unrecoverableIds.has(request.id)
                ? { ...request, status: 'failed' as const, error: '应用中断，未取得远端任务 ID', updatedAt: Date.now() }
                : request,
            ),
            slots: state.slots.map((slot) =>
              affectedSlots.has(slot.index) && slot.status !== 'done' && slot.status !== 'failed'
                ? { ...slot, status: 'pending' as const }
                : slot,
            ),
          }
        }
      }
      const persist = () =>
        updateTaskInStore(taskId, {
          generationSlots: state.slots.map((s) => ({ ...s })),
          remoteGenerationRequests: state.remoteRequests.map((r) => ({ ...r })),
        })

      persist()

      // 并发信号量
      let activeCount = 0
      const waitQueue: Array<() => void> = []
      const acquire = async () => {
        if (activeCount < maxConcurrent) {
          activeCount++
          return
        }
        await new Promise<void>((resolve) => waitQueue.push(resolve))
      }
      const release = () => {
        activeCount--
        if (waitQueue.length > 0 && activeCount < maxConcurrent) {
          activeCount++
          waitQueue.shift()!()
        }
      }
      const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

      const committed = new Map<
        number,
        { imgId: string; dataUrl: string; actualParams?: Partial<TaskParams>; revised?: string; rawUrl?: string }
      >()

      // Result processing mutates slot state and persists images. Serializing this
      // critical section prevents two concurrently completed requests from accepting
      // the same fingerprint before either one has committed it.
      let resultCommitChain = Promise.resolve()
      const withResultCommitLock = async <T,>(fn: () => Promise<T>): Promise<T> => {
        const next = resultCommitChain.then(fn, fn)
        resultCommitChain = next.then(() => undefined, () => undefined)
        return next
      }

      for (const slot of state.slots) {
        if (slot.status !== 'done' || !slot.outputImageId) continue
        const dataUrl = await ensureImageCached(slot.outputImageId)
        if (!dataUrl) continue
        committed.set(slot.index, {
          imgId: slot.outputImageId,
          dataUrl,
          actualParams: task.actualParamsByImage?.[slot.outputImageId],
        })
      }

      const processResult = async (requestId: string, result: CallApiResult): Promise<GenerationState> => withResultCommitLock(async () => {
        const request = state.remoteRequests.find((r) => r.id === requestId)
        if (!request) return state
        const candidates: Array<{
          slotIndex: number
          prepared: PreparedGeneratedImage
          contentHash: string
          perceptualHash?: string
          revised?: string
          rawUrl?: string
        }> = []
        const rejectedExact: number[] = []
        const seen: ImageFingerprintLike[] = []
        for (let i = 0; i < request.slotIndexes.length; i++) {
          const slotIndex = request.slotIndexes[i]
          const image = result.images[i]
          if (!image) continue
          const prepared = await prepareGeneratedImage(
            image,
            taskParams,
            result.actualParamsList?.[i] ?? result.actualParams,
          )
          const fingerprint = await fingerprintImage(prepared.dataUrl)
          const kind = classifyImageAgainstState(state, fingerprint.contentHash, fingerprint.perceptualHash, policy, seen)
          if (kind === 'accepted') {
            candidates.push({
              slotIndex,
              contentHash: fingerprint.contentHash,
              perceptualHash: fingerprint.perceptualHash,
              prepared,
              revised: result.revisedPrompts?.[i],
              rawUrl: result.rawImageUrls?.[i],
            })
            seen.push({ contentHash: fingerprint.contentHash, perceptualHash: fingerprint.perceptualHash })
          } else if (kind === 'exact-duplicate') {
            rejectedExact.push(slotIndex)
          }
        }

        const assignments: SlotAssignment[] = []
        const newlyCommittedIds: string[] = []
        try {
          for (const candidate of candidates) {
            const imgId = await commitGeneratedImage(candidate.prepared)
            newlyCommittedIds.push(imgId)
            assignments.push({
              slotIndex: candidate.slotIndex,
              imageId: imgId,
              contentHash: candidate.contentHash,
              perceptualHash: candidate.perceptualHash,
            })
            committed.set(candidate.slotIndex, {
              imgId,
              dataUrl: candidate.prepared.dataUrl,
              actualParams: candidate.prepared.actualParams,
              revised: candidate.revised,
              rawUrl: candidate.rawUrl,
            })
          }
        } catch (err) {
          await deleteUnreferencedImageIds(newlyCommittedIds)
          for (const candidate of candidates) committed.delete(candidate.slotIndex)
          throw err
        }

        state = applyProviderResult(
          state,
          requestId,
          assignments,
          rejectedExact.length ? { slotIndexes: rejectedExact, kind: 'exact-duplicate' } : undefined,
        )
        const current = useStore.getState().tasks.find((t) => t.id === taskId)
        if (current && current.status === 'running') {
          const outputImages = state.slots
            .filter((slot) => slot.status === 'done' && slot.outputImageId)
            .sort((a, b) => a.index - b.index)
            .map((slot) => slot.outputImageId!)
          updateTaskProgress(taskId, 'generating')
          updateTaskInStore(taskId, { outputImages })
          for (const assignment of assignments) {
            void saveTaskImagesToLocalFS(taskId, [assignment.imageId], assignment.slotIndex)
          }
          scheduleOpenAIWatchdog(taskId, activeProfile.timeout, activeProfile)
        }
        return state
      })

      const submitRequest = async (planned: PlannedRequest): Promise<void> => {
        await acquire()
        const requestId = genId()
        try {
          const provider: RemoteGenerationProvider =
            taskProvider === 'fal' ? 'fal' : isAsyncCustom ? 'custom' : 'openai'
          state = applyRemoteRequestSubmitted(state, planned, { id: requestId, provider })
          persist()
          const seed = capabilities.supportsSeed
            ? computeSeed(taskId, planned.slotIndexes[0], planned.attempt)
            : undefined
          const requestInputDataUrls = useFolderMode
            ? await Promise.all(planned.slotIndexes.map(async (slotIndex) => {
                const imgId = task.inputImageIds[slotIndex % task.inputImageIds.length]
                const dataUrl = await ensureImageCached(imgId)
                if (!dataUrl) throw new Error('输入图片已不存在')
                return dataUrl
              }))
            : inputDataUrls
          const result = await retryWithBackoff(requestId, async () =>
            callImageApi({
              settings: requestSettings,
              prompt: appendAdNegativeRule(
                replaceImageMentionsForApi(task.prompt, requestInputDataUrls.length, undefined, variableResolver),
                task.adNegativeRuleSnapshot?.content ?? getAdNegativeRule(requestSettings, task.params.adNegativeRuleId).content,
              ),
              params: { ...taskParams, n: planned.count, ...(seed !== undefined ? { seed } : {}) },
              inputImageDataUrls: requestInputDataUrls,
              maskDataUrl,
              onFalRequestEnqueued: (request) => {
                state = applyRemoteRequestSubmitted(state, planned, {
                  id: requestId,
                  provider: 'fal',
                  endpoint: request.endpoint,
                  remoteRequestId: request.requestId,
                })
                persist()
                falRequestInfo = request
                updateTaskProgress(taskId, 'relay-received')
                return updateTaskInStore(taskId, {
                  falRequestId: request.requestId,
                  falEndpoint: request.endpoint,
                  falRecoverable: false,
                })
              },
              onCustomTaskEnqueued: (request) => {
                state = applyRemoteRequestSubmitted(state, planned, {
                  id: requestId,
                  provider: 'custom',
                  remoteRequestId: request.taskId,
                })
                persist()
                customTaskInfo = request
                updateTaskProgress(taskId, 'relay-received')
                return updateTaskInStore(taskId, {
                  customTaskId: request.taskId,
                  customRecoverable: false,
                })
              },
              onPartialImage: (partial) => {
                updateTaskProgress(taskId, 'previewing')
                const baseIndex = planned.slotIndexes[0] + (partial.requestIndex ?? 0)
                useStore.getState().setTaskStreamPreview(taskId, partial.image, baseIndex)
                void persistTaskStreamPartialImage(taskId, partial.image)
                scheduleOpenAIWatchdog(taskId, activeProfile.timeout, activeProfile)
              },
            }),
          )
          state = await processResult(requestId, result)
          persist()
        } catch (err) {
          const kind = classifyGenerationError(err, {
            hasRemoteId: Boolean(state.remoteRequests.find((r) => r.id === requestId)?.remoteRequestId),
            afterSubmitTimeout: err instanceof Error ? /timeout/i.test(err.message) : false,
          })
          state = applyRequestFailure(state, requestId, kind)
          persist()
        } finally {
          release()
        }
      }

      const retryWithBackoff = async (requestId: string, fn: () => Promise<CallApiResult>): Promise<CallApiResult> => {
        let lastError: unknown
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (attempt > 0) {
            const delayMs = computeBackoffDelay(attempt - 1)
            release()
            try {
              await sleep(delayMs)
            } finally {
              await acquire()
            }
          }
          try {
            return await fn()
          } catch (err) {
            lastError = err
            const hasRemoteId = Boolean(state.remoteRequests.find((request) => request.id === requestId)?.remoteRequestId)
            const kind = classifyGenerationError(err, { hasRemoteId, afterSubmitTimeout: hasRemoteId })
            // Once a queue provider has accepted a request, resubmitting would create
            // an untracked duplicate. Let the outer failure path poll that request instead.
            if (hasRemoteId) throw err
            if (attempt < maxRetries && (kind === 'transient' || kind === 'rate-limit' || kind === 'result-missing')) {
              continue
            }
            throw err
          }
        }
        throw lastError
      }

      const recoverRequest = async (req: (typeof state.remoteRequests)[number]): Promise<void> => {
        try {
          let result: CallApiResult
          if (req.provider === 'fal' && req.endpoint && req.remoteRequestId) {
            result = await getFalQueuedImageResult(activeProfile, req.endpoint, req.remoteRequestId, taskParams)
          } else if (req.provider === 'custom' && req.remoteRequestId) {
            const customDef = getCustomProviderDefinition(requestSettings, task.apiProvider ?? activeProfile.provider)
            if (!customDef) {
              state = applyRequestFailure(state, req.id, 'invalid-input')
              persist()
              return
            }
            result = await getCustomQueuedImageResult(activeProfile, customDef, req.remoteRequestId, taskParams)
          } else {
            return
          }
          state = await processResult(req.id, result)
          persist()
        } catch (err) {
          const kind = classifyGenerationError(err, { hasRemoteId: true, afterSubmitTimeout: true })
          state = applyRequestFailure(state, req.id, kind)
          persist()
        }
      }

      let recoveryIterations = 0
      const maxRecovery = maxRetries + 2
      // 主循环：规划 -> 提交 -> 恢复，直到完成或进入 partial-failure
      for (;;) {
        const completion = getBatchCompletion(state, policy)
        if (completion.status !== 'running') break
        state = markExhaustedSlots(state, policy)
        const afterMark = getBatchCompletion(state, policy)
        if (afterMark.status !== 'running') break
        const plannedList = planNextRequests(state, policy)
        if (plannedList.length > 0) {
          await Promise.all(plannedList.map((planned) => submitRequest(planned)))
          persist()
          continue
        }
        const recoverable = getRecoverableRequests(state)
        if (recoverable.length === 0) break
        if (recoveryIterations >= maxRecovery) {
          // 恢复预算耗尽：硬失败该请求，并把被覆盖的槽位退回 pending，
          // 使其能被当作补偿请求重新规划（若补偿预算也用尽，则由 markExhaustedSlots 标记失败）。
          for (const req of recoverable) {
            state = {
              ...state,
              remoteRequests: state.remoteRequests.map((r) =>
                r.id === req.id
                  ? { ...r, status: 'failed' as const, error: '恢复超时，放弃该远端请求', updatedAt: Date.now() }
                  : r,
              ),
              slots: state.slots.map((s) =>
                req.slotIndexes.includes(s.index) && s.status !== 'done' && s.status !== 'failed'
                  ? { ...s, status: 'pending' as const }
                  : s,
              ),
            }
          }
          persist()
          continue
        }
        recoveryIterations++
        for (const req of recoverable) await recoverRequest(req)
      }

      const doneSlots = state.slots.filter((s) => s.status === 'done').sort((a, b) => a.index - b.index)
      const images = doneSlots.map((s) => committed.get(s.index)!.dataUrl)
      //  race-free 的槽位级结果（并发提交不会互相覆盖），用于最终 outputImages。
      const outputImages = doneSlots.map((s) => committed.get(s.index)!.imgId)
      const actualParamsList = doneSlots.map((s) => committed.get(s.index)!.actualParams)
      const revisedPrompts = doneSlots.map((s) => committed.get(s.index)!.revised)
      const rawImageUrls = doneSlots
        .map((s) => committed.get(s.index)!.rawUrl)
        .filter((u): u is string => Boolean(u))
      const batchItemStatuses: BatchItemStatus[] = state.slots.map((s) =>
        s.status === 'failed' ? 'error' : 'done',
      )
      const batchItemErrors: BatchItemError[] = state.slots
        .filter((s) => s.status === 'failed' && s.error)
        .map((s) => ({ index: s.index, error: s.error! }))
      const hasPartialFailure = batchItemErrors.length > 0
      const finalCompletion = getBatchCompletion(state, policy)
      return {
        images,
        outputImages,
        actualParams: { ...firstActualParams(actualParamsList), n: images.length },
        actualParamsList,
        revisedPrompts,
        ...(rawImageUrls.length ? { rawImageUrls } : {}),
        // 始终输出槽位级状态，便于 UI 展示「生成中 X/N」「补齐 Y 张」等。
        batchItemStatuses,
        batchItemErrors,
        status: finalCompletion.status,
        ...(finalCompletion.status === 'error'
          ? { error: state.error ?? '生成失败' }
          : hasPartialFailure
            ? { error: `${batchItemErrors.length} 张图片生成失败` }
            : {}),
      }
    }

    let result: CallApiResult & {
      status?: 'running' | 'done' | 'partial-failure' | 'error' | 'cancelled'
      error?: string
      outputImages?: string[]
      batchItemStatuses?: BatchItemStatus[]
      batchItemErrors?: BatchItemError[]
    }
    if (n > 1) {
      result = await executeOrchestratedBatch()
    } else {
      let singleRequestProgressed = false
      result = await retryTransientRequest(() => callImageApi({
        settings: requestSettings,
        prompt: appendAdNegativeRule(
          replaceImageMentionsForApi(task.prompt, inputDataUrls.length, undefined, variableResolver),
          task.adNegativeRuleSnapshot?.content ?? getAdNegativeRule(requestSettings, task.params.adNegativeRuleId).content,
        ),
        params: task.params,
        inputImageDataUrls: inputDataUrls,
        maskDataUrl,
        onFalRequestEnqueued: (request) => {
          singleRequestProgressed = true
          falRequestInfo = request
          updateTaskProgress(taskId, 'relay-received')
          return updateTaskInStore(taskId, {
            falRequestId: request.requestId,
            falEndpoint: request.endpoint,
            falRecoverable: false,
          })
        },
        onCustomTaskEnqueued: (request) => {
          singleRequestProgressed = true
          customTaskInfo = request
          updateTaskProgress(taskId, 'relay-received')
          return updateTaskInStore(taskId, {
            customTaskId: request.taskId,
            customRecoverable: false,
          })
        },
        onPartialImage: (partial) => {
          singleRequestProgressed = true
          updateTaskProgress(taskId, 'previewing')
          useStore.getState().setTaskStreamPreview(taskId, partial.image, partial.requestIndex)
          void persistTaskStreamPartialImage(taskId, partial.image)
          scheduleOpenAIWatchdog(taskId, activeProfile.timeout, activeProfile)
        },
        }), {
          maxRetries: normalizeMaxRetries(activeProfile.maxRetries),
          shouldRetry: (error) => !singleRequestProgressed && isRetryableError(error),
        })
    }

    const latestBeforeSuccess = useStore.getState().tasks.find((t) => t.id === taskId)
    if (!latestBeforeSuccess || latestBeforeSuccess.status !== 'running') {
      useStore.getState().setTaskStreamPreview(taskId)
      return
    }

    // 存储输出图片（n>1 分批模式已在每轮追加，这里只需补充单张模式）
    // 多图编排路径直接返回 race-free 的槽位级 outputImages；单张路径沿用 store 中已累积的 outputImages。
    const outputIds: string[] =
      result.outputImages && result.outputImages.length > 0
        ? result.outputImages
        : latestBeforeSuccess.outputImages || []
    let storedSingleActualParamsList: Array<Partial<TaskParams> | undefined> | undefined
    if (n === 1) {
      storedSingleActualParamsList = []
      for (let i = 0; i < result.images.length; i++) {
        const stored = await processAndStoreGeneratedImage(result.images[i], taskParams, result.actualParamsList?.[i] ?? result.actualParams)
        outputIds.push(stored.id)
        storedSingleActualParamsList.push(stored.actualParams)
      }
    }
    const isAsyncCustomTask = taskProvider !== 'fal' && taskProvider !== 'openai' && Boolean(customTaskInfo)
    const actualParamsList = storedSingleActualParamsList ?? (taskProvider === 'fal'
      ? await resolveImageSizeParamsList(result.images, result.actualParamsList)
      : isAsyncCustomTask
      ? await readImageSizeParamsList(result.images)
      : result.actualParamsList)
    const actualParams = (() => {
      if (storedSingleActualParamsList) return { ...firstActualParams(actualParamsList), n: outputIds.length }
      if (taskProvider === 'fal') return firstActualParams(actualParamsList)
      if (isAsyncCustomTask) return firstActualParams(actualParamsList)
      return { ...result.actualParams, n: outputIds.length }
    })()
    const shouldStoreRevisedPrompts = taskProvider !== 'fal' && !isAsyncCustomTask
    const actualParamsByImage = mapActualParamsByImage(outputIds, actualParamsList)
    const revisedPromptByImage = shouldStoreRevisedPrompts ? result.revisedPrompts?.reduce<Record<string, string>>((acc, revisedPrompt, index) => {
      const imgId = outputIds[index]
      if (imgId && revisedPrompt && revisedPrompt.trim()) acc[imgId] = revisedPrompt
      return acc
    }, {}) : undefined
    const promptWasRevised = shouldStoreRevisedPrompts && result.revisedPrompts?.some(
      (revisedPrompt) => revisedPrompt?.trim() && revisedPrompt.trim() !== task.prompt.trim(),
    )
    const hasRevisedPromptValue = shouldStoreRevisedPrompts && result.revisedPrompts?.some((revisedPrompt) => revisedPrompt?.trim())
    if (taskProvider === 'openai' && activeProfile.apiMode === 'responses' && !activeProfile.codexCli) {
      if (promptWasRevised) {
        showCodexCliPrompt()
      } else if (!hasRevisedPromptValue) {
        showCodexCliPrompt(false, '接口没有返回官方 API 会返回的部分信息')
      }
    }

    // 更新任务
    const latestBeforeUpdate = useStore.getState().tasks.find((t) => t.id === taskId)
    if (!latestBeforeUpdate || latestBeforeUpdate.status !== 'running') {
      useStore.getState().setTaskStreamPreview(taskId)
      return
    }
    const partialImageIdsToClean = latestBeforeUpdate.streamPartialImageIds || []
    clearOpenAIWatchdogTimer(taskId)
    useStore.getState().setTaskStreamPreview(taskId)
    const hasPartialFailure = (result as any).batchItemStatuses && (result as any).batchItemErrors && (result as any).batchItemErrors.length > 0
    // 编排批处理可能返回明确的失败/部分完成状态，避免伪装成成功。
    const finalTaskStatus: TaskStatus =
      result.status === 'error' ? 'error' : 'done'
    updateTaskProgress(taskId, 'saving')
    updateTaskInStore(taskId, {
      outputImages: outputIds,
      streamPartialImageIds: undefined,
      rawImageUrls: result.rawImageUrls?.length ? result.rawImageUrls : undefined,
      actualParams,
      actualParamsByImage,
      revisedPromptByImage: revisedPromptByImage && Object.keys(revisedPromptByImage).length > 0 ? revisedPromptByImage : undefined,
      batchItemStatuses: (result as any).batchItemStatuses,
      batchItemErrors: (result as any).batchItemErrors,
      status: finalTaskStatus,
      ...(result.status === 'error' ? { error: result.error ?? '生成失败' } : { error: null }),
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
      falRecoverable: false,
      customRecoverable: false,
    })
    void deleteUnreferencedImageIds(partialImageIdsToClean)

    if (hasPartialFailure) {
      const failCount = (result as any).batchItemErrors!.length
      const totalCount = (result as any).batchItemStatuses!.length
      useStore.getState().showToast(`生成完成，${totalCount - failCount}/${totalCount} 张成功`, 'info')
      if (!isAgentTask(task)) showTaskCompletionNotification('图像生成完成', `生成完成，${totalCount - failCount}/${totalCount} 张成功，${failCount} 张失败。`)
    } else {
      useStore.getState().showToast(`生成完成，共 ${outputIds.length} 张图片`, 'success')
      if (!isAgentTask(task)) showTaskCompletionNotification('图像生成完成', `生成完成，共 ${outputIds.length} 张图片。`)
    }
    if (n > 1) {
      void saveTaskMetaToLocalFS(task.id)
    } else {
      void saveTaskToLocalFS(task.id)
    }
    const currentMask = useStore.getState().maskDraft
    if (
      maskDataUrl &&
      currentMask &&
      currentMask.targetImageId === task.maskTargetImageId &&
      currentMask.maskDataUrl === maskDataUrl
    ) {
      useStore.getState().clearMaskDraft()
    }
  } catch (err) {
    clearOpenAIWatchdogTimer(taskId)
    const latestTask = useStore.getState().tasks.find((t) => t.id === taskId) ?? task
    if (latestTask.status !== 'running') return
    useStore.getState().setTaskStreamPreview(taskId)
    const latestFalRequestInfo = falRequestInfo ?? (latestTask.falRequestId && latestTask.falEndpoint
      ? { requestId: latestTask.falRequestId, endpoint: latestTask.falEndpoint }
      : null)
    const latestCustomTaskInfo = customTaskInfo ?? (latestTask.customTaskId ? { taskId: latestTask.customTaskId } : null)
    if (latestTask.apiProvider === 'fal' && latestFalRequestInfo && isFalConnectionRecoverableError(err)) {
      updateTaskInStore(taskId, {
        status: 'error',
        error: '与 fal.ai 的连接已断开，之后会继续查询任务结果。',
        progressStage: 'recovering',
        progressUpdatedAt: Date.now(),
        falRequestId: latestFalRequestInfo.requestId,
        falEndpoint: latestFalRequestInfo.endpoint,
        falRecoverable: true,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      scheduleFalRecovery(taskId)
    } else if (latestCustomTaskInfo && isFalConnectionRecoverableError(err)) {
      updateTaskInStore(taskId, {
        status: 'error',
        error: '与自定义异步任务的连接已断开，之后会继续查询任务结果。',
        progressStage: 'recovering',
        progressUpdatedAt: Date.now(),
        customTaskId: latestCustomTaskInfo.taskId,
        customRecoverable: true,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      scheduleCustomRecovery(taskId)
    } else {
      let errorMessage = err instanceof Error ? err.message : String(err)
      const settings = useStore.getState().settings
      const profile = getTaskApiProfile(settings, latestTask)
      const usesApiProxy = profile?.apiProxy ?? settings.apiProxy
      const activeProfile = getActiveApiProfile(settings)
      const hintProfile = profile ?? {
        provider: latestTask.apiProvider ?? activeProfile.provider,
        apiMode: settings.apiMode,
        streamImages: activeProfile.streamImages,
        streamPartialImages: activeProfile.streamPartialImages,
      }
      const networkErrorHint = getApiRequestNetworkErrorHint(err, latestTask.createdAt, usesApiProxy, hintProfile)
      if (networkErrorHint && !errorMessage.includes(IMAGE_FETCH_CORS_HINT)) {
        errorMessage += `\n${networkErrorHint}`
      }
      const streamingHint = getStreamingErrorHint(err, hintProfile)
      if (streamingHint && !errorMessage.includes(streamingHint)) {
        errorMessage += streamingHint
      }
      const existingOutputImages = latestTask.outputImages || []
      if (existingOutputImages.length > 0) {
        const totalRequested = latestTask.params?.n ?? 1
        const successCount = existingOutputImages.length
        const batchItemStatuses: BatchItemStatus[] = Array.from({ length: totalRequested }, (_, i) =>
          i < successCount ? 'done' : 'error'
        )
        const batchItemErrors: BatchItemError[] = Array.from(
          { length: Math.max(0, totalRequested - successCount) },
          (_, i) => ({ index: successCount + i, error: errorMessage })
        )
        updateTaskInStore(taskId, {
          status: 'done',
          error: undefined,
          progressStage: 'partial-failure',
          progressUpdatedAt: Date.now(),
          batchItemStatuses,
          batchItemErrors: batchItemErrors.length > 0 ? batchItemErrors : undefined,
          streamPartialImageIds: undefined,
          falRecoverable: false,
          customRecoverable: false,
          finishedAt: Date.now(),
          elapsed: Date.now() - task.createdAt,
        })
        const totalCount = batchItemStatuses.length
        useStore.getState().showToast(`生成异常，${successCount}/${totalCount} 张成功`, 'info')
        useStore.getState().setDetailTaskId(taskId)
      } else {
        updateTaskInStore(taskId, {
          status: 'error',
          error: errorMessage,
          progressStage: 'failed',
          progressUpdatedAt: Date.now(),
          ...getRawErrorPayload(err),
          falRecoverable: false,
          customRecoverable: false,
          finishedAt: Date.now(),
          elapsed: Date.now() - task.createdAt,
        })
        useStore.getState().setDetailTaskId(taskId)
      }
    }
  } finally {
    // 释放输入图片的内存缓存（已持久化到 IndexedDB，后续按需从 DB 加载）
    for (const imgId of task.inputImageIds) {
      imageCache.delete(imgId)
    }
  }
}

function normalizeFavoritePatch(task: TaskRecord, patch: Partial<TaskRecord>, defaultFavoriteCollectionId: string | null): Partial<TaskRecord> {
  if ('favoriteCollectionIds' in patch) {
    const ids = normalizeFavoriteCollectionIds(patch.favoriteCollectionIds)
    return { ...patch, favoriteCollectionIds: ids, isFavorite: ids.length > 0 }
  }
  if ('isFavorite' in patch) {
    if (patch.isFavorite) {
      const ids = normalizeFavoriteCollectionIds(task.favoriteCollectionIds)
      return { ...patch, favoriteCollectionIds: ids.length ? ids : defaultFavoriteCollectionId ? [defaultFavoriteCollectionId] : [] }
    }
    return { ...patch, favoriteCollectionIds: [] }
  }
  return patch
}

export function updateTaskInStore(taskId: string, patch: Partial<TaskRecord>): Promise<void> {
  const { tasks, setTasks, defaultFavoriteCollectionId, workspaceTabs } = useStore.getState()
  const updated = tasks.map((t) =>
    t.id === taskId ? { ...t, ...normalizeFavoritePatch(t, patch, defaultFavoriteCollectionId) } : t,
  )
  const task = updated.find((t) => t.id === taskId)
  setTasks(updated)
  // Sync updated task to all workspace tabs that contain it
  const updatedTabs = workspaceTabs.map((tab) => ({
    ...tab,
    tasks: tab.tasks.map((t) =>
      t.id === taskId ? { ...t, ...normalizeFavoritePatch(t, patch, defaultFavoriteCollectionId) } : t,
    ),
  }))
  useStore.setState({ workspaceTabs: updatedTabs })
  maybeOpenSupportPrompt(tasks, updated, taskId)
  return task ? putTask(task).then(() => undefined) : Promise.resolve()
}

function updateTaskProgress(taskId: string, progressStage: TaskProgressStage, progressMessage?: string) {
  updateTaskInStore(taskId, {
    progressStage,
    ...(progressMessage ? { progressMessage } : {}),
    progressUpdatedAt: Date.now(),
  })
}

function normalizeFavoriteCollectionIds(ids: unknown) {
  if (!Array.isArray(ids)) return []
  return Array.from(new Set(ids.map(String).filter((id) => id && id !== ALL_FAVORITES_COLLECTION_ID)))
}

function sameFavoriteCollectionIds(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((id) => bSet.has(id))
}

export function getTaskFavoriteCollectionIds(task: TaskRecord) {
  const ids = normalizeFavoriteCollectionIds(task.favoriteCollectionIds)
  if (ids.length > 0) return ids
  const defaultFavoriteCollectionId = useStore.getState().defaultFavoriteCollectionId
  return task.isFavorite && defaultFavoriteCollectionId ? [defaultFavoriteCollectionId] : []
}

function normalizeTaskFavoriteState(task: TaskRecord, collections: FavoriteCollection[]): TaskRecord {
  const collectionIdSet = new Set(collections.map((collection) => collection.id))
  const normalizedIds = normalizeFavoriteCollectionIds(task.favoriteCollectionIds).filter((id) => collectionIdSet.has(id))
  // 旧版本只有 isFavorite 没有 favoriteCollectionIds，迁移到"默认"收藏夹
  const defaultId = getDefaultNamedFavoriteCollectionId(collections)
  const ids = normalizedIds.length > 0 ? normalizedIds : task.isFavorite && defaultId ? [defaultId] : []
  const isFavorite = ids.length > 0 || Boolean(task.isFavorite)
  if (ids.length === (task.favoriteCollectionIds ?? []).length && ids.every((id, index) => id === task.favoriteCollectionIds?.[index]) && Boolean(task.isFavorite) === isFavorite) {
    return task
  }
  return { ...task, favoriteCollectionIds: ids, isFavorite }
}

function normalizeLoadedFavoriteState(tasks: TaskRecord[], collections: FavoriteCollection[], preferredDefaultFavoriteCollectionId: string | null) {
  let changed = false
  // 确保"默认"收藏夹存在，给孤立收藏任务一个归属
  const normalizedCollections = ensureDefaultNamedCollection(ensureDefaultFavoriteCollection(normalizeFavoriteCollections(collections)))
  const defaultFavoriteCollectionId = resolveDefaultFavoriteCollectionId(normalizedCollections, preferredDefaultFavoriteCollectionId)
  const normalizedTasks = tasks.map((task) => {
    const nextTask = normalizeTaskFavoriteState(task, normalizedCollections)
    if (nextTask !== task) changed = true
    return nextTask
  })
  return { tasks: normalizedTasks, collections: normalizedCollections, defaultFavoriteCollectionId, changed }
}

export function getFavoriteCollectionTitle(collectionId: string | null, collections = useStore.getState().favoriteCollections) {
  if (collectionId === ALL_FAVORITES_COLLECTION_ID) return '全部'
  return collections.find((collection) => collection.id === collectionId)?.name ?? DEFAULT_FAVORITE_COLLECTION_NAME
}

export function createFavoriteCollection(name: string) {
  const normalizedName = normalizeFavoriteCollectionName(name)
  if (!normalizedName) return null
  if (Array.from(normalizedName).length > 60) {
    useStore.getState().showToast('收藏夹名称最多 60 个字符', 'error')
    return null
  }
  const state = useStore.getState()
  const existing = state.favoriteCollections.find((collection) => collection.name === normalizedName)
  if (existing) return existing
  const now = Date.now()
  const collection: FavoriteCollection = { id: genId(), name: normalizedName, createdAt: now, updatedAt: now }
  state.setFavoriteCollections([...state.favoriteCollections, collection])
  state.showToast(`已创建收藏夹「${normalizedName}」`, 'success')
  return collection
}

export function renameFavoriteCollection(collectionId: string, name: string) {
  const normalizedName = normalizeFavoriteCollectionName(name)
  if (!normalizedName || collectionId === ALL_FAVORITES_COLLECTION_ID) return
  if (Array.from(normalizedName).length > 60) {
    useStore.getState().showToast('收藏夹名称最多 60 个字符', 'error')
    return
  }
  const { favoriteCollections, setFavoriteCollections, showToast } = useStore.getState()
  setFavoriteCollections(favoriteCollections.map((collection) =>
    collection.id === collectionId ? { ...collection, name: normalizedName, updatedAt: Date.now() } : collection,
  ))
  showToast('收藏夹名称已更新', 'success')
}

export async function updateTasksFavoriteCollections(taskIds: string[], collectionIds: string[]) {
  const ids = normalizeFavoriteCollectionIds(collectionIds)
  const uniqueTaskIds = Array.from(new Set(taskIds)).filter(Boolean)
  if (!uniqueTaskIds.length) return
  const { tasks, workspaceTabs, setTasks, clearSelection, showToast } = useStore.getState()
  const idSet = new Set(uniqueTaskIds)
  const changedTaskIds = new Set<string>()
  const newFavoriteTasks: TaskRecord[] = []

  const updated = tasks.map((task) => {
    if (!idSet.has(task.id)) return task
    if (sameFavoriteCollectionIds(getTaskFavoriteCollectionIds(task), ids)) return task
    
    const isFavorite = ids.length > 0
    if (isFavorite && !task.isFavorite) {
      // 收藏时复制一份作为收藏卡片，只保留第一张图
      const duplicateTask: TaskRecord = {
        ...task,
        id: genId(),
        outputImages: task.outputImages?.length > 0 ? [task.outputImages[0]] : [],
        favoriteCollectionIds: ids,
        isFavorite: true,
        error: null,
        status: 'done' as const,
        elapsed: null,
        progressStage: undefined,
        progressMessage: undefined,
        progressUpdatedAt: undefined,
        batchItemStatuses: undefined,
        batchItemErrors: undefined,
        rawResponsePayload: undefined,
        falRequestId: undefined,
        falEndpoint: undefined,
        falRecoverable: undefined,
        customTaskId: undefined,
        customRecoverable: undefined,
        // 清理输出地址参数，保留提示词
        favoriteOutputPath: undefined,
        favoriteOutputUseDateVariable: undefined,
        scheduledOutputPath: undefined,
        scheduledOutputSubFolder: undefined,
        localSaveBatchFolder: undefined,
      }
      newFavoriteTasks.push(duplicateTask)
      return task // 原任务卡不会被改变
    }
    
    changedTaskIds.add(task.id)
    return { ...task, favoriteCollectionIds: ids, isFavorite }
  })

  if (!changedTaskIds.size && !newFavoriteTasks.length) {
    clearSelection()
    return
  }
  
  const finalTasks = [...updated, ...newFavoriteTasks]
  setTasks(finalTasks)
  
  const duplicateSourceMap = new Map<string, string>()
  for (let i = 0; i < updated.length; i++) {
    if (newFavoriteTasks.length > 0 && newFavoriteTasks[newFavoriteTasks.length - 1].id !== undefined) {
      // Find matching duplicate source
      const dup = newFavoriteTasks.find(d => 
        d.createdAt === updated[i].createdAt && 
        d.prompt === updated[i].prompt &&
        d.apiProfileId === updated[i].apiProfileId
      )
      if (dup) {
        duplicateSourceMap.set(dup.id, updated[i].id)
      }
    }
  }

  const updatedTaskById = new Map(finalTasks.filter((task) => changedTaskIds.has(task.id)).map((task) => [task.id, task]))
  useStore.setState({
    workspaceTabs: workspaceTabs.map((tab) => {
      const newTasks: TaskRecord[] = []
      for (const task of tab.tasks) {
        newTasks.push(updatedTaskById.get(task.id) ?? task)
        // 注意：不将 newFavoriteTasks 添加到 workspaceTabs 中，这样生图窗口就不会显示复制的收藏卡片
      }
      return { ...tab, tasks: newTasks }
    }),
  })
  
  const tasksToPut = [
    ...finalTasks.filter((task) => changedTaskIds.has(task.id)),
    ...newFavoriteTasks
  ]
  await Promise.all(tasksToPut.map((task) => putTask(task)))
  
  clearSelection()
  showToast(ids.length ? '收藏夹已更新' : '已取消收藏', 'success')
}

export async function updateTaskPrompt(taskId: string, newPrompt: string) {
  const { tasks, workspaceTabs, setTasks } = useStore.getState()
  const updatedTasks = tasks.map((t) => t.id === taskId ? { ...t, prompt: newPrompt } : t)
  setTasks(updatedTasks)
  useStore.setState({
    workspaceTabs: workspaceTabs.map((tab) => ({
      ...tab,
      tasks: tab.tasks.map((t) => t.id === taskId ? { ...t, prompt: newPrompt } : t),
    })),
  })
  const task = updatedTasks.find((t) => t.id === taskId)
  if (task) {
    await dbPutTask(task)
  }
}

export async function updateTaskParams(taskId: string, params: Partial<TaskParams>) {
  const { tasks, workspaceTabs, setTasks } = useStore.getState()
  const updatedTasks = tasks.map((t) => t.id === taskId ? { ...t, params: { ...t.params, ...params } } : t)
  setTasks(updatedTasks)
  useStore.setState({
    workspaceTabs: workspaceTabs.map((tab) => ({
      ...tab,
      tasks: tab.tasks.map((t) => t.id === taskId ? { ...t, params: { ...t.params, ...params } } : t),
    })),
  })
  const task = updatedTasks.find((t) => t.id === taskId)
  if (task) {
    await dbPutTask(task)
  }
}

export async function deleteFavoriteCollection(collectionId: string, deleteTasks = false) {
  if (!collectionId || collectionId === ALL_FAVORITES_COLLECTION_ID) return
  const state = useStore.getState()
  const collection = state.favoriteCollections.find((item) => item.id === collectionId)
  if (!collection || state.favoriteCollections.length <= 1) return
  const collectionTaskRefs = state.tasks
    .map((task) => ({ task, favoriteIds: getTaskFavoriteCollectionIds(task) }))
    .filter(({ favoriteIds }) => favoriteIds.includes(collectionId))
  const taskIds = collectionTaskRefs.map(({ task }) => task.id)
  const nextCollections = state.favoriteCollections.filter((item) => item.id !== collectionId)
  const nextCollectionIdSet = new Set(nextCollections.map((item) => item.id))
  state.setFavoriteCollections(nextCollections)
  if (state.defaultFavoriteCollectionId === collectionId) {
    const nextDefaultId = nextCollections[0]?.id
    if (nextDefaultId) useStore.getState().setDefaultFavoriteCollectionId(nextDefaultId)
  }
  if (state.activeFavoriteCollectionId === collectionId) state.setActiveFavoriteCollectionId(null)
  if (deleteTasks) {
    const idsByTaskToKeep = new Map<string, string[]>()
    const taskIdsToDelete: string[] = []
    for (const { task, favoriteIds } of collectionTaskRefs) {
      const nextIds = favoriteIds.filter((id) => id !== collectionId && nextCollectionIdSet.has(id))
      if (nextIds.length) {
        idsByTaskToKeep.set(task.id, nextIds)
      } else {
        taskIdsToDelete.push(task.id)
      }
    }
    if (idsByTaskToKeep.size) {
      const latestTasks = useStore.getState().tasks
      const updated = latestTasks.map((task) => {
        const ids = idsByTaskToKeep.get(task.id)
        return ids ? { ...task, favoriteCollectionIds: ids, isFavorite: true } : task
      })
      useStore.getState().setTasks(updated)
      await Promise.all(updated.filter((task) => idsByTaskToKeep.has(task.id)).map((task) => putTask(task)))
    }
    if (taskIdsToDelete.length) await removeMultipleTasks(taskIdsToDelete)
  } else if (taskIds.length) {
    const idsByTaskId = new Map(collectionTaskRefs.map(({ task, favoriteIds }) => [
      task.id,
      favoriteIds.filter((id) => id !== collectionId && nextCollectionIdSet.has(id)),
    ]))
    const updated = state.tasks.map((task) => {
      const ids = idsByTaskId.get(task.id)
      if (!ids) return task
      return { ...task, favoriteCollectionIds: ids, isFavorite: ids.length > 0 }
    })
    state.setTasks(updated)
    await Promise.all(updated.filter((task) => idsByTaskId.has(task.id)).map((task) => putTask(task)))
  }
  useStore.getState().setSelectedFavoriteCollectionIds((ids) => ids.filter((id) => id !== collectionId))
  useStore.getState().showToast(`已删除收藏夹「${collection.name}」`, 'success')
}

/** 重试失败的任务：创建新任务并执行 */
export async function retryTask(task: TaskRecord, options: { sopBatch?: TaskRecord['sopBatch'] } = {}) {
  const { settings, workspaceTabs, activeWorkspaceTabId } = useStore.getState()
  const activeProfile = getActiveApiProfile(settings)
  const normalizedParams = normalizeParamsForSettings(task.params, settings, { hasInputImages: task.inputImageIds.length > 0 })
  const sourceTabId = workspaceTabs.find((t) => t.tasks.some((rt) => rt.id === task.id))?.id
  const tabIdToUpdate = sourceTabId ?? activeWorkspaceTabId ?? workspaceTabs[0]?.id ?? null
  const createdAt = Date.now()
  const taskId = genId()
  const filenameBatch = getNextTaskFilenameBatch(createdAt, tabIdToUpdate)
  const newTask: TaskRecord = {
    id: taskId,
    prompt: task.prompt,
    sopBatch: options.sopBatch ?? (task.sopBatch ? { ...task.sopBatch } : undefined),
    params: normalizedParams,
    apiProvider: activeProfile.provider,
    apiProfileId: activeProfile.id,
    apiProfileName: activeProfile.name,
    apiMode: activeProfile.apiMode,
    apiModel: activeProfile.model,
    inputImageIds: [...task.inputImageIds],
    inputImageFolderPath: task.inputImageFolderPath,
    maskTargetImageId: task.maskTargetImageId ?? null,
    maskImageId: task.maskImageId ?? null,
    outputImages: [],
    filenameBatch,
    status: 'running',
    error: null,
    createdAt,
    finishedAt: null,
    elapsed: null,
    localSaveBatchFolder: getTaskLocalSaveBatchFolder(createdAt, filenameBatch),
  }

  const latestTasks = useStore.getState().tasks
  useStore.getState().setTasks([newTask, ...latestTasks])
  
  // 查找原任务所在的标签页，或者使用当前激活的标签页
  if (tabIdToUpdate) {
    useStore.setState((state) => ({
      workspaceTabs: state.workspaceTabs.map((t) =>
        t.id === tabIdToUpdate ? { ...t, tasks: [newTask, ...t.tasks] } : t,
      ),
    }))
  } else {
    // 兜底：如果没有激活的标签页，尝试加到第一个标签页
    useStore.setState((state) => {
      if (state.workspaceTabs.length === 0) return state
      const firstTabId = state.workspaceTabs[0].id
      return {
        workspaceTabs: state.workspaceTabs.map((t) =>
          t.id === firstTabId ? { ...t, tasks: [newTask, ...t.tasks] } : t,
        ),
      }
    })
  }

  await putTask(newTask)

  executeTask(taskId)
}

export async function rerunSopBatchTasks(tasks: TaskRecord[]) {
  const batchTasks = tasks.filter((task) => task.sopBatch)
  if (!batchTasks.length) return
  const firstMeta = batchTasks[0].sopBatch!
  const batchId = `sop-batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  let snapshotId: string | undefined
  if (firstMeta.snapshotId) {
    const previousSnapshot = await getSopBatchSnapshot(firstMeta.snapshotId)
    if (previousSnapshot) {
      snapshotId = `sop-snapshot-${batchId}`
      await putSopBatchSnapshot({
        ...previousSnapshot,
        id: snapshotId,
        batchId,
        createdAt: Date.now(),
        prompts: previousSnapshot.prompts.map((prompt) => ({ ...prompt })),
        referenceImageIds: [...previousSnapshot.referenceImageIds],
        params: { ...previousSnapshot.params },
        sop: { ...previousSnapshot.sop },
      })
    }
  }
  await Promise.all(batchTasks.map((task) => retryTask(task, {
    sopBatch: {
      ...task.sopBatch!,
      batchId,
      snapshotId,
    },
  })))
  useStore.getState().showToast(`已创建新的 SOP 批次，共 ${batchTasks.length} 条提示词`, 'success')
}

/** 复用配置 */
export async function reuseConfig(task: TaskRecord) {
  const { settings, setPrompt, setParams, setInputImages, setInputImageFolder, setMaskDraft, clearMaskDraft, showToast, setConfirmDialog, setReusedTaskApiProfile, setCustomOutputPath } = useStore.getState()
  const normalizedSettings = normalizeSettings(settings)
  const currentProfile = getActiveApiProfile(settings)
  const matchedProfile = normalizedSettings.reuseTaskApiProfileTemporarily ? getTaskApiProfile(normalizedSettings, task) : null
  const shouldTemporarilyReuseProfile = Boolean(matchedProfile && matchedProfile.id !== currentProfile.id)
  const missingReusedProfile = normalizedSettings.reuseTaskApiProfileTemporarily && !matchedProfile
  const taskProfileName = matchedProfile?.name ?? getTaskApiProfileName(task)

  setParams(task.params)
  setReusedTaskApiProfile(
    shouldTemporarilyReuseProfile && matchedProfile ? matchedProfile.id : null,
    missingReusedProfile,
    taskProfileName,
  )
  clearMaskDraft()

  // 恢复输入图片
  const imgs: InputImage[] = []
  for (const imgId of task.inputImageIds) {
    const dataUrl = await ensureImageCached(imgId)
    if (dataUrl) {
      imgs.push({ id: imgId, dataUrl })
    }
  }

  if (task.inputImageFolderPath) {
    setInputImageFolder({ path: task.inputImageFolderPath, imageIds: imgs.map((img) => img.id) })
  } else {
    setInputImages(imgs)
  }

  setPrompt(task.prompt)
  // 恢复输出地址
  if (task.scheduledOutputPath) {
    setCustomOutputPath(task.scheduledOutputPath)
  } else {
    setCustomOutputPath('')
  }
  const maskTargetImageId = task.maskTargetImageId ?? (task.maskImageId ? task.inputImageIds[0] : null)
  if (maskTargetImageId && task.maskImageId && imgs.some((img) => img.id === maskTargetImageId)) {
    const maskDataUrl = await ensureImageCached(task.maskImageId)
    if (maskDataUrl) {
      setMaskDraft({
        targetImageId: maskTargetImageId,
        maskDataUrl,
        updatedAt: Date.now(),
      })
    } else {
      clearMaskDraft()
    }
  } else {
    clearMaskDraft()
  }
  if (missingReusedProfile) {
    setConfirmDialog({
      title: '找不到 API 配置',
      message: `找不到复用任务所使用的 API 配置「${taskProfileName}」，要使用当前的 API 配置「${currentProfile.name}」提交任务吗？`,
      confirmText: '使用当前配置提交',
      cancelText: '放弃提交',
      action: () => {
        void submitTask({ useCurrentApiProfileWhenReusedMissing: true })
      },
    })
    return
  }

  showToast(
    shouldTemporarilyReuseProfile && matchedProfile
      ? `已临时复用该任务的 API 配置「${matchedProfile.name}」`
      : '已复用配置到输入框',
    'success',
  )
}

/** 编辑输出：将输出图加入输入 */
export async function editOutputs(task: TaskRecord) {
  const { inputImages, addInputImage, showToast } = useStore.getState()
  if (!task.outputImages?.length) return

  let added = 0
  for (const imgId of task.outputImages) {
    if (inputImages.find((i) => i.id === imgId)) continue
    const dataUrl = await ensureImageCached(imgId)
    if (dataUrl) {
      addInputImage({ id: imgId, dataUrl })
      added++
    }
  }
  showToast(`已添加 ${added} 张输出图到输入`, 'success')
}

/** 将任务从当前标签移动到另一个标签 */
export function moveTasksToWorkspaceTab(
  taskIds: string[],
  targetTabId: string,
  sourceTabId?: string,
): boolean {
  const state = useStore.getState()
  const targetTab = state.workspaceTabs.find((tab) => tab.id === targetTabId)
  const sourceTab = sourceTabId
    ? state.workspaceTabs.find((tab) => tab.id === sourceTabId)
    : null

  if (!targetTab) {
    state.showToast('目标标签不存在', 'error')
    return false
  }

  if (sourceTabId && !sourceTab) {
    state.showToast('当前标签不存在', 'error')
    return false
  }

  if (sourceTabId === targetTabId) {
    state.showToast('所选任务已在该标签中', 'info')
    return false
  }

  const selectedIds = new Set(taskIds.filter(Boolean))
  const movableIds = new Set(
    sourceTab
      ? sourceTab.tasks.filter((task) => selectedIds.has(task.id)).map((task) => task.id)
      : state.workspaceTabs
          .filter((tab) => tab.id !== targetTabId)
          .flatMap((tab) => tab.tasks)
          .filter((task) => selectedIds.has(task.id))
          .map((task) => task.id),
  )

  if (movableIds.size === 0) {
    state.showToast('所选任务已在该标签中', 'info')
    return false
  }

  const taskById = new Map(state.tasks.map((task) => [task.id, task]))
  for (const tab of state.workspaceTabs) {
    for (const task of tab.tasks) {
      if (!taskById.has(task.id)) taskById.set(task.id, task)
    }
  }
  const movingTasks = [...movableIds]
    .map((taskId) => taskById.get(taskId))
    .filter((task): task is TaskRecord => Boolean(task))

  if (movingTasks.length === 0) {
    state.showToast('未找到可移动的任务', 'info')
    return false
  }

  const now = Date.now()
  const targetTaskIds = new Set(targetTab.tasks.map((task) => task.id))
  const updatedTabs = state.workspaceTabs.map((tab) => {
    if (tab.id === targetTabId) {
      const additions = movingTasks.filter((task) => !targetTaskIds.has(task.id))
      return {
        ...tab,
        tasks: [...additions, ...tab.tasks],
        updatedAt: now,
      }
    }

    if (sourceTabId && tab.id !== sourceTabId) return tab
    const remainingTasks = tab.tasks.filter((task) => !movableIds.has(task.id))
    return remainingTasks.length === tab.tasks.length
      ? tab
      : { ...tab, tasks: remainingTasks, updatedAt: now }
  })

  useStore.setState({
    workspaceTabs: updatedTabs,
    selectedTaskIds: [],
  })
  state.showToast(`已将 ${movingTasks.length} 个任务移动到「${targetTab.name}」`, 'success')
  return true
}

/** 删除多条任务 */
export async function removeMultipleTasks(taskIds: string[]) {
  const { tasks, setTasks, inputImages, galleryInputDraft, showToast, clearSelection, selectedTaskIds, workspaceTabs } = useStore.getState()

  if (!taskIds.length) return

  const toDelete = new Set(taskIds)
  const deletedTasks = tasks.filter(t => toDelete.has(t.id))
  const remaining = await scrubAgentOutputPayloadsForDeletedTasks(deletedTasks, tasks.filter(t => !toDelete.has(t.id)))

  // 收集所有被删除任务的关联图片
  const deletedImageIds = new Set<string>()
  for (const t of tasks) {
    if (toDelete.has(t.id)) {
      addTaskReferencedImageIds(deletedImageIds, t)
    }
  }

  setTasks(remaining)
  // Remove from all workspace tabs
  const updatedTabs = workspaceTabs.map((tab) => ({
    ...tab,
    tasks: tab.tasks.filter((t) => !toDelete.has(t.id)),
  }))
  useStore.setState({ workspaceTabs: updatedTabs })
  for (const id of taskIds) {
    await dbDeleteTask(id)
  }

  // 找出其他任务仍引用的图片
  const stillUsed = new Set<string>()
  for (const t of remaining) {
    addTaskReferencedImageIds(stillUsed, t)
  }
  addAgentReferencedImageIds(stillUsed)
  addInputDraftReferencedImageIds(stillUsed, galleryInputDraft)
  for (const img of inputImages) stillUsed.add(img.id)

  // 删除孤立图片
  for (const imgId of deletedImageIds) {
    if (!stillUsed.has(imgId)) {
      await deleteImage(imgId)
      imageCache.delete(imgId)
      thumbnailCache.delete(imgId)
    }
  }

  // 如果删除的任务在选中列表中，则移除
  const newSelection = selectedTaskIds.filter(id => !toDelete.has(id))
  if (newSelection.length !== selectedTaskIds.length) {
    useStore.getState().setSelectedTaskIds(newSelection)
  }

  showToast(`已删除 ${taskIds.length} 个任务`, 'success')
}

/** 删除单条任务 */
export async function removeTask(task: TaskRecord) {
  const { tasks, setTasks, inputImages, galleryInputDraft, showToast, workspaceTabs } = useStore.getState()

  // 收集此任务关联的图片
  const taskImageIds = new Set([
    ...(task.inputImageIds || []),
    ...(task.maskImageId ? [task.maskImageId] : []),
    ...(task.outputImages || []),
    ...(task.streamPartialImageIds || []),
  ])

  // 从列表移除
  const remaining = await scrubAgentOutputPayloadsForDeletedTasks([task], tasks.filter((t) => t.id !== task.id))
  setTasks(remaining)
  // Remove from all workspace tabs
  const updatedTabs = workspaceTabs.map((tab) => ({
    ...tab,
    tasks: tab.tasks.filter((t) => t.id !== task.id),
  }))
  useStore.setState({ workspaceTabs: updatedTabs })
  await dbDeleteTask(task.id)

  // 找出其他任务仍引用的图片
  const stillUsed = new Set<string>()
  for (const t of remaining) {
    addTaskReferencedImageIds(stillUsed, t)
  }
  addAgentReferencedImageIds(stillUsed)
  addInputDraftReferencedImageIds(stillUsed, galleryInputDraft)
  for (const img of inputImages) stillUsed.add(img.id)

  // 删除孤立图片
  for (const imgId of taskImageIds) {
    if (!stillUsed.has(imgId)) {
      await deleteImage(imgId)
      imageCache.delete(imgId)
      thumbnailCache.delete(imgId)
    }
  }

  showToast('任务已删除', 'success')
}

export async function clearFailedTasks() {
  const { tasks, setTasks, workspaceTabs, showToast, setConfirmDialog } = useStore.getState()
  const failedTasks = tasks.filter((t) => t.status === 'error')
  const partialFailureTasks = tasks.filter((t) => t.status === 'done' && t.batchItemStatuses?.some((s) => s === 'error'))
  if (!failedTasks.length && !partialFailureTasks.length) {
    showToast('没有失败记录', 'info')
    return
  }
  const totalCount = failedTasks.length + partialFailureTasks.length
  const hasPartial = partialFailureTasks.length > 0
  setConfirmDialog({
    title: '清除失败记录',
    message: hasPartial
      ? `确定清空 **${failedTasks.length}** 条完全失败的任务记录，并清除 **${partialFailureTasks.length}** 条部分失败任务中的失败标记？成功的图片会保留，不可恢复。`
      : `确定清空所有 **${failedTasks.length}** 条生成失败的任务记录？此操作会同步清理对应的孤立图片资源，不可恢复。`,
    tone: 'danger',
    buttons: [
      {
        label: '清除',
        tone: 'danger',
        action: async () => {
          useStore.getState().setConfirmDialog(null)
          const currentTasks = useStore.getState().tasks
          const remainingTasks = currentTasks.filter((t) => t.status !== 'error')
          const remaining = await scrubAgentOutputPayloadsForDeletedTasks(failedTasks, remainingTasks)
          const updatedTasks = remaining.map((t) => {
            if (t.batchItemStatuses?.some((s) => s === 'error')) {
              const { batchItemStatuses, batchItemErrors, ...rest } = t
              return rest
            }
            return t
          })
          setTasks(updatedTasks)
          const updatedTabs = useStore.getState().workspaceTabs.map((tab) => ({
            ...tab,
            tasks: tab.tasks
              .filter((t) => t.status !== 'error')
              .map((t) => {
                if (t.batchItemStatuses?.some((s) => s === 'error')) {
                  const { batchItemStatuses, batchItemErrors, ...rest } = t
                  return rest
                }
                return t
              }),
          }))
          useStore.setState({ workspaceTabs: updatedTabs })
          for (const task of failedTasks) await dbDeleteTask(task.id)
          for (const task of partialFailureTasks) {
            void saveTaskToLocalFS(task.id)
          }
          const failedImageIds = new Set<string>()
          for (const t of failedTasks) addTaskReferencedImageIds(failedImageIds, t)
          await deleteUnreferencedImageIds(failedImageIds)
          showToast(`已清除 ${totalCount} 条失败记录${hasPartial ? '（部分失败仅清标记）' : ''}`, 'success')
        },
      },
      { label: '取消', tone: 'secondary', action: () => useStore.getState().setConfirmDialog(null) },
    ],
  })
}

/** 清空数据选项 */
export interface ClearOptions {
  clearConfig?: boolean
  clearTasks?: boolean
}

/** 清空数据 */
export async function clearData(options: ClearOptions = { clearConfig: true, clearTasks: true }) {
  const { setTasks, clearInputImages, clearMaskDraft, setSettings, setParams, showToast } = useStore.getState()

  if (options.clearTasks) {
    await dbClearTasks()
    await dbClearAgentConversations()
    await clearSopBatchSnapshots()
    await clearImages()
    imageCache.clear()
    thumbnailCache.clear()
    thumbnailBackfillIds.clear()
    if (typeof localStorage !== 'undefined') {
      for (let index = localStorage.length - 1; index >= 0; index--) {
        const key = localStorage.key(index)
        if (key?.startsWith('doupao.gallery-sop-prompt-run.')) localStorage.removeItem(key)
      }
    }
    setTasks([])
    useStore.setState({
      agentConversations: [],
      activeAgentConversationId: null,
      supportPromptOpen: false,
      supportPromptSkippedForImportedData: false,
    })
    clearInputImages()
    clearMaskDraft()
  }

  if (options.clearConfig) {
    useStore.setState({ dismissedCodexCliPrompts: [], supportPromptDismissed: false })
    setSettings({ ...DEFAULT_SETTINGS })
    setParams({ ...DEFAULT_PARAMS })
  }

  showToast('所选数据已清空', 'success')
}

/** 从 dataUrl 解析出 MIME 扩展名和二进制数据 */
function dataUrlToBytes(dataUrl: string): { ext: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:image\/(\w+);base64,/)
  const ext = match?.[1] ?? 'png'
  const b64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { ext, bytes }
}

/** 将二进制数据还原为 dataUrl */
function bytesToDataUrl(bytes: Uint8Array, filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png'
  const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
  const mime = mimeMap[ext] ?? 'image/png'
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return `data:${mime};base64,${btoa(binary)}`
}

async function completeRecoveredCustomTask(task: TaskRecord, result: Awaited<ReturnType<typeof getCustomQueuedImageResult>>) {
  const latest = useStore.getState().tasks.find((item) => item.id === task.id)
  if (!latest || latest.status === 'done') return

  const originalActualParamsList = await readImageSizeParamsList(result.images)
  const outputIds: string[] = []
  const actualParamsList: Array<Partial<TaskParams> | undefined> = []
  for (let i = 0; i < result.images.length; i++) {
    const stored = await processAndStoreGeneratedImage(result.images[i], task.params, originalActualParamsList[i])
    outputIds.push(stored.id)
    actualParamsList.push(stored.actualParams)
  }

  updateTaskInStore(task.id, {
    outputImages: outputIds,
    actualParams: firstActualParams(actualParamsList),
    actualParamsByImage: mapActualParamsByImage(outputIds, actualParamsList),
    revisedPromptByImage: undefined,
    status: 'done',
    error: null,
    customRecoverable: false,
    finishedAt: Date.now(),
    elapsed: Date.now() - task.createdAt,
  })
  useStore.getState().showToast(`自定义异步任务已恢复，共 ${outputIds.length} 张图片`, 'success')
  if (!isAgentTask(task)) showTaskCompletionNotification('图像生成完成', `自定义异步任务已恢复，共 ${outputIds.length} 张图片。`)
  else void continueRecoveredAgentRound(task.id)
  void saveTaskToLocalFS(task.id)
}

async function recoverCustomTask(taskId: string) {
  const { settings, tasks } = useStore.getState()
  const task = tasks.find((item) => item.id === taskId)
  if (!task || !task.customTaskId || task.status === 'done') return

  const profile = getCustomRecoveryProfile(settings, task)
  const customProvider = task.apiProvider ? getCustomProviderDefinition(settings, task.apiProvider) : null
  if (!profile || !customProvider?.poll) {
    scheduleCustomRecovery(taskId)
    return
  }

  try {
    const result = await getCustomQueuedImageResult(profile, customProvider, task.customTaskId, task.params)
    clearCustomRecoveryTimer(taskId)
    await completeRecoveredCustomTask(task, result)
  } catch (err) {
    clearCustomRecoveryTimer(taskId)
    updateTaskInStore(taskId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      ...getRawErrorPayload(err),
      customRecoverable: false,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
    if (isAgentTask(task)) void continueRecoveredAgentRound(taskId)
  }
}

function formatExportFileTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

/** 生成 ZIP 数据 */
async function generateExportZipBuffer(options: ExportOptions = { exportConfig: true, exportTasks: true }): Promise<Uint8Array> {
  const tasks = options.exportTasks ? await getAllTasks() : []
  const sopPromptRuns = options.exportTasks ? await getAllSopBatchSnapshots() : []
  const images = options.exportTasks ? await getAllImages() : []
  const state = useStore.getState()
  const { settings, agentConversations, favoriteCollections, defaultFavoriteCollectionId, wordLibraryGroups, wordLibraryEntries, wordGenerationBatches } = state
  const exportedAt = Date.now()
  const imageCreatedAtFallback = new Map<string, number>()

  if (options.exportTasks) {
    for (const task of tasks) {
      for (const id of [
        ...(task.inputImageIds || []),
        ...(task.maskImageId ? [task.maskImageId] : []),
        ...(task.outputImages || []),
        ...(task.streamPartialImageIds || []),
      ]) {
        const prev = imageCreatedAtFallback.get(id)
        if (prev == null || task.createdAt < prev) {
          imageCreatedAtFallback.set(id, task.createdAt)
        }
      }
    }
  }

  const imageFiles: ExportData['imageFiles'] = {}
  const thumbnailFiles: NonNullable<ExportData['thumbnailFiles']> = {}
  const zipFiles: Record<string, Uint8Array | [Uint8Array, { mtime: Date }]> = {}

  if (options.exportTasks) {
    for (const img of images) {
      const dataUrl = await ensureImageCached(img.id)
      if (!dataUrl) continue

      const { ext, bytes } = dataUrlToBytes(dataUrl)
      const path = `images/${img.id}.${ext}`
      const createdAt = img.createdAt ?? imageCreatedAtFallback.get(img.id) ?? exportedAt
      imageFiles[img.id] = {
        path,
        createdAt,
        source: img.source,
        width: img.width,
        height: img.height,
      }
      zipFiles[path] = [bytes, { mtime: new Date(createdAt) }]

      const thumbnail = await getImageThumbnail(img.id)
      if (thumbnail?.thumbnailDataUrl) {
        const { ext: thumbnailExt, bytes: thumbnailBytes } = dataUrlToBytes(thumbnail.thumbnailDataUrl)
        const thumbnailPath = `thumbnails/${img.id}.${thumbnailExt}`
        imageFiles[img.id].width = imageFiles[img.id].width ?? thumbnail.width
        imageFiles[img.id].height = imageFiles[img.id].height ?? thumbnail.height
        thumbnailFiles[img.id] = {
          path: thumbnailPath,
          width: thumbnail.width,
          height: thumbnail.height,
          thumbnailVersion: thumbnail.thumbnailVersion,
        }
        zipFiles[thumbnailPath] = [thumbnailBytes, { mtime: new Date(createdAt) }]
      }
    }
  }

  const manifest: ExportData = {
    version: 5,
    exportedAt: new Date(exportedAt).toISOString(),
    includesSecrets: options.includeSecrets === true,
  }

  if (options.exportConfig) {
      manifest.settings = sanitizeSettingsForBackup(settings, options.includeSecrets === true)
      manifest.favoriteCollections = favoriteCollections
      manifest.defaultFavoriteCollectionId = defaultFavoriteCollectionId
      manifest.wordLibraryGroups = wordLibraryGroups
      manifest.wordLibraryEntries = wordLibraryEntries
      manifest.wordGenerationBatches = wordGenerationBatches
      manifest.postprocessState = await getPostprocessBackupState()
      manifest.workspaceState = createWorkspaceBackupState(
        state.workspaceTabs,
        state.workspaceTabGroups,
        state.activeWorkspaceTabId,
        options.exportTasks === true,
      )
    }
  if (options.exportTasks) {
    manifest.tasks = tasks
    manifest.sopPromptRuns = sopPromptRuns
    manifest.agentConversations = getPersistableAgentConversations(agentConversations)
    manifest.thumbnailFiles = thumbnailFiles
  }
  if (options.exportImages) {
    manifest.imageFiles = imageFiles
  }

  zipFiles['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { mtime: new Date(exportedAt) }]

  const zipped = zipSync(zipFiles, { level: 6 })
  return zipped
}

/** 导出选项 */
export interface ExportOptions {
  exportConfig?: boolean
  exportTasks?: boolean
  exportImages?: boolean
  includeSecrets?: boolean
}

interface ExportDataToPathBehavior {
  showErrorToast?: boolean
}

async function buildCompositeBackup() {
  const [
    { useCompositeV2Store, getCompositeV2PersistedState },
    { collectCompositeAssetIds },
    { migrateLegacyCompositeAssets },
  ] = await Promise.all([
    import('./features/composite/storeV2'),
    import('./features/composite/lib/compositeAssets'),
    import('./features/composite/lib/compositeAssetMigration'),
  ])
  await migrateLegacyCompositeAssets({
    getState: useCompositeV2Store.getState,
    setState: (patch) => useCompositeV2Store.setState(patch),
  })
  const compositeState = getCompositeV2PersistedState(useCompositeV2Store.getState())
  const ids = collectCompositeAssetIds(compositeState)
  const assets = await batchGetCompositeAssets(ids)
  for (const id of ids) {
    if (!assets.has(id)) throw new Error(`后期处理资源 ${id} 不存在`)
  }
  const compositeAssetFiles: NonNullable<ExportData['compositeAssetFiles']> = {}
  for (const id of ids) {
    const asset = assets.get(id)!
    compositeAssetFiles[id] = {
      path: `composite-assets/${id}.${getCompositeAssetExtension(asset.blob.type)}`,
      createdAt: asset.createdAt,
      type: asset.blob.type || 'application/octet-stream',
    }
  }
  return { compositeState, compositeAssetFiles, assets }
}

async function getPostprocessBackupState() {
  const { getPostprocessPersistedState } = await import('./storePostprocess')
  return getPostprocessPersistedState()
}

function getCompositeAssetExtension(type: string) {
  if (type === 'image/jpeg') return 'jpg'
  if (type === 'image/webp') return 'webp'
  if (type === 'image/svg+xml') return 'svg'
  return 'png'
}

async function restoreCompositeBackup(
  data: ExportData,
  unzipped: Record<string, Uint8Array>,
): Promise<void> {
  if (!data.compositeState) return

  const [{ collectCompositeAssetIds }, { replaceCompositeV2PersistedState }] = await Promise.all([
    import('./features/composite/lib/compositeAssets'),
    import('./features/composite/storeV2'),
  ])
  const ids = collectCompositeAssetIds(data.compositeState)
  const assets = ids.map((id) => {
    const info = data.compositeAssetFiles?.[id]
    if (!info) throw new Error(`后期处理资源 ${id} 缺少备份索引`)
    const bytes = unzipped[info.path]
    if (!bytes) throw new Error(`后期处理资源 ${id} 缺少二进制文件`)
    return {
      id,
      blob: new Blob([
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      ], { type: info.type }),
      createdAt: info.createdAt,
    }
  })

  await putCompositeAssets(assets)
  replaceCompositeV2PersistedState(data.compositeState)
}

/** 导出数据为 ZIP */
export async function exportData(options: ExportOptions = { exportConfig: true, exportTasks: true }) {
  try {
    if (isElectronEnv()) {
      const exportedAt = Date.now()
      const defaultName = `gpt-image-playground-backup_${formatExportFileTime(new Date(exportedAt))}.zip`
      const filePath = await selectZipSavePath(defaultName)
      if (!filePath) return
      const success = await exportDataToPath(filePath, options)
      if (success) useStore.getState().showToast('数据已导出', 'success')
      return
    }
    const tasks = options.exportTasks ? await getAllTasks() : []
    const sopPromptRuns = options.exportTasks ? await getAllSopBatchSnapshots() : []
    const images = options.exportTasks || options.exportImages ? await getAllImages() : []
    const state = useStore.getState()
    const { settings, agentConversations, favoriteCollections, defaultFavoriteCollectionId, wordLibraryGroups, wordLibraryEntries, wordGenerationBatches } = state
    const exportedAt = Date.now()
    const imageCreatedAtFallback = new Map<string, number>()

    if (options.exportTasks || options.exportImages) {
      for (const task of tasks) {
        for (const id of [
          ...(task.inputImageIds || []),
          ...(task.maskImageId ? [task.maskImageId] : []),
          ...(task.outputImages || []),
          ...(task.streamPartialImageIds || []),
        ]) {
          const prev = imageCreatedAtFallback.get(id)
          if (prev == null || task.createdAt < prev) {
            imageCreatedAtFallback.set(id, task.createdAt)
          }
        }
      }
    }

    const imageFiles: ExportData['imageFiles'] = {}
    const thumbnailFiles: NonNullable<ExportData['thumbnailFiles']> = {}
    const zipFiles: Record<string, Uint8Array | [Uint8Array, { mtime: Date }]> = {}
    const compositeBackup = options.exportConfig ? await buildCompositeBackup() : null
    if (compositeBackup) {
      for (const [id, asset] of compositeBackup.assets) {
        const info = compositeBackup.compositeAssetFiles[id]!
        zipFiles[info.path] = [new Uint8Array(await asset.blob.arrayBuffer()), { mtime: new Date(info.createdAt) }]
      }
    }

    if (options.exportTasks || options.exportImages) {
      for (const img of images) {
        const dataUrl = await ensureImageCached(img.id)
        if (!dataUrl) continue

        const { ext, bytes } = dataUrlToBytes(dataUrl)
        const path = `images/${img.id}.${ext}`
        const createdAt = img.createdAt ?? imageCreatedAtFallback.get(img.id) ?? exportedAt
        
        if (options.exportImages) {
          imageFiles[img.id] = {
            path,
            createdAt,
            source: img.source,
            width: img.width,
            height: img.height,
          }
          zipFiles[path] = [bytes, { mtime: new Date(createdAt) }]
        }

        if (options.exportTasks) {
          const thumbnail = await getImageThumbnail(img.id)
          if (thumbnail?.thumbnailDataUrl) {
            const { ext: thumbnailExt, bytes: thumbnailBytes } = dataUrlToBytes(thumbnail.thumbnailDataUrl)
            const thumbnailPath = `thumbnails/${img.id}.${thumbnailExt}`
            if (options.exportImages) {
              imageFiles[img.id].width = imageFiles[img.id].width ?? thumbnail.width
              imageFiles[img.id].height = imageFiles[img.id].height ?? thumbnail.height
            }
            thumbnailFiles[img.id] = {
              path: thumbnailPath,
              width: thumbnail.width,
              height: thumbnail.height,
              thumbnailVersion: thumbnail.thumbnailVersion,
            }
            zipFiles[thumbnailPath] = [thumbnailBytes, { mtime: new Date(createdAt) }]
            cacheThumbnail(img.id, {
              dataUrl: thumbnail.thumbnailDataUrl,
              width: thumbnail.width,
              height: thumbnail.height,
              thumbnailVersion: thumbnail.thumbnailVersion,
            })
          }
        }
      }
    }

    const manifest: ExportData = {
      version: 5,
      exportedAt: new Date(exportedAt).toISOString(),
      includesSecrets: options.includeSecrets === true,
    }

    if (options.exportConfig) {
      manifest.settings = sanitizeSettingsForBackup(settings, options.includeSecrets === true)
      manifest.favoriteCollections = favoriteCollections
      manifest.defaultFavoriteCollectionId = defaultFavoriteCollectionId
      manifest.wordLibraryGroups = wordLibraryGroups
      manifest.wordLibraryEntries = wordLibraryEntries
      manifest.wordGenerationBatches = wordGenerationBatches
      manifest.postprocessState = await getPostprocessBackupState()
      manifest.compositeState = compositeBackup!.compositeState
      manifest.compositeAssetFiles = compositeBackup!.compositeAssetFiles
      manifest.workspaceState = createWorkspaceBackupState(
        state.workspaceTabs,
        state.workspaceTabGroups,
        state.activeWorkspaceTabId,
        options.exportTasks === true,
      )
    }
    if (options.exportTasks) {
      manifest.tasks = tasks
      manifest.sopPromptRuns = sopPromptRuns
      manifest.agentConversations = getPersistableAgentConversations(agentConversations)
      manifest.thumbnailFiles = thumbnailFiles
    }
    if (options.exportImages) {
      manifest.imageFiles = imageFiles
    }

    zipFiles['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { mtime: new Date(exportedAt) }]

    const zipped = zipSync(zipFiles, { level: 6 })
    const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gpt-image-playground-backup_${formatExportFileTime(new Date(exportedAt))}.zip`
    a.click()
    URL.revokeObjectURL(url)
    useStore.getState().showToast('数据已导出', 'success')
  } catch (e) {
    useStore
      .getState()
      .showToast(
        `导出失败：${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
  }
}

/** 导出数据到指定路径 */
export async function exportDataToPath(
  filePath: string,
  options: ExportOptions = { exportConfig: true, exportTasks: true },
  behavior: ExportDataToPathBehavior = {},
): Promise<boolean> {
  try {
    if (!isElectronEnv()) throw new Error('当前环境不支持流式导出')
    await ensureImageStorageMigrated()
    const allTasks = options.exportTasks || options.exportImages ? await getAllTasks() : []
    const sopPromptRuns = options.exportTasks || options.exportImages ? await getAllSopBatchSnapshots() : []
    const state = useStore.getState()
    const exportedAt = Date.now()
    const compositeBackup = options.exportConfig ? await buildCompositeBackup() : null
    const ids = options.exportImages
      ? [...new Set([
          ...collectReferencedExportImageIds(allTasks, state.agentConversations),
          ...sopPromptRuns.flatMap((run) => run.referenceImageIds),
        ])]
      : []
    const entries = await buildElectronImageExportEntries(ids, getImage)
    const imageFiles: ExportData['imageFiles'] = {}
    for (const entry of entries) {
      const image = await getImage(entry.imageId)
      imageFiles[entry.imageId] = {
        path: entry.archivePath,
        createdAt: entry.createdAt ?? exportedAt,
        source: image?.source,
        width: image?.width,
        height: image?.height,
      }
    }
    const manifest: ExportData = {
      version: 5,
      exportedAt: new Date(exportedAt).toISOString(),
      includesSecrets: options.includeSecrets === true,
      ...(options.exportConfig ? {
        settings: sanitizeSettingsForBackup(state.settings, options.includeSecrets === true),
        favoriteCollections: state.favoriteCollections,
        defaultFavoriteCollectionId: state.defaultFavoriteCollectionId,
        wordLibraryGroups: state.wordLibraryGroups,
        wordLibraryEntries: state.wordLibraryEntries,
        wordGenerationBatches: state.wordGenerationBatches,
        postprocessState: await getPostprocessBackupState(),
        compositeState: compositeBackup!.compositeState,
        compositeAssetFiles: compositeBackup!.compositeAssetFiles,
        workspaceState: createWorkspaceBackupState(
          state.workspaceTabs,
          state.workspaceTabGroups,
          state.activeWorkspaceTabId,
          options.exportTasks === true,
        ),
      } : {}),
      ...(options.exportTasks ? {
        tasks: allTasks,
        sopPromptRuns,
        agentConversations: getPersistableAgentConversations(state.agentConversations),
      } : {}),
      ...(options.exportImages ? { imageFiles } : {}),
    }
    const result = await exportZipToPath({
      destinationPath: filePath,
      manifestJson: JSON.stringify(manifest, null, 2),
      entries: [
        ...entries.map((entry) => ({
          sourcePath: entry.sourcePath,
          archivePath: entry.archivePath,
          mtime: entry.createdAt,
        })),
        ...(compositeBackup ? await Promise.all([...compositeBackup.assets].map(async ([id, asset]) => ({
          archivePath: compositeBackup.compositeAssetFiles[id]!.path,
          data: new Uint8Array(await asset.blob.arrayBuffer()),
          mtime: asset.createdAt,
        }))) : []),
      ],
    })
    if (!result.success) throw new Error(result.error || '导出失败')
    return true
  } catch (error) {
    if (behavior.showErrorToast !== false) {
      useStore.getState().showToast(`导出失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
    return false
  }
}

/** 导入选项 */
export interface ImportOptions {
  importConfig?: boolean
  importTasks?: boolean
  importImages?: boolean
}

/** 导入 ZIP 数据 */
export async function importData(file: File, options: ImportOptions = { importConfig: true, importTasks: true }): Promise<boolean> {
  try {
    const buffer = await file.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(buffer))

    const manifestBytes = unzipped['manifest.json']
    if (!manifestBytes) throw new Error('ZIP 中缺少 manifest.json')

    const data: ExportData = JSON.parse(strFromU8(manifestBytes))
    validateBackupArchive(data, unzipped, options)
    const replaceWorkspace =
      data.version >= 5 &&
      Boolean(data.workspaceState) &&
      options.importConfig === true &&
      options.importTasks === true

    const importedImageIds: string[] = []
    const importedImages: StoredImage[] = []
    const importedThumbnails: StoredImageThumbnail[] = []
    const importedTasks: TaskRecord[] = []
    
    // Import Images
    if (options.importImages && data.imageFiles) {
      // 还原图片
      for (const [id, info] of Object.entries(data.imageFiles)) {
        const bytes = unzipped[info.path]
        if (!bytes) continue
        const dataUrl = bytesToDataUrl(bytes, info.path)
        
        let localPath: string | undefined
        if (isElectronEnv()) {
          const { saveRawCacheImageToLocal } = await import('./lib/localSave')
          localPath = await saveRawCacheImageToLocal(id, dataUrl) || undefined
        }

        importedImages.push({
          id,
          dataUrl: localPath ? undefined : dataUrl,
          localPath,
          createdAt: info.createdAt,
          source: info.source,
          width: info.width,
          height: info.height,
        })
        if (!localPath) {
          cacheImage(id, dataUrl)
        }
        importedImageIds.push(id)
      }
    }
    if (!options.importTasks && importedImages.length > 0) {
      await commitImportedRecords({ images: importedImages, thumbnails: [], tasks: [] })
    }

    if (options.importTasks) {
      for (const [id, info] of Object.entries(data.thumbnailFiles ?? {})) {
        const bytes = unzipped[info.path]
        if (!bytes) continue
        const thumbnailDataUrl = bytesToDataUrl(bytes, info.path)
        importedThumbnails.push({
          id,
          thumbnailDataUrl,
          width: info.width,
          height: info.height,
          thumbnailVersion: info.thumbnailVersion,
        })
        cacheThumbnail(id, {
          dataUrl: thumbnailDataUrl,
          width: info.width,
          height: info.height,
          thumbnailVersion: info.thumbnailVersion,
        })
      }

      if (data.tasks) {
        for (const task of data.tasks) {
          importedTasks.push(getPersistableTask(task))
        }
      }

      await commitImportedRecords({
        images: importedImages,
        thumbnails: importedThumbnails,
        tasks: importedTasks,
        replaceTasks: replaceWorkspace,
      })
      if (data.sopPromptRuns?.length) {
        await Promise.all(data.sopPromptRuns.map((run) => putSopBatchSnapshot(run)))
      }

      const tasks = await getAllTasks()
      const state = useStore.getState()
      
      const importedAgentConversations = normalizeAgentConversations(data.agentConversations ?? [])
        .filter((conversation) => !isEmptyAgentConversation(conversation))
      useStore.setState((state) => {
        const agentConversations = replaceWorkspace
          ? importedAgentConversations
          : mergeImportedAgentConversations(state.agentConversations, importedAgentConversations)
        const activeAgentConversationId = replaceWorkspace
          ? agentConversations[0]?.id ?? null
          : state.activeAgentConversationId && agentConversations.some((conversation) => conversation.id === state.activeAgentConversationId)
            ? state.activeAgentConversationId
            : importedAgentConversations[0]?.id ?? agentConversations[0]?.id ?? null
        return {
          agentConversations,
          activeAgentConversationId,
        }
      })
      await replaceStoredAgentConversations(useStore.getState().agentConversations)
      skipSupportPromptForImportedData(tasks)
      scheduleThumbnailBackfill(importedImageIds)
    }

    if (options.importConfig) {
      await restoreCompositeBackup(data, unzipped)
      if (data.postprocessState) {
        const { replacePostprocessPersistedState } = await import('./storePostprocess')
        replacePostprocessPersistedState(data.postprocessState)
      }
      const state = useStore.getState()
      
      if (data.settings) {
        state.setSettings(mergeImportedSettings(state.settings, data.settings))
      }

      const importedCollections = normalizeFavoriteCollections(data.favoriteCollections ?? [])
      const favoriteCollections = importedCollections.length
        ? ensureDefaultFavoriteCollection(normalizeFavoriteCollections([...state.favoriteCollections, ...importedCollections]))
        : state.favoriteCollections
      const defaultFavoriteCollectionId = importedCollections.length
        ? resolveDefaultFavoriteCollectionId(favoriteCollections, data.defaultFavoriteCollectionId)
        : state.defaultFavoriteCollectionId
      const tasks = await getAllTasks()
      const normalizedFavorites = normalizeLoadedFavoriteState(tasks, favoriteCollections, defaultFavoriteCollectionId)
      const restoredWorkspace = replaceWorkspace
        ? restoreWorkspaceBackupState(
            data.workspaceState!,
            normalizedFavorites.tasks,
            new Set(Object.keys(data.imageFiles ?? {})),
          )
        : null
      useStore.setState({
        tasks: normalizedFavorites.tasks,
        favoriteCollections: normalizedFavorites.collections,
        defaultFavoriteCollectionId: normalizedFavorites.defaultFavoriteCollectionId,
        ...(restoredWorkspace ? {
          workspaceTabs: restoredWorkspace.tabs,
          workspaceTabGroups: restoredWorkspace.groups,
          activeWorkspaceTabId: restoredWorkspace.activeTabId,
          selectedWorkspaceTabIds: [],
        } : {}),
      })
      if (normalizedFavorites.changed) await Promise.all(normalizedFavorites.tasks.map((task) => putTask(task)))

      if (data.wordLibraryGroups && data.wordLibraryEntries) {
        // 合并分组：去重，以导入数据中的分组为准（同名覆盖）
        const existingGroupMap = new Map(state.wordLibraryGroups.map(g => [g.name, g]))
        const mergedGroups = [...existingGroupMap.values()]
        const groupIdMap = new Map<string, string>()
        for (const importedGroup of data.wordLibraryGroups) {
          if (!importedGroup || typeof importedGroup.id !== 'string' || typeof importedGroup.name !== 'string') continue
          const existing = existingGroupMap.get(importedGroup.name)
          if (!existing) {
            mergedGroups.push(importedGroup)
            groupIdMap.set(importedGroup.id, importedGroup.id)
          } else {
            groupIdMap.set(importedGroup.id, existing.id)
          }
        }
        const remappedImportedEntries = Array.isArray(data.wordLibraryEntries)
          ? data.wordLibraryEntries.map((entry) => {
              if (!isRecord(entry) || typeof entry.groupId !== 'string') return entry
              return { ...entry, groupId: groupIdMap.get(entry.groupId) ?? entry.groupId }
            })
          : []
        const normalizedImportedEntries = normalizeWordLibraryEntries(remappedImportedEntries, mergedGroups)
        // 合并词条：去重（按 key + groupId），以导入数据为准
        const mergedEntries = [...state.wordLibraryEntries]
        for (const importedEntry of normalizedImportedEntries) {
          const entryKey = `${importedEntry.key}:${importedEntry.groupId}`
          const existingIndex = mergedEntries.findIndex(e => `${e.key}:${e.groupId}` === entryKey)
          if (existingIndex >= 0) {
            // 覆盖现有词条
            mergedEntries[existingIndex] = importedEntry
          } else {
            // 确保 groupId 在合并后的分组中存在，如果不存在则分配到第一个分组
            const groupExists = mergedGroups.some(g => g.id === importedEntry.groupId)
            if (groupExists) {
              mergedEntries.push(importedEntry)
            } else if (mergedGroups.length > 0) {
              mergedEntries.push({ ...importedEntry, groupId: mergedGroups[0].id })
            }
          }
        }
        const batchMap = new Map(state.wordGenerationBatches.map((batch) => [batch.id, batch]))
        if (Array.isArray(data.wordGenerationBatches)) {
          for (const batch of data.wordGenerationBatches) {
            if (!isRecord(batch) || typeof batch.id !== 'string' || typeof batch.skillName !== 'string' || typeof batch.sourcePrompt !== 'string') continue
            batchMap.set(batch.id, {
              id: batch.id,
              skillName: batch.skillName,
              sourcePrompt: batch.sourcePrompt,
              referenceImageIds: Array.isArray(batch.referenceImageIds) ? batch.referenceImageIds.filter((id): id is string => typeof id === 'string') : [],
              entryIds: Array.isArray(batch.entryIds) ? batch.entryIds.filter((id): id is string => typeof id === 'string') : [],
              createdAt: typeof batch.createdAt === 'number' ? batch.createdAt : Date.now(),
              archivedAt: typeof batch.archivedAt === 'number' ? batch.archivedAt : null,
            })
          }
        }
        useStore.setState({
          wordLibraryGroups: mergedGroups,
          wordLibraryEntries: mergedEntries,
          wordGenerationBatches: [...batchMap.values()],
        })
      }
    }

    let msg = '数据已成功导入'
    if (options.importTasks && data.tasks) {
      msg = `已导入 ${data.tasks.length} 个任务`
    } else if (options.importImages && data.imageFiles) {
      msg = `已导入 ${Object.keys(data.imageFiles).length} 张图片`
    } else if (options.importConfig && data.settings) {
      msg = '配置已成功导入'
    }

    useStore.getState().showToast(msg, 'success')
    return true
  } catch (e) {
    useStore
      .getState()
      .showToast(
        `导入失败：${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
    return false
  }
}

/** 添加图片到输入（文件上传） */
export async function addImageFromFile(file: File): Promise<void> {
  const image = await createInputImageFromFile(file)
  if (!image) return
  useStore.getState().addInputImage(image)
}

export async function createInputImageFromFile(file: File): Promise<InputImage | null> {
  if (!file.type.startsWith('image/')) return null
  const dataUrl = await fileToDataUrl(file)
  const id = await storeImage(dataUrl, 'upload')
  cacheImage(id, dataUrl)
  return { id, dataUrl }
}

/** 添加图片到输入（右键菜单）—— 支持 data/blob/http URL */
export async function addImageFromUrl(src: string): Promise<void> {
  const res = await fetch(src)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) throw new Error('不是有效的图片')
  const dataUrl = await blobToDataUrl(blob)
  const id = await storeImage(dataUrl, 'upload')
  cacheImage(id, dataUrl)
  useStore.getState().addInputImage({ id, dataUrl })
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
