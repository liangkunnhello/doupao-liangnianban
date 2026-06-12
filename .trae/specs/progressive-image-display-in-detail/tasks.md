# Tasks

- [x] Task 1: 修改 DetailModal 图片展示条件，running + outputImages 非空时展示已完成图片
  - [x] SubTask 1.1: 将 `{task.status === 'done' && outputLen > 0 && ...}` 的条件改为 `(task.status === 'done' || (task.status === 'running' && outputLen > 0)) && ...`
  - [x] SubTask 1.2: 下载按钮和分页导航的条件同步放宽（不再仅限 done）
- [x] Task 2: running 状态下展示"生成中"指示器覆盖在已完成图片上
  - [x] SubTask 2.1: 在已完成图片展示区域上方叠加半透明"生成中"标签（类似 TaskCard 的生成中标签样式）
  - [x] SubTask 2.2: 分页指示器文案改为 "N / M (共需 X 张)" 格式，其中 X = task.params.n
- [x] Task 3: 确保 running 状态下 outputPreviewSrcs 的 useEffect 正确加载图片
  - [x] SubTask 3.1: 验证现有 useEffect（依赖 task.outputImages）在 running 状态下仍正常触发和加载
  - [x] SubTask 3.2: 确保 imageIndex 在 outputImages 增长时不会越界（现有逻辑已处理）
- [x] Task 4: 运行 typecheck 和 lint 确保无编译错误

# Task Dependencies

- Task 2 依赖 Task 1（需要在图片展示后才叠加指示器）
- Task 3 独立于 Task 1/2（验证性任务）
- Task 4 依赖 Task 1-3 全部完成
