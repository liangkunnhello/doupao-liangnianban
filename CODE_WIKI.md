# GPT Image Playground — Code Wiki

> 版本：0.5.5 | 许可证：MIT

---

## 目录

1. [项目概览](#1-项目概览)
2. [技术栈与依赖](#2-技术栈与依赖)
3. [项目结构](#3-项目结构)
4. [架构设计](#4-架构设计)
5. [核心数据模型（types.ts）](#5-核心数据模型typests)
6. [状态管理（store.ts）](#6-状态管理storets)
7. [API 层](#7-api-层)
8. [组件层](#8-组件层)
9. [自定义 Hooks](#9-自定义-hooks)
10. [工具库（lib/）](#10-工具库lib)
11. [数据持久化（IndexedDB）](#11-数据持久化indexeddb)
12. [部署架构](#12-部署架构)
13. [开发与运行](#13-开发与运行)
14. [数据流详解](#14-数据流详解)

---

## 1. 项目概览

**GPT Image Playground** 是一个基于 OpenAI gpt-image-2 API 的图片生成与编辑 Web 工具。提供简洁精美的 UI，支持 OpenAI / OpenAI 兼容接口、fal.ai 与可导入的自定义 HTTP 服务商，支持文本生图、参考图与遮罩编辑，数据纯本地化存储。

### 核心特性

- **图像生成与编辑**：支持文本生图、参考图上传（最多 16 张）、遮罩编辑、批量生成与流式预览
- **Agent 多轮对话模式**：基于 Responses API 的对话式生成，支持上下文记忆、`@` 引用图片、并发批量生成、分支与重新生成、可选 Web 搜索
- **多服务商接入**：内置 OpenAI（Images API / Responses API）、fal.ai、自定义 HTTP 服务商（同步/异步）
- **多配置管理**：支持创建、切换、导入多个 API 配置
- **纯本地存储**：所有数据保存在浏览器 IndexedDB 中，支持 ZIP 导出/导入备份
- **精细化参数追踪**：自动提取 API 响应中真实生效的参数，与请求参数高亮对比

---

## 2. 技术栈与依赖

### 运行时依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| **React** | 19.1.0 | UI 框架 |
| **React DOM** | 19.1.0 | DOM 渲染 |
| **Zustand** | 5.0.5 | 状态管理（含 persist 中间件） |
| **@fal-ai/client** | ^1.10.0 | fal.ai SDK |
| **fflate** | ^0.8.2 | ZIP 压缩/解压（导入导出） |
| **react-markdown** | ^10.1.0 | Markdown 渲染（Agent 回复） |
| **remark-gfm** | ^4.0.1 | GitHub Flavored Markdown 支持 |
| **streamdown** | ^2.5.0 | 流式 Markdown 渲染样式 |
| **core-js** | ^3.49.0 | Polyfill（如 `Array.at`） |

### 开发依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| **TypeScript** | ^5.8.3 | 类型系统 |
| **Vite** | ^6.3.2 | 构建工具与开发服务器 |
| **Vitest** | ^4.1.5 | 单元测试 |
| **Tailwind CSS** | ^3.4.17 | 原子化 CSS 框架 |
| **PostCSS** | ^8.5.3 | CSS 处理 |
| **Wrangler** | ^4.96.0 | Cloudflare Workers 部署 |

---

## 3. 项目结构

```
gpt_image_playground-main/
├── deploy/                          # 部署配置
│   ├── Dockerfile                   # 多阶段构建（Node 构建 → Nginx 运行）
│   ├── nginx.conf                   # Nginx 配置模板（含 API 代理）
│   ├── inject-api-url.sh            # 运行时注入环境变量到构建产物
│   └── migrate-api-env.envsh        # 旧版环境变量兼容迁移
├── docs/                            # 文档与截图
│   ├── custom-provider-llm-prompt.md
│   ├── mock-image-api.md
│   └── images/
├── public/                          # 静态资源
│   ├── manifest.webmanifest         # PWA 清单
│   ├── pwa-icon.svg
│   └── sw.js                        # Service Worker
├── scripts/
│   └── mock-image-api.mjs           # 本地模拟 API 服务器
├── src/
│   ├── components/                  # React UI 组件
│   ├── hooks/                       # 自定义 React Hooks
│   ├── lib/                         # 核心业务逻辑库
│   ├── App.tsx                      # 应用根组件
│   ├── main.tsx                     # 应用入口
│   ├── store.ts                     # Zustand 全局状态
│   ├── types.ts                     # TypeScript 类型定义
│   ├── index.css                    # 全局样式（Tailwind）
│   ├── store.test.ts                # Store 测试
│   └── vite-env.d.ts               # Vite 环境类型声明
├── .github/workflows/               # CI/CD 工作流
│   ├── deploy.yml
│   ├── docker.yml
│   └── vercel-tag-deploy.yml
├── package.json
├── vite.config.ts                   # Vite 配置（含开发代理）
├── tailwind.config.js
├── tsconfig.json
├── vercel.json                      # Vercel 部署配置
├── wrangler.jsonc                   # Cloudflare Workers 配置
└── dev-proxy.config.example.json    # 本地开发代理配置示例
```

---

## 4. 架构设计

### 整体架构图

```
┌─────────────────────────────────────────────────────┐
│                     浏览器 (SPA)                      │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐ │
│  │  Gallery  │  │  Agent   │  │  Settings / Modals │ │
│  │  Mode     │  │  Mode    │  │                    │ │
│  └────┬─────┘  └────┬─────┘  └────────┬───────────┘ │
│       │              │                  │              │
│       └──────────────┼──────────────────┘              │
│                      │                                 │
│              ┌───────┴───────┐                         │
│              │   Store (Zustand)  │ ← persist 中间件    │
│              │  + 内存图片缓存     │                     │
│              └───────┬───────┘                         │
│                      │                                 │
│          ┌───────────┴───────────┐                     │
│          │       API Layer       │                     │
│          │  ┌─────┐ ┌────┐ ┌──┐ │                     │
│          │  │OpenAI│ │fal │ │自 │ │                     │
│          │  │兼容  │ │.ai │ │定义│ │                     │
│          │  └──┬───┘ └─┬──┘ └┬─┘ │                     │
│          └─────┼───────┼─────┼───┘                     │
│                │       │     │                          │
│  ┌─────────────┴───────┴─────┴──────────────────┐     │
│  │              Dev Proxy / API Proxy             │     │
│  └─────────────┬────────────────────────────────┘     │
│                │                                      │
└────────────────┼──────────────────────────────────────┘
                 │
     ┌───────────┴────────────┐
     │   外部 API 服务         │
     │  OpenAI / fal.ai / 自定义│
     └────────────────────────┘

┌──────────────────────────────────────────────────────┐
│              IndexedDB (浏览器本地存储)                 │
│  ┌─────────┐ ┌────────┐ ┌──────────┐ ┌────────────┐ │
│  │  tasks   │ │ images │ │thumbnails│ │agentConv.  │ │
│  └─────────┘ └────────┘ └──────────┘ └────────────┘ │
└──────────────────────────────────────────────────────┘
```

### 双模式架构

应用有两种工作模式，由 `AppMode` 类型区分：

- **Gallery 模式**（`'gallery'`）：传统的图片生成/编辑工作流，输入提示词 → 生成图片 → 查看历史
- **Agent 模式**（`'agent'`）：多轮对话式生成，支持上下文记忆、工具调用、批量生成

### API 双通道架构

每种 API 配置（`ApiProfile`）支持两种 API 模式（`ApiMode`）：

- **Images API**（`'images'`）：调用 `/v1/images/generations` 和 `/v1/images/edits`，传统图片生成接口
- **Responses API**（`'responses'`）：调用 `/v1/responses`，Agent 模式专用，支持工具调用和流式响应

---

## 5. 核心数据模型（types.ts）

### 设置相关类型

| 类型 | 说明 |
|------|------|
| `ApiMode` | `'images' \| 'responses'` — API 调用模式 |
| `AppMode` | `'gallery' \| 'agent'` — 应用工作模式 |
| `ApiProvider` | `'openai' \| 'fal' \| string` — 服务商标识（含自定义） |
| `ApiProfile` | API 配置对象：包含 provider、baseUrl、apiKey、model、timeout、apiMode、流式设置等 |
| `AppSettings` | 应用全局设置：包含 profiles 列表、activeProfileId、各种行为偏好 |
| `CustomProviderDefinition` | 自定义服务商定义：submit（提交映射）、editSubmit（编辑提交映射）、poll（轮询映射） |
| `CustomProviderSubmitMapping` | 自定义提交映射：path、method、contentType、body 模板、files 映射、taskIdPath、result 提取路径 |
| `CustomProviderPollMapping` | 自定义轮询映射：path、intervalSeconds、statusPath、successValues、failureValues、result |

### 任务相关类型

| 类型 | 说明 |
|------|------|
| `TaskParams` | 任务参数：size、quality、output_format、output_compression、moderation、n |
| `InputImage` | 输入图片：id（SHA-256 hash）、dataUrl（预览） |
| `MaskDraft` | 遮罩草稿：targetImageId、maskDataUrl |
| `TaskRecord` | 任务记录：完整记录一次生成任务的输入、输出、状态、参数、来源等 |
| `TaskStatus` | `'running' \| 'done' \| 'error'` |

### Agent 模式类型

| 类型 | 说明 |
|------|------|
| `AgentMessage` | Agent 消息：role、content、关联图片 |
| `AgentRound` | Agent 轮次：一次用户-助手交互，含分支支持 |
| `AgentConversation` | Agent 对话：包含 rounds 和 messages，支持多分支 |

### 存储相关类型

| 类型 | 说明 |
|------|------|
| `StoredImage` | IndexedDB 存储的图片：id（hash）、dataUrl、source、尺寸 |
| `StoredImageThumbnail` | 缩略图：thumbnailDataUrl、thumbnailVersion |
| `FavoriteCollection` | 收藏夹 |
| `ExportData` | ZIP 导出的 manifest.json 格式 |

### API 请求/响应类型

| 类型 | 说明 |
|------|------|
| `ImageGenerationRequest` | Images API 请求体 |
| `ImageApiResponse` | Images API 响应 |
| `ResponsesApiResponse` | Responses API 响应 |
| `ResponsesOutputItem` | Responses API 输出项（含 function_call、image_generation_call 等） |
| `FalApiResponse` | fal.ai API 响应 |

---

## 6. 状态管理（store.ts）

Store 是整个应用的**核心枢纽**，使用 Zustand + persist 中间件实现，负责状态管理、业务逻辑协调和数据持久化。

### 关键常量

| 常量 | 值 | 说明 |
|------|----|------|
| `MAX_IMAGE_CACHE_ENTRIES` | 8 | 内存图片缓存上限 |
| `MAX_THUMBNAIL_CACHE_ENTRIES` | 80 | 缩略图缓存上限 |
| `FAL_RECOVERY_POLL_MS` | 10,000 | fal.ai 队列恢复轮询间隔 |
| `AGENT_INPUT_DRAFT_RETENTION_MS` | 3 天 | Agent 输入草稿保留时间 |

### Store 核心职责

1. **图片缓存管理**：LRU 策略的内存缓存（`imageCache`、`thumbnailCache`），带缩略图回填机制
2. **任务生命周期**：`submitTask` → 运行 → 完成/失败，含超时控制、中断恢复
3. **Agent 对话管理**：多轮对话、分支切换、消息引用解析
4. **收藏管理**：收藏夹 CRUD、批量收藏
5. **数据导入导出**：ZIP 格式的完整备份/恢复
6. **fal.ai / 自定义服务商恢复**：连接断开后自动轮询恢复结果

### 关键 Store 方法

| 方法 | 说明 |
|------|------|
| `submitTask(prompt, params, inputImages, maskDraft)` | 提交图片生成/编辑任务 |
| `submitAgentRound(prompt, inputImages, maskDraft)` | 提交 Agent 对话轮次 |
| `regenerateAgentAssistantMessage(roundId)` | 重新生成 Agent 助手消息 |
| `removeTask(taskId)` | 删除任务（联动清理对话引用） |
| `ensureImageCached(imageId)` | 确保图片在内存缓存中可用 |
| `setSettings(settings)` | 更新应用设置 |
| `exportData()` | 导出所有数据为 ZIP |
| `importData(file)` | 从 ZIP 导入数据 |

---

## 7. API 层

### 调用链路

```
callImageApi (api.ts)
├── provider === 'fal' → callFalAiImageApi (falAiImageApi.ts)
└── provider === 'openai' | custom → callOpenAICompatibleImageApi (openaiCompatibleImageApi.ts)
    ├── apiMode === 'images' → callImagesApi
    │   ├── 单图 → callImagesApiSingle
    │   └── 多图/CodexCLI → callImagesApiConcurrent（拆分为并发单图）
    ├── apiMode === 'responses' → callResponsesImageApi
    │   └── 单图/多图并发 → callResponsesImageApiSingle
    └── customProvider → callCustomHttpImageApi
        ├── 同步返回 → extractCustomImages
        └── 异步任务 → submitCustomRequest + pollCustomTaskResult
```

### api.ts — API 统一入口

`callImageApi(opts)` 根据 `provider` 类型分发到对应服务商的实现：

- `fal` → `callFalAiImageApi`
- `openai` / 自定义 → `callOpenAICompatibleImageApi`

### imageApiShared.ts — 共享工具

| 函数/常量 | 说明 |
|-----------|------|
| `CallApiOptions` | 统一 API 调用参数接口 |
| `CallApiResult` | 统一 API 返回结果接口（images、actualParams、revisedPrompts） |
| `MIME_MAP` | 输出格式 → MIME 类型映射 |
| `normalizeBase64Image` | 将裸 base64 补全为 data URL |
| `fetchImageUrlAsDataUrl` | HTTP URL 图片下载为 data URL，含 CORS 检测与友好提示 |
| `getApiErrorMessage` | 从 HTTP 错误响应提取可读错误信息 |
| `pickActualParams` | 从 API 响应中提取实际生效参数 |
| `assertImageInputPayloadSize` | 校验输入图片总大小（上限 512 MiB） |
| `assertMaskEditFileSize` | 校验遮罩文件大小（上限 50 MiB） |

### openaiCompatibleImageApi.ts — OpenAI 兼容接口

**Images API 模式**（`callImagesApi`）：
- **生成**：`POST /v1/images/generations`，JSON 请求体
- **编辑**：`POST /v1/images/edits`，FormData（多图 `image[]` + `mask`）
- **流式**：SSE 事件流解析，支持 `partial_image` 中间步骤预览
- **Codex CLI 模式**：提示词防改写守卫 + 多图拆分为并发单图请求
- **并发**：`callImagesApiConcurrent` 将 n > 1 的请求拆为 `Promise.allSettled`

**Responses API 模式**（`callResponsesImageApi`）：
- `POST /v1/responses`，使用 `image_generation` 工具
- `tool_choice: 'required'` 强制立即生成
- 提示词防改写守卫：`PROMPT_REWRITE_GUARD_PREFIX`
- 支持流式 SSE 响应解析

**自定义服务商**（`callCustomHttpImageApi`）：
- 通过模板变量（`$prompt`、`$params.size` 等）渲染请求
- 支持 JSON / Multipart 两种 content type
- 支持异步任务：提交 → 提取 taskId → 轮询状态 → 获取结果
- 支持路径通配符提取（`data.*.url`、`data.*.b64_json`）

### falAiImageApi.ts — fal.ai 接口

- 使用 `@fal-ai/client` SDK
- 支持 fal.ai 队列机制（`fal.subscribe` + `onEnqueue` 回调）
- 自动映射尺寸/质量参数到 fal.ai 格式
- 支持自定义代理 URL
- 连接断开后可通过 `getFalQueuedImageResult` 恢复

### agentApi.ts — Agent API

**`callAgentResponsesApi`**：Agent 模式的核心 API 调用

- 构建 Agent 系统指令（`createAgentInstructions`），包含图像生成策略、批量生成规则
- 工具列表：`image_generation` + `generate_image_batch` + `continue_generation` + 可选 `web_search`
- 支持流式 SSE 响应，实时推送文本增量、图片中间步骤、Web 搜索状态
- 输入消息包含 `input_text` + `input_image` 内容块

**`callAgentConversationTitleApi`**：自动生成对话标题

- 使用 XML 格式输出 `<title>...</title>`
- 支持中英文标题长度限制

**`callBatchImageSingle`**：批量图片生成

- Agent 通过 `generate_image_batch` 工具触发的并发单图生成
- 复用 Responses API 模式 + 提示词防改写守卫

### devProxy.ts — API 代理

| 函数 | 说明 |
|------|------|
| `normalizeBaseUrl` | 规范化 API 基础 URL（补全协议、/v1 路径） |
| `buildApiUrl` | 根据代理开关构建最终请求 URL |
| `readClientDevProxyConfig` | 读取客户端代理配置（构建时注入） |
| `shouldUseApiProxy` | 判断是否使用 API 代理 |
| `isApiProxyAvailable` | 代理是否可用（Docker 部署或开发代理） |
| `isApiProxyLocked` | 代理是否锁定（Docker 部署锁定） |

代理机制：浏览器请求同源 `/api-proxy/...` → Vite 开发服务器 / Docker Nginx 转发到真实 API

---

## 8. 组件层

### 根组件（App.tsx）

应用入口组件，负责：
- URL 参数解析与设置初始化
- 自定义服务商配置 URL 导入
- Docker API URL 迁移提示
- 根据 `appMode` 渲染 Gallery / Agent 界面
- 全局模态框挂载

### 主要组件

| 组件 | 文件 | 说明 |
|------|------|------|
| `Header` | Header.tsx | 顶部导航栏：模式切换、设置入口、版本信息 |
| `SearchBar` | SearchBar.tsx | 搜索/过滤栏：按状态过滤、收藏过滤 |
| `TaskGrid` | TaskGrid.tsx | 任务卡片网格：展示历史生成任务 |
| `TaskCard` | TaskCard.tsx | 单个任务卡片：缩略图、状态、操作按钮 |
| `InputBar` | InputBar.tsx | 输入栏：提示词输入、参考图上传、参数选择、提交 |
| `AgentWorkspace` | AgentWorkspace.tsx | Agent 对话工作区：消息流、轮次管理、分支切换 |
| `DetailModal` | DetailModal.tsx | 任务详情模态框：大图、参数对比、原始响应 |
| `Lightbox` | Lightbox.tsx | 全屏大图查看器：左右滑动、快捷下载 |
| `SettingsModal` | SettingsModal.tsx | 设置模态框：API 配置、行为偏好、数据管理 |
| `MaskEditorModal` | MaskEditorModal.tsx | 遮罩编辑器：Canvas 绘制、画笔/橡皮、预处理 |
| `SizePickerModal` | SizePickerModal.tsx | 尺寸选择器：1K/2K/4K 档位、比例选择、自定义 |
| `HelpModal` | HelpModal.tsx | 帮助文档 |
| `HistoryModal` | HistoryModal.tsx | 历史记录模态框 |
| `FavoriteCollections` | FavoriteCollections.tsx | 收藏夹管理（含 Picker、View、Manage 三个子组件） |
| `ImageContextMenu` | ImageContextMenu.tsx | 图片右键/长按上下文菜单 |
| `Toast` | Toast.tsx | 全局通知提示 |
| `ConfirmDialog` | ConfirmDialog.tsx | 确认对话框 |
| `MarkdownRenderer` | MarkdownRenderer.tsx | Markdown 渲染（Agent 文本回复） |
| `ViewportTooltip` | ViewportTooltip.tsx | 自定义 Tooltip |
| `Select` | Select.tsx | 自定义下拉选择器 |
| `Checkbox` | Checkbox.tsx | 自定义复选框 |
| `icons` | icons.tsx | SVG 图标集合 |

---

## 9. 自定义 Hooks

| Hook | 文件 | 说明 |
|------|------|------|
| `useCloseOnEscape` | useCloseOnEscape.ts | ESC 键关闭回调 |
| `useDockerApiUrlMigrationNotice` | useDockerApiUrlMigrationNotice.ts | Docker 旧版 API URL 迁移提示 |
| `useDragSelect` | useDragSelect.ts | 鼠标拖拽框选（Gallery 批量选择） |
| `useHintTooltip` | useHintTooltip.ts | 引导提示 Tooltip |
| `usePreventBackgroundScroll` | usePreventBackgroundScroll.ts | 阻止背景滚动（模态框打开时） |
| `useTooltip` | useTooltip.ts | 通用 Tooltip 状态管理 |
| `useVersionCheck` | useVersionCheck.ts | 版本更新检查 |

---

## 10. 工具库（lib/）

### apiProfiles.ts — API 配置管理

| 函数 | 说明 |
|------|------|
| `normalizeSettings` | 规范化设置对象，补全默认值 |
| `normalizeApiProfile` | 规范化 API 配置 |
| `normalizeCustomProviderDefinition` | 规范化自定义服务商定义 |
| `getActiveApiProfile` | 获取当前激活的 API 配置 |
| `getCustomProviderDefinition` | 根据 provider ID 获取自定义服务商 |
| `createDefaultOpenAIProfile` | 创建默认 OpenAI 配置 |
| `createDefaultFalProfile` | 创建默认 fal.ai 配置 |
| `switchApiProfileProvider` | 切换配置的服务商类型（保留 providerDrafts） |
| `mergeImportedSettings` | 合并导入的设置（去重、追加） |
| `importCustomProviderSettingsFromJson` | 从 JSON 导入自定义服务商配置 |
| `validateApiProfile` | 校验 API 配置完整性 |
| `findEquivalentApiProfile` | 查找等价配置（避免重复导入） |

**关键机制 — providerDrafts**：切换服务商时保存当前服务商的配置快照，切回时恢复。

### agentImageReferences.ts — Agent 图片引用

| 函数 | 说明 |
|------|------|
| `getAgentCurrentReferenceId` | 生成当前轮次输入图片的引用 ID |
| `getAgentGeneratedImageReferenceId` | 生成轮次输出图片的引用 ID |
| `replaceAgentPromptImageReferencesForApi` | 将 `@N轮图M` 格式替换为 `<ref id="..."/>` XML 标签 |
| `extractAgentReferenceIds` | 从文本提取所有引用 ID |
| `collectAgentRoundOutputImages` | 收集轮次的所有输出图片 ID |

**引用格式**：
- 用户侧：`@1轮图2`（第 1 轮第 2 张图）
- API 侧：`<ref id="round-1-image-2" />`

### mask.ts — 遮罩处理

| 函数 | 说明 |
|------|------|
| `validateMaskTarget` | 校验遮罩目标图片存在性 |
| `orderInputImagesForMask` | 将遮罩目标图排在输入图片首位 |
| `classifyMaskAlpha` | 分类遮罩覆盖度：empty / partial / full |
| `assertUsableMaskCoverage` | 断言遮罩非空 |

### maskPreprocess.ts — 遮罩预处理

对 Canvas 遮罩进行预处理以符合 API 要求（分辨率限制、格式转换等）。

### size.ts — 尺寸计算

| 函数 | 说明 |
|------|------|
| `normalizeImageSize` | 将自定义尺寸规整到 16 的倍数、总像素校验 |
| `parseRatio` | 解析比例字符串（如 `16:9`） |
| `formatImageRatio` | 将宽高比格式化为友好显示 |
| `calculateImageSize` | 根据档位（1K/2K/4K）和比例计算最佳尺寸 |

**尺寸约束**：16 的倍数、最大边 3840px、最大宽高比 3:1、总像素 655K~8.3M。

### canvasImage.ts — Canvas 图像处理

图片 data URL 与 Blob 互转、遮罩预览合成等。

### downloadImages.ts — 图片下载

| 函数 | 说明 |
|------|------|
| `downloadImageIds` | 逐个下载图片（单图直接下载，多图延迟避免浏览器拦截） |
| `downloadImageEntriesAsZip` | 批量打包为 ZIP 下载（使用 fflate） |

### clipboard.ts — 剪贴板操作

复制文本/图片到剪贴板，含降级处理。

### browserNotification.ts — 浏览器通知

任务完成后发送浏览器 Notification。

### promptImageMentions.ts — 提示词图片引用

处理 `@图N` 格式的图片引用标记，替换为 API 可用格式。

### paramCompatibility.ts — 参数兼容性

检测 API 返回参数与请求参数的差异，生成对比提示。

### paramDisplay.tsx — 参数显示

参数对比的 UI 渲染组件。

### customProviderConfigUrl.ts — 自定义服务商配置 URL

从 URL 加载并导入自定义服务商 JSON 配置。

### urlSettings.ts — URL 参数设置

从 URL 查询参数（`?apiUrl=...&apiKey=...`）解析并合并到设置中。

### runtimeEnv.ts — 运行时环境变量

读取 Vite 注入的环境变量（`VITE_DEFAULT_API_URL` 等）。

### viewport.ts — 移动端视口

安装移动端视口保护（虚拟键盘弹出时修正布局）。

### viewportTransform.ts — 视口变换

Gallery 模式下的拖拽、缩放变换计算。

### tooltipDismiss.ts — Tooltip 关闭

全局关闭所有 Tooltip。

### taskPromptDisplay.ts — 任务提示词显示

格式化任务的完整提示词（含引用图片信息）。

### dropdown.ts — 下拉菜单

下拉菜单的定位与交互逻辑。

### clickSuppression.ts — 点击抑制

拖拽选择时抑制误触点击。

### domRect.ts — DOM 矩形

DOMRect 工具函数。

### agentWebSearch.ts — Agent Web 搜索

提取 Agent 响应中的 Web 搜索调用信息。

---

## 11. 数据持久化（IndexedDB）

### 数据库名称

`gpt-image-playground`，版本 3

### Object Stores

| Store | Key | 内容 |
|-------|-----|------|
| `tasks` | `id` | `TaskRecord[]` — 生成任务记录 |
| `images` | `id` (SHA-256) | `StoredImage[]` — 完整图片 data URL |
| `thumbnails` | `id` | `StoredImageThumbnail[]` — 缩略图 |
| `agentConversations` | `id` | `AgentConversation[]` — Agent 对话 |

### 图片去重机制

- 使用 `hashDataUrl()` 计算图片 data URL 的 SHA-256 哈希作为 ID
- 支持 `crypto.subtle` 不可用时的 Fallback 哈希（FNV 变体）
- `storeImage()` 写入前先检查是否已存在相同 ID

### 缩略图机制

- 最大尺寸 720px，WebP 格式，质量 0.9
- 缩略图版本号 `THUMBNAIL_VERSION = 2`，版本不匹配时重新生成
- 避免卡片页解码完整 4K 原图，大幅提升列表渲染性能
- 支持后台回填（`thumbnailBackfillIds`），限制并发数 4

### 导入导出格式

ZIP 包结构：
```
export_YYYYMMDD_HHMMSS.zip
├── manifest.json          # ExportData 格式元数据
├── images/                # 完整图片文件
├── thumbnails/            # 缩略图文件
├── tasks/                 # 任务记录 JSON（可选）
├── favorites/             # 收藏夹数据
└── agent_conversations/   # Agent 对话数据
```

---

## 12. 部署架构

### 多阶段 Docker 构建

```
Build Stage (Node 20 Alpine)
    → npm ci → npm run build → dist/

Production Stage (Nginx Alpine)
    → 复制 dist/ → 注入环境变量 → Nginx 服务
```

**运行时环境变量注入**：`inject-api-url.sh` 脚本在 Nginx 启动前，将 Docker 环境变量替换到已构建的 JS 文件中的占位符。

### Nginx 配置要点

- SPA fallback：所有路径回退到 `index.html`
- 静态资源长缓存：`/assets/` 下带 hash 的文件缓存 1 年
- API 代理：`/api-proxy/` 路径转发到 `API_PROXY_URL`，仅允许 POST
- Gzip 压缩：常用 MIME 类型
- 请求体上限：600 MiB

### 部署方式

| 方式 | 配置文件 | 说明 |
|------|----------|------|
| **Vercel** | `vercel.json` | 一键部署，支持环境变量 `VITE_DEFAULT_API_URL` |
| **Cloudflare Workers** | `wrangler.jsonc` | `npm run deploy:cf`，构建后通过 Wrangler 部署 |
| **Docker** | `deploy/Dockerfile` | 多阶段构建，支持运行时环境变量注入 |
| **静态部署** | `vite build` | 构建到 `dist/`，部署到任意静态服务器 |

### 环境变量

| 变量 | 构建时 | 运行时 | 说明 |
|------|--------|--------|------|
| `VITE_DEFAULT_API_URL` | ✅ | ❌（Docker 通过注入脚本） | 默认 API 地址 |
| `VITE_API_PROXY_AVAILABLE` | ✅ | ❌ | API 代理是否可用 |
| `VITE_API_PROXY_LOCKED` | ✅ | ❌ | API 代理是否锁定 |
| `VITE_DOCKER_DEPLOYMENT` | ✅ | ❌ | 是否 Docker 部署 |
| `DEFAULT_API_URL` | ❌ | ✅（Docker） | 运行时默认 API URL |
| `API_PROXY_URL` | ❌ | ✅（Docker） | 代理转发目标 |
| `ENABLE_API_PROXY` | ❌ | ✅（Docker） | 是否开启 Nginx 代理 |
| `LOCK_API_PROXY` | ❌ | ✅（Docker） | 是否锁定代理开关 |

---

## 13. 开发与运行

### 常用命令

| 命令 | 说明 |
|------|------|
| `npm install` | 安装依赖 |
| `npm run dev` | 启动开发服务器（Vite，默认 5173 端口） |
| `npm run build` | 构建生产产物（TypeScript 编译 + Vite 构建） |
| `npm run preview` | 预览构建产物 |
| `npm run test` | 运行测试（Vitest） |
| `npm run test:watch` | 监听模式运行测试 |
| `npm run mock:api` | 启动本地模拟 API 服务器 |
| `npm run deploy:cf` | 部署到 Cloudflare Workers |

### 本地开发跨域代理

1. 复制 `dev-proxy.config.example.json` 为 `dev-proxy.config.json`
2. 配置 `target` 为真实 API 地址
3. 重启开发服务器
4. 在页面设置中开启 API 代理

### PWA 支持

- 生产环境注册 Service Worker（`sw.js`）
- 开发环境自动注销 Service Worker
- `manifest.webmanifest` 定义 PWA 元数据

---

## 14. 数据流详解

### Gallery 模式 — 图片生成流程

```
用户输入提示词 + 参考图/遮罩
        │
        ▼
  InputBar 组件
  │ submitTask(prompt, params, inputImages, maskDraft)
  ▼
  Store.submitTask()
  │ 1. 验证遮罩
  │ 2. 图片去重存储（storeImage → hashDataUrl → IndexedDB）
  │ 3. 创建 TaskRecord（status: 'running'）
  │ 4. 替换提示词中的图片引用
  │ 5. 调用 callImageApi()
  ▼
  callImageApi() → 分发到对应服务商
  │ callOpenAICompatibleImageApi / callFalAiImageApi / callCustomHttpImageApi
  │
  │ ← 流式回调：onPartialImage → 实时更新预览
  │ ← fal.ai 入队：onFalRequestEnqueued → 保存 requestId 以便恢复
  │ ← 自定义入队：onCustomTaskEnqueued → 保存 taskId 以便恢复
  ▼
  Store 收到结果
  │ 1. 存储 outputImages 到 IndexedDB
  │ 2. 解析 actualParams / revisedPrompt
  │ 3. 更新 TaskRecord（status: 'done'）
  │ 4. 发送浏览器通知（可选）
  ▼
  TaskGrid / TaskCard 更新显示
```

### Agent 模式 — 对话流程

```
用户输入消息 + @引用图片
        │
        ▼
  AgentWorkspace 组件
  │ submitAgentRound(prompt, inputImages, maskDraft)
  ▼
  Store.submitAgentRound()
  │ 1. 解析 @N轮图M 引用 → 替换为 <ref id="..."/>
  │ 2. 创建 AgentRound + AgentMessage
  │ 3. 构建对话历史（messages → input）
  │ 4. 调用 callAgentResponsesApi()
  ▼
  callAgentResponsesApi()
  │ 流式回调：
  │   onTextDelta → 实时更新助手文本
  │   onImageToolStarted → 显示生成占位
  │   onImagePartialImage → 中间步骤预览
  │   onImageToolCompleted → 图片存入 IndexedDB + 创建 TaskRecord
  │   onOutputItems → 更新工具调用状态
  ▼
  Store 处理 Agent 响应
  │ 1. 解析 generate_image_batch → 并发调用 callBatchImageSingle
  │ 2. 解析 continue_generation → 自动追加新一轮
  │ 3. 解析 web_search_call → 显示搜索状态
  │ 4. 存储输出图片，创建关联 TaskRecord
  │ 5. 更新 AgentRound + AgentMessage
  │ 6. 自动生成对话标题
  ▼
  AgentWorkspace 更新显示
```

### 设置导入流程

```
URL 参数 / JSON 导入 / 配置 URL
        │
        ▼
  buildSettingsFromUrlParams() / importCustomProviderSettingsFromJson()
        │
        ▼
  normalizeSettings() → 规范化 + 补全默认值
        │
        ▼
  mergeImportedSettings() → 去重合并
  │ 1. 自定义服务商按 dedup key 合并
  │ 2. API 配置按 provider+baseUrl+apiKey+model+apiMode 去重
  │ 3. 新增配置追加到列表
  │ 4. 首个导入配置自动激活
  ▼
  Store.setSettings() → 持久化
```

---

## 附录：关键文件索引

| 文件 | 行数（约） | 核心职责 |
|------|-----------|----------|
| `src/types.ts` | 440 | 全局类型定义 |
| `src/store.ts` | 2000+ | 全局状态 + 业务逻辑 |
| `src/App.tsx` | 100 | 应用根组件 |
| `src/main.tsx` | 30 | 应用入口 |
| `src/lib/api.ts` | 15 | API 统一入口 |
| `src/lib/openaiCompatibleImageApi.ts` | 1070 | OpenAI 兼容接口实现 |
| `src/lib/falAiImageApi.ts` | 230 | fal.ai 接口实现 |
| `src/lib/agentApi.ts` | 920 | Agent API 实现 |
| `src/lib/apiProfiles.ts` | 800 | API 配置管理 |
| `src/lib/imageApiShared.ts` | 190 | API 共享工具 |
| `src/lib/devProxy.ts` | 100 | API 代理 |
| `src/lib/db.ts` | 320 | IndexedDB 封装 |
| `src/lib/size.ts` | 260 | 尺寸计算 |
| `src/lib/agentImageReferences.ts` | 90 | Agent 图片引用 |
| `src/lib/mask.ts` | 35 | 遮罩处理 |
| `src/lib/downloadImages.ts` | 140 | 图片下载 |
| `src/lib/urlSettings.ts` | 130 | URL 参数设置 |
| `src/components/AgentWorkspace.tsx` | 1000+ | Agent 工作区组件 |
| `src/components/SettingsModal.tsx` | 大 | 设置模态框 |
| `src/components/MaskEditorModal.tsx` | 大 | 遮罩编辑器 |
