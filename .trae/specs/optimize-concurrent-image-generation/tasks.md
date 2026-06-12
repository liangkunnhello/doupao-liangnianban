# Tasks

- [x] Task 1: 将 executeInBatches 改为滑动窗口 + 单张即时回调模式
  - [x] SubTask 1.1: 修改 executeInBatches 内部逻辑：用 worker pool 替代 for 循环分批，worker 完成一个 item 后立即取下一个
  - [x] SubTask 1.2: 每个 item 成功后立即 storeImage + updateTaskInStore 追加到 outputImages（不等整轮）
  - [x] SubTask 1.3: 每个 item 失败后跳过，不影响其他 item 执行
  - [x] SubTask 1.4: 所有 item 完成后汇总结果（actualParams、revisedPrompts 等），做最终收尾更新
- [x] Task 2: 移除 openaiCompatibleImageApi.ts 中 n>1 的内部并发拆分
  - [x] SubTask 2.1: callImagesApi 在 n>1 时直接调用 callImagesApiSingle 发送带 n 参数的单次请求（store 层已拆分为 n=1）
  - [x] SubTask 2.2: callResponsesImageApi 在 n>1 时直接调用 callResponsesImageApiSingle 发送单次请求
  - [x] SubTask 2.3: 移除 callImagesApiConcurrent 函数（不再需要）
  - [x] SubTask 2.4: 移除 callResponsesImageApi 中的并发拆分逻辑
- [x] Task 3: 运行 typecheck 确保无编译错误
- [x] Task 4: 运行测试确保无回归

# Task Dependencies

- Task 2 依赖 Task 1（先确保 store 层的并发控制正确，再移除 API 层的并发逻辑）
- Task 3 和 Task 4 依赖 Task 1 和 Task 2 全部完成
