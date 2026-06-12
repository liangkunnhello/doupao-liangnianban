# Tasks

- [x] Task 1: store.ts 添加 randomPromptModalOpen 状态
  - AppState 添加 `randomPromptModalOpen: boolean` 和 `setRandomPromptModalOpen`
  - 在 create 闭包中添加默认值和 action 实现
- [x] Task 2: 创建 RandomPromptModal 组件
  - 在 `src/components/RandomPromptModal.tsx` 实现模态框
  - 包含 segments 编辑器、library 词库编辑器、生成/使用按钮
  - 调用 `render_prompt` 生成随机提示词
- [x] Task 3: InputBar 添加入口按钮
  - 在 InputBar 工具栏（桌面端和移动端）添加骰子图标按钮
  - 点击时设置 `randomPromptModalOpen = true`
- [x] Task 4: App.tsx 注册 RandomPromptModal
  - 参照 `PromptInputDialog.tsx` 的注册方式在 App.tsx 中添加组件

# Task Dependencies

- Task 1: 无依赖
- Task 2: 依赖 Task 1
- Task 3: 依赖 Task 1
- Task 4: 依赖 Task 2