# 多标签页功能 Spec

## Why
当前应用仅支持单工作区（gallery/agent 模式切换），用户无法同时管理多个独立的生成任务上下文。添加多标签页功能后，用户可以在不同标签页之间保存各自的提示词、参数、输入图片等状态，实现类似浏览器的多标签工作流，提升多任务并行管理效率。

## What Changes
- 在界面左侧添加固定的竖向标签栏（类似浏览器竖向标签页）
- 每个标签页独立保存：提示词、输入图片、参数、蒙版草稿、输入图片文件夹
- 标签页支持：创建、关闭、复制、重命名、拖拽排序、分组
- 标签栏顶部为功能按钮区（创建、管理、批量运行、搜索）
- 标签页数据持久化到 localStorage（通过 Zustand persist）
- **BREAKING**: 当前 gallery 模式的输入状态（prompt/inputImages/params 等）将被迁移到第一个默认标签页中

## Impact
- Affected specs: gallery 工作区输入状态管理、任务提交流程
- Affected code: `src/store.ts`（状态管理核心）、`src/App.tsx`（布局）、`src/components/InputBar.tsx`（输入栏与当前标签绑定）、`src/types.ts`（新增 Tab 类型）

## ADDED Requirements

### Requirement: 标签页数据模型
The system SHALL provide a `WorkspaceTab` data type containing:
- `id`: 唯一标识符
- `name`: 标签页名称（用户可重命名）
- `groupId`: 所属分组 ID（可选，null 表示未分组）
- `prompt`: 提示词
- `inputImages`: 输入图片列表
- `inputImageFolder`: 输入图片文件夹（与 inputImages 互斥）
- `params`: 生成参数
- `maskDraft`: 蒙版草稿
- `maskEditorImageId`: 蒙版编辑器图片 ID
- `createdAt`: 创建时间
- `updatedAt`: 更新时间
- `order`: 排序权重

### Requirement: 标签页状态管理
The system SHALL maintain the following tab-related state in Zustand store:
- `workspaceTabs`: `WorkspaceTab[]` — 所有标签页
- `activeWorkspaceTabId`: `string | null` — 当前激活的标签页
- `workspaceTabGroups`: `{ id, name, order }[]` — 标签页分组
- Actions: `createWorkspaceTab`, `closeWorkspaceTab`, `duplicateWorkspaceTab`, `renameWorkspaceTab`, `reorderWorkspaceTabs`, `moveTabToGroup`, `setActiveWorkspaceTabId`

#### Scenario: 创建新标签页
- **WHEN** 用户点击标签栏顶部的"创建标签"按钮
- **THEN** 系统创建一个新的 `WorkspaceTab`，名称为"标签 N"（N 为序号），复制当前激活标签页的全部状态（prompt、inputImages、params 等）作为初始值，并激活该新标签页

#### Scenario: 切换标签页
- **WHEN** 用户点击某个标签页
- **THEN** 系统将当前工作区的输入状态（prompt、inputImages、params、maskDraft 等）保存到当前激活标签页，然后从目标标签页恢复对应状态到工作区，并更新 `activeWorkspaceTabId`

#### Scenario: 关闭标签页
- **WHEN** 用户点击标签页上的关闭按钮
- **THEN** 系统移除该标签页，如果关闭的是当前激活标签页，则自动激活相邻标签页（优先右侧，否则左侧），如果关闭后无标签页则自动创建一个默认标签页

#### Scenario: 复制标签页
- **WHEN** 用户在标签页右键菜单选择"复制"
- **THEN** 系统创建一个新标签页，完全复制原标签页的所有数据，名称为"原名称 - 副本"

#### Scenario: 重命名标签页
- **WHEN** 用户在标签页右键菜单选择"重命名"并输入新名称
- **THEN** 系统更新该标签页的 `name` 字段

#### Scenario: 拖拽排序
- **WHEN** 用户拖拽标签页到新的位置
- **THEN** 系统更新 `workspaceTabs` 数组的顺序，并重新计算 `order` 字段

#### Scenario: 标签页分组
- **WHEN** 用户在标签页右键菜单选择"移动到分组"并选择/创建分组
- **THEN** 系统更新该标签页的 `groupId` 字段
- 分组在标签栏中可折叠/展开，同一分组的标签页在视觉上聚合显示

### Requirement: 竖向标签栏 UI
The system SHALL render a fixed vertical tab bar on the left side of the screen:
- 宽度约 48px（收起时）/ 200px（展开时），支持点击展开/收起
- 顶部功能按钮区（固定高度，约 120px）：
  - 创建标签按钮（+ 图标）
  - 标签管理按钮（设置/管理图标，打开管理弹窗）
  - 多标签批量运行按钮（播放图标，批量运行选中的标签页）
  - 搜索框（可搜索标签页名称）
- 下方标签页展示区（可滚动）：
  - 每个标签页显示名称（展开时）或首字母/图标（收起时）
  - 当前激活标签页高亮显示
  - 每个标签页带有关闭按钮（hover 时显示）
  - 支持右键菜单：复制、重命名、移动到分组、关闭
- 分组支持折叠/展开，分组标题可拖拽排序

#### Scenario: 批量运行
- **WHEN** 用户选中多个标签页（通过 Ctrl/Cmd 或 Shift 多选）并点击批量运行按钮
- **THEN** 系统依次提交每个选中标签页的生成任务（使用各自标签页的 prompt、params、inputImages）

### Requirement: 标签页数据持久化
The system SHALL persist `workspaceTabs`、`activeWorkspaceTabId`、`workspaceTabGroups` to localStorage via Zustand persist.

#### Scenario: 首次加载
- **WHEN** 应用首次启动且无持久化数据
- **THEN** 系统创建一个默认标签页，名称为"标签 1"，并迁移当前 gallery 模式的输入状态到该标签页

#### Scenario: 数据迁移
- **WHEN** 应用加载旧版本持久化数据（无 workspaceTabs）
- **THEN** 系统创建一个默认标签页，将旧的 prompt、inputImages、params、maskDraft 等数据迁移到该标签页中

## MODIFIED Requirements

### Requirement: 输入状态同步机制
当前 `syncActiveInputDraft` 和 `saveGalleryInputDraft` 机制需要修改为：
- 当 gallery 模式下输入状态变化时，同步保存到当前激活的 `WorkspaceTab`（而非 `galleryInputDraft`）
- `galleryInputDraft` 字段保留但仅作为向后兼容的迁移字段
- Agent 模式的 `agentInputDrafts` 机制保持不变（Agent 模式不使用标签页）

### Requirement: 任务提交
`submitTask` 函数需要从当前激活的 `WorkspaceTab` 读取 prompt、params、inputImages 等数据，而非直接从 store 顶层状态读取。

## REMOVED Requirements
无
