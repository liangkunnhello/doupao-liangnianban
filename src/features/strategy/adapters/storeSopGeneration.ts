import { getAgentTextApiProfile } from '../../../lib/apiProfiles'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from '../../../lib/devProxy'
import { useStore } from '../../../store'
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
) => {
  validateSopGenerationInput(description, referenceImages, kind)
  const brief = description.trim()

  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  if (!profile.apiKey.trim()) throw new Error('管理员尚未配置可用的文本模型 API 密钥')
  if (profile.provider !== 'openai' || profile.apiMode !== 'responses') {
    throw new Error('SOP 智能生成需要管理员配置 OpenAI Responses 兼容文本模型')
  }

  const proxy = readClientDevProxyConfig()
  const content = buildSopRequestContent(brief, context, referenceImages, kind)
  const response = await fetch(buildApiUrl(profile.baseUrl, 'responses', proxy, shouldUseApiProxy(profile.apiProxy, proxy)), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${profile.apiKey}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    body: JSON.stringify({
      model: profile.model || settings.model,
      instructions: getSopGeneratorInstruction(kind, metaInstruction),
      input: [{ role: 'user', content }],
      max_output_tokens: 8000,
    }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`SOP 生成失败（${response.status}）：${body.slice(0, 180)}`)
  }
  return parseGeneratedSop(extractResponseText(await response.json()))
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
