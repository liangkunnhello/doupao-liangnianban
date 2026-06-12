# Tasks

- [x] Task 1: promptImageMentions.ts 扩展
  - 添加 VAR_START/VAR_END 常量和 VAR_MENTION_RE 正则
  - 扩展 PromptMentionPart 类型，增加 'variable' 类型
  - 修改 getPromptMentionParts 解析变量标记
  - 扩展 stripImageMentionMarkers 去除新标记
- [x] Task 2: index.css 添加 wildcard-var 样式
  - 明亮/暗色模式变量标签样式（鲜艳橙色/琥珀色背景）
  - hover/selected 状态样式
- [x] Task 3: InputBar.tsx 添加变量转换功能
  - 工具栏添加"转换为变量"按钮（桌面端和移动端）
  - 选词转变量逻辑（获取选中文本，包裹变量标记）
  - HTML 渲染适配 variable 类型（生成 wildcard-var span）
  - 双击编辑变量名（调用 PromptInputDialog）
  - 所有遍历 contentEditable 节点的辅助函数适配 wildcard-var
- [x] Task 4: 验证集成
  - TypeScript 编译无错误
  - 测试全部通过（202 passed）
  - 完整流程验证（选词→转换→显示→双击编辑）

# Task Dependencies

- Task 1: 无依赖
- Task 2: 无依赖
- Task 3: 依赖 Task 1, Task 2
- Task 4: 依赖所有