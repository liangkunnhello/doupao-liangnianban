# Tasks

- [x] Task 1: 实现辅助函数模块
  - 在 `src/lib/promptGenerator.ts` 中实现 `slugify`、`normalize_entries`、`normalize_draw_count`
  - 这三个函数为纯函数，无依赖，可并行编写测试
- [x] Task 2: 实现 render_prompt 核心函数
  - 在 `src/lib/promptGenerator.ts` 中实现 `render_prompt(state, seed?, missing_policy?)`
  - 含 JSON 解析、segments 清洗、通配符替换、随机抽取、报告生成
  - 依赖 Task 1 的三个辅助函数
- [x] Task 3: 编写单元测试
  - 在 `src/lib/promptGenerator.test.ts` 中覆盖 spec.md 中所有 Scenario
  - 对辅助函数和 render_prompt 核心函数做全覆盖测试

# Task Dependencies

- Task 1: 无依赖
- Task 2: 依赖 Task 1
- Task 3: 依赖 Task 2