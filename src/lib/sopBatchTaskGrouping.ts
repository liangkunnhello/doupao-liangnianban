import type { TaskRecord } from '../types'

export type SopBatchSummary = {
  total: number
  running: number
  completed: number
  failed: number
}

export type TaskGridItem =
  | { kind: 'task'; id: string; createdAt: number; task: TaskRecord }
  | {
      kind: 'reverse-sop'
      id: string
      createdAt: number
      controller: TaskRecord
      imageTasks: TaskRecord[]
    }
  | {
      kind: 'sop-batch'
      id: string
      createdAt: number
      groupId: string
      sopName: string
      tasks: TaskRecord[]
      summary: SopBatchSummary
    }

export function getSopBatchElapsedMs(tasks: TaskRecord[], now = Date.now()) {
  if (!tasks.length) return 0

  const startedAt = Math.min(...tasks.map((task) => task.createdAt))
  const isStillRunning = tasks.some((task) => task.status === 'running' || task.falRecoverable || task.customRecoverable)
  if (isStillRunning) return Math.max(0, now - startedAt)

  const finishedAt = Math.max(...tasks.map((task) => task.finishedAt ?? (task.elapsed != null ? task.createdAt + task.elapsed : task.createdAt)))
  return Math.max(0, finishedAt - startedAt)
}

export function formatSopBatchElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0')
  const remainderSeconds = String(seconds % 60).padStart(2, '0')
  return `${minutes}:${remainderSeconds}`
}

function sortBatchTasks(tasks: TaskRecord[]) {
  return [...tasks].sort((a, b) => {
    const indexDelta = (a.sopBatch?.promptIndex ?? Number.MAX_SAFE_INTEGER) - (b.sopBatch?.promptIndex ?? Number.MAX_SAFE_INTEGER)
    return indexDelta || a.createdAt - b.createdAt
  })
}

function keepLatestPromptAttempts(tasks: TaskRecord[]) {
  const latestByPrompt = new Map<string, TaskRecord>()
  for (const task of tasks) {
    const promptKey = task.sopBatch?.promptId || String(task.sopBatch?.promptIndex ?? task.id)
    const previous = latestByPrompt.get(promptKey)
    if (!previous || task.createdAt >= previous.createdAt) latestByPrompt.set(promptKey, task)
  }
  return [...latestByPrompt.values()]
}

function summarize(tasks: TaskRecord[]): SopBatchSummary {
  return tasks.reduce<SopBatchSummary>((summary, task) => {
    if (task.status === 'running') summary.running += 1
    else if (task.status === 'error') summary.failed += 1
    else summary.completed += 1
    summary.total += 1
    return summary
  }, { total: 0, running: 0, completed: 0, failed: 0 })
}

export function groupSopBatchTasks(tasks: TaskRecord[]): TaskGridItem[] {
  const batches = new Map<string, TaskRecord[]>()
  const reverseControllers = new Map<string, TaskRecord>()
  const reverseImageTasks = new Map<string, TaskRecord[]>()
  const items: TaskGridItem[] = []

  for (const task of tasks) {
    if (task.reverseSop?.role === 'controller') {
      reverseControllers.set(task.reverseSop.runId, task)
      continue
    }
    if (task.reverseSop?.role === 'image') {
      reverseImageTasks.set(task.reverseSop.runId, [...(reverseImageTasks.get(task.reverseSop.runId) ?? []), task])
      continue
    }
    const groupId = task.sopBatch?.snapshotId || task.sopBatch?.batchId
    if (!groupId) {
      items.push({ kind: 'task', id: task.id, createdAt: task.createdAt, task })
      continue
    }
    batches.set(groupId, [...(batches.get(groupId) ?? []), task])
  }

  for (const [groupId, batchTasks] of batches) {
    const sortedTasks = sortBatchTasks(keepLatestPromptAttempts(batchTasks))
    const firstTask = sortedTasks[0]
    if (!firstTask) continue
    items.push({
      kind: 'sop-batch',
      id: `sop-batch:${groupId}`,
      groupId,
      sopName: firstTask.sopBatch?.sopName || 'SOP 批量任务',
      createdAt: Math.max(...sortedTasks.map((task) => task.createdAt)),
      tasks: sortedTasks,
      summary: summarize(sortedTasks),
    })
  }

  for (const [runId, controller] of reverseControllers) {
    const activeChildIds = controller.reverseSop?.role === 'controller'
      ? new Set(controller.reverseSop.imageTaskIds)
      : new Set<string>()
    const children = (reverseImageTasks.get(runId) ?? []).filter((task) => activeChildIds.has(task.id))
    items.push({
      kind: 'reverse-sop',
      id: `reverse-sop:${runId}`,
      createdAt: Math.max(controller.createdAt, ...children.map((task) => task.createdAt)),
      controller,
      imageTasks: children.sort((a, b) => (a.reverseSop?.role === 'image' ? a.reverseSop.promptIndex : 0) - (b.reverseSop?.role === 'image' ? b.reverseSop.promptIndex : 0)),
    })
  }

  // A controller can be filtered out while a child remains visible. Do not
  // hide that result: show it as an ordinary task in that narrow case.
  for (const [runId, children] of reverseImageTasks) {
    if (reverseControllers.has(runId)) continue
    children.forEach((task) => items.push({ kind: 'task', id: task.id, createdAt: task.createdAt, task }))
  }

  return items.sort((a, b) => b.createdAt - a.createdAt)
}
