# 词条库管理系统 — 实施计划

## 摘要

将现有的"随机提示词生成器"（RandomPromptModal）重新设计为持久的"词条库管理"系统。双击变量标签时提供丰富编辑功能（修改变量名 + 编辑对应词条 + 保存到词条库），新增分组管理功能，实现词条数据的持久化存储。

---

## 当前状态分析

### 现有系统结构
- **变量标记**：`promptImageMentions.ts` 使用 `\u2060`/`\u2061` 标记变量，通过 `getPromptMentionParts` 解析为 `{type:'variable', text, varName}`
- **RandomPromptModal**：内存级词条库，无持久化，本地 state 管理
- **双击编辑**：InputBar 中简单调用 `PromptInputDialog`，只改变量名
- **词条库**：只有 `render_prompt` 调用时临时构建，关闭模态框即丢失
- **入口**：InputBar 骰子按钮 → `randomPromptModalOpen` store 状态

### 关键文件
- `src/components/RandomPromptModal.tsx` — 需重写为 WordLibraryManager
- `src/lib/promptGenerator.ts` — 保持不变（render_prompt 已完整）
- `src/lib/promptImageMentions.ts` — 保持不变（变量标记已完整）
- `src/components/InputBar.tsx` — 更新双击编辑逻辑和按钮入口
- `src/store.ts` — 新增词条库持久化状态

---

## 修改计划

### Phase 1: Store — 词条库持久化

**目标**：在 Zustand store 中添加持久化的词条库数据模型和 CRUD 操作。

**修改文件**：`src/store.ts`

**新增类型**（在 AppState interface 中）：
```typescript
interface WordLibraryGroup {
  id: string
  name: string
}

interface WordLibraryEntry {
  id: string
  groupId: string
  key: string          // 变量标识（与 VAR_START/END 匹配）
  label: string        // 显示名
  entries: string[]    // 词条列表
  draw_count: number   // 抽取数量
}
```

**新增 AppState 属性**：
- `wordLibraryGroups: WordLibraryGroup[]`（默认包含一个"默认分组"）
- `wordLibraryEntries: WordLibraryEntry[]`

**新增 AppState actions**：
- `createWordLibraryGroup(name)` → 新建分组
- `renameWordLibraryGroup(id, name)` → 重命名
- `deleteWordLibraryGroup(id)` → 删除分组（其下 entry 移至默认分组或删除）
- `createWordLibraryEntry(groupId, key?)` → 新建词条
- `updateWordLibraryEntry(id, patch)` → 更新词条（key/label/entries/draw_count）
- `deleteWordLibraryEntry(id)` → 删除词条
- `moveWordLibraryEntry(entryId, targetGroupId)` → 移动分组

**持久化**：使用 zustand persist middleware，key 为 `word-library`。

---

### Phase 2: WordLibraryManager 组件（替换 RandomPromptModal）

**目标**：将 RandomPromptModal 重写为词条库管理器，保留生成功能。

**修改文件**：`src/components/RandomPromptModal.tsx` → 重写

**UI 结构**（参照现有 PromptPresetSidebar 的 Dark/Light 切换标签风格）：

```
┌────────────────────────────────────────┐
│  词条库管理                   [关闭]     │
├──────────┬─────────────────────────────┤
│ 分组列表  │  词条列表（选中分组内）           │
│          │                             │
│ [默认]   │  ┌─ 词条1 ───────────────┐  │
│ [风格]   │  │ key: 风格  label: 风格  │  │
│ [材质]   │  │ draw: 2  词条: 20条    │  │
│ [颜色]   │  │ [编辑] [删除]          │  │
│          │  └────────────────────────┘  │
│ [+ 分组] │  ┌─ 词条2 ...             ┐  │
│          │  │ ...                     │  │
│          │  └────────────────────────┘  │
│          │  [+ 新增词条]                 │
├──────────┴─────────────────────────────┤
│  模板 (Segments)  [收起/展开]           │
│  ┌─文本段──┐ ┌─通配符段──┐              │
│  │a cute   │ │[风格]     │              │
│  └─────────┘ └───────────┘              │
│  [+文本] [+通配符]                      │
├─────────────────────────────────────────┤
│  [生成]  [重新生成]  [使用]              │
└─────────────────────────────────────────┘
```

**关键设计**：
- **分组列表**：左侧窄栏，点击切换选中分组，右键菜单重命名/删除
- **词条列表**：右侧主区域，显示选中分组下的所有词条
  - 每个词条卡片显示：key、label、词条数、draw_count
  - 点击"编辑"打开条目详情编辑（同现有 library 编辑器风格）
  - "新增词条"按钮
  - 搜索/过滤输入框
- **模板（Segments）区域**：折叠面板，保留现有 segments 编辑器
- **底部按钮**：保留生成/重新生成/使用按钮
  - 生成时：从 store 的 `wordLibraryEntries` 构建 library 对象，调用 `render_prompt`
- 每次打开模态框时，segments 重置为默认，library 从 store 加载

**入口**：InputBar 中的骰子按钮保持不变，store 状态名从 `randomPromptModalOpen` 改为 `wordLibraryModalOpen`（或保持原名兼容）。

---

### Phase 3: 双击变量标签增强

**目标**：双击变量标签时提供比当前 PromptInputDialog 更丰富的编辑体验。

**修改文件**：`src/components/InputBar.tsx`（`onDoubleClick` 处理）

**新行为**：
- 双击 `.wildcard-var` 时获取 `varName`
- 在 store 的 `wordLibraryEntries` 中查找匹配项（by key）
- 如果找到匹配词条：
  - 打开一个弹窗/浮层显示：
    - 变量名（可编辑）
    - 所属分组（下拉选择）
    - label
    - draw_count
    - 词条列表（textarea，每行一词）
    - [保存] [取消] 按钮
  - 保存时：`updateWordLibraryEntry(id, patch)` + 更新 prompt 中的变量标记
- 如果未找到匹配词条：
  - 打开一个浮层显示：
    - 变量名
    - 分组（下拉选择，默认"默认分组"）
    - label（预填变量名）
    - [创建并编辑词条] → 调用 createWordLibraryEntry，然后显示编辑界面
    - [取消]

**实现方式**：复用 PromptInputDialog 机制或创建一个新的小型浮层组件。为了保持一致性和降低复杂度，可以使用 `setPromptInputDialog` 但传入更丰富的配置，或者创建一个 `editVariableDialog` 专用状态。

决策：创建一个新的 `editVariableDialog` store 状态，配合一个轻量级 EditVariableOverlay 组件。

---

### Phase 4: 入口更新与收尾

**目标**：清理旧代码，确保所有入口正确。

**修改文件**：`src/App.tsx`、`src/components/InputBar.tsx`

- 更新 App.tsx 中的组件注册（`RandomPromptModal` → `WordLibraryManager`）
- InputBar 按钮文字改回"词条库管理"（或保持图标）
- 删除旧的 `randomPromptModalOpen` 相关 store 状态（保留兼容别名或直接替换）

---

## 假设与决策

1. **持久化策略**：使用 Zustand persist middleware（localStorage），与现有 store 的持久化方式一致。词条数据量通常较小，localStorage 足够。
2. **分组方案**：简单扁平分组，不引入嵌套。每个 entry 有且仅有一个 groupId。
3. **变量解析**：提交提示词时，如果 prompt 中包含 `\u2060var\u2061`，在提交前自动用 `render_prompt` 替换（使用词条库作为 library）。这是一个后续强化点，当前先聚焦于编辑和管理功能。
4. **兼容性**：保留 `randomPromptModalOpen` 作为别名或直接替换为 `wordLibraryModalOpen`，避免额外迁移。
5. **UI 风格**：所有新 UI 遵循项目现有设计系统（Tailwind CSS、圆角卡片、毛玻璃背景、暗色支持）。

---

## 验证步骤

1. TypeScript 编译通过（0 error）
2. 所有已有测试通过（202 tests）
3. 打开词条库管理器，验证：
   - 默认有一个"默认分组"
   - 可新建/重命名/删除分组
   - 可在分组下新建/编辑/删除词条
4. 验证词条数据刷新页面后仍然存在（localStorage 持久化）
5. 双击变量标签，验证：
   - 已有词条可编辑
   - 新建词条可创建
   - 保存后 prompt 和词条库同步更新
6. 使用模板 + 生成功能，验证生成的提示词正确引用了词条库