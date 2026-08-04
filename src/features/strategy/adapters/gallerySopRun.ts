export type GallerySopBatchStatus = 'idle' | 'generating' | 'paused' | 'ready' | 'submitting' | 'success' | 'error'

export type GallerySopRunStatus = {
  workspaceTabId: string | null
  phase: GallerySopBatchStatus
  message: string
  promptCount: number
  availablePrompts: number
  totalImages: number
  failed: number
}

export function getGallerySopPromptRunStorageKey(tabId: string | null) {
  return `doupao.gallery-sop-prompt-run.${tabId ?? 'default'}`
}
