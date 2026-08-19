// Agent 对话板块工具

import {
  ensureImageCached,
  getActiveAgentRounds,
  stopAgentResponse,
  submitAgentMessage,
  useStore,
} from '../../store'
import type { AgentConversation, InputImage } from '../../types'
import { errorResult, textResult, type McpToolDefinition } from '../types'
import { clampLimit } from './helpers'

function serializeConversationSummary(conversation: AgentConversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    rounds: conversation.rounds.length,
    messages: conversation.messages.length,
    running: conversation.rounds.some((round) => round.status === 'running'),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  }
}

function findConversation(conversationId: string): AgentConversation | undefined {
  return useStore.getState().agentConversations.find((item) => item.id === conversationId)
}

/** 等待对话中所有 running 轮次结束；返回最后一条 assistant 消息与新产生的任务 */
async function waitForConversation(conversationId: string, timeoutSeconds: number) {
  const deadline = Date.now() + timeoutSeconds * 1000
  while (Date.now() < deadline) {
    const conversation = findConversation(conversationId)
    if (!conversation) return { conversation: null, timedOut: false }
    if (!conversation.rounds.some((round) => round.status === 'running')) {
      return { conversation, timedOut: false }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  return { conversation: findConversation(conversationId) ?? null, timedOut: true }
}

export const agentTools: McpToolDefinition[] = [
  {
    name: 'agent_list_conversations',
    description: '列出 Agent 对话（id、标题、轮次数、是否有进行中的轮次、更新时间），按最近更新排序。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: '返回条数，默认 50，最大 200' },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      const state = useStore.getState()
      const limit = clampLimit(args.limit, 50, 200)
      const sorted = [...state.agentConversations].sort((a, b) => b.updatedAt - a.updatedAt)
      return textResult({
        activeConversationId: state.activeAgentConversationId,
        total: sorted.length,
        conversations: sorted.slice(0, limit).map(serializeConversationSummary),
      })
    },
  },
  {
    name: 'agent_get_conversation',
    description: '获取一个 Agent 对话的详情：当前分支的轮次与消息内容（用户/助手文本、输入图片 id、输出任务 id 等）。maxMessages 可限制返回的最近消息条数。',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string', description: '对话 id' },
        maxMessages: { type: 'integer', description: '最多返回最近多少条消息，默认 30' },
      },
      required: ['conversationId'],
      additionalProperties: false,
    },
    handler: (args) => {
      const conversation = findConversation(args.conversationId as string)
      if (!conversation) return errorResult(`对话 ${args.conversationId} 不存在`)
      const maxMessages = clampLimit(args.maxMessages, 30, 200)
      const activeRounds = getActiveAgentRounds(conversation)
      const activeRoundIds = new Set(activeRounds.map((round) => round.id))
      const messages = conversation.messages.filter((message) => activeRoundIds.has(message.roundId))
      return textResult({
        ...serializeConversationSummary(conversation),
        activeRoundId: conversation.activeRoundId ?? null,
        messages: messages.slice(-maxMessages).map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          roundId: message.roundId,
          inputImageIds: message.inputImageIds ?? [],
          outputTaskIds: message.outputTaskIds ?? [],
          createdAt: message.createdAt,
        })),
        rounds: activeRounds.map((round) => ({
          id: round.id,
          index: round.index,
          status: round.status,
          error: round.error,
          prompt: round.prompt,
          outputTaskIds: round.outputTaskIds,
          createdAt: round.createdAt,
          finishedAt: round.finishedAt,
        })),
      })
    },
  },
  {
    name: 'agent_create_conversation',
    description: '新建一个 Agent 对话并返回其 id（会设为当前对话）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const id = useStore.getState().createAgentConversation()
      return textResult({ id, message: '对话已创建并设为当前对话' })
    },
  },
  {
    name: 'agent_rename_conversation',
    description: '重命名 Agent 对话。',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string', description: '对话 id' },
        title: { type: 'string', description: '新标题' },
      },
      required: ['conversationId', 'title'],
      additionalProperties: false,
    },
    handler: (args) => {
      const conversation = findConversation(args.conversationId as string)
      if (!conversation) return errorResult(`对话 ${args.conversationId} 不存在`)
      useStore.getState().renameAgentConversation(conversation.id, args.title as string)
      return textResult(`对话已重命名为「${(args.title as string).trim()}」`)
    },
  },
  {
    name: 'agent_delete_conversation',
    description: '删除 Agent 对话（默认保留其生成的画廊任务与图片）。',
    inputSchema: {
      type: 'object',
      properties: { conversationId: { type: 'string', description: '对话 id' } },
      required: ['conversationId'],
      additionalProperties: false,
    },
    handler: (args) => {
      const conversation = findConversation(args.conversationId as string)
      if (!conversation) return errorResult(`对话 ${args.conversationId} 不存在`)
      useStore.getState().deleteAgentConversation(conversation.id)
      return textResult(`对话「${conversation.title}」已删除`)
    },
  },
  {
    name: 'agent_send_message',
    description:
      '向 Agent 对话发送一条消息并触发回复（会真实调用 Agent API 并消耗额度）。注意：该操作会占用应用的输入框状态（等价于在输入框输入后回车）。可用 referenceImageIds 附带参考图。wait=false 立即返回；wait=true 等待本轮回复完成（默认最长 300 秒）。',
    inputSchema: {
      type: 'object',
      properties: {
        conversationId: { type: 'string', description: '目标对话 id；不传则用当前对话' },
        text: { type: 'string', description: '消息内容，支持 @ 引用语法（与应用内一致）' },
        referenceImageIds: { type: 'array', items: { type: 'string' }, description: '随消息附带的图片 id 列表' },
        wait: { type: 'boolean', description: '是否等待回复完成，默认 false' },
        waitTimeoutSeconds: { type: 'integer', description: 'wait=true 时的最长等待秒数，默认 300，最大 600' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    timeoutSeconds: 660,
    handler: async (args) => {
      const text = (args.text as string).trim()
      if (!text) return errorResult('消息内容不能为空')
      const state = useStore.getState()

      let conversationId = args.conversationId as string | undefined
      if (conversationId) {
        if (!findConversation(conversationId)) return errorResult(`对话 ${conversationId} 不存在`)
        state.setActiveAgentConversationId(conversationId)
      } else {
        conversationId = useStore.getState().activeAgentConversationId ?? undefined
        if (!conversationId) {
          conversationId = useStore.getState().createAgentConversation()
        }
      }

      const imageIds = Array.isArray(args.referenceImageIds)
        ? (args.referenceImageIds as unknown[]).filter((id): id is string => typeof id === 'string' && !!id)
        : []
      const images: InputImage[] = []
      for (const id of imageIds.slice(0, 16)) {
        const dataUrl = await ensureImageCached(id).catch(() => undefined)
        if (!dataUrl) return errorResult(`参考图 ${id} 无法读取（可能已被清理）`)
        images.push({ id, dataUrl })
      }

      const store = useStore.getState()
      store.setInputImages(images)
      store.setPrompt(text)
      await submitAgentMessage()

      const after = findConversation(conversationId)
      if (!after) return errorResult('对话在提交后不存在')
      const submittedRound = after.rounds[after.rounds.length - 1]
      if (!submittedRound || submittedRound.prompt !== text) {
        return errorResult('消息未能提交：请检查 Agent API 配置是否完整、或当前有正在生成的轮次')
      }

      if (args.wait !== true) {
        return textResult({ conversationId, roundId: submittedRound.id, status: 'running', hint: '消息已提交。用 agent_get_conversation 查看回复。' })
      }
      const timeout = clampLimit(args.waitTimeoutSeconds, 300, 600)
      const { conversation, timedOut } = await waitForConversation(conversationId, timeout)
      if (!conversation) return errorResult('对话已不存在')
      const round = conversation.rounds.find((item) => item.id === submittedRound.id)
      const assistantMessage = round?.assistantMessageId
        ? conversation.messages.find((message) => message.id === round.assistantMessageId)
        : conversation.messages.filter((message) => message.roundId === submittedRound.id && message.role === 'assistant').pop()
      return textResult({
        conversationId,
        roundId: submittedRound.id,
        status: timedOut ? 'running' : round?.status ?? 'unknown',
        timedOut,
        error: round?.error ?? null,
        assistantReply: assistantMessage?.content ?? null,
        outputTaskIds: round?.outputTaskIds ?? [],
        hint: (round?.outputTaskIds?.length ?? 0) > 0 ? '该轮产生了画廊任务，可用 gallery_get_task / gallery_read_image 查看。' : undefined,
      })
    },
  },
  {
    name: 'agent_stop',
    description: '停止指定对话（或当前对话）正在进行的 Agent 生成。',
    inputSchema: {
      type: 'object',
      properties: { conversationId: { type: 'string', description: '对话 id；不传则停止当前对话' } },
      additionalProperties: false,
    },
    handler: (args) => {
      const conversationId = (args.conversationId as string | undefined) ?? useStore.getState().activeAgentConversationId
      if (!conversationId) return errorResult('没有可停止的对话')
      if (!findConversation(conversationId)) return errorResult(`对话 ${conversationId} 不存在`)
      stopAgentResponse(conversationId)
      return textResult(`已发送停止指令：${conversationId}`)
    },
  },
]
