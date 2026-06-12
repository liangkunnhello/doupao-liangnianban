# 词条库侧边浮动栏 Spec

## Why

当前词条库管理以模态弹窗形式存在（RandomPromptModal），与提示词输入框分离，操作路径长。用户希望将词条库管理重构为参考图所示的侧边浮动栏布局，直接集成在输入区域旁，支持搜索、分类筛选、词条插入/替换、词条编辑等一站式操作，大幅提升提示词编写效率。

## What Changes

- **新增** `src/components/WordLibrarySidebar.tsx`：侧边浮动栏主组件，包含搜索、分类标签、词条列表、词条详情编辑
- **新增** `src/components/WordLibrarySidebarToggle.tsx`：浮动栏的展开/收起切换按钮
- **修改** `src/components/InputBar.tsx`：
  - 删除底部工具栏中的"词条库管理"按钮（骰子图标）
  - 在输入框右侧区域集成 `WordLibrarySidebarToggle`
  - 当侧边栏打开时，输入框区域自适应调整
- **修改** `src/components/RandomPromptModal.tsx`：保留但降级为模板生成器专用（移除词条管理功能，仅保留 segments 模板和生成功能）
- **修改** `src/store.ts`：
  - 新增 `wordLibrarySidebarOpen: boolean` 状态及 `setWordLibrarySidebarOpen` action
  - 保留所有现有 wordLibrary 相关 state/actions（groups、entries、CRUD）
- **修改** `src/index.css`：添加侧边栏相关样式（浮动面板、分类标签 pill、词条卡片、详情区）
- **修改** `src/App.tsx`：挂载 `WordLibrarySidebar` 组件

## Impact

- Affected specs: add-wildcard-var-conversion（变量标签的插入/替换操作）
- Affected code: `src/components/InputBar.tsx`、`src/components/RandomPromptModal.tsx`、`src/store.ts`、`src/App.tsx`

## ADDED Requirements

### Requirement: 侧边栏状态管理

系统 SHALL 在 `src/store.ts` 中新增：

#### Scenario: 状态定义
- `wordLibrarySidebarOpen: boolean` — 侧边栏展开/收起状态
- `setWordLibrarySidebarOpen: (open: boolean) => void` — 设置展开状态
- 默认值：`wordLibrarySidebarOpen: false`
- 持久化：不持久化（每次启动默认收起）

### Requirement: WordLibrarySidebar 组件

系统 SHALL 创建 `src/components/WordLibrarySidebar.tsx`，实现参考图所示的侧边浮动栏布局。

#### Scenario: 整体布局
- **WHEN** `wordLibrarySidebarOpen === true`
- **THEN** 侧边栏以固定定位显示在输入框右侧（或主内容区右侧），宽度约 360px
- **THEN** 侧边栏高度占满可用垂直空间（扣除 Header 高度）
- **THEN** 侧边栏背景为深色主题（`bg-gray-900` 或类似），与当前暗色模式一致
- **THEN** 侧边栏有左侧边框分隔线
- **THEN** 侧边栏内容可垂直滚动
- **THEN** 侧边栏支持拖拽调整宽度（可选，最小 280px，最大 480px）

#### Scenario: 顶部搜索区
- **THEN** 显示标题"搜索词条"
- **THEN** 提供搜索输入框，placeholder 为"搜索词条"
- **THEN** 输入框右侧有搜索图标
- **THEN** 搜索框下方有排序下拉选择，默认"按名称"
- **THEN** 搜索实时过滤词条列表（按 key、label、entries 内容匹配）

#### Scenario: 分类标签栏
- **THEN** 显示所有分组的 pill 标签，格式为"分组名 数量"（如"全部 87"、"场景 13"）
- **THEN** "全部"标签始终存在，显示所有词条总数
- **THEN** 当前选中标签高亮（蓝色背景）
- **THEN** 标签栏横向可滚动
- **THEN** 点击标签切换当前筛选分组
- **THEN** 标签按词条数量降序排列（"全部"始终在最前）

#### Scenario: 词条列表
- **THEN** 每个词条显示为卡片，包含：
  - 左侧首字图标：取词条 key 的第一个字符，放入圆角方块中；颜色按分组循环分配（绿色系、橙色系、蓝色系等）
  - 词条名称（key）
  - 副标题："来源 · 条数 · 抽 N"（如"快手 · 50 条 · 抽 1"）— 来源显示 group 名称，条数显示 entries.length，抽数显示 draw_count
  - 右侧两个按钮："插入"和"替换"
- **THEN** 列表按当前搜索和分组筛选
- **THEN** 空状态显示提示文字

#### Scenario: 词条详情编辑区
- **THEN** 点击词条列表中的卡片，下方展开/显示词条详情编辑区
- **THEN** 详情区标题为"词条详情"，右上角有"新建词条"按钮
- **THEN** 表单三列布局：
  - **属性名称**：输入框，绑定 entry.key
  - **所属分类**：下拉选择，绑定 entry.groupId，选项为所有分组
  - **每次抽取数量**：数字输入框，绑定 entry.draw_count，范围 1-999
- **THEN** "候选词库"标签下方是大文本域（textarea），每行一个词条，绑定 entry.entries
- **THEN** 底部操作栏：左侧"删除"按钮（红色），右侧"还原"和"保存"按钮
- **THEN** "新建词条"按钮点击后创建空词条并进入编辑状态
- **THEN** "保存"将修改写回 store（updateWordLibraryEntry）
- **THEN** "删除"从 store 删除该词条（deleteWordLibraryEntry）并清空编辑区
- **THEN** "还原"重置表单为原始数据

#### Scenario: 插入/替换操作
- **WHEN** 用户点击词条卡片的"插入"按钮
- **THEN** 将该词条的变量标记（`\u2060key\u2061`）插入到当前 prompt 光标位置
- **THEN** 如果光标不在输入框内，则追加到 prompt 末尾
- **WHEN** 用户点击词条卡片的"替换"按钮
- **THEN** 将该词条的变量标记替换当前 prompt 中选中的文本
- **THEN** 如果没有选中文本，则行为同"插入"
- **THEN** 操作后显示 toast 提示"已插入"或"已替换"

### Requirement: WordLibrarySidebarToggle 组件

系统 SHALL 创建 `src/components/WordLibrarySidebarToggle.tsx`：

#### Scenario: 切换按钮
- **THEN** 显示在输入框工具栏右侧（或输入框右侧边缘）
- **THEN** 图标使用书本/词典样式（或保留现有骰子图标但改变含义）
- **THEN** 点击切换 `wordLibrarySidebarOpen` 状态
- **THEN** 按钮有 active 状态样式（当侧边栏打开时高亮）
- **THEN** tooltip 显示"词条库"

### Requirement: InputBar 修改

系统 SHALL 修改 `src/components/InputBar.tsx`：

#### Scenario: 删除旧入口
- **THEN** 删除桌面端和移动端工具栏中的"词条库管理"按钮（骰子图标）
- **THEN** 删除相关的 `randomHover` tooltip 和 aria-label

#### Scenario: 集成切换按钮
- **THEN** 在输入框区域右侧（靠近发送按钮）添加 `WordLibrarySidebarToggle`
- **THEN** 当侧边栏打开时，输入框区域宽度自适应（不重叠）

### Requirement: RandomPromptModal 降级

系统 SHALL 修改 `src/components/RandomPromptModal.tsx`：

#### Scenario: 功能剥离
- **THEN** 移除左侧分组列表、右侧词条卡片、搜索过滤、词条编辑弹窗等词条管理 UI
- **THEN** 保留 segments 模板编辑区和生成功能
- **THEN** 重命名为"提示词模板"或保留原名但功能聚焦
- **THEN** 从 InputBar 保留一个入口按钮（或移到设置中）用于打开模板生成器

### Requirement: 样式系统

系统 SHALL 在 `src/index.css` 中添加：

#### Scenario: 侧边栏基础样式
- `.word-library-sidebar`：固定定位、宽度、背景、边框、滚动条美化
- `.word-library-sidebar-resize-handle`：拖拽调整宽度的手柄样式

#### Scenario: 分类标签 pill
- `.word-library-tag`：圆角 pill、内边距、字体大小
- `.word-library-tag-active`：选中状态（蓝色背景 + 白色文字）
- `.word-library-tag-inactive`：未选中状态（深色背景 + 灰色文字）

#### Scenario: 词条卡片
- `.word-library-card`：卡片背景、圆角、内边距、hover 效果
- `.word-library-card-icon`：首字图标方块（圆角、颜色循环）
- `.word-library-card-actions`：插入/替换按钮组

#### Scenario: 详情区
- `.word-library-detail`：详情区背景、边框、内边距
- `.word-library-detail-form`：三列表单网格布局
- `.word-library-detail-textarea`：候选词库文本域样式

## MODIFIED Requirements

### Requirement: RandomPromptModal 保留功能

[原词条库管理功能已迁移到 WordLibrarySidebar，RandomPromptModal 仅保留模板生成]

#### Scenario: 模板生成
- **WHEN** 用户打开 RandomPromptModal
- **THEN** 仅显示 segments 编辑区和生成按钮
- **THEN** 词条来源从 store 的 wordLibraryEntries 读取（与侧边栏共享同一数据源）

## REMOVED Requirements

### Requirement: InputBar 底部词条库管理按钮
**Reason**: 功能已迁移到侧边浮动栏，原弹窗入口不再需要
**Migration**: 用户通过侧边栏 Toggle 按钮打开词条库

### Requirement: RandomPromptModal 中的词条管理 UI
**Reason**: 词条管理已集中到侧边栏，避免功能分散
**Migration**: 所有词条 CRUD 操作在侧边栏完成