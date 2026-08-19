// 助手动作（技能栏）板块工具

import { ensureImageCached, useStore } from '../../store'
import { getAgentTextApiProfile, normalizeSettings } from '../../lib/apiProfiles'
import { buildAssistantInputContext } from '../../features/assistantActions/context'
import { getResolvedBuiltInActions, normalizeAssistantActionPreferences } from '../../features/assistantActions/matcher'
import { runAssistantAction } from '../../features/assistantActions/runner'
import type { InputImage } from '../../types'
import { errorResult, textResult, type McpToolDefinition } from '../types'

export const assistantTools: McpToolDefinition[] = [
  {
    name: 'assistant_list_actions',
    description: '列出助手动作（提示词优化、图片描述、超级衍生、赌狗模式等内置技能与自定义技能）：id、名称、描述。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const preferences = normalizeAssistantActionPreferences(useStore.getState().settings.assistantActions)
      const builtIns = getResolvedBuiltInActions(preferences).map((action) => ({
        id: action.id,
        name: action.name,
        description: action.description ?? '',
        custom: false,
      }))
      const customs = (preferences.customSkills ?? []).map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description ?? '',
        custom: true,
      }))
      return textResult({ actions: [...builtIns, ...customs] })
    },
  },
  {
    name: 'assistant_run',
    description:
      '运行一个助手动作/技能（会调用 Agent 文本模型并消耗额度）：对给定文本（可选附带参考图）执行技能，返回结构化结果（优化后的提示词、图片描述、衍生方案等）。技能 id 见 assistant_list_actions。',
    inputSchema: {
      type: 'object',
      properties: {
        actionId: { type: 'string', description: '技能 id' },
        text: { type: 'string', description: '输入文本（如待优化的提示词）' },
        referenceImageIds: { type: 'array', items: { type: 'string' }, description: '参考图 id 列表（可选）' },
      },
      required: ['actionId', 'text'],
      additionalProperties: false,
    },
    timeoutSeconds: 300,
    handler: async (args) => {
      const actionId = args.actionId as string
      const text = (args.text as string).trim()
      if (!text) return errorResult('输入文本不能为空')

      const images: InputImage[] = []
      if (Array.isArray(args.referenceImageIds)) {
        for (const id of (args.referenceImageIds as unknown[]).slice(0, 16)) {
          if (typeof id !== 'string' || !id) continue
          const dataUrl = await ensureImageCached(id).catch(() => undefined)
          if (!dataUrl) return errorResult(`参考图 ${id} 无法读取（可能已被清理）`)
          images.push({ id, dataUrl })
        }
      }

      const state = useStore.getState()
      const settings = normalizeSettings(state.settings)
      const profile = getAgentTextApiProfile(settings)
      const result = await runAssistantAction(actionId, buildAssistantInputContext(text, images), {
        settings,
        profile,
        params: state.params,
        preferences: normalizeAssistantActionPreferences(settings.assistantActions),
      })
      return textResult({
        actionId: result.actionId,
        title: result.title,
        prompt: result.prompt,
        content: result.content,
        alternativePrompt: result.alternativePrompt ?? null,
        candidates: result.candidates ?? null,
        sections: result.sections ?? null,
        wordEntries: result.wordEntries ?? null,
      })
    },
  },
]
