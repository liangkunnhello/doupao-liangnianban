# 移除生成数量上限 & 添加并发批次控制 Spec

## Why

当前程序对一次生成图片数量限制为 10 张（OpenAI）/ 4 张（fal.ai），且用户希望生成更多图片时不受该限制约束。同时，当 n > 1 时所有请求全部并发执行，可能造成资源压力过大。需要：

1. 取消生成数量上限，允许用户输入任意正整数
2. 保持 n > 1 时拆分单图调用的逻辑（已有）
3. 限制最大并发数为 20，超出部分自动按批次轮循

## What Changes

- **BREAKING**: 移除 `MAX_OPENAI_OUTPUT_IMAGES` (10) 和 `MAX_FAL_OUTPUT_IMAGES` (4) 常量
- **BREAKING**: 移除 `getOutputImageLimitForSettings` 函数的限值逻辑，改为返回 `Infinity`
- 修改 `normalizeParamsForSettings`：不再用 `Math.min(outputImageLimit, n)` 截断 n
- 修改 `InputBar.tsx` 中的 `commitN`：移除 `Math.min(outputImageLimit, ...)` 截断，仅保留 `Math.max(1, normalizedValue)`
- 修改 `InputBar.tsx` 中的 `handleNInputChange`：不再显示超限提示
- 修改 `InputBar.tsx` 中的 `handleNLimitIncreaseAttempt`：不再拦截超限输入
- 修改 `InputBar.tsx` 中的 `nLimitHintText`：更新提示文案
- 修改 `src/store.ts` 普通模式（n > 1）：将 `Promise.allSettled(Array.from({ length: n })...)` 改为按批次并发（每批最多 20），所有批次完成后汇总结果
- 修改 `src/store.ts` 文件夹模式（useFolderMode）：将顺序 `for` 循环改为按批次并发（每批最多 20），所有批次完成后汇总结果
- 更新 `paramCompatibility.test.ts`：删除关于上限的测试用例，添加新的无上限测试

## Impact

- Affected specs: 参数兼容性、UI 输入处理、图片生成执行逻辑
- Affected code: `src/lib/paramCompatibility.ts`, `src/components/InputBar.tsx`, `src/store.ts`, `src/lib/paramCompatibility.test.ts`

## ADDED Requirements

### Requirement: 无上限输入
系统 SHALL 允许用户在生成数量输入框中输入任意正整数（>= 1）。

#### Scenario: 用户输入超过旧上限的值
- **WHEN** 用户输入大于 10（OpenAI）/ 4（fal.ai）的数值
- **THEN** 输入框接受该数值，不做截断或提示限制

### Requirement: 按批次并发
系统 SHALL 在 n > 1 时将请求拆分为多批次并发，每批最多 20 个并发请求。

#### Scenario: 生成 50 张图片
- **WHEN** n = 50
- **THEN** 第 1 批并发发送请求 #0-#19，第 2 批 #20-#39，第 3 批 #40-#49，所有批次完成后汇总结果

#### Scenario: 生成 20 张图片
- **WHEN** n = 20
- **THEN** 一批并发发送所有 20 个请求

#### Scenario: 生成 1 张图片
- **WHEN** n = 1
- **THEN** 单次调用，不走批次逻辑

### Requirement: 文件夹模式也支持批次并发
系统 SHALL 在文件夹模式下同样按批次并发（每批最多 20），而非顺序串行。

## MODIFIED Requirements

### Requirement: 生成数量提交
commitN 不再将 n 截断到旧上限，仅确保 n >= 1。

### Requirement: 参数规范化
normalizeParamsForSettings 不再对 n 做上限截断。

## REMOVED Requirements

### Requirement: 生成数量上限提示
**Reason**: 无上限后不再需要
**Migration**: 移除 `handleNInputChange` 和 `handleNLimitIncreaseAttempt` 中的超限提示逻辑；移除 `nLimitHintText` 中关于上限的描述

### Requirement: MAX_OPENAI_OUTPUT_IMAGES / MAX_FAL_OUTPUT_IMAGES 常量
**Reason**: 无上限后不再需要
**Migration**: 移除常量定义和 `getOutputImageLimitForSettings` 中的限值逻辑