# Tasks

- [ ] Task 1: 添加 PromptPreset 类型和 store 状态管理
  - 在 `src/types.ts` 或 `src/store.ts` 中添加 `PromptPreset` 接口定义
  - 在 Zustand store 中添加 `promptPresets` 状态和 `addPromptPreset` / `updatePromptPreset` / `deletePromptPreset` actions
  - 确保预设数据通过 Zustand persist 持久化到 localStorage

- [ ] Task 2: 创建 PromptPresetSidebar 悬浮侧边栏组件
  - 新建 `src/components/PromptPresetSidebar.tsx`
  - 实现从右侧滑入的动画效果（CSS transition）
  - 实现遮罩层（点击关闭）
  - 显示预设列表（按创建时间倒序）
  - 每个预设项包含：标题、prompt 预览文本、「使用」按钮、「编辑」按钮、「删除」按钮
  - 空状态显示「暂无保存的预设」
  - 响应式宽度（桌面 320px，移动端全宽）
  - 支持 Escape 键关闭

- [ ] Task 3: 在 App.tsx 中集成 PromptPresetSidebar 组件
  - 导入并渲染 `PromptPresetSidebar`
  - 管理侧边栏显示状态（`promptPresetSidebarOpen`）

- [ ] Task 4: 在 InputBar 中添加触发器和"保存为预设"按钮
  - 添加预设图标触发器按钮，点击打开侧边栏
  - 添加「保存为预设」功能入口（长按或附加菜单），调用 `addPromptPreset` action
  - 保存时弹出标题输入对话框（可使用浏览器 prompt 或已有模态框）

- [ ] Task 5: 验证预设交互流程
  - 添加预设 → 确认侧边栏中显示
  - 点击预设 → 提示词填入输入框
  - 关闭/重新打开侧边栏 → 状态保持
  - 刷新页面 → 预设持久化保留

# Task Dependencies

- [Task 1] 无依赖
- [Task 2] 依赖 [Task 1]
- [Task 3] 依赖 [Task 2]
- [Task 4] 依赖 [Task 1]
- [Task 5] 依赖 [Task 3], [Task 4]