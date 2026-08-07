import { getAgentTextApiProfile } from '../../../lib/apiProfiles'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from '../../../lib/devProxy'
import { submitTaskWithData, useStore } from '../../../store'
import {
  buildSopRequestContent,
  extractResponseText,
  getSopGeneratorInstruction,
  parseGeneratedSop,
  validateSopGenerationInput,
  type GenerateSop,
} from '../sopGeneration'
import {
  buildSopPromptBatchRequest,
  generateSopPromptBatches,
  parseSopPromptBatchResponse,
  SOP_PROMPT_GENERATOR_INSTRUCTION,
  type SopPromptBatchContext,
} from '../sopPromptBatch'
import type { SopLibraryItem } from '../types'

const SOP_GENERATION_TEXT_FORMAT = {
  type: 'json_schema',
  name: 'generated_sop',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '专业、清晰、可识别用途的 SOP 名称' },
      description: { type: 'string', description: '一到两句话说明 SOP 的用途、输入和产出' },
      sop: { type: 'string', description: '完整、可独立执行的 Markdown SOP 正文' },
    },
    required: ['name', 'description', 'sop'],
    additionalProperties: false,
  },
} as const

export function getSopPromptGenerationModelFromStore() {
  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  return (profile.model || settings.model).trim()
}

function buildSopPromptTextFormat(quantity: number) {
  const count = Math.max(1, Math.trunc(quantity))
  return {
    type: 'json_schema',
    name: 'sop_prompt_batch',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        prompts: {
          type: 'array',
          description: `严格包含 ${count} 条彼此不同、可直接用于图片生成模型的完整中文提示词`,
          minItems: count,
          maxItems: count,
          items: { type: 'string' },
        },
      },
      required: ['prompts'],
      additionalProperties: false,
    },
  } as const
}

export const generateSopFromStore: GenerateSop = async (
  description,
  context,
  referenceImages = [],
  kind = 'general',
  metaInstruction,
  options,
) => {
  options?.onProgress?.({ stage: 'validate', message: '正在校验生成条件与模型配置' })
  validateSopGenerationInput(description, referenceImages, kind)
  const brief = description.trim()

  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  if (!profile.apiKey.trim()) throw new Error('管理员尚未配置可用的文本模型 API 密钥')
  if (profile.provider !== 'openai' || profile.apiMode !== 'responses') {
    throw new Error('SOP 智能生成需要管理员配置 OpenAI Responses 兼容文本模型')
  }

  const proxy = readClientDevProxyConfig()
  options?.onProgress?.({
    stage: 'prepare',
    message: referenceImages.length > 0
      ? `正在整理 ${referenceImages.length} 张参考图片与生成说明`
      : '正在整理生成说明与元指令',
  })
  const content = buildSopRequestContent(brief, context, referenceImages, kind)
  const url = buildApiUrl(profile.baseUrl, 'responses', proxy, shouldUseApiProxy(profile.apiProxy, proxy))
  const baseInstruction = getSopGeneratorInstruction(kind, metaInstruction)
  const send = (useStructuredOutput: boolean, retryIncomplete = false) => fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${profile.apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: options?.signal,
    cache: 'no-store',
    body: JSON.stringify({
      model: profile.model || settings.model,
      instructions: [
        baseInstruction,
        '应用只接收 name、description、sop 三个字段；不得省略任何字段，sop 必须包含完整正文。',
        retryIncomplete ? '上一轮结果结构不完整。请重新完整生成，不要复述错误结果。' : '',
      ].filter(Boolean).join('\n\n'),
      input: [{ role: 'user', content }],
      max_output_tokens: 8000,
      ...(useStructuredOutput ? { text: { format: SOP_GENERATION_TEXT_FORMAT } } : {}),
    }),
  })

  options?.onProgress?.({
    stage: 'request',
    message: referenceImages.length > 1
      ? `AI 正在逐张分析 ${referenceImages.length} 张图片并编译 SOP`
      : 'AI 正在分析输入并编译 SOP',
  })
  let structuredOutputEnabled = true
  let response = await send(structuredOutputEnabled)
  if (!response.ok && (response.status === 400 || response.status === 422)) {
    structuredOutputEnabled = false
    options?.onProgress?.({ stage: 'request', message: '当前模型已切换为兼容生成模式' })
    response = await send(false)
  }
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`SOP 生成失败（${response.status}）：${body.slice(0, 180)}`)
  }
  options?.onProgress?.({ stage: 'parse', message: '正在校验名称、说明与 SOP 正文' })
  try {
    return parseGeneratedSop(extractResponseText(await response.json()))
  } catch (error) {
    options?.onProgress?.({ stage: 'repair', message: '返回结构不完整，正在自动修复并重试' })
    const retryResponse = await send(structuredOutputEnabled, true)
    if (!retryResponse.ok) {
      const body = await retryResponse.text()
      throw new Error(`SOP 自动修复失败（${retryResponse.status}）：${body.slice(0, 180)}`)
    }
    options?.onProgress?.({ stage: 'parse', message: '正在校验修复后的 SOP 结构' })
    try {
      return parseGeneratedSop(extractResponseText(await retryResponse.json()))
    } catch {
      throw new Error('AI 连续两次返回不完整内容，请切换文本模型或简化元指令后重试')
    }
  }
}

export async function generatePromptsFromSopStore(
  sop: SopLibraryItem,
  quantity: number,
  brief = '',
  options: {
    context?: SopPromptBatchContext
    referenceImages?: Array<{ name: string; dataUrl: string }>
    exact?: boolean
    existingPrompts?: string[]
    onProgress?: (completed: number, total: number) => void
    maxBatchSize?: number
    onBatch?: (prompts: string[], completed: number, total: number) => void | Promise<void>
    beforeBatch?: () => void | Promise<void>
    signal?: AbortSignal
  } = {},
) {
  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  if (!profile.apiKey.trim()) throw new Error('管理员尚未配置可用的文本模型 API 密钥')
  if (profile.provider !== 'openai' || profile.apiMode !== 'responses') {
    throw new Error('SOP 提示词生成需要管理员配置 OpenAI Responses 兼容文本模型')
  }

  const proxy = readClientDevProxyConfig()
  const url = buildApiUrl(profile.baseUrl, 'responses', proxy, shouldUseApiProxy(profile.apiProxy, proxy))
  let structuredOutputEnabled = true

  return generateSopPromptBatches(quantity, async (batchQuantity, existingPrompts) => {
    const requestText = buildSopPromptBatchRequest(sop, batchQuantity, brief, {
      ...options.context,
      existingPrompts,
    })
    const input = options.referenceImages?.length
      ? [{
        role: 'user',
        content: [
          { type: 'input_text', text: requestText },
          ...options.referenceImages.map((image) => ({ type: 'input_image', image_url: image.dataUrl })),
        ],
      }]
      : requestText
    const send = (useStructuredOutput: boolean) => fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${profile.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: options.signal,
      cache: 'no-store',
      body: JSON.stringify({
        model: profile.model || settings.model,
        instructions: SOP_PROMPT_GENERATOR_INSTRUCTION,
        input,
        max_output_tokens: 12000,
        ...(useStructuredOutput ? { text: { format: buildSopPromptTextFormat(batchQuantity) } } : {}),
      }),
    })

    let response = await send(structuredOutputEnabled)
    if (!response.ok && structuredOutputEnabled && (response.status === 400 || response.status === 422)) {
      structuredOutputEnabled = false
      response = await send(false)
    }
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`提示词生成失败（${response.status}）：${body.slice(0, 180)}`)
    }
    return parseSopPromptBatchResponse(extractResponseText(await response.json()), batchQuantity, {
      exact: false,
      existingPrompts,
    })
  }, {
    exact: options.exact,
    existingPrompts: options.existingPrompts,
    onProgress: options.onProgress,
    maxBatchSize: options.maxBatchSize,
    onBatch: options.onBatch,
    beforeBatch: options.beforeBatch,
    signal: options.signal,
  })
}

export async function testSopRevisionFromStore(sop: SopLibraryItem) {
  const [prompt] = await generatePromptsFromSopStore(sop, 1, '', {
    exact: true,
    maxBatchSize: 1,
  })
  if (!prompt?.trim()) throw new Error('AI 未能从该 SOP 生成可测试的生图提示词')

  const state = useStore.getState()
  const activeTab = state.workspaceTabs.find((tab) => tab.id === state.activeWorkspaceTabId)
  const taskId = await submitTaskWithData({
    prompt: prompt.trim(),
    inputImages: state.inputImages,
    inputImageFolder: state.inputImageFolder,
    params: { ...state.params, n: 1 },
    maskDraft: null,
    targetTabId: state.activeWorkspaceTabId,
    scheduledOutputPath: state.customOutputPath.trim() || undefined,
    scheduledOutputSubFolder: activeTab?.name,
  }, { silentSuccess: true })
  if (!taskId) throw new Error('测试生图任务未能提交，请检查图片 API 配置')
  state.showToast('测试任务已提交，可在当前画廊查看生成结果', 'success')
}
