# Checklist

## Phase 1: 数据模型与状态管理

- [x] `WorkspaceTab` 类型已正确定义在 `src/types.ts` 中，包含所有必需字段
- [x] `WorkspaceTabGroup` 类型已正确定义在 `src/types.ts` 中
- [x] `AppState` 接口已添加标签页相关状态字段（workspaceTabs, activeWorkspaceTabId, workspaceTabGroups, workspaceTabBarExpanded, selectedWorkspaceTabIds）
- [x] Zustand store 初始化时创建默认标签页，包含当前 gallery 输入状态
- [x] 标签页数据已纳入 `getPersistedState` 持久化范围
- [x] 标签页数据已纳入 `mergePersistedState` 恢复逻辑
- [x] `migratePersistedState` 已添加旧数据迁移逻辑（将旧版 prompt/inputImages/params 迁移到默认标签页）
- [x] `createWorkspaceTab` action 正确复制当前激活标签页状态
- [x] `closeWorkspaceTab` action 正确处理激活标签切换和空标签页兜底
- [x] `duplicateWorkspaceTab` action 正确复制所有标签页数据
- [x] `renameWorkspaceTab` action 正确更新名称
- [x] `setActiveWorkspaceTabId` action 正确保存/恢复状态
- [x] `reorderWorkspaceTabs` action 正确更新顺序
- [x] 分组管理 actions（create/rename/delete/moveToGroup）正确工作

## Phase 2: 输入状态与标签页绑定

- [x] `syncActiveInputDraft` 在 gallery 模式下将状态同步保存到当前激活 WorkspaceTab
- [x] `setAppMode` gallery 模式切换支持从标签页恢复状态
- [x] `galleryInputDraft` 保留作为向后兼容字段
- [x] `submitTask` 从当前激活标签页读取数据
- [x] `reuseConfig` 支持将任务配置恢复到当前标签页

## Phase 3: UI 组件

- [x] `WorkspaceTabBar` 组件存在且能正确渲染
- [x] 标签栏固定在界面左侧
- [x] 展开/收起状态切换正常工作（48px ↔ 200px）
- [x] 顶部功能按钮区正确渲染（创建、管理、批量运行、搜索）
- [x] 标签页列表正确展示名称、激活高亮、关闭按钮
- [x] 右键菜单正确显示（复制、重命名、移动到分组、关闭）
- [x] 拖拽排序正常工作
- [x] 分组折叠/展开正常工作
- [x] `WorkspaceTabManagerModal` 组件存在且能正确渲染
- [x] 管理弹窗支持多选、批量关闭、批量运行
- [x] `App.tsx` 正确集成 WorkspaceTabBar
- [x] 主内容区布局正确调整，为标签栏留出空间
- [x] agent 模式下标签栏行为正确（隐藏或显示不同内容）

## Phase 4: 批量运行功能

- [x] `selectedWorkspaceTabIds` 状态正确工作
- [x] 批量运行逻辑正确遍历选中标签页并依次提交任务
- [x] 运行进度提示（Toast）正确显示

## Phase 5: 验证与测试

- [x] `npx tsc --noEmit` 无类型错误
- [x] `npx vite build` 构建成功
- [x] 创建/关闭/切换标签页功能正常
- [x] 不同标签页状态隔离正常（prompt/inputImages 独立）
- [x] 复制/重命名/拖拽排序功能正常
- [x] 分组功能正常
- [x] 批量运行功能正常
- [x] 刷新页面后标签页数据保留
- [x] 旧数据迁移逻辑正常工作
