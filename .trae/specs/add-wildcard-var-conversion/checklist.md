# 检查清单

- [x] Task 1: VAR_START/VAR_END/VAR_MENTION_RE 导出正确
- [x] Task 1: PromptMentionPart 包含 'variable' 类型
- [x] Task 1: getPromptMentionParts 正确解析变量标记
- [x] Task 1: stripImageMentionMarkers 去除新标记
- [x] Task 2: 明亮模式 wildcard-var 样式正确（橙色/琥珀色背景）
- [x] Task 2: 暗色模式 wildcard-var 样式正确
- [x] Task 3: 选中纯文本时"转换为变量"按钮可用
- [x] Task 3: 选中已有变量/mention 时按钮不可用（handleConvertToVariable 有保护检查）
- [x] Task 3: 点击按钮将选中文本转为变量标签（橙色背景）
- [x] Task 3: 变量可被正确渲染和读取（getContentEditablePlainText 含 VAR_START/VAR_END）
- [x] Task 3: 双击变量弹出编辑对话框
- [x] Task 3: 编辑变量名后 prompt 正确更新
- [x] Task 3: 清空变量名可删除变量
- [x] Task 3: 辅助函数（getNodeVisibleTextLength / getMentionTagForBoundary / syncMentionTagSelection / setContentEditableCursor / findBoundary）正确处理 wildcard-var
- [x] Task 4: TypeScript 编译通过（0 错误）
- [x] Task 4: 所有测试通过（202 passed）
- [x] Task 4: 完整流程验证通过