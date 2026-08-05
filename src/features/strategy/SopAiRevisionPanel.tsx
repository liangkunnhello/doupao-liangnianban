import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircleIcon as CheckCircle,
  CopyIcon as Copy,
  HistoryIcon as History,
  LoaderCircleIcon as Loader,
  PlayIcon as Play,
  SendIcon as Send,
  SparklesIcon as Sparkles,
  TrashIcon as Trash,
} from '../../design-system/icons'
import { reviseSopDocument, type SopRevisionConversationMessage } from '../../lib/agentApi'
import { getAgentTextApiProfile, validateApiProfile } from '../../lib/apiProfiles'
import { useAppDialog } from '../../hooks/useAppDialog'
import { useStore } from '../../store'
import {
  clearSopAiRevisionThread,
  createSopAiRevisionMessage,
  loadSopAiRevisionThread,
  saveSopAiRevisionThread,
  type SopAiRevisionMessage,
} from './sopAiRevision'

type SopAiRevisionPanelProps = {
  documentId: string
  value: string
  onApply: (value: string) => void
  onTestRevision?: (value: string) => Promise<void>
}

const STARTER_REQUESTS = [
  '先诊断这份 SOP 最影响执行稳定性的三个问题，再给出完整修订版。',
  '在不遗漏任何约束的前提下，重组结构并减少重复。',
  '重点优化生图提示词的一致性、变化范围和验收标准。',
]

function toConversationMessages(messages: SopAiRevisionMessage[]): SopRevisionConversationMessage[] {
  return messages.map((message) => ({
    role: message.role,
    text: message.text,
    revisionContent: message.revision?.content,
  }))
}

function formatMessageTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(timestamp)
}

export default function SopAiRevisionPanel({
  documentId,
  value,
  onApply,
  onTestRevision,
}: SopAiRevisionPanelProps) {
  const abortRef = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const settings = useStore((state) => state.settings)
  const showToast = useStore((state) => state.showToast)
  const { openConfirmDialog } = useAppDialog()
  const profile = useMemo(() => getAgentTextApiProfile(settings), [settings])
  const [messages, setMessages] = useState<SopAiRevisionMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [canRetry, setCanRetry] = useState(false)
  const [testingMessageId, setTestingMessageId] = useState('')

  useEffect(() => {
    abortRef.current?.abort()
    setMessages(loadSopAiRevisionThread(documentId).messages)
    setInput('')
    setLoading(false)
    setError('')
    setCanRetry(false)
    setTestingMessageId('')
  }, [documentId])

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [loading, messages])

  function commitMessages(nextMessages: SopAiRevisionMessage[]) {
    setMessages(nextMessages)
    saveSopAiRevisionThread(documentId, nextMessages)
  }

  async function requestRevision(requestMessages: SopAiRevisionMessage[]) {
    const validationError = validateApiProfile(profile)
    if (validationError || profile.provider !== 'openai') {
      const message = validationError
        ? `请先完善 Agent 配置：${validationError}`
        : 'SOP 对话优化需要 OpenAI 兼容的 Agent 配置'
      setError(message)
      setCanRetry(false)
      showToast(message, 'error')
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError('')
    setCanRetry(false)
    try {
      const result = await reviseSopDocument({
        settings,
        profile,
        content: value,
        conversation: toConversationMessages(requestMessages),
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      const assistantMessage = createSopAiRevisionMessage('assistant', result.reply, {
        content: result.content,
        changeSummary: result.changeSummary,
      })
      commitMessages([...requestMessages, assistantMessage])
      showToast('AI 已生成一版可测试的 SOP 提案', 'success')
    } catch (cause) {
      if (controller.signal.aborted) return
      const message = cause instanceof Error ? cause.message : 'SOP 对话优化失败'
      setError(message)
      setCanRetry(true)
      showToast(message, 'error')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setLoading(false)
    }
  }

  async function sendMessage() {
    const request = input.trim()
    if (!request || loading) return
    const nextMessages = [...messages, createSopAiRevisionMessage('user', request)]
    commitMessages(nextMessages)
    setInput('')
    await requestRevision(nextMessages)
  }

  function applyRevision(message: SopAiRevisionMessage) {
    if (!message.revision) return
    onApply(message.revision.content)
    const appliedAt = Date.now()
    const nextMessages = messages.map((item) => item.id === message.id && item.revision
      ? { ...item, revision: { ...item.revision, appliedAt } }
      : item)
    commitMessages(nextMessages)
    showToast('SOP 提案已应用到正文，可用编辑器撤销', 'success')
  }

  async function copyRevision(message: SopAiRevisionMessage) {
    if (!message.revision) return
    try {
      await navigator.clipboard.writeText(message.revision.content)
      showToast('SOP 提案已复制', 'success')
    } catch {
      showToast('复制失败，请检查剪贴板权限', 'error')
    }
  }

  async function testRevision(message: SopAiRevisionMessage) {
    if (!message.revision || !onTestRevision || testingMessageId) return
    setTestingMessageId(message.id)
    try {
      await onTestRevision(message.revision.content)
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : '测试生图提交失败', 'error')
    } finally {
      setTestingMessageId('')
    }
  }

  function clearHistory() {
    openConfirmDialog({
      title: '清空 AI 对话记录？',
      message: '将删除当前 SOP 的全部对话与修订提案，正文不会受到影响。',
      confirmText: '清空记录',
      tone: 'danger',
      action: () => {
        abortRef.current?.abort()
        clearSopAiRevisionThread(documentId)
        setMessages([])
        setError('')
        setCanRetry(false)
      },
    })
  }

  return (
    <aside className="sop-ai-chat" aria-label="SOP AI 对话优化">
      <header className="sop-ai-chat__header">
        <div className="min-w-0">
          <strong><Sparkles size={14} />AI 对话优化</strong>
          <span title={`当前模型：${profile.model || '未配置'}`}>{profile.model || '未配置模型'} · 记录仅保存在本机</span>
        </div>
        <button type="button" onClick={clearHistory} disabled={messages.length === 0 || loading} aria-label="清空 AI 对话记录" title="清空记录"><Trash size={14} /></button>
      </header>

      <div className="sop-ai-chat__messages" aria-live="polite">
        {messages.length === 0 && !loading && (
          <div className="sop-ai-chat__empty">
            <History size={20} />
            <strong>从当前正文开始一轮可回溯优化</strong>
            <p>AI 每次都会返回完整 SOP 提案。先测试生图，确认效果后再应用到正文。</p>
            <div className="sop-ai-chat__starters">
              {STARTER_REQUESTS.map((request) => (
                <button key={request} type="button" onClick={() => setInput(request)}>{request}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <article key={message.id} className="sop-ai-chat__message" data-role={message.role}>
            <div className="sop-ai-chat__message-meta">
              <strong>{message.role === 'user' ? '你' : 'AI 修订提案'}</strong>
              <time dateTime={new Date(message.createdAt).toISOString()}>{formatMessageTime(message.createdAt)}</time>
            </div>
            <p className="sop-ai-chat__message-text">{message.text}</p>
            {message.revision && (
              <div className="sop-ai-chat__revision">
                <ul>
                  {message.revision.changeSummary.map((item) => <li key={item}>{item}</li>)}
                </ul>
                <details>
                  <summary>查看完整 SOP · {message.revision.content.length} 字符</summary>
                  <pre>{message.revision.content}</pre>
                </details>
                <div className="sop-ai-chat__revision-actions">
                  <button type="button" onClick={() => void testRevision(message)} disabled={!onTestRevision || Boolean(testingMessageId)}>
                    {testingMessageId === message.id ? <Loader size={13} className="animate-spin" /> : <Play size={13} />}
                    {testingMessageId === message.id ? '正在提交' : '测试生图'}
                  </button>
                  <button type="button" onClick={() => void copyRevision(message)}><Copy size={13} />复制</button>
                  <button type="button" className="sop-ai-chat__apply" onClick={() => applyRevision(message)}>
                    <CheckCircle size={13} />{message.revision.appliedAt ? '再次应用' : '应用到正文'}
                  </button>
                </div>
                {message.revision.appliedAt && <span className="sop-ai-chat__applied">已应用于 {formatMessageTime(message.revision.appliedAt)}</span>}
              </div>
            )}
          </article>
        ))}

        {loading && (
          <div className="sop-ai-chat__thinking"><Loader size={14} className="animate-spin" />正在结合正文与对话生成完整修订版…</div>
        )}
        {error && (
          <div className="sop-ai-chat__error" role="alert">
            <span>{error}</span>
            {canRetry && <button type="button" onClick={() => void requestRevision(messages)} disabled={loading}>重试</button>}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="sop-ai-chat__composer">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void sendMessage()
            }
          }}
          maxLength={4000}
          placeholder="描述你希望如何修改；Enter 发送，Shift+Enter 换行"
          aria-label="向 AI 描述 SOP 修改要求"
          disabled={loading}
        />
        <button type="button" onClick={() => void sendMessage()} disabled={!input.trim() || loading} aria-label="发送 SOP 修改要求">
          {loading ? <Loader size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </div>
    </aside>
  )
}
