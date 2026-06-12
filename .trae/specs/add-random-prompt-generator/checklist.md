# 检查清单

- [x] Task 1 已验证：slugify 正确转换并截断
- [x] Task 1 已验证：normalize_entries 正确处理数组/字符串/null 输入
- [x] Task 1 已验证：normalize_draw_count 正确处理范围校验和类型转换
- [x] Task 2 已验证：render_prompt 纯文本 segment 直接拼接
- [x] Task 2 已验证：render_prompt 通配符从词库随机抽取替换
- [x] Task 2 已验证：render_prompt seed>0 时确定性随机（同 seed 结果一致）
- [x] Task 2 已验证：render_prompt seed=0/无 seed 时真随机
- [x] Task 2 已验证：missing_policy="keep_label" 时无对应词条返回 label
- [x] Task 2 已验证：missing_policy="empty" 时无对应词条返回空串
- [x] Task 2 已验证：draw_count > entries 长度时取全部
- [x] Task 2 已验证：空 state 返回 ("", [])
- [x] Task 2 已验证：entries 去重去空后再抽取
- [x] Task 2 已验证：词库属性为列表格式时自动转为对象格式
- [x] Task 2 已验证：返回格式包含 (最终文本, 抽取报告)
- [x] Task 3 已验证：所有测试用例通过，覆盖率符合要求