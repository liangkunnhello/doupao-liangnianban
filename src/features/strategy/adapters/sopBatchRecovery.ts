import type { SopBatchSnapshot } from '../../../types'
import { getAllSopBatchSnapshots, putSopBatchSnapshot } from '../../../lib/db'

export async function recoverInterruptedSopBatchSnapshots(
  options: { workspaceTabId?: string | null } = {},
) {
  const snapshots = await getAllSopBatchSnapshots()
  const recoveredAt = Date.now()
  return Promise.all(snapshots.map(async (snapshot) => {
    const matchesWorkspace = options.workspaceTabId === undefined
      || snapshot.workspaceTabId === options.workspaceTabId
    if (!matchesWorkspace || snapshot.status !== 'generating') return snapshot
    const recovered: SopBatchSnapshot = {
      ...snapshot,
      status: snapshot.prompts.some((prompt) => !prompt.deleted && prompt.text.trim()) ? 'ready' : 'failed',
      updatedAt: recoveredAt,
    }
    await putSopBatchSnapshot(recovered)
    return recovered
  }))
}
