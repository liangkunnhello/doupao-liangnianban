import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { submitPlannedBatchUnit } from '../lib/agentBatchExecution'
import { AGENT_BATCH_QUEUE_UPDATED_EVENT, getBatchQueueProgress, getDueBatchUnits, loadAgentBatchQueue, saveAgentBatchQueue } from '../lib/agentBatchQueue'

function todayKey() {
  const date = new Date()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function AgentBatchQueueRunner() {
  const runningRef = useRef(false)

  useEffect(() => {
    const run = async () => {
      if (runningRef.current) return
      const queue = loadAgentBatchQueue()
      if (!queue || queue.paused || getBatchQueueProgress(queue).completed) return
      const currentDate = todayKey()
      if (queue.lastRunDate === currentDate) return
      const dueUnits = getDueBatchUnits(queue, currentDate)
      if (dueUnits.length === 0) return
      runningRef.current = true
      try {
        for (const unit of dueUnits) {
          const state = useStore.getState()
          const taskId = await submitPlannedBatchUnit(unit, state.settings, state.params)
          if (!taskId) throw new Error('批量任务未成功提交，请检查 API 配置')
          queue.submitted[unit.id] = { taskId, submittedAt: Date.now(), plannedCount: unit.plannedCount }
          queue.lastError = undefined
          saveAgentBatchQueue(queue)
        }
        queue.lastRunDate = currentDate
        saveAgentBatchQueue(queue)
        const progress = getBatchQueueProgress(queue)
        useStore.getState().showToast(
          progress.completed ? '自动批量队列已全部提交' : `自动批量队列已提交到 ${todayKey()}`,
          'success',
        )
      } catch (reason) {
        queue.paused = true
        queue.lastError = reason instanceof Error ? reason.message : String(reason)
        saveAgentBatchQueue(queue)
        useStore.getState().showToast(`自动批量队列已暂停：${queue.lastError}`, 'error')
      } finally {
        runningRef.current = false
      }
    }

    const initialTimer = window.setTimeout(() => { void run() }, 2_000)
    const interval = window.setInterval(() => { void run() }, 60_000)
    const handleQueueUpdate = () => { void run() }
    window.addEventListener(AGENT_BATCH_QUEUE_UPDATED_EVENT, handleQueueUpdate)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(interval)
      window.removeEventListener(AGENT_BATCH_QUEUE_UPDATED_EVENT, handleQueueUpdate)
    }
  }, [])

  return null
}
