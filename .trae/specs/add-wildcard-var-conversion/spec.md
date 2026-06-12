# 提示词变量转换功能 Spec

## Why

用户在编写提示词时希望快速将选中的常量文本转为可变的通配符变量（例如将 "cat" 转为变量），变量以鲜艳纯色背景突出显示，并可双击编辑变量名。这是对提示词编辑体验的增强，与已有的通配符提示词生成器功能互补。

## What Changes

- `src/lib/promptImageMentions.ts`：新增变量标记符、正则、辅助函数，扩展 `getPromptMentionParts` 支持变量类型
- `src/components/InputBar.tsx`：添加"转换为变量"按钮、选词转变量逻辑、变量标签渲染、双击编辑
- `src/index.css`：添加 `.wildcard-var` 类样式（鲜艳纯色背景）
- 涉及所有遍历 contentEditable 节点的辅助函数（`getNodeVisibleTextLength`、`getMentionTagForBoundary` 等）适配变量标签
- **不修改** `src/lib/promptGenerator.ts`、`src/store.ts`

## Impact

- Affected specs: add-random-prompt-generator（变量可被 render_prompt 识别）
- Affected code: `src/lib/promptImageMentions.ts`（修改）、`src/components/InputBar.tsx`（修改）、`src/index.css`（修改）

## ADDED Requirements

### 数据标记

系统 SHALL 使用以下 Unicode 不可见字符标记变量：

```
VAR_START = '\u2060'   // 变量开始标记
VAR_END   = '\u2061'   // 变量结束标记
```

变量在 prompt 字符串中的格式：`\u2060变量名\u2061`

### Requirement: promptImageMentions.ts 扩展

系统 SHALL 在 `src/lib/promptImageMentions.ts` 中：

#### Scenario: 导出新常量
- 导出 `VAR_START`、`VAR_END`、`VAR_MENTION_RE`
- `VAR_MENTION_RE = /\u2060([^\u2061]+)\u2061/g`

#### Scenario: stripImageMentionMarkers 扩展
- **WHEN** 输入包含 `\u2060` 或 `\u2061`
- **THEN** 这些字符也被去除

#### Scenario: PromptMentionPart 新增类型
- 新增联合类型：`{ type: 'variable'; text: string; varName: string }`
- `text` 为纯文本内容，`varName` 为变量名（去除标记后的实际内容）

#### Scenario: getPromptMentionParts 扩展
- **WHEN** prompt 中包含 `\u2060变量名\u2061`
- **THEN** 输出 `{ type: 'variable', text: '变量名', varName: '变量名' }` 片段

### Requirement: InputBar.tsx 扩展

系统 SHALL 在 `src/components/InputBar.tsx` 中：

#### Scenario: 转换按钮
- **WHEN** 用户选中文本且未选中 mention-tag 或 wildcard-var
- **THEN** 工具栏显示"转换为变量"按钮（可用 `$` 或 `{%}` 图标）
- **WHEN** 用户选中了已有变量或 mention
- **THEN** 按钮置灰或隐藏
- 桌面端和移动端工具栏各添加一个按钮

#### Scenario: 选词转变量
- **WHEN** 用户选中一段纯文本，点击"转换为变量"
- **THEN** 获取选中文本，用 `VAR_START + 选中文本 + VAR_END` 包裹替换
- **THEN** 更新 prompt，选中文本变为变量标签
- **WHEN** 选中文本为空或仅空白
- **THEN** 不执行转换

#### Scenario: 变量标签渲染
- **WHEN** prompt 包含变量标记
- **THEN** 在 contentEditable 中渲染为 `<span contenteditable="false" class="wildcard-var" data-var-name="变量名">变量名</span>`
- **THEN** 标签使用鲜艳纯色背景（橙色/琥珀色系），不同于蓝色的 mention-tag

#### Scenario: 双击编辑变量
- **WHEN** 用户双击 `.wildcard-var` 元素
- **THEN** 弹出 PromptInputDialog 编辑变量名
- **THEN** 确认后更新 prompt 中的变量名
- **THEN** 如果新名称为空则删除该变量

#### Scenario: 辅助函数适配
- **WHEN** `getNodeVisibleTextLength`、`getMentionTagForBoundary`、`getBoundaryOffsetInMention` 等函数遍历节点
- **THEN** `.wildcard-var` 元素按 mention-tag 相同规则处理（视为不可编辑的完整标签）

### Requirement: index.css

系统 SHALL 在 `src/index.css` 中添加 `.wildcard-var` 样式：

#### Scenario: 明亮模式
- 背景色：`#fef3c7`（琥珀色100）或 `#ffedd5`（橙色100）
- 文字颜色：`#c2410c`（橙色700）
- 边框：`#fed7aa`（橙色200）
- 字体加粗，圆角与 mention-tag 一致

#### Scenario: 暗色模式
- 背景色：`rgba(251, 146, 60, 0.2)`
- 文字颜色：`#fdba74`
- 边框：`rgba(251, 146, 60, 0.3)`

#### Scenario: hover/selected 状态
- hover：更深的背景色
- selected：实心高亮背景（橙色500 + 白色文字）