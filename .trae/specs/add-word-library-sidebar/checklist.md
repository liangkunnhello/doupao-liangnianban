# 检查清单

## Store 状态扩展
- [x] `wordLibrarySidebarOpen` 和 `setWordLibrarySidebarOpen` 已添加到 AppState 接口
- [x] `wordLibrarySidebarOpen` 默认值为 `false`
- [x] `wordLibrarySidebarOpen` 不参与持久化

## 联动划词转词条
- [x] 划词点击"转换为变量"后，侧边栏自动打开
- [x] 新变量自动在词条库中创建对应词条（如果不存在）
- [x] 侧边栏自动选中/高亮新创建的词条卡片
- [x] 词条详情编辑区自动展开，显示该词条的名称、分组、候选词库
- [x] 编辑保存后，上方词条列表实时更新
- [x] 分组变化后，词条自动重新分类到对应分组
- [x] 分类标签栏根据当前词条的分组自动高亮对应 pill

## 分组下拉支持新建
- [x] "所属分类"下拉中有"+ 新建分组"选项
- [x] 点击后弹出输入框可输入分组名称
- [x] 确认后创建新分组并自动选中
- [x] 分类标签栏实时显示新分组

## 插入/替换精确光标操作
- [x] "插入"按钮在 contentEditable 光标位置插入变量标记
- [x] "替换"按钮替换 contentEditable 中选中的文本
- [x] 输入框无焦点时先聚焦再操作
- [x] 操作后光标位置正确

## InputBar 修改
- [x] 桌面端工具栏已删除旧骰子按钮
- [x] 移动端工具栏已删除旧骰子按钮
- [x] `WordLibrarySidebarToggle` 已集成
- [x] 划词转词条后自动打开侧边栏

## RandomPromptModal 降级
- [x] 词条管理 UI 已移除
- [x] segments 模板编辑区保留
- [x] 生成功能保留

## 验证
- [x] TypeScript 编译通过（0 错误）
- [x] 所有测试通过（202 passed）
- [x] 完整流程验证通过
