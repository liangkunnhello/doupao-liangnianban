export const INITIAL_TASK_GRID_RENDER_COUNT = 60
export const TASK_GRID_RENDER_BATCH_SIZE = 60

export function getTaskGridRenderSlice<T>(tasks: T[], visibleCount: number): T[] {
  return tasks.slice(0, Math.max(0, visibleCount))
}

export function getNextTaskGridVisibleCount(currentCount: number, totalCount: number, batchSize = TASK_GRID_RENDER_BATCH_SIZE): number {
  return Math.min(totalCount, currentCount + Math.max(1, batchSize))
}
