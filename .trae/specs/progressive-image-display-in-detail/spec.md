# 运行中任务详情页渐进式图片展示 Spec

## Why

当前任务卡片（TaskCard）在 running 状态下已能显示已完成的图片缩略图，但用户点进详情页（DetailModal）后却看不到已完成的图片——DetailModal 在 running 状态下只显示"流式预览"或"加载中"旋转图标，只有 status === 'done' 时才渲染已完成的 outputImages。用户期望"边生边展示"，每完成一张就立即在详情页中可见。

## What Changes

- DetailModal 左侧图片区域在 running 状态下，若 outputImages 已有数据，优先展示已完成的图片（带分页、下载按钮），而非只显示流式预览/loading spinner
- running 状态下同时展示已完成图片和流式预览/加载指示器，形成混合视图
- 分页计数需区分"已完成 N / 共 M 张"的语义

## Impact

- Affected code: `src/components/DetailModal.tsx`（核心改动）、`src/components/TaskCard.tsx`（参考，无需改动）

## ADDED Requirements

### Requirement: 运行中详情页渐进式图片展示

DetailModal 在任务 running 状态下 SHALL 展示已完成的 outputImages 图片，而不是仅显示流式预览或加载旋转图标。

#### Scenario: running 状态下已有部分完成图片

- **WHEN** 任务处于 running 状态 AND task.outputImages.length > 0
- **THEN** DetailModal 左侧图片区域展示已完成的 outputImages 图片，支持分页切换
- **AND** 同时在图片上方或旁边显示"生成中"指示器，标明任务仍在进行

#### Scenario: running 状态下无已完成图片但有流式预览

- **WHEN** 任务处于 running 状态 AND task.outputImages.length === 0 AND streamPreviewSrc 存在
- **THEN** 展示流式预览（保持现有行为不变）

#### Scenario: running 状态下无已完成图片也无流式预览

- **WHEN** 任务处于 running 状态 AND task.outputImages.length === 0 AND 无流式预览
- **THEN** 展示加载旋转图标（保持现有行为不变）

#### Scenario: running 状态下分页导航

- **WHEN** 任务处于 running 状态 AND outputImages.length > 1
- **THEN** 用户可通过左右箭头切换已完成的图片
- **AND** 底部分页指示器显示 "N / M (共需 X 张)"，其中 N 为当前索引+1，M 为已完成数，X 为总需求数（task.params.n）

#### Scenario: 新图片在 running 中追加后的即时反映

- **WHEN** 任务处于 running 状态 AND 新图片被追加到 outputImages
- **THEN** DetailModal 的 useEffect（依赖 task.outputImages）自动触发，加载新图片的 dataUrl 并更新展示

## MODIFIED Requirements

### Requirement: DetailModal 图片展示条件

原要求：status === 'done' 时展示 outputImages。

修改为：status === 'done' 或 status === 'running'（且 outputImages.length > 0）时展示 outputImages。

## REMOVED Requirements

无。
