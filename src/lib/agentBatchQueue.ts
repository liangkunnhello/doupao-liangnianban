import type { AgentBatchPlan } from './agentBatchPlanner'

export const AGENT_BATCH_QUEUE_STORAGE_KEY = 'doupao.agent-batch-queue.v1'
export const AGENT_BATCH_QUEUE_UPDATED_EVENT = 'doupao-agent-batch-queue-updated'

export interface AgentBatchQueueSubmission {
  taskId: string
  submittedAt: number
  plannedCount: number
}

export interface AgentBatchQueue {
  version: 1
  id: string
  createdAt: number
  paused: boolean
  plan: AgentBatchPlan
  submitted: Record<string, AgentBatchQueueSubmission>
  lastRunDate?: string
  lastError?: string
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function getStorage(): StorageLike | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

export function createAgentBatchQueue(plan: AgentBatchPlan, now = Date.now()): AgentBatchQueue {
  return {
    version: 1,
    id: `agent-batch-${now}`,
    createdAt: now,
    paused: false,
    plan,
    submitted: {},
  }
}

export function loadAgentBatchQueue(storage: StorageLike | null = getStorage()): AgentBatchQueue | null {
  if (!storage) return null
  try {
    const parsed = JSON.parse(storage.getItem(AGENT_BATCH_QUEUE_STORAGE_KEY) ?? 'null') as AgentBatchQueue | null
    if (!parsed || parsed.version !== 1 || !parsed.plan || !Array.isArray(parsed.plan.days)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveAgentBatchQueue(queue: AgentBatchQueue, storage: StorageLike | null = getStorage()) {
  storage?.setItem(AGENT_BATCH_QUEUE_STORAGE_KEY, JSON.stringify(queue))
}

export function clearAgentBatchQueue(storage: StorageLike | null = getStorage()) {
  storage?.removeItem(AGENT_BATCH_QUEUE_STORAGE_KEY)
}

export function getDueBatchUnits(queue: AgentBatchQueue, dateKey: string) {
  for (const day of queue.plan.days) {
    if (day.date > dateKey) break
    const pending = day.units.filter((unit) => !queue.submitted[unit.id])
    if (pending.length > 0) return pending
  }
  return []
}

export function getBatchQueueProgress(queue: AgentBatchQueue) {
  const allUnits = queue.plan.days.flatMap((day) => day.units)
  const submittedUnits = allUnits.filter((unit) => Boolean(queue.submitted[unit.id]))
  return {
    totalUnits: allUnits.length,
    submittedUnits: submittedUnits.length,
    submittedImages: submittedUnits.reduce((sum, unit) => sum + unit.plannedCount, 0),
    completed: submittedUnits.length === allUnits.length,
  }
}
