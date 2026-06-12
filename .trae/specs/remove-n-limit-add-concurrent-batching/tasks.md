# Tasks

## Task 1: 移除 paramCompatibility 中的数量上限常量及限值逻辑
修改 `src/lib/paramCompatibility.ts`：
- 移除 `MAX_OPENAI_OUTPUT_IMAGES` (10) 和 `MAX_FAL_OUTPUT_IMAGES` (4) 常量
- `getOutputImageLimitForSettings` 改为返回 `Infinity`
- `normalizeParamsForSettings` 中不再对 n 做 `Math.min(outputImageLimit, ...)` 截断，仅保留 `Math.max(1, params.n || DEFAULT_PARAMS.n)`

## Task 2: 更新 InputBar 中的 n 值处理逻辑
修改 `src/components/InputBar.tsx`：
- `commitN` 中移除 `Math.min(outputImageLimit, ...)` 截断，仅保留 `Math.max(1, normalizedValue)`
- `handleNInputChange` 中移除超限提示逻辑（`nextValue > outputImageLimit` 检查）
- `handleNLimitIncreaseAttempt` 中不再需要拦截（`effectiveValue < outputImageLimit` 检查）
- 更新 `nLimitHintText` 文案，不再提及具体上限

## Task 3: 修改 store.ts 普通模式并发逻辑
修改 `src/store.ts`：
- 提取并发批次常量 `MAX_CONCURRENT = 20`
- 将普通模式（n > 1）的 `Promise.allSettled(Array.from({ length: n })...)` 改为按批次处理：
  - 每批最多 `MAX_CONCURRENT` 个并发请求
  - 每批使用 `Promise.allSettled` 执行
  - 所有批次结果合并到 `successfulResults`
- 涉及回调参数 `i`（task stream preview 的 index）需要基于全局索引而非批次内索引

## Task 4: 修改 store.ts 文件夹模式并发逻辑
修改 `src/store.ts`：
- 文件夹模式（useFolderMode）的顺序 `for` 循环改为按批次并发（每批最多 20）
- 每批并发执行 `callImageApi`，结果合并到 `results`
- 每批完成后再执行下一批
- 涉及回调参数 `i` 同样基于全局索引

## Task 5: 更新 paramCompatibility.test.ts
修改 `src/lib/paramCompatibility.test.ts`：
- 删除关于上限截断的测试用例（"limits OpenAI output count to 10" 和 "limits fal.ai output count to 4"）
- 添加新的测试用例验证 n 不再被截断

## Task 6: 运行测试验证
- 运行 `npm run test` 确保所有测试通过
- 运行 `npm run tsc` 确保 TypeScript 编译无错误

# Task Dependencies
- [Task 5] 依赖于 [Task 1]
- [Task 2] 依赖于 [Task 1]
- [Task 3] 无依赖
- [Task 4] 无依赖
- [Task 6] 依赖于 [Task 1-5]