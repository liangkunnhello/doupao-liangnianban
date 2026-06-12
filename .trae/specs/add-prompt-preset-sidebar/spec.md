# 提示词预设悬浮侧边栏 Spec

## Why

用户生成图片时需要频繁使用特定风格的提示词模板，每次手动输入或从外部复制效率低。需要一个悬浮侧边栏来保存、管理和快速插入提示词预设。

## What Changes

- **新增** 提示词预设数据类型和 Zustand store 状态管理（持久化）
- **新增** `PromptPresetSidebar` 悬浮侧边栏组件（可收起/展开）
- **新增** 预设侧边栏的触发器按钮（固定在 InputBar 或画面边缘）
- **修改** `InputBar` 集成「插入预设」和「保存为预设」功能
- **修改** `AppSettings` 类型添加可选的预设列表字段

## Impact

- 不破坏现有功能
- 新增状态通过 Zustand persist 持久化到 localStorage
- 不影响 gallery/agent 模式切换逻辑
- 不影响已有 IPC 和 Electron 集成
- 不需要修改后端

## ADDED Requirements

### Requirement: 提示词预设数据模型

系统 SHALL 定义一个 `PromptPreset` 类型：

```typescript
interface PromptPreset {
  id: string
  title: string
  prompt: string       // 完整的提示词文本
  createdAt: number
  updatedAt: number
  isFavorite?: boolean
}
```

### Requirement: Store 状态管理

系统 SHALL 在 Zustand store 中添加以下状态和 action：

```typescript
promptPresets: PromptPreset[]
addPromptPreset: (title: string, prompt: string) => void
updatePromptPreset: (id: string, data: Partial<PromptPreset>) => void
deletePromptPreset: (id: string) => void
```

持久化方式：通过现有的 `persist` middleware 存储到 localStorage，key 使用 `gpt-image-playground.promptPresets`。

#### Scenario: 添加预设
- **WHEN** 用户在 InputBar 输入提示词后点击「保存为预设」
- **THEN** 弹出标题输入框 → 确认后新增预设 → toast 提示"预设已保存"

#### Scenario: 删除预设
- **WHEN** 用户在侧边栏中点击预设项的删除按钮
- **THEN** 弹出确认对话框 → 确认后删除 → toast 提示"预设已删除"

#### Scenario: 使用预设
- **WHEN** 用户在侧边栏中点击一个预设项
- **THEN** 该预设的提示词文本替换 InputBar 中的当前提示词 → 自动关闭侧边栏

### Requirement: PromptPresetSidebar 悬浮侧边栏组件

系统 SHALL 提供一个可展开/收起的悬浮侧边栏组件：

- 固定在画面右侧，覆盖在主要内容之上（z-index 高于主内容但低于 Modal/Dialog）
- 半透明遮罩层覆盖在主内容上
- 顶部有标题栏「提示词预设」和关闭按钮
- 预设列表按创建时间倒序排列
- 每个预设项显示：标题、预览文本（截断）、「使用」按钮、「编辑」按钮、「删除」按钮
- 空状态显示文案「暂无保存的预设」
- 响应式：宽度 320px，移动端可全宽

#### Scenario: 打开侧边栏
- **WHEN** 用户点击侧边栏触发器按钮（固定在右下角或 InputBar 旁）
- **THEN** 侧边栏从右侧滑入展开

#### Scenario: 关闭侧边栏
- **WHEN** 用户点击关闭按钮、点击遮罩层、或按 Escape 键
- **THEN** 侧边栏收起

### Requirement: 触发器按钮

系统 SHALL 在 InputBar 附近添加一个「预设」按钮（图标为书签/文件夹风格），点击后打开侧边栏。

## MODIFIED Requirements

### Requirement: AppSettings 扩展

**修改** `AppSettings` 类型不做修改，预设数据独立存储在 store 中而非 settings 中，以避免与导入/导出功能冲突。

### Requirement: InputBar 扩展

在 InputBar 的按钮区域添加「预设」图标按钮。不影响已有提交逻辑。

## REMOVED Requirements

无