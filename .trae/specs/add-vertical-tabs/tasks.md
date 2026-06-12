# Tasks

## Phase 1: 数据模型与状态管理

- [x] Task 1: 定义 WorkspaceTab 和 WorkspaceTabGroup 类型
  - [x] SubTask 1.1: 在 `src/types.ts` 中添加 `WorkspaceTab` 接口（包含 id, name, groupId, prompt, inputImages, inputImageFolder, params, maskDraft, maskEditorImageId, createdAt, updatedAt, order）
  - [x] SubTask 1.2: 在 `src/types.ts` 中添加 `WorkspaceTabGroup` 接口（包含 id, name, order, collapsed）

- [x] Task 2: 在 Zustand store 中添加标签页状态
  - [x] SubTask 2.1: 在 `AppState` 接口中添加 `workspaceTabs`、`activeWorkspaceTabId`、`workspaceTabGroups`、`workspaceTabBarExpanded`、`selectedWorkspaceTabIds` 等字段及 setter
  - [x] SubTask 2.2: 在 `useStore` 创建函数中初始化默认值（一个默认标签页，包含当前 gallery 输入状态）
  - [x] SubTask 2.3: 在 `getPersistedState` 和 `mergePersistedState` 中处理标签页数据的持久化/恢复
  - [x] SubTask 2.4: 在 `migratePersistedState` 中添加旧数据迁移逻辑（将旧版 prompt/inputImages/params 迁移到默认标签页）

- [x] Task 3: 实现标签页 CRUD actions
  - [x] SubTask 3.1: `createWorkspaceTab` — 复制当前激活标签页状态创建新标签页
  - [x] SubTask 3.2: `closeWorkspaceTab` — 关闭标签页，自动切换激活标签
  - [x] SubTask 3.3: `duplicateWorkspaceTab` — 复制指定标签页
  - [x] SubTask 3.4: `renameWorkspaceTab` — 重命名标签页
  - [x] SubTask 3.5: `setActiveWorkspaceTabId` — 切换标签页（保存当前状态到旧标签，恢复新标签状态到工作区）
  - [x] SubTask 3.6: `reorderWorkspaceTabs` — 拖拽排序
  - [x] SubTask 3.7: `createWorkspaceTabGroup` / `renameWorkspaceTabGroup` / `deleteWorkspaceTabGroup` / `moveTabToGroup` — 分组管理

## Phase 2: 输入状态与标签页绑定

- [x] Task 4: 修改输入状态同步机制
  - [x] SubTask 4.1: 修改 `syncActiveInputDraft`，在 gallery 模式下将状态同步保存到当前激活的 `WorkspaceTab`
  - [x] SubTask 4.2: 修改 `setAppMode` 中的 gallery 模式切换逻辑，支持从标签页恢复状态
  - [x] SubTask 4.3: 确保 `galleryInputDraft` 保留作为向后兼容字段

- [x] Task 5: 修改任务提交流程
  - [x] SubTask 5.1: 修改 `submitTask` 函数，确保从当前激活标签页读取 prompt、params、inputImages 等数据
  - [x] SubTask 5.2: 修改 `reuseConfig` 函数，支持将任务配置恢复到当前标签页

## Phase 3: UI 组件

- [x] Task 6: 创建 WorkspaceTabBar 组件
  - [x] SubTask 6.1: 创建 `src/components/WorkspaceTabBar.tsx`，实现竖向标签栏基础布局
  - [x] SubTask 6.2: 实现展开/收起状态切换（宽度 48px ↔ 200px）
  - [x] SubTask 6.3: 实现顶部功能按钮区（创建、管理、批量运行、搜索）
  - [x] SubTask 6.4: 实现标签页列表展示（名称、激活高亮、关闭按钮 hover 显示）
  - [x] SubTask 6.5: 实现右键菜单（复制、重命名、移动到分组、关闭）
  - [x] SubTask 6.6: 实现拖拽排序（标签页和分组标题）
  - [x] SubTask 6.7: 实现分组折叠/展开视觉聚合

- [x] Task 7: 创建标签页管理弹窗
  - [x] SubTask 7.1: 创建 `src/components/WorkspaceTabManagerModal.tsx`
  - [x] SubTask 7.2: 实现标签页列表（带复选框多选）
  - [x] SubTask 7.3: 实现批量操作：批量关闭、批量运行、批量导出
  - [x] SubTask 7.4: 实现分组管理（创建、重命名、删除分组）

- [x] Task 8: 集成到 App 布局
  - [x] SubTask 8.1: 在 `App.tsx` 中添加 `<WorkspaceTabBar />` 组件
  - [x] SubTask 8.2: 调整主内容区布局，为左侧标签栏留出空间
  - [x] SubTask 8.3: 确保标签栏在 agent 模式下隐藏或显示不同内容

## Phase 4: 批量运行功能

- [x] Task 9: 实现多标签批量运行
  - [x] SubTask 9.1: 在 store 中添加 `selectedWorkspaceTabIds` 状态
  - [x] SubTask 9.2: 实现批量运行逻辑：遍历选中标签页，依次调用 `submitTask`
  - [x] SubTask 9.3: 添加运行进度提示（Toast 或进度条）

## Phase 5: 验证与测试

- [x] Task 10: 编译验证
  - [x] SubTask 10.1: 运行 `npx tsc --noEmit` 确保无类型错误
  - [x] SubTask 10.2: 运行 `npx vite build` 确保构建成功

- [x] Task 11: 功能验证
  - [x] SubTask 11.1: 验证创建/关闭/切换标签页
  - [x] SubTask 11.2: 验证标签页状态隔离（不同标签页有独立的 prompt/inputImages）
  - [x] SubTask 11.3: 验证复制/重命名/拖拽排序
  - [x] SubTask 11.4: 验证分组功能
  - [x] SubTask 11.5: 验证批量运行
  - [x] SubTask 11.6: 验证持久化（刷新页面后标签页数据保留）
  - [x] SubTask 11.7: 验证旧数据迁移

# Task Dependencies
- Task 4 依赖 Task 2、Task 3
- Task 5 依赖 Task 2、Task 3
- Task 6 依赖 Task 1、Task 2、Task 3
- Task 7 依赖 Task 1、Task 2、Task 3
- Task 8 依赖 Task 6
- Task 9 依赖 Task 2、Task 3、Task 5
- Task 10 依赖 Task 4、Task 5、Task 6、Task 7、Task 8
- Task 11 依赖 Task 10
