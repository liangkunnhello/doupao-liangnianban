# 随机提示词生成器 UI Spec

## Why

此前实现了 `render_prompt` 核心函数，但界面中没有对应的 UI 入口，用户无法使用。需要添加界面让用户编辑模板段和词库、生成随机提示词并插入到输入框。

## What Changes

- 新增 `src/components/RandomPromptModal.tsx`：随机提示词生成器模态框
- 在 `src/components/InputBar.tsx` 工具栏添加触发按钮（桌面端和移动端）
- 在 `src/store.ts` 的 `AppState` 添加 `randomPromptModalOpen` 状态
- 在 `src/App.tsx` 注册 `RandomPromptModal` 组件
- **不修改** `src/lib/promptGenerator.ts`（已有模块）

## Impact

- Affected specs: add-random-prompt-generator（此 UI 为其前端）
- Affected code: `src/components/RandomPromptModal.tsx`（新增）、`src/components/InputBar.tsx`（修改）、`src/store.ts`（修改）、`src/App.tsx`（修改）

## ADDED Requirements

### Requirement: 数据模型

系统 SHALL 在 `RandomPromptModal` 内部维护以下本地状态：

```
PromptState = {
  segments: Array<{type: "text", text: string} | {type: "wildcard", id: string, label: string}>
  library: Record<string, {entries: string[], draw_count: number, label: string}>
}
```

### Requirement: 模态框 UI

系统 SHALL 提供一个模态框，包含：

#### Scenario: Segments 编辑器
- **WHEN** 用户点击模态框中的 Segments 区域
- **THEN** 显示当前所有段的列表，每段可编辑/删除
- **THEN** 提供"添加文本段"和"添加通配符段"按钮
- **THEN** 文本段可编辑 text 内容；通配符段可编辑 id 和 label，并可在下拉菜单中选择关联的词库属性

#### Scenario: Library 词库编辑器
- **WHEN** 用户展开词库编辑区域
- **THEN** 显示所有词库属性列表，每个属性可编辑 label、entries、draw_count
- **THEN** 提供"添加词库属性"按钮
- **THEN** entries 用 textarea 输入，每行一个词条

#### Scenario: 生成与使用
- **WHEN** 用户点击"生成"按钮
- **THEN** 调用 `render_prompt(state, undefined, 'keep_label')` 生成随机提示词
- **THEN** 在预览区域显示生成的文本和抽取报告
- **WHEN** 用户点击"使用"按钮
- **THEN** 将生成的文本设置为当前 prompt，关闭模态框
- **WHEN** 用户点击"重新生成"按钮
- **THEN** 再次调用 `render_prompt` 重新生成

### Requirement: InputBar 入口按钮

#### Scenario: 桌面端
- **WHEN** 桌面端 InputBar 渲染
- **THEN** 在"提示词预设"按钮旁边添加一个骰子图标按钮
- **THEN** 点击打开 RandomPromptModal

#### Scenario: 移动端
- **WHEN** 移动端 InputBar 渲染
- **THEN** 在"提示词预设"按钮旁边添加相同按钮

## MODIFIED Requirements

### Requirement: store.ts - AppState 扩展
系统 SHALL 在 AppState 中添加：
- `randomPromptModalOpen: boolean`
- `setRandomPromptModalOpen: (open: boolean) => void`

### Requirement: App.tsx - 注册组件
系统 SHALL 在 App.tsx 中渲染 `RandomPromptModal` 组件（参照 `PromptInputDialog` 的注册方式）

### Requirement: 样式规范
- 模态框风格与 **PromptInputDialog** 一致（圆角、毛玻璃背景、暗色支持）
- 使用 Tailwind CSS 类名，遵循现有设计系统
- 按钮样式与 InputBar 中的预设按钮一致