# 优化并发生图方式 Spec

## Why

当前项目在 `store.ts` 的 `executeInBatches` 中做了分批并发控制，但 `openaiCompatibleImageApi.ts` 中的 `callImagesApiConcurrent` / `callResponsesImageApi` 对 `n>1` 又做了一层并发拆分，形成双重并发。同时，并发模式下每张图完成后没有即时回调更新 UI，必须等整轮结束后才批量追加到 outputImages。参考 Infinite-Canvas 项目的"每张图单独完成即展示"模式，需要优化并发架构以实现更稳定、更高效的生图。

## What Changes

- 消除双重并发：`openaiCompatibleImageApi.ts` 中的 `callImagesApi` / `callOpenAICompatibleImageApi` 在 `n=1` 时直接调用单次 API，不再内部拆分并发（并发控制统一由 `store.ts` 的 `executeInBatches` 管理）
- `executeInBatches` 改为"单张即时回调"模式：每张图生成成功后立即调用 `storeImage` + `updateTaskInStore` 追加到 outputImages，不等整轮完成
- `executeInBatches` 改用滑动窗口（worker pool）模式替代分批模式：worker 完成一个 item 后立即取下一个，避免等待最慢的请求拖垮整轮
- 在 `TaskCard` 和 `DetailModal` 的 running 状态下展示已完成的 outputImages（已部分实现在上一次 spec 中）

## Impact

- Affected code: `src/lib/openaiCompatibleImageApi.ts`（移除 n>1 内部并发拆分）、`src/store.ts`（executeInBatches 改为单张即时回调 + 滑动窗口）、`src/lib/imageApiShared.ts`（runWithConcurrencyAndRetry 增加单完成回调）

## ADDED Requirements

### Requirement: 单张即时回调机制

系统 SHALL 在并发图片生成过程中，每张图生成成功后立即将其存储并追加到任务的 outputImages，而非等待整批/整轮完成后才批量追加。

#### Scenario: 并发生成中某张图先完成

- **WHEN** 任务请求生成 N 张图 AND 当前正在并发生成中 AND 其中一张图先完成
- **THEN** 该图立即被 storeImage 保存 AND 立即通过 updateTaskInStore 追加到 outputImages
- **AND** UI（TaskCard 缩略图、DetailModal 图片展示）立即更新显示该图

#### Scenario: 某张图失败但其他图继续

- **WHEN** 并发生成中某张图失败（重试耗尽后）
- **THEN** 失败的图被跳过，不追加到 outputImages
- **AND** 其他仍在进行的图继续执行
- **AND** 最终只包含成功生成的图片

### Requirement: 滑动窗口并发替代分批并发

系统 SHALL 使用滑动窗口（worker pool）模式管理并发生成，而非固定分批模式。

#### Scenario: 5并发生成40张图

- **WHEN** 用户请求 40 张图 AND maxConcurrent = 5
- **THEN** 系统启动 5 个 worker，每个 worker 完成一张后立即取下一张
- **AND** 同一时刻最多 5 个请求在飞行中
- **AND** 不存在"等最慢请求完成后才启动下一批"的等待时间

#### Scenario: 某个请求特别慢

- **WHEN** 5 个并发请求中有 1 个特别慢（如超时 120s）AND 其他 4 个已完成
- **THEN** 4 个已完成的图片立即追加到 outputImages
- **AND** 第 5 个 worker 继续等待（直到完成或超时）
- **AND** 其他 worker 从待处理队列取新 item 开始执行

### Requirement: 消除 API 层双重并发

系统 SHALL 确保图片生成 API 调用不会在两层同时做并发拆分。

#### Scenario: store 层并发控制下的 API 调用

- **WHEN** store.ts 的 executeInBatches 以 n=1 调用 callImageApi
- **THEN** callImageApi 直接执行单次 API 请求，不再内部拆分为多个 n=1 并发请求
- **AND** 并发控制完全由 executeInBatches 的滑动窗口管理

## MODIFIED Requirements

### Requirement: callImagesApi 和 callOpenAICompatibleImageApi 的 n>1 处理

原行为：n>1 时内部调用 callImagesApiConcurrent / callResponsesImageApi 做并发拆分。

修改为：n>1 时仍由调用方（store.ts）负责拆分为 n=1 的单次请求，API 层不再自动并发拆分。callImagesApi 和 callResponsesImageApi 在 n>1 时直接发送单次 API 请求（带 n 参数），如果 API 不支持 n>1 则由调用方决定如何拆分。

**注意**：当前 store.ts 的 executeInBatches 已将每个请求设为 n=1，因此 API 层的并发拆分实际上不会被触发。只需移除 API 层中 n>1 的并发逻辑，避免双重并发。

## REMOVED Requirements

无。
