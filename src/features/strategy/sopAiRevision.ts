export type SopAiRevisionMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  revision?: {
    content: string
    changeSummary: string[]
    appliedAt?: number
  }
}

export type SopAiRevisionThread = {
  documentId: string
  messages: SopAiRevisionMessage[]
  updatedAt: number
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const STORAGE_PREFIX = 'doupao.sop-ai-revision.v1.'
const MAX_PERSISTED_MESSAGES = 30

function getStorage(): StorageLike | null {
  return typeof window === 'undefined' ? null : window.localStorage
}

function storageKey(documentId: string) {
  return `${STORAGE_PREFIX}${documentId}`
}

function isRevisionMessage(value: unknown): value is SopAiRevisionMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<SopAiRevisionMessage>
  if (typeof message.id !== 'string' || (message.role !== 'user' && message.role !== 'assistant')) return false
  if (typeof message.text !== 'string' || typeof message.createdAt !== 'number') return false
  if (!message.revision) return true
  return typeof message.revision.content === 'string'
    && Array.isArray(message.revision.changeSummary)
    && message.revision.changeSummary.every((item) => typeof item === 'string')
}

export function loadSopAiRevisionThread(
  documentId: string,
  storage: StorageLike | null = getStorage(),
): SopAiRevisionThread {
  const emptyThread = { documentId, messages: [], updatedAt: 0 }
  if (!storage) return emptyThread
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(documentId)) ?? 'null') as Partial<SopAiRevisionThread> | null
    if (!parsed || parsed.documentId !== documentId || !Array.isArray(parsed.messages)) return emptyThread
    return {
      documentId,
      messages: parsed.messages.filter(isRevisionMessage).slice(-MAX_PERSISTED_MESSAGES),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  } catch {
    return emptyThread
  }
}

export function saveSopAiRevisionThread(
  documentId: string,
  messages: SopAiRevisionMessage[],
  storage: StorageLike | null = getStorage(),
) {
  if (!storage) return
  const thread: SopAiRevisionThread = {
    documentId,
    messages: messages.slice(-MAX_PERSISTED_MESSAGES),
    updatedAt: Date.now(),
  }
  try {
    storage.setItem(storageKey(documentId), JSON.stringify(thread))
  } catch {
    // The editor remains usable when private browsing or storage quotas block persistence.
  }
}

export function clearSopAiRevisionThread(
  documentId: string,
  storage: StorageLike | null = getStorage(),
) {
  try {
    storage?.removeItem(storageKey(documentId))
  } catch {
    // Treat unavailable preference storage as an already-cleared thread.
  }
}

export function createSopAiRevisionMessage(
  role: SopAiRevisionMessage['role'],
  text: string,
  revision?: SopAiRevisionMessage['revision'],
): SopAiRevisionMessage {
  return {
    id: `sop-ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    createdAt: Date.now(),
    revision,
  }
}
