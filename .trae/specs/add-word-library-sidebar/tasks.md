# Tasks

- [x] Task 1: Store 状态扩展
  - [x] SubTask 1.1: 在 AppState 接口中添加 `wordLibrarySidebarOpen: boolean` 和 `setWordLibrarySidebarOpen: (open: boolean) => void`
  - [x] SubTask 1.2: 在 store 默认值中添加 `wordLibrarySidebarOpen: false`
  - [x] SubTask 1.3: 在 `getPersistedState` 和 `mergePersistedState` 中**不**包含 `wordLibrarySidebarOpen`（不持久化）

- [x] Task 2: 重构 WordLibrarySidebar 组件 — 联动划词转词条
  - [x] SubTask 2.1: 监听 store 中 prompt 的变化，自动提取所有变量标记（`\u2060key\u2061`）
  - [x] SubTask 2.2: 当检测到新变量（划词刚转换的）时，自动在侧边栏创建对应词条（如果不存在）
  - [x] SubTask 2.3: 自动选中/高亮当前 prompt 中最新添加的变量对应的词条卡片
  - [x] SubTask 2.4: 自动展开该词条的详情编辑区，显示词条名称、分组、候选词库
  - [x] SubTask 2.5: 词条详情编辑区实时联动 — 编辑保存后上方词条列表实时更新（包括分组变化导致的重新分类）
  - [x] SubTask 2.6: 分类标签栏根据当前词条的分组自动高亮对应分组 pill

- [x] Task 3: 重构 WordLibrarySidebar — 分组下拉支持新建
  - [x] SubTask 3.1: 在"所属分类"下拉选择器中添加"+ 新建分组"选项
  - [x] SubTask 3.2: 点击"+ 新建分组"弹出小型输入框，输入分组名称
  - [x] SubTask 3.3: 确认后调用 store.createWordLibraryGroup 创建新分组
  - [x] SubTask 3.4: 新分组自动成为当前词条的所属分类
  - [x] SubTask 3.5: 分类标签栏实时更新，显示新分组

- [x] Task 4: 重构 WordLibrarySidebar — 插入/替换精确光标操作
  - [x] SubTask 4.1: 插入操作：获取 InputBar contentEditable 的当前光标位置，在该位置插入变量标记
  - [x] SubTask 4.2: 替换操作：获取 InputBar contentEditable 的当前选区，用变量标记替换选中文本
  - [x] SubTask 4.3: 如果输入框没有焦点，先聚焦再执行操作
  - [x] SubTask 4.4: 操作后保持光标在插入/替换后的位置

- [x] Task 5: 修改 InputBar.tsx — 划词转词条后自动打开侧边栏
  - [x] SubTask 5.1: 在"转换为变量"按钮的 onClick 处理中，转换完成后调用 `setWordLibrarySidebarOpen(true)`
  - [x] SubTask 5.2: 确保侧边栏打开后自动定位到新创建的词条

- [x] Task 6: 验证集成
  - [x] SubTask 6.1: TypeScript 编译无错误
  - [x] SubTask 6.2: 所有测试通过
  - [x] SubTask 6.3: 完整流程验证：划词 → 转变量 → 侧边栏自动打开显示词条 → 编辑词条名称/分组 → 保存 → 列表实时更新 → 插入/替换到光标位置

# Task Dependencies

- Task 2: 依赖 Task 1
- Task 3: 依赖 Task 2
- Task 4: 依赖 Task 2
- Task 5: 依赖 Task 1
- Task 6: 依赖所有
