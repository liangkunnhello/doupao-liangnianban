// ===== 设置 =====

import type { CompositeV2PersistedSnapshot } from './features/composite/lib/compositeV2Types'
import type { AssistantActionPreferences } from './features/assistantActions/types'

export type ApiMode = 'images' | 'responses'
export type AppMode = 'gallery' | 'agent' | 'postprocess'
export type ThemeMode = 'light' | 'dark'
export type ImageSaveLayout = 'flat' | 'batch-folder'
export type ReferenceImageEditAction = 'ask' | 'replace-reference' | 'add-mask'
export const ZIP_DOWNLOAD_ROUTE_VALUES = [
  'task-selection',
  'favorite-collection-selection',
  'image-context-menu-all',
  'task-detail-all',
  'task-detail-partial',
  'agent-round-all',
] as const
export type ZipDownloadRoute = typeof ZIP_DOWNLOAD_ROUTE_VALUES[number]
export const DEFAULT_ZIP_DOWNLOAD_ROUTES: ZipDownloadRoute[] = ['task-selection', 'favorite-collection-selection']
export type BuiltInApiProvider = 'openai' | 'fal'
export type ApiProvider = BuiltInApiProvider | string
export type CustomProviderTemplate = 'http-image'
export const DEFAULT_STREAM_PARTIAL_IMAGES = 1
export const DEFAULT_AGENT_MAX_TOOL_ROUNDS = 15

export type CustomProviderRequestMethod = 'GET' | 'POST'
export type CustomProviderContentType = 'json' | 'multipart'
export type CustomProviderFileSource = 'inputImages' | 'mask'

export interface CustomProviderFileMapping {
  field: string
  source: CustomProviderFileSource
  array?: boolean
}

export interface CustomProviderResultMapping {
  imageUrlPaths?: string[]
  b64JsonPaths?: string[]
}

export interface CustomProviderSubmitMapping {
  path: string
  method?: CustomProviderRequestMethod
  contentType?: CustomProviderContentType
  query?: Record<string, string>
  body?: Record<string, unknown>
  files?: CustomProviderFileMapping[]
  taskIdPath?: string
  result?: CustomProviderResultMapping
}

export interface CustomProviderPollMapping {
  path: string
  method?: CustomProviderRequestMethod
  query?: Record<string, string>
  intervalSeconds?: number
  statusPath: string
  successValues: string[]
  failureValues: string[]
  errorPath?: string
  result: CustomProviderResultMapping
}

export interface CustomProviderDefinition {
  id: string
  name: string
  template?: CustomProviderTemplate
  submit: CustomProviderSubmitMapping
  editSubmit?: CustomProviderSubmitMapping
  poll?: CustomProviderPollMapping
}

export interface ApiProfile {
  id: string
  name: string
  provider: ApiProvider
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  apiMode: ApiMode
  codexCli: boolean
  apiProxy: boolean
  responseFormatB64Json?: boolean
  streamImages?: boolean
  streamPartialImages?: number
  maxConcurrent?: number
  maxRetries?: number
  providerDrafts?: Partial<Record<ApiProvider, Partial<Pick<ApiProfile, 'baseUrl' | 'model' | 'apiMode' | 'codexCli' | 'apiProxy' | 'responseFormatB64Json' | 'streamImages' | 'streamPartialImages' | 'maxConcurrent' | 'maxRetries'>>>>
}

export interface AppSettings {
  /** 界面主题：手动浅色 / 深色 */
  themeMode: ThemeMode
  /** 旧版单配置字段：保留用于导入/查询参数兼容，实际请求以 active profile 为准 */
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  apiMode: ApiMode
  codexCli: boolean
  apiProxy: boolean
  streamImages?: boolean
  streamPartialImages?: number
  customProviders: CustomProviderDefinition[]
  providerOrder?: string[]
  clearInputAfterSubmit: boolean
  persistInputOnRestart: boolean
  reuseTaskApiProfileTemporarily: boolean
  alwaysShowRetryButton: boolean
  taskCompletionNotification: boolean
  enterSubmit: boolean
  referenceImageEditAction: ReferenceImageEditAction
  zipDownloadRoutes: ZipDownloadRoute[]
  imageSaveLayout: ImageSaveLayout
  imageFilenameDatePrefix: boolean
  imageFilenameUsePrompt: boolean
  agentScrollToBottomAfterSubmit: boolean
  agentMaxToolRounds: number
  agentWebSearch: boolean
  assistantActions: AssistantActionPreferences
  wordLibraryDerivativeRule?: string
  wordLibraryDerivativeRuleMode: 'single' | 'multiple'
  wordLibraryDerivativeRules: WordLibraryDerivativeRule[]
  profiles: ApiProfile[]
  activeProfileId: string
  agentProfileId: string | null
  agentUseCustomProfile: boolean
  agentProfile: ApiProfile
  backupInterval: number
  customBackupPath: string
}

// ===== 任务参数 =====

export interface WordLibraryDerivativeRule {
  id: string
  name: string
  content: string
  enabled: boolean
  builtIn?: boolean
}

export const DEFAULT_WORD_LIBRARY_DERIVATIVE_RULE = [
  'Identify the seed entry semantic role first, such as background, style, subject, material, color, composition, lighting, mood, era, or camera treatment.',
  'Keep the core role and noun phrase stable, then derive entries by replacing same-category descriptive modifiers.',
  'For example, red background should derive green background or yellow background; hand-drawn illustration style should derive cartoon illustration style or watercolor illustration style.',
  'Avoid drifting into unrelated prompt concepts, and avoid producing synonyms that only rephrase the exact same idea.',
].join('\n')

export interface TaskParams {
  reference_mode: 'cycle' | 'all'
  size: string
  quality: 'auto' | 'low' | 'medium' | 'high'
  output_format: 'png' | 'jpeg' | 'webp'
  output_compression: number | null
  postprocess_resize_enabled: boolean
  postprocess_size: string
  postprocess_compress_enabled: boolean
  postprocess_format: 'png' | 'jpeg' | 'webp'
  postprocess_max_size_kb: number | null
  moderation: 'auto' | 'low'
  n: number
  /** 稳定且每槽位不同的 seed（仅支持的供应商如 fal 使用；不修改用户 prompt） */
  seed?: number
}

export const DEFAULT_PARAMS: TaskParams = {
  reference_mode: 'cycle',
  size: 'auto',
  quality: 'auto',
  output_format: 'png',
  output_compression: null,
  postprocess_resize_enabled: false,
  postprocess_size: 'auto',
  postprocess_compress_enabled: false,
  postprocess_format: 'webp',
  postprocess_max_size_kb: 399,
  moderation: 'auto',
  n: 1,
}

// ===== 输入图片（UI 层面） =====

export interface InputImage {
  /** IndexedDB image store 的 id（SHA-256 hash） */
  id: string
  /** data URL，用于预览 */
  dataUrl: string
}

export interface InputImageFolder {
  /** 文件夹路径 */
  path: string
  /** 文件夹内所有图片的 ID 列表（按文件名排序） */
  imageIds: string[]
}

export interface MaskDraft {
  targetImageId: string
  maskDataUrl: string
  updatedAt: number
}

// ===== 任务记录 =====

export type TaskStatus = 'running' | 'done' | 'error'

export type TaskProgressStage =
  | 'queued'
  | 'requesting'
  | 'relay-received'
  | 'generating'
  | 'previewing'
  | 'saving'
  | 'recovering'
  | 'completed'
  | 'partial-failure'
  | 'failed'
  | 'stopped'

export type BatchItemStatus = 'done' | 'error'

export interface BatchItemError {
  index: number
  error: string
}

// ===== 批量生成编排（槽位 + 远端请求） =====
// 以下类型用于替换旧的"请求 N 张"语义：编排器负责数量、恢复和去重，
// 供应商适配器只负责提交、查询、取消和解析结果。

export type GenerationSlotStatus =
  | 'pending'
  | 'submitted'
  | 'running'
  | 'validating'
  | 'done'
  | 'failed'

export interface GenerationSlot {
  index: number
  status: GenerationSlotStatus
  /** 该槽位被调度的次数（首轮计 1，每次补偿 +1） */
  attempts: number
  /** commitGeneratedImage 之后回填的图片存储 id */
  outputImageId?: string
  /** 通过指纹校验后回填的 SHA-256 内容哈希 */
  contentHash?: string
  /** 感知哈希（pHash），用于近似重复检测 */
  perceptualHash?: string
  /** 失败原因（status === 'failed' 时） */
  error?: string
}

export type RemoteGenerationProvider = 'openai' | 'fal' | 'custom'

export type RemoteGenerationRequestStatus =
  | 'created'
  | 'submitted'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface RemoteGenerationRequest {
  id: string
  provider: RemoteGenerationProvider
  endpoint?: string
  /** 供应商侧 request id（如 fal requestId / 自定义 taskId） */
  remoteRequestId?: string
  /** 本次请求负责的槽位下标 */
  slotIndexes: number[]
  /** 本次请求向供应商申请的图片数量 */
  requestedCount: number
  /** 调度轮次（首轮为 0，补偿轮次递增） */
  attempt: number
  status: RemoteGenerationRequestStatus
  createdAt: number
  updatedAt: number
  /** 失败 / 错误信息 */
  error?: string
}

export interface TaskRecord {
  id: string
  prompt: string
  params: TaskParams
  /** Stable one-based batch within the task's local date and filename label scope. */
  filenameBatch?: number
  /** 生成时使用的 Provider 类型 */
  apiProvider?: ApiProvider
  /** 生成时使用的 API 配置 ID */
  apiProfileId?: string
  /** 生成时使用的 Provider 名称 */
  apiProfileName?: string
  /** 生成时使用的 API 模式 */
  apiMode?: ApiMode
  /** 生成时使用的模型 ID */
  apiModel?: string
  /** fal.ai 队列请求 ID，用于连接断开后的结果恢复 */
  falRequestId?: string
  /** fal.ai 队列 endpoint，用于连接断开后的状态和结果查询 */
  falEndpoint?: string
  /** fal.ai 任务连接断开后是否等待自动恢复 */
  falRecoverable?: boolean
  /** 自定义异步服务商任务 ID，用于重启后继续查询结果 */
  customTaskId?: string
  /** 自定义异步任务是否等待自动恢复 */
  customRecoverable?: boolean
  /**
   * 批量生成槽位，数量固定等于 params.n。
   * 旧任务可能没有该字段，UI 与编排器均应兼容（按 outputImages 直接展示）。
   */
  generationSlots?: GenerationSlot[]
  /**
   * 所有远端生成请求（fal / 自定义异步），用于应用关闭、崩溃或断网后恢复。
   * 新的多图编排不再依赖单个 falRequestId / customTaskId，但仍保留这两个字段用于兼容旧任务。
   */
  remoteGenerationRequests?: RemoteGenerationRequest[]
  /** API 返回的实际生效参数，用于标记与请求值不一致的情况 */
  actualParams?: Partial<TaskParams>
  /** 输出图片对应的实际生效参数，key 为 outputImages 中的图片 id */
  actualParamsByImage?: Record<string, Partial<TaskParams>>
  /** 输出图片对应的 API 改写提示词，key 为 outputImages 中的图片 id */
  revisedPromptByImage?: Record<string, string>
  /** 输入图片的 image store id 列表 */
  inputImageIds: string[]
  /** 输入图片文件夹路径（仅文件夹批量输入模式有值） */
  inputImageFolderPath?: string
  maskTargetImageId?: string | null
  maskImageId?: string | null
  /** 输出图片的 image store id 列表 */
  outputImages: string[]
  /** 并发多图每个请求的状态，按请求顺序排列，仅部分失败时有值 */
  batchItemStatuses?: BatchItemStatus[]
  /** 并发多图每个失败请求的错误信息 */
  batchItemErrors?: BatchItemError[]
  /** 流式生成的中间步骤图片 id 列表，仅失败时保留供排查/下载 */
  streamPartialImageIds?: string[]
  /** API 返回的原始图片 HTTP URL（非 base64 时记录） */
  rawImageUrls?: string[]
  /** 发生解析错误时的原始响应 JSON */
  rawResponsePayload?: string
  status: TaskStatus
  error: string | null
  progressStage?: TaskProgressStage
  progressMessage?: string
  progressUpdatedAt?: number
  createdAt: number
  finishedAt: number | null
  /** 总耗时毫秒 */
  elapsed: number | null
  /** 是否收藏 */
  isFavorite?: boolean
  /** 所属收藏夹 ID 列表 */
  favoriteCollectionIds?: string[]
  /** 收藏任务专用输出目录；为空时按收藏夹名称回退 */
  favoriteOutputPath?: string
  favoriteOutputUseDateVariable?: boolean
  /** 日程运行任务的显式输出目录 */
  scheduledOutputPath?: string
  /** 日程运行任务的输出子目录 */
  scheduledOutputSubFolder?: string
  localSaveBatchFolder?: string
  localSavedOutputImagePaths?: Record<string, string>
  /** 来源模式：画廊 / Agent */
  sourceMode?: AppMode
  /** Agent 对话 ID */
  agentConversationId?: string
  /** Agent 轮次 ID */
  agentRoundId?: string
  /** Agent 消息 ID */
  agentMessageId?: string
  /** Agent 图像工具调用 ID */
  agentToolCallId?: string
  /** Agent 批量图像工具调用 ID */
  agentBatchCallId?: string
  /** Agent 图像工具实际动作 */
  agentToolAction?: 'generate' | 'edit' | 'auto' | string
}

export interface FavoriteCollection {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export type ScheduleItemStatus = 'idle' | 'queued' | 'running' | 'done' | 'error'

export interface ScheduleItem {
  id: string
  taskId: string
  collectionId: string | null
  date: string
  rowId: string
  order: number
  count: number
  time: string | null
  lastRunKey?: string
  status?: ScheduleItemStatus
  lastTaskIds?: string[]
  lastError?: string
}

export interface ScheduleRow {
  id: string
  name: string
  order: number
}

export interface ScheduleState {
  rows: ScheduleRow[]
  items: ScheduleItem[]
  activeWeekStart: string
  modalOpen: boolean
  runningWeekStarts: string[]
}

// ===== Agent 模式 =====

export type AgentMessageRole = 'user' | 'assistant'
export type AgentRoundStatus = 'running' | 'done' | 'error'

export interface AgentMessage {
  id: string
  role: AgentMessageRole
  content: string
  roundId: string
  inputImageIds?: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null
  outputTaskIds?: string[]
  createdAt: number
}

export interface AgentRound {
  id: string
  index: number
  parentRoundId?: string | null
  userMessageId: string
  assistantMessageId?: string
  prompt: string
  inputImageIds: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null
  outputTaskIds: string[]
  responseId?: string
  responseOutput?: ResponsesOutputItem[]
  status: AgentRoundStatus
  error: string | null
  createdAt: number
  finishedAt: number | null
}

export interface AgentConversation {
  id: string
  title: string
  activeRoundId?: string | null
  createdAt: number
  updatedAt: number
  rounds: AgentRound[]
  messages: AgentMessage[]
}

// ===== IndexedDB 存储的图片 =====

export interface StoredImage {
  id: string
  /** 
   * 图片的 Base64 数据或 Blob URL。
   * 当使用本地文件系统存储时，数据库中此字段可为空或保留为 Blob URL（不存入DB），
   * 但为了兼容 Web 版本和内存缓存，保持该字段可选。
   */
  dataUrl?: string
  /** 图片首次存储时间（ms） */
  createdAt?: number
  /** 图片来源：用户上传 / API 生成 / 遮罩 */
  source?: 'upload' | 'generated' | 'mask'
  /** 原图宽度 */
  width?: number
  /** 原图高度 */
  height?: number
  /** 本地文件绝对路径（仅 Electron 环境下存在） */
  localPath?: string
}

export interface StoredImageThumbnail {
  id: string
  /** 列表缩略图，用于避免卡片页解码完整 4K 原图 */
  thumbnailDataUrl: string
  /** 原图宽度 */
  width?: number
  /** 原图高度 */
  height?: number
  /** 缩略图生成参数版本 */
  thumbnailVersion?: number
}

export interface StoredCompositeAsset {
  id: string
  blob: Blob
  createdAt: number
}

// ===== API 请求体 =====

export interface ImageGenerationRequest {
  model: string
  prompt: string
  size: string
  quality: string
  output_format: string
  moderation: string
  output_compression?: number
  n?: number
}

// ===== API 响应 =====

export interface ImageResponseItem {
  b64_json?: string
  url?: string
  revised_prompt?: string
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
}

export interface ImageApiResponse {
  data: ImageResponseItem[]
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  n?: number
}

export interface ResponsesOutputItem {
  id?: string
  type?: string
  status?: string
  action?: string | Record<string, unknown>
  /** function_call: unique call id for sending back function_call_output */
  call_id?: string
  /** function_call: function name */
  name?: string
  /** function_call: JSON-encoded arguments string */
  arguments?: string
  /** function_call_output: JSON/text output string */
  output?: string
  annotations?: Array<{
    type?: string
    start_index?: number
    end_index?: number
    url?: string
    title?: string
  }>
  content?: Array<{
    type?: string
    text?: string
    annotations?: Array<{
      type?: string
      start_index?: number
      end_index?: number
      url?: string
      title?: string
    }>
  }>
  result?: string | {
    b64_json?: string
    base64?: string
    image?: string
    data?: string
  }
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  revised_prompt?: string
}

export interface ResponsesApiResponse {
  id?: string
  output?: ResponsesOutputItem[]
  tools?: Array<{
    type?: string
    size?: string
    quality?: string
    output_format?: string
    output_compression?: number
    moderation?: string
    n?: number
  }>
}

export interface FalImageFile {
  url?: string
  content_type?: string
  file_name?: string
  width?: number
  height?: number
  b64_json?: string
  base64?: string
  data?: string
}

export interface FalApiResponse {
  images?: FalImageFile[]
  image?: FalImageFile | string
  url?: string
  seed?: number
}

// ===== 词条库 =====

export interface WordLibraryGroup {
  id: string
  name: string
  sortOrder: number
  /** Only one nesting level is supported to keep large libraries navigable. */
  parentId?: string | null
  description?: string
  color?: string
  archivedAt?: number | null
}

export interface WordLibraryEntry {
  id: string
  groupId: string
  key: string
  label: string
  entries: string[]
  draw_count: number
  /** 分组内排序权重，越小越靠前（置顶词条优先） */
  sortOrder: number
  isPinned: boolean
  isFavorite: boolean
  tags: string[]
  /** 删除时间（ms）；非空表示已进入回收站（软删除），列表默认不展示 */
  deletedAt: number | null
  createdAt: number
  updatedAt: number
  /** 被引用/抽取的使用次数，用于「使用频率」排序 */
  usageCount: number
  /** Skill-generated entries keep their origin so they can be reviewed as a batch. */
  sourceSkillName?: string
  generationBatchId?: string
}

export interface WordGenerationBatch {
  id: string
  skillName: string
  sourcePrompt: string
  referenceImageIds: string[]
  entryIds: string[]
  createdAt: number
  archivedAt: number | null
}

/** 词条库视图：列表视图 / 回收站视图 */
export type WordLibraryView = 'list' | 'trash'

/** 词条排序方式 */
export type WordLibrarySortType =
  | 'manual'
  | 'updatedAt'
  | 'createdAt'
  | 'usage'
  | 'title'

/** 词条库导入/导出数据结构（用于备份与迁移） */
export interface WordLibraryExportData {
  version: number
  exportedAt: number
  groups: WordLibraryGroup[]
  entries: WordLibraryEntry[]
  batches?: WordGenerationBatch[]
}

// ===== 导出数据 =====

/** ZIP manifest.json 格式 */
export interface ExportData {
  version: number
  exportedAt: string
  includesSecrets?: boolean
  settings?: AppSettings
  tasks?: TaskRecord[]
  favoriteCollections?: FavoriteCollection[]
  defaultFavoriteCollectionId?: string | null
  agentConversations?: AgentConversation[]
  wordLibraryGroups?: WordLibraryGroup[]
  wordLibraryEntries?: WordLibraryEntry[]
  wordGenerationBatches?: WordGenerationBatch[]
  /** imageId → 图片信息 */
  imageFiles?: Record<string, {
    path: string
    createdAt?: number
    source?: 'upload' | 'generated' | 'mask'
    width?: number
    height?: number
  }>
  /** imageId → 缩略图信息 */
  thumbnailFiles?: Record<string, {
    path: string
    width?: number
    height?: number
    thumbnailVersion?: number
  }>
  compositeState?: CompositeV2PersistedSnapshot
  postprocessState?: import('./storePostprocess').PostprocessPersistedState
  workspaceState?: WorkspaceBackupState
  compositeAssetFiles?: Record<string, {
    path: string
    createdAt: number
    type: string
  }>
}

// ===== 工作区标签页 =====

export interface WorkspaceTabGroup {
  id: string
  name: string
  order: number
  collapsed: boolean
}

export interface WorkspaceTab {
  id: string
  name: string
  groupId: string | null
  prompt: string
  inputImages: InputImage[]
  inputImageFolder: InputImageFolder | null
  params: TaskParams
  maskDraft: MaskDraft | null
  maskEditorImageId: string | null
  customOutputPath: string
  tasks: TaskRecord[]
  createdAt: number
  updatedAt: number
  order: number
}

export interface WorkspaceBackupTab {
  id: string
  name: string
  groupId: string | null
  prompt: string
  inputImageIds: string[]
  inputImageFolder: InputImageFolder | null
  params: TaskParams
  maskDraft: MaskDraft | null
  maskEditorImageId: string | null
  customOutputPath: string
  taskIds: string[]
  createdAt: number
  updatedAt: number
  order: number
}

export interface WorkspaceBackupState {
  tabs: WorkspaceBackupTab[]
  groups: WorkspaceTabGroup[]
  activeTabId: string | null
}
