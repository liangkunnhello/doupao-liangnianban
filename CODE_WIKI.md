# GPT Image Playground（豆泡）— Code Wiki

> 结构化项目文档，基于源码分析生成，涵盖架构、模块、类型、关键函数与运行方式。
> 反映截至 **v0.6.8** 的代码结构。

---

## 目录

1. [项目整体架构](#1-项目整体架构)
2. [主要模块职责](#2-主要模块职责)
3. [关键类型定义](#3-关键类型定义)
4. [关键函数与业务逻辑](#4-关键函数与业务逻辑)
5. [依赖关系](#5-依赖关系)
6. [项目运行方式](#6-项目运行方式)
7. [关键设计决策与约束](#7-关键设计决策与约束)
8. [文件索引](#8-文件索引)

---

## 1. 项目整体架构

### 1.1 项目定位

GPT Image Playground（应用名 **DOUPAO Image** / **豆泡**）是一个 **AI 图像生成桌面客户端**，同时也可作为 PWA 在浏览器中运行。它提供两种工作模式：

- **画廊模式（gallery）**：经典任务式生图，输入提示词 + 参考图 + 参数，并发生成、查看、收藏、编辑。
- **Agent 模式（agent）**：多轮对话式生图，模型可自主调用图像工具（单图 / 批量 / 续轮 / 联网搜索）。

支持多种图像服务商：**OpenAI 兼容接口**（`images` / `responses` 两种 API 模式）、**fal.ai**、以及用户自定义的 **HTTP 图像服务商**（支持同步与异步轮询）。

### 1.2 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 桌面壳 | Electron（ESM 主进程 + CJS preload） | ^33 |
| 自动更新 | electron-updater（GitHub Releases） | ^6.8 |
| 前端框架 | React + TypeScript | 19.1 / 5.8 |
| 构建工具 | Vite + vite-plugin-electron | 6.3 / 0.28 |
| 状态管理 | Zustand（持久化到 Electron `userData` / localStorage） | ^5.0 |
| 样式方案 | Tailwind CSS（经 PostCSS 引入） | ^3.4 |
| 数据存储 | 原生 IndexedDB（前端）+ Electron 文件系统（本地） | — |
| 压缩/解压 | fflate（ZIP 导入/导出、备份） | ^0.8 |
| Markdown | react-markdown + remark-gfm + streamdown | 10.1 / 4 / 2.5 |
| 图像服务商 SDK | @fal-ai/client | ^1.10 |
| 测试 | Vitest | ^4.1 |
| 桌面打包 | electron-builder | ^25 |

> 注：图标使用项目内自绘 SVG（`src/components/icons.tsx`），**不依赖** lucide-react；IndexedDB 使用**原生 API**（`src/lib/db.ts`），**不依赖** Dexie。

### 1.3 目录结构

```
gpt_image_playground-main/
├── electron/
│   ├── main.ts              # Electron 主进程入口（窗口、自动更新）
│   ├── preload.ts           # 预加载脚本源（构建为 CJS preload.cjs）
│   ├── preload.cjs          # 构建产物（被 preload.ts 覆盖）
│   ├── ipc-handlers.ts      # IPC 处理器（文件系统、本地保存、备份）
│   └── tsconfig.json
├── public/                  # 静态资源（app-icon、PWA manifest、sw.js）
├── prompts/                 # 提示词样本文本（运行时生成的缓存文件）
├── scripts/
│   └── mock-image-api.mjs   # 本地 mock 图像 API（开发调试）
├── src/
│   ├── main.tsx             # React 渲染入口（含 SW 注册、移动端视口修正）
│   ├── App.tsx              # 根组件（模式路由、初始化、备份策略）
│   ├── store.ts             # Zustand store（≈6000 行，核心状态与业务逻辑）
│   ├── types.ts             # 全局 TypeScript 类型定义
│   ├── index.css            # 全局样式 + Tailwind 指令
│   ├── components/          # React 组件（≈30 个）
│   ├── hooks/               # 自定义 Hooks（7 个）
│   └── lib/                 # 工具库与业务逻辑（≈30 个模块）
├── index.html               # HTML 入口
├── package.json
├── vite.config.ts           # Vite 配置（Electron 插件 + dev proxy）
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
└── start.bat                # Windows 一键启动脚本
```

### 1.4 构建配置要点

`vite.config.ts` 的关键设计：

- **双入口 Electron 构建**：`electron/main.ts`（主进程）与 `electron/preload.ts`（preload，强制 CJS 输出 `dist-electron/electron/preload.cjs`）分别构建。
- **dev proxy**：开发时读取 `dev-proxy.config.json`（可选），通过 `normalizeDevProxyConfig` 规范化后注入 `server.proxy`，并以 `__DEV_PROXY_CONFIG__` 全局常量传给前端，用于运行时 `buildApiUrl` 的 `api-proxy` 前缀拼接。
- **版本注入**：`__APP_VERSION__` 来自 `package.json`，供「关于」页展示。
- **base: './'**：相对路径，便于 Electron `loadFile` 与 PWA 部署。

`package.json` 的 `build` 段（electron-builder）：

- 发布到 GitHub（`owner: nideyilian / repo: doupao`）。
- Windows：`nsis`（可选安装目录）+ `portable`，x64。
- macOS：`dmg`；Linux：`AppImage`。

---

## 2. 主要模块职责

### 2.1 Electron 主进程（`electron/main.ts`）

- 创建 `BrowserWindow`：`1400×900`、`minWidth 800 / minHeight 600`、`autoHideMenuBar`、`webSecurity: false`、`contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`、`devTools: false`。
- 配置 **electron-updater**：`autoDownload: true`、`autoInstallOnAppQuit: true`、`allowPrerelease: true`（规避 GitHub `latest.yml` 的 406），FeedURL 指向 `nideyilian/doupao`。
- 将 updater 的全部生命周期事件（checking / available / downloading / downloaded / error）转发为渲染进程的 `update:status` IPC 消息，并把技术错误**翻译为中文友好提示**。
- 在 `app.whenReady` 中调用 `initLocalSavePath()` 与 `registerIpcHandlers()`，注册 `update:check / update:download / update:install / app:get-version` 四个 `ipcMain.handle`，生产环境下延迟 5s 自动检查更新。

### 2.2 Preload 脚本（`electron/preload.ts`）

通过 `contextBridge.exposeInMainWorld('electronAPI', {...})` 向渲染进程暴露**安全、受限**的 IPC 接口（不暴露 `require` / `fs`）。暴露的接口包括：

| 分组 | 方法 |
|------|------|
| 文件系统 | `saveImage`、`saveJson`、`saveText`、`ensureDir`、`pathJoin`、`checkExists`、`readDir`、`readFileBuffer`、`openInExplorer`、`selectDirectory`、`getDefaultPath`、`getDesktopPath` |
| 本地保存 | `getLocalSavePath`、`setLocalSavePath` |
| 数据/备份 | `readJsonText`、`writeJsonText`、`listBackups`、`checkBackupHasData`、`restoreFromBackup`、`deleteBackup`、`saveZipBuffer` |
| 自动更新 | `onUpdateStatus`（监听）、`checkForUpdate`、`downloadUpdate`、`installUpdate`、`getAppVersion` |
| 标志 | `isElectron: true` |

### 2.3 IPC 处理器（`electron/ipc-handlers.ts`）

`registerIpcHandlers()` 注册约 20 个 `ipcMain.handle`：

- **文件读写**：`fs:save-image`（data URL → Buffer）、`fs:save-json`、`fs:save-text`、`fs:read-file-buffer`、`fs:read-dir`、`fs:check-exists`、`fs:ensure-dir`、`fs:path-join`、`fs:open-in-explorer`（`shell.showItemInFolder`）、`fs:select-directory`（系统对话框）。
- **本地保存路径**：`store:get-local-save-path` / `store:set-local-save-path`，持久化在 `userData/local-settings.json`，默认 `userData/local-saves`。
- **带备份的 JSON 写入** `fs:write-json-text`：
  - 写入前先 `.bak` 快照，再写 `.tmp` 后 `rename`（原子写）。
  - 按 `backupInterval`（分钟）节流地把旧文件复制到 `backups/` 目录，文件名带时间戳。
  - 仅保留最近 **30** 个备份（旧的清空内容）。
- **备份管理**：`fs:list-backups`、`fs:check-backup-has-data`（解析 JSON 判断 `tasks` / `agentConversations` 是否非空）、`fs:restore-from-backup`、`fs:delete-backup`。
- **ZIP 导出**：`fs:save-zip-buffer`（ArrayBuffer → 文件）。

### 2.4 状态管理（`src/store.ts`）

Zustand store（`create<AppState>()`）是应用的**核心**，约 **5966 行**，职责：

- **生命周期**：`initStore()` 从 IndexedDB 加载 tasks / agentConversations，合并旧版数据，标记中断任务，调度 fal/custom 任务恢复，分配画廊任务到默认标签页。
- **任务执行**：画廊生图（含并发、重试、文件夹批量、流式中间图）、任务重试/删除、本地保存（图片/元数据/提示词）。
- **图片缓存**：内存 LRU 缓存（`MAX_IMAGE_CACHE_ENTRIES=8`、`MAX_THUMBNAIL_CACHE_ENTRIES=80`）、缩略图回填（并发上限 4）、IndexedDB 持久化。
- **Agent 对话**：多轮对话、流式响应、工具调用循环（`agentRoundControllers` 用 `AbortController` 支持停止）、标题自动生成。
- **配置/设置**：`AppSettings` 规范化与持久化、多 API Profile、Provider 草稿（`providerDrafts`）。
- **收藏夹 / 词库 / 工作区标签**：多对多收藏关系、词条分组与随机渲染、可分组的多标签页。
- **导入/导出**：ZIP 备份与恢复（`exportData` / `importData` / `exportDataToPath`）。
- **UI 状态**：详情弹窗、灯箱、设置弹窗、Toast、确认对话框、各种侧栏开关。

### 2.5 渲染入口与根组件

**`src/main.tsx`**：

- 引入 `core-js/actual/array/at`（兼容旧环境）、`streamdown/styles.css`、`index.css`。
- 调用 `installMobileViewportGuards()`（移动端视口修正）。
- 生产环境注册 `sw.js`（PWA 离线缓存），开发环境主动注销已注册的 SW。
- `createRoot(...).render(<StrictMode><App /></StrictMode>)`。

**`src/App.tsx`**：

- 初始化序列（`useEffect`，含 StrictMode 重复执行保护）：
  1. 从 URL query 读取并应用设置（`buildSettingsFromUrlParams`），处理后清除 query。
  2. 若存在自定义服务商配置 URL，异步拉取并合并（`loadCustomProviderSettingsFromUrl` + `mergeImportedSettings`）。
  3. 调用 `initStore()`（仅一次，用 `window.__storeInitialized` 守卫）。
  4. **备份策略**：Electron 环境下，若数据为空且未提醒过，扫描备份列表；发现可用备份则提示恢复，否则提示「备份到桌面」。
  5. **每周自动备份**：距上次自动备份 ≥ 7 天时，把 ZIP 备份到桌面。
- 全局阻止页面图片被拖拽。
- 布局：`WorkspaceTabBar`（顶/侧标签）+ `Header` + 模式区（`AgentWorkspace` 或 `SearchBar`+`TaskGrid`/`FavoriteCollectionsView`）+ `InputBar` + 一组 **懒加载** 的弹窗/侧栏（`DetailModal`、`Lightbox`、`SettingsModal`、`MaskEditorModal` 等，用 `React.lazy` 包裹）。

### 2.6 核心组件（`src/components/`）

| 组件 | 行数 | 职责 |
|------|------|------|
| `InputBar.tsx` | 2595 | 输入区：提示词编辑、参考图管理、参数（尺寸/质量/格式/并发/重试）、遮罩编辑入口、提交；支持文件夹批量、词条变量 |
| `SettingsModal.tsx` | 2843 | 设置弹窗（多 Tab：通用 / Agent / API 配置 / 数据 / 备份 / 关于） |
| `FavoriteCollections.tsx` | 1303 | 收藏夹视图、收藏选择器、收藏夹管理弹窗（3 个导出组件） |
| `AgentWorkspace.tsx` | 1192 | Agent 模式工作区：对话流、轮次编辑、工具调用结果、引用/输出资源面板 |
| `DetailModal.tsx` | 1067 | 任务详情：大图、实际参数、错误、批量状态、重新生成 |
| `MaskEditorModal.tsx` | 919 | Canvas 手绘遮罩编辑器（笔刷大小、橡皮、覆盖率校验） |
| `TaskCard.tsx` | 763 | 单个任务卡片：缩略图、状态徽标、选择、收藏、流式预览 |
| `WordLibrarySidebar.tsx` | 731 | 右侧词库侧栏（分组、词条增删、变量编辑、随机预览） |
| `WorkspaceTabBar.tsx` | 620 | 工作区标签栏（新建/重命名/分组/折叠/拖拽） |
| `Lightbox.tsx` | 599 | 全屏图片预览（键盘导航、对比、下载） |
| `Select.tsx` | 388 | 自定义下拉选择组件 |
| `SizePickerModal.tsx` | 365 | 尺寸选择（推荐集 + 自定义 + 比例计算） |
| `WorkspaceTabManagerModal.tsx` | 359 | 标签管理弹窗 |
| `TaskGrid.tsx` | 313 | 任务网格（虚拟滚动、筛选、多选、拖选） |
| `HistoryModal.tsx` | 300 | 历史记录弹窗 |
| `RandomPromptModal.tsx` | 284 | 随机提示词生成器（基于词库） |
| `Header.tsx` | 254 | 顶部栏（模式切换、设置、更新状态） |
| `ImageContextMenu.tsx` | 223 | 图片右键菜单（下载、复制、收藏、设为参考图） |
| `MarkdownRenderer.tsx` | 184 | Markdown 渲染（react-markdown + GFM + 安全清洗） |
| `icons.tsx` | 185 | 自绘 SVG 图标库 |
| `HelpModal.tsx` | 180 | 帮助弹窗 |
| `ConfirmDialog.tsx` | 156 | 通用确认对话框（支持多按钮、复选框、危险/警告色调） |
| `VarEntryEditor.tsx` | 126 | 词条变量编辑器 |
| `ViewportTooltip.tsx` | 111 | 悬浮提示 |
| `SearchBar.tsx` | 96 | 搜索栏（关键词、状态筛选、收藏筛选） |
| `PromptInputDialog.tsx` | 83 | 提示输入弹窗 |
| `SupportPromptModal.tsx` | 85 | 支持/赞助弹窗（任务量达阈值时提示） |
| `Toast.tsx` | 41 | 全局 Toast |
| `ErrorBoundary.tsx` | 47 | React 错误边界 |
| `Checkbox.tsx` | 29 | 复选框 |
| `WordLibrarySidebarToggle.tsx` | 28 | 词库侧栏开关按钮 |

### 2.7 自定义 Hooks（`src/hooks/`）

| Hook | 职责 |
|------|------|
| `useAutoUpdate.ts` | 封装 `electronAPI.onUpdateStatus`，返回更新状态机（idle/checking/available/downloading/downloaded/error）与 check/download/install/reset |
| `useVersionCheck.ts` | 版本检查（非 Electron 环境下的 Web 版本检测） |
| `useCloseOnEscape.ts` | 按 ESC 关闭弹窗 |
| `useDragSelect.ts` | 任务网格拖拽多选 |
| `useTooltip.ts` / `useHintTooltip.ts` | 悬浮提示与首次使用引导提示 |
| `usePreventBackgroundScroll.ts` | 弹窗打开时禁止背景滚动 |

### 2.8 工具库概览（`src/lib/`）

| 模块 | 行数 | 职责 |
|------|------|------|
| `api.ts` | 11 | **API 统一分发入口** `callImageApi` |
| `apiProfiles.ts` | 782 | 设置/Profile 规范化、自定义服务商定义、导入合并、默认值 |
| `openaiCompatibleImageApi.ts` | 865 | OpenAI 兼容（images/responses）+ 自定义 HTTP 服务商调用 |
| `falAiImageApi.ts` | 201 | fal.ai 调用（队列模式 + 恢复） |
| `imageApiShared.ts` | 213 | API 共享：类型、MIME、尺寸、错误、并发重试、URL→dataURL |
| `agentApi.ts` | 812 | Agent 工具定义、流式解析、批量图像工具 |
| `agentImageReferences.ts` | 70 | Agent 对话中的 `<ref>` 图片引用解析与替换 |
| `agentWebSearch.ts` | 61 | Agent 联网搜索工具 |
| `db.ts` | 329 | IndexedDB 封装（tasks/images/thumbnails/agentConversations） |
| `localSave.ts` | 288 | 本地文件系统保存（封装 `electronAPI`） |
| `promptGenerator.ts` | 135 | 词库渲染、带种子的随机变量抽取 |
| `promptImageMentions.ts` | 158 | 提示词中 `@选中图片n` 等引用的解析与替换 |
| `mask.ts` / `maskPreprocess.ts` | 28 / 104 | 遮罩覆盖率校验、遮罩预处理 |
| `canvasImage.ts` | 97 | Canvas 图片/遮罩合成、Blob 转换 |
| `size.ts` | 229 | 尺寸规范化、比例计算、推荐尺寸集 |
| `devProxy.ts` | 86 | dev proxy 配置与 `buildApiUrl` |
| `downloadImages.ts` | 118 | 批量打包下载（ZIP） |
| `urlSettings.ts` | 111 | URL query 参数化的设置导入 |
| `customProviderConfigUrl.ts` | 46 | 从 URL 导入自定义服务商配置 |
| `paramCompatibility.ts` | 41 | 参数兼容性（codexCli 等历史模式） |
| `paramDisplay.tsx` | 107 | 参数展示格式化 |
| `browserNotification.ts` | 55 | 任务完成浏览器通知 |
| `clipboard.ts` | 113 | 复制到剪贴板 |
| `viewport.ts` / `viewportTransform.ts` | 17 / 95 | 移动端视口修正与变换 |
| `dropdown.ts` / `domRect.ts` / `tooltipDismiss.ts` / `clickSuppression.ts` | 小 | UI 交互辅助 |
| `runtimeEnv.ts` | 3 | 运行时环境变量读取（`VITE_*`） |
| `taskPromptDisplay.ts` | 5 | 任务提示词展示辅助 |

---

## 3. 关键类型定义

所有核心类型集中在 `src/types.ts`。

### 3.1 模式与枚举

```typescript
export type ApiMode = 'images' | 'responses'        // 两种 OpenAI 兼容 API 形态
export type AppMode = 'gallery' | 'agent'           // 应用两种工作模式
export type BuiltInApiProvider = 'openai' | 'fal'
export type ApiProvider = BuiltInApiProvider | string // string = 自定义服务商 id
export type TaskStatus = 'running' | 'done' | 'error'
export type ReferenceImageEditAction = 'ask' | 'replace-reference' | 'add-mask'

export const DEFAULT_STREAM_PARTIAL_IMAGES = 1
export const DEFAULT_AGENT_MAX_TOOL_ROUNDS = 15
export const DEFAULT_ZIP_DOWNLOAD_ROUTES = ['task-selection', 'favorite-collection-selection']
```

### 3.2 任务参数 `TaskParams`

```typescript
export interface TaskParams {
  size: string                     // 如 '1024x1024' 或 'auto'
  quality: 'auto' | 'low' | 'medium' | 'high'
  output_format: 'png' | 'jpeg' | 'webp'
  output_compression: number | null
  moderation: 'auto' | 'low'
  n: number                        // 生成数量
}
```

### 3.3 API 配置 `ApiProfile`

```typescript
export interface ApiProfile {
  id: string
  name: string
  provider: ApiProvider            // 'openai' | 'fal' | custom id
  baseUrl: string
  apiKey: string
  model: string
  timeout: number                  // 秒
  apiMode: ApiMode                 // 'images' | 'responses'
  codexCli: boolean                // codex CLI 兼容模式（注入 prompt 守卫）
  apiProxy: boolean                // 是否走 api-proxy
  responseFormatB64Json?: boolean
  streamImages?: boolean
  streamPartialImages?: number
  maxConcurrent?: number           // 1-999
  maxRetries?: number              // 0-10
  providerDrafts?: Partial<Record<ApiProvider, ...>> // 切换 provider 时保留各 provider 的草稿
}
```

### 3.4 自定义服务商 `CustomProviderDefinition`

```typescript
export type CustomProviderTemplate = 'http-image'

export interface CustomProviderDefinition {
  id: string
  name: string
  template?: 'http-image'
  submit: CustomProviderSubmitMapping      // 生成/提交映射
  editSubmit?: CustomProviderSubmitMapping // 编辑映射（multipart）
  poll?: CustomProviderPollMapping         // 异步轮询映射（可选）
}
```

- `CustomProviderSubmitMapping`：`path` / `method` / `contentType`(`json`|`multipart`) / `query` / `body`（支持 `$profile.model`、`$prompt`、`$params.size` 等模板变量）/ `files`（`inputImages`|`mask` 映射）/ `taskIdPath`（异步任务 id 路径）/ `result`（`imageUrlPaths` + `b64JsonPaths`）。
- `CustomProviderPollMapping`：`path`（支持 `{task_id}`）/ `statusPath` / `successValues` / `failureValues` / `errorPath` / `intervalSeconds` / `result`。

### 3.5 应用设置 `AppSettings`

```typescript
export interface AppSettings {
  // 旧版单配置字段（向后兼容，实际以 active profile 为准）
  baseUrl, apiKey, model, timeout, apiMode, codexCli, apiProxy, streamImages, streamPartialImages
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
  agentScrollToBottomAfterSubmit: boolean
  agentMaxToolRounds: number
  agentWebSearch: boolean
  profiles: ApiProfile[]                  // 多 API 配置
  activeProfileId: string
  agentProfileId: string | null
  agentUseCustomProfile: boolean
  agentProfile: ApiProfile                // Agent 独立配置
  backupInterval: number
  customBackupPath: string
}
```

### 3.6 任务记录 `TaskRecord`（关键字段）

```typescript
export interface TaskRecord {
  id, prompt, params: TaskParams
  apiProvider?, apiProfileId?, apiProfileName?, apiMode?, apiModel?
  // 异步恢复
  falRequestId?, falEndpoint?, falRecoverable?
  customTaskId?, customRecoverable?
  // 实际生效参数与改写提示词
  actualParams?, actualParamsByImage?, revisedPromptByImage?
  inputImageIds, inputImageFolderPath?, maskTargetImageId?, maskImageId?
  outputImages, batchItemStatuses?, batchItemErrors?, streamPartialImageIds?
  rawImageUrls?, rawResponsePayload?
  status: TaskStatus, error, createdAt, finishedAt?, elapsed?
  isFavorite?, favoriteCollectionIds?
  // Agent 关联
  sourceMode?, agentConversationId?, agentRoundId?, agentMessageId?, agentToolCallId?, agentBatchCallId?, agentToolAction?
}
```

### 3.7 Agent 对话模型

```typescript
export interface AgentMessage { id, role: 'user'|'assistant', content, roundId, inputImageIds?, maskTargetImageId?, maskImageId?, outputTaskIds?, createdAt }
export interface AgentRound { id, index, parentRoundId?, userMessageId, assistantMessageId?, prompt, inputImageIds, maskTargetImageId?, maskImageId?, outputTaskIds, responseId?, responseOutput?, status, error, createdAt, finishedAt? }
export interface AgentConversation { id, title, activeRoundId?, createdAt, updatedAt, rounds: AgentRound[], messages: AgentMessage[] }
```

### 3.8 IndexedDB 存储类型

```typescript
export interface StoredImage { id, dataUrl, createdAt?, source?: 'upload'|'generated'|'mask', width?, height? }
export interface StoredImageThumbnail { id, thumbnailDataUrl, width?, height?, thumbnailVersion? }
```

### 3.9 工作区与导出

```typescript
export interface WorkspaceTabGroup { id, name, order, collapsed }
export interface WorkspaceTab { id, name, groupId, prompt, inputImages, inputImageFolder, params, maskDraft, maskEditorImageId, tasks, createdAt, updatedAt, order }
export interface ExportData { version, exportedAt, settings?, tasks?, favoriteCollections?, ..., agentConversations?, wordLibraryGroups?, wordLibraryEntries?, imageFiles?, thumbnailFiles? }
```

---

## 4. 关键函数与业务逻辑

### 4.1 API 调用层（`src/lib/api.ts` + 实现）

#### `callImageApi(opts)` — 统一入口

```typescript
const profile = getActiveApiProfile(opts.settings)
if (profile.provider === 'fal') return callFalAiImageApi(opts, profile)
return callOpenAICompatibleImageApi(opts, profile, getCustomProviderDefinition(opts.settings, profile.provider))
```

#### `callOpenAICompatibleImageApi()`（`openaiCompatibleImageApi.ts`）

三态分发：

1. **自定义 HTTP 服务商**（`customProvider` 非空）→ `callCustomHttpImageApi`：
   - 用 `resolveTemplateValue` 解析 `body` 中的 `$` 模板变量（上下文含 `profile/prompt/params/inputImages/mask`）。
   - `multipart` 时用 `createCustomMultipartBody` 组 FormData；`json` 时直接 `JSON.stringify`。
   - 若 `taskIdPath` 存在：提取异步任务 id，回调 `onCustomTaskEnqueued`，进入 `pollCustomTaskResult` 轮询（状态判定 + 可恢复错误重试 + 可重试 HTTP 状态码重试）。
   - 结果用 `getAllByPath` 按 `imageUrlPaths` / `b64JsonPaths` 路径提取（支持 `*` 通配与数组下标）。
2. **`apiMode: 'images'`** → `callImagesApiSingle`：
   - 无输入图：`POST {baseUrl}/images/generations`，JSON body。
   - 有输入图：`POST {baseUrl}/images/edits`，FormData（`image[]` + 可选 `mask`）。
   - 支持 `stream`（SSE 解析 `image_generation.partial_image` / `completed` 等事件）。
3. **`apiMode: 'responses'`** → `callResponsesImageApiSingle`：
   - `POST {baseUrl}/responses`，body 含 `input`（文本 + `input_image` 数组）与 `tools`（`image_generation` 工具）。
   - 同样支持流式 `response.image_generation_call.partial_image`。

所有请求统一：`Authorization: Bearer`、`AbortController` 超时（`profile.timeout * 1000`）、`api-proxy` 前缀（当 `useApiProxy`）。

#### `callFalAiImageApi()`（`falAiImageApi.ts`）

- 用 `@fal-ai/client` 的 `fal.config` 配置 credentials（可选 `proxyUrl`）。
- 编辑模式自动追加 `/edit` endpoint；`image_size` 由 `size` 解析，`auto` 直传。
- 队列模式：`falRequestId` / `falEndpoint` 回传给上层，连接断开后由 store 的 `scheduleFalRecovery` 重试（`FAL_RECOVERY_POLL_MS = 10s`）。

### 4.2 并发与重试（`imageApiShared.ts`）

#### `runWithConcurrencyAndRetry(items, concurrency, maxRetries, handler)`

- **worker 池模型**：`workerCount = min(concurrency, items.length)`，共享 `nextIndex` 指针循环领取任务。
- **指数退避重试**：仅对 `isRetryableError`（429 / 5xx / rate limit / network / ECONN*）重试，退避 `min(30s, 1000 * 2^(attempt-1))`。
- 返回 `PromiseSettledResult<CallApiResult>[]`，部分失败可定位到具体索引。

### 4.3 状态核心（`src/store.ts`）

#### `initStore()`（2808 行起）

1. 合并 IndexedDB 中的 agentConversations 与内存中的旧版数据（`mergeAgentConversationsForStorage`）。
2. 标记中断的 OpenAI running 任务（`markInterruptedOpenAIRunningTasks`，把断电遗留的 running 改写为 error 并保存）。
3. 规范化收藏夹状态（`normalizeLoadedFavoriteState`）。
4. 把画廊任务分配到默认标签页（首加载）或同步任务状态变更（已有标签）。
5. 为所有 `running`/`*Recoverable` 的 fal/custom 任务调度恢复（`scheduleFalRecovery` / `scheduleCustomRecovery`）。
6. 收集所有被引用的图片 id（待 GC 用）。

#### 图片缓存与缩略图

- `imageCache`（LRU，8 条）/ `thumbnailCache`（LRU，80 条）。
- `ensureImageCached(id)` / `ensureImageThumbnailCached(id)`：缓存未命中则回源 IndexedDB。
- 缩略图回填：`thumbnailBackfillIds` 记录待补图，`MAX_THUMBNAIL_BACKFILL_CONCURRENT=4` 并发生成，通过 `thumbnailSubscribers` 订阅式通知组件更新。

#### 本地保存（Electron）

- `saveTaskImagesToLocalFS` / `saveTaskMetaToLocalFS` / `saveTaskToLocalFS` / `saveAgentConversationToLocalFS`：任务完成后异步把图片/元数据/Agent 对话落到 `local-saves/` 目录。

#### 任务恢复

- `recoverFalTask`（2773 行）/ `recoverCustomTask`（6002 行）：用 `getFalQueuedImageResult` / `getCustomQueuedImageResult` 恢复断连任务，成功则更新任务，失败则重试或标记不可恢复。

#### 导入/导出

- `generateExportZipBuffer` / `exportData` / `exportDataToPath`（6128 / 6234）：收集 settings/tasks/conversations/wordLibrary + 图片 + 缩略图，用 fflate 打包 ZIP。
- `importData`（6332）：解压 ZIP，解析 `manifest.json`，调用 `mergeImportedSettings` 合并配置，写回 IndexedDB。

### 4.4 Agent 模式（`src/lib/agentApi.ts` + `store.ts`）

#### 工具定义 `createAgentTools`

- **`image_generation`**（内置工具，`action: 'auto'`）：单图/基础图生成。
- **`generate_image_batch`**（自定义 function tool）：并发生成多张**相互独立**的图；每个 item 的 prompt 可内嵌 `<ref id="round-N-image-M" />` 引用前序图。
- **`continue_generation`**：当已生成前置图、还需下一轮生成依赖图时调用。
- **`web_search`**（当 `settings.agentWebSearch` 开启）。

系统提示（`AGENT_IMAGE_INSTRUCTIONS`）规定了「渐进式批量生成」策略：先建基准 → 批量并发生成剩余 → 独立图一次性生成。

#### `callAgentResponsesApi`

- 构造 messages（用户图以 `input_image` 注入 + `<ref>` 标签）+ tools + `tool_choice: 'required'`。
- 流式解析 SSE：`response.image_generation_call.partial_image`（中间图）、`response.output_item.done`（完成项）、`function_call`（工具调用）、`function_call_output`（工具结果回填）。
- 用 `agentRoundControllers`（`Map<roundId, AbortController>`）支持用户随时停止生成。

#### 引用解析（`agentImageReferences.ts`）

- `getAgentGeneratedImageReferenceId(round, i)` → `round-{index}-image-{i+1}`。
- `resolveAgentPromptImageReferences`：把 `@第N轮图M` 文本引用解析为真实 image id。
- `replaceAgentPromptImageReferencesForApi`：把引用替换为 `<ref>` / `<removed_ref>` 标签供 API 使用。

### 4.5 图片与遮罩处理

| 函数 | 文件 | 职责 |
|------|------|------|
| `hashDataUrl(dataUrl)` | `db.ts` | SHA-256 去重 id（降级 FNV 双 hash） |
| `storeImage(dataUrl, source)` | `db.ts` | 去重存储 + 自动生成缩略图（720px / webp 0.9） |
| `createImageThumbnail` / `safeCreateImageThumbnail` | `db.ts` | Canvas 生成缩略图，失败降级返回空对象 |
| `getImageDimensions` | `canvasImage.ts` | 读取图片真实宽高 |
| `imageDataUrlToPngBlob` / `maskDataUrlToPngBlob` | `canvasImage.ts` | 转 PNG Blob（遮罩需重新光栅化） |
| `classifyMaskAlpha` | `mask.ts` | 判定遮罩覆盖：`empty`/`partial`/`full` |
| `assertUsableMaskCoverage` | `mask.ts` | 空遮罩抛错 |

### 4.6 提示词处理

| 函数 | 文件 | 职责 |
|------|------|------|
| `render_prompt`（含 `createRng`） | `promptGenerator.ts` | 词库变量替换，支持 `{var}` 随机抽取（种子化 Fisher-Yates 洗牌，可复现） |
| `slugify` / `normalize_entries` / `normalize_draw_count` | `promptGenerator.ts` | 词条规范化 |
| `replaceImageMentionsForApi` / `getPromptMentionParts` | `promptImageMentions.ts` | `@选中图片n` 等引用解析与替换 |
| `replaceAgentPromptImageReferencesForApi` | `agentImageReferences.ts` | Agent 对话 `<ref>` 引用替换 |

### 4.7 尺寸处理（`src/lib/size.ts`）

| 函数 | 职责 |
|------|------|
| `normalizeImageSize` | 规范化尺寸字符串为 `WxH` |
| `formatImageRatio` | 计算并格式化比例（如 `16:9`、`≈1:1`） |
| `resolveImageSizeParamsList` | 从生成图片中读取实际尺寸 |
| `RECOMMENDED_SIZE_SET` | 推荐尺寸集合（常用比例） |

### 4.8 设置与 Profile 管理（`src/lib/apiProfiles.ts`）

| 函数 | 职责 |
|------|------|
| `normalizeSettings` | 把任意输入规范为合法 `AppSettings`，向后兼容旧版单配置字段 |
| `normalizeApiProfile` | 规范化单个 Profile |
| `createDefaultOpenAIProfile` / `createDefaultFalProfile` | 构造默认 Profile |
| `switchApiProfileProvider` | 切换 provider，用 `providerDrafts` 保留各 provider 草稿 |
| `getActiveApiProfile` / `getAgentApiProfile` | 取当前生效 / Agent 专用 Profile |
| `mergeImportedSettings` | 合并导入的设置（按 dedup key 去重 Profile 与自定义服务商） |
| `importCustomProviderSettingsFromJson` | 从 JSON 文本导入自定义服务商（支持 markdown 围栏） |
| `validateApiProfile` | 校验必填项 |
| `DEFAULT_SETTINGS` | 应用默认设置 |

### 4.9 本地保存（`src/lib/localSave.ts`）

| 函数 | 职责 |
|------|------|
| `getLocalSavePath` / `setLocalSavePath` | 读写 `local-saves` 根目录 |
| `saveImageToLocal` | 保存单图到 `images/[标签名?]/{taskId}_{i}.{ext}` |
| `saveTaskMetaToLocal` | 保存任务元数据到 `tasks/{taskId}.json` |
| `savePromptToLocal` | 保存提示词到 `prompts/{taskId}.txt` |
| `saveAgentConversationToLocal` | Agent 对话转 Markdown 存到 `agent/{id}.md` |
| `getBackupList` / `restoreFromBackupFile` / `deleteBackupFile` | 备份列表/恢复/删除 |
| `saveZipToPath` / `getDesktopPath` | ZIP 备份到桌面 |

---

## 5. 依赖关系

### 5.1 生产依赖（`dependencies`）

| 包 | 用途 |
|------|------|
| `react` / `react-dom` | UI 框架 |
| `zustand` | 全局状态管理 |
| `@fal-ai/client` | fal.ai 图像 SDK |
| `electron-updater` | 自动更新（GitHub Releases） |
| `fflate` | ZIP 压缩/解压（导入导出、备份） |
| `react-markdown` / `remark-gfm` / `streamdown` | Markdown 渲染（Agent 回复、帮助） |
| `core-js` | 旧环境 polyfill（`Array.at` 等） |

> Electron 本身（`electron`）在 `devDependencies`（^33），构建产物 `dist-electron/main.js` 作为 `package.json` 的 `"main"`。

### 5.2 开发依赖（`devDependencies`）

| 包 | 用途 |
|------|------|
| `vite` / `@vitejs/plugin-react` / `vite-plugin-electron` / `vite-plugin-electron-renderer` | 构建链 |
| `typescript` | 类型系统 |
| `tailwindcss` / `postcss` / `autoprefixer` | 原子化 CSS（**v3.4**，经 PostCSS） |
| `vitest` | 单元测试（`*.test.ts`） |
| `electron-builder` | 应用打包与发布 |
| `@types/react` / `@types/react-dom` | 类型定义 |

### 5.3 `overrides`

```json
"mdast-util-gfm-autolink-literal": "2.0.0",
"dompurify": "^3.4.7"
```

### 5.4 模块依赖图

```
App.tsx
├── store.ts (核心状态 ≈6000 行)
│   ├── lib/api.ts (统一分发)
│   │   ├── lib/openaiCompatibleImageApi.ts (OpenAI/自定义)
│   │   ├── lib/falAiImageApi.ts (fal.ai)
│   │   └── lib/imageApiShared.ts (共享：并发重试/错误/尺寸)
│   ├── lib/agentApi.ts (Agent 流式 + 工具)
│   │   └── lib/agentImageReferences.ts
│   ├── lib/apiProfiles.ts (设置/Profile/自定义服务商)
│   ├── lib/db.ts (IndexedDB)
│   ├── lib/localSave.ts (→ electronAPI → IPC)
│   ├── lib/devProxy.ts (buildApiUrl)
│   ├── lib/canvasImage.ts / mask.ts / maskPreprocess.ts
│   ├── lib/promptGenerator.ts / promptImageMentions.ts
│   ├── lib/size.ts / downloadImages.ts
│   └── types.ts
├── components/* (UI)
│   └── hooks/* (useAutoUpdate / useDragSelect / ...)
└── lib/urlSettings.ts / customProviderConfigUrl.ts (启动时导入)
```

数据流：**组件 → store actions → lib/api → 服务商 → 回调更新 store → 持久化 IndexedDB / Electron 文件**。

---

## 6. 项目运行方式

### 6.1 环境要求

- Node.js（建议 18+，含原生 ESM 支持）。
- Windows / macOS / Linux。
- 首次运行需 `npm install`。

### 6.2 npm scripts

| 命令 | 作用 |
|------|------|
| `npm run dev` / `npm run electron:dev` | 启动 Vite 开发服务器（Electron 自动加载 dev URL） |
| `npm run build` | `tsc -b && vite build`（类型检查 + 前端生产构建） |
| `npm run electron:build` | `vite build && electron-builder`（打包桌面应用） |
| `npm run electron:preview` | `vite build && electron .`（构建后直接本地预览） |
| `npm run release` | 打包并**发布**到 GitHub Releases（`--publish always`） |
| `npm run release:dry` | 打包但**不发布**（`--publish never`，本地验证） |
| `npm test` / `npm run test:watch` | 运行 Vitest 单测 |
| `npm run mock:api` | 启动本地 mock 图像 API（`scripts/mock-image-api.mjs`） |
| `npm run preview` | `vite preview`（预览构建产物） |

Windows 下亦可双击 `start.bat` 一键启动开发环境。

### 6.3 开发模式说明

- Vite dev server 默认 `http://localhost:5173/`，`server.host: true` 允许外部访问。
- 可选 `dev-proxy.config.json`（参考 `dev-proxy.config.example.json`）启用 dev proxy：前端请求 `/api-proxy/*` 被代理到 `target`，用于规避浏览器 CORS 调试中转接口。
- Preload 通过 `vite-plugin-electron` 的 `onstart({ reload })` 在改动时自动重载窗口。

### 6.4 测试与类型检查

```bash
npx tsc --noEmit      # 类型检查
npx vitest run        # 单元测试
```

测试覆盖关键纯逻辑模块：`apiProfiles`、`agentApi`、`agentImageReferences`、`api`、`falAiImageApi`、`mask`、`maskPreprocess`、`paramCompatibility`、`promptGenerator`、`promptImageMentions`、`size`、`urlSettings`、`customProviderConfigUrl`、`devProxy`、`viewportTransform`、`store.test.ts`。

### 6.5 发布流程

1. 更新 `package.json` 的 `version`。
2. 本地校验：`npx tsc --noEmit && npx vitest run && npm run release:dry`。
3. 提交并打 tag：
   ```bash
   git commit -m "release: v<VERSION>"
   git tag v<VERSION>
   git push origin main --tags
   ```
4. GitHub Actions 自动 `electron-builder` 构建并上传到 Releases。
5. 已安装客户端启动后由 `electron-updater` 自动检查、下载、退出时安装。

### 6.6 自动更新机制

- `main.ts` 配置 FeedURL → `nideyilian/doupao`，`autoDownload: true`。
- 生产环境启动 5s 后自动 `checkForUpdates`。
- 所有事件经 `sendToWindow('update:status', ...)` 转发，渲染进程 `useAutoUpdate` Hook 暴露 `check/download/install/reset`。
- 错误信息做了**中文友好映射**（404/406/429/网络/证书 等场景）。

### 6.7 PWA

- `index.html` 引入 `manifest.webmanifest`、`app-icon.png`，meta 配置 apple-mobile-web-app。
- `public/sw.js`：缓存 APP_SHELL，导航请求 network-first（失败回退缓存），其余 GET 缓存优先。
- 仅在生产环境注册（开发环境主动注销）。

---

## 7. 关键设计决策与约束

| 决策 | 说明 |
|------|------|
| `webSecurity: false` | 绕过 CORS，允许渲染进程直连各 AI 服务商；`contextIsolation: true` + `nodeIntegration: false` 仍保证安全边界 |
| Preload 为 CJS | 输出 `preload.cjs`，规避 Electron 中 ESM/CommonJS 混用导致的加载问题 |
| 双 API 模式 | OpenAI 兼容支持 `images`（经典）与 `responses`（工具调用）两种形态 |
| 自定义服务商 Manifest | 通过 `http-image` 模板 + submit/editSubmit/poll 映射，声明式适配任意 HTTP 图像接口（含异步轮询） |
| 图片 SHA-256 去重 | data URL 做 hash 作为 id，相同图复用，节省存储 |
| 缩略图体系 | 720px webp 缩略图 + 版本号（`THUMBNAIL_VERSION=2`）+ 并发回填，避免列表页解码 4K 原图 |
| 三级缓存 | 内存 LRU（图 8 / 缩略图 80）→ IndexedDB → Electron 文件系统 |
| 中断任务恢复 | OpenAI running 任务断电后改写为 error；fal/custom 异步任务用定时器轮询恢复 |
| 原子写入 + 备份 | `write-json-text` 用 `.tmp`+`rename` 原子写，写前 `.bak` + 节流备份，保留最近 30 份 |
| 并发与重试 | `maxConcurrent`（1-999）worker 池 + 仅对可重试错误做指数退避（上限 30s） |
| Provider 草稿 | `providerDrafts` 在同一 Profile 内切换 provider 时保留各 provider 的参数草稿 |
| Agent 引用标签 | `<ref id="round-N-image-M" />` / `<removed_ref>` 标签在用户消息中注入，模型据此引用/识别已删图 |
| 懒加载重组件 | `SettingsModal`/`DetailModal`/`Lightbox`/`AgentWorkspace` 等用 `React.lazy` + `Suspense` 延迟加载 |
| 启动备份策略 | 空数据时扫描备份提示恢复；每周自动备份到桌面 |

---

## 8. 文件索引

### 8.1 Electron

| 路径 | 职责 |
|------|------|
| `electron/main.ts` | 主进程入口、窗口管理、自动更新、IPC（update/app:version） |
| `electron/preload.ts` | 安全暴露 `window.electronAPI`（CJS 产物 `preload.cjs`） |
| `electron/ipc-handlers.ts` | 文件系统 / 本地保存 / 备份 IPC 处理器 |
| `electron/tsconfig.json` | 主进程 TS 配置 |

### 8.2 渲染进程入口

| 路径 | 职责 |
|------|------|
| `src/main.tsx` | React 渲染入口、SW 注册、移动端视口修正 |
| `src/App.tsx` | 根组件、初始化序列、模式路由、备份策略 |
| `src/store.ts` | Zustand store（核心状态与全部业务逻辑） |
| `src/types.ts` | 全局类型定义 |
| `src/index.css` | 全局样式 + Tailwind 指令 |

### 8.3 业务库（`src/lib/`）

| 路径 | 职责 |
|------|------|
| `api.ts` | API 统一分发入口 `callImageApi` |
| `openaiCompatibleImageApi.ts` | OpenAI 兼容（images/responses）+ 自定义 HTTP 服务商 |
| `falAiImageApi.ts` | fal.ai 调用（队列 + 恢复） |
| `imageApiShared.ts` | 共享类型 / 并发重试 / 错误 / 尺寸 / URL→dataURL |
| `agentApi.ts` | Agent 工具定义、流式解析、批量图像工具 |
| `agentImageReferences.ts` | Agent `<ref>` 引用解析与替换 |
| `agentWebSearch.ts` | Agent 联网搜索工具 |
| `apiProfiles.ts` | 设置/Profile/自定义服务商规范化与合并 |
| `db.ts` | IndexedDB 封装（4 个 store） |
| `localSave.ts` | 本地文件系统保存（封装 IPC） |
| `canvasImage.ts` | Canvas 图片/遮罩合成、Blob 转换 |
| `mask.ts` / `maskPreprocess.ts` | 遮罩覆盖率校验与预处理 |
| `promptGenerator.ts` | 词库渲染、种子化随机变量 |
| `promptImageMentions.ts` | 提示词图片引用解析 |
| `size.ts` | 尺寸规范化与比例计算 |
| `devProxy.ts` | dev proxy 配置与 `buildApiUrl` |
| `downloadImages.ts` | 批量打包下载（ZIP） |
| `urlSettings.ts` | URL query 设置导入 |
| `customProviderConfigUrl.ts` | 从 URL 导入自定义服务商配置 |
| `paramCompatibility.ts` | 历史参数兼容 |
| `paramDisplay.tsx` | 参数展示格式化 |
| `browserNotification.ts` | 任务完成通知 |
| `clipboard.ts` | 剪贴板 |
| `viewport.ts` / `viewportTransform.ts` | 移动端视口 |
| `runtimeEnv.ts` | `VITE_*` 环境变量读取 |

### 8.4 组件与 Hooks

详见 [2.6 核心组件](#26-核心组件srccomponents) 与 [2.7 自定义 Hooks](#27-自定义-hookssrchooks)。

---

*本文档基于项目源码逐文件分析生成，已校正旧版文档中的多处事实性错误（API 模式、依赖清单、TaskParams 字段、Tailwind 版本、IPC 处理器清单等）。反映截至 v0.6.8 的代码结构。*
