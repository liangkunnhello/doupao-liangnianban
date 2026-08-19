import { getAgentTextApiProfile } from '../../../lib/apiProfiles'
import { apiFetch } from '../../../lib/desktopApiFetch'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from '../../../lib/devProxy'
import { submitTaskWithData, useStore } from '../../../store'
import { parseVariablePrompt } from '../../../lib/variablePrompt'
import {
  buildSopRequestContent,
  extractChatCompletionText,
  extractResponseText,
  getSopGeneratorInstruction,
  parseGeneratedSop,
  parseGeneratedVariablePrompt,
  toChatCompletionMessages,
  toChatResponseFormat,
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
import {
  applyVariablePromptTextPolicy,
  EXCLUDE_TEXT_SKILL_INSTRUCTION,
  KEEP_TEXT_SKILL_INSTRUCTION,
} from '../variablePromptTextPolicy'

const SOP_TEXT_REQUEST_TIMEOUT_CAP_SECONDS = 180
const SOP_TEXT_REQUEST_TIMEOUT_FALLBACK_SECONDS = 180

type BufferedApiResponse = {
  ok: boolean
  status: number
  body: string
}

function getSopTextRequestTimeoutSeconds(configuredTimeout: number | undefined) {
  const normalized = typeof configuredTimeout === 'number' && Number.isFinite(configuredTimeout)
    ? Math.max(1, configuredTimeout)
    : SOP_TEXT_REQUEST_TIMEOUT_FALLBACK_SECONDS
  return Math.min(normalized, SOP_TEXT_REQUEST_TIMEOUT_CAP_SECONDS)
}

async function postSopModelRequest(
  url: string,
  body: unknown,
  apiKey: string,
  configuredTimeout: number | undefined,
  externalSignal: AbortSignal | undefined,
  operation: string,
): Promise<BufferedApiResponse> {
  externalSignal?.throwIfAborted()
  const controller = new AbortController()
  const timeoutSeconds = getSopTextRequestTimeoutSeconds(configuredTimeout)
  let timedOut = false
  const abortFromCaller = () => controller.abort(externalSignal?.reason)
  externalSignal?.addEventListener('abort', abortFromCaller, { once: true })
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException(`${operation}超时`, 'TimeoutError'))
  }, timeoutSeconds * 1000)

  try {
    const response = await apiFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
      body: JSON.stringify(body),
    })
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    }
  } catch (error) {
    if (externalSignal?.aborted) {
      throw externalSignal.reason instanceof Error ? externalSignal.reason : error
    }
    if (timedOut) {
      throw new Error(`${operation}超时：超过 ${timeoutSeconds} 秒仍未完成，请稍后重试或检查文本模型服务。`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', abortFromCaller)
  }
}

function parseBufferedResponse(response: BufferedApiResponse) {
  return JSON.parse(response.body) as unknown
}

function shouldPreferChatCompletions(model: string) {
  return /(?:^|[/_.-])gemini(?:$|[/_.-])/i.test(model.trim())
}

function toBufferedRequestFailure(error: unknown): BufferedApiResponse {
  return {
    ok: false,
    status: 0,
    body: error instanceof Error ? error.message : String(error),
  }
}

function getBufferedResponseText(response: BufferedApiResponse, useChat: boolean) {
  let payload: unknown
  try {
    payload = parseBufferedResponse(response)
  } catch {
    throw new Error('文本模型返回了无法解析的响应')
  }
  const text = useChat ? extractChatCompletionText(payload) : extractResponseText(payload)
  if (!text.trim()) throw new Error('文本模型返回成功状态，但没有返回任何文本内容')
  return text
}

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

const VARIABLE_PROMPT_GENERATION_TEXT_FORMAT = {
  type: 'json_schema',
  name: 'generated_variable_prompt',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '简洁、清晰、可识别用途的变量提示词策略名称' },
      description: { type: 'string', description: '一到两句话说明视觉机制和批量应用价值' },
      variablePrompt: { type: 'string', description: '可直接解析执行的变量提示词正文，包含单独一行的可变项区块' },
    },
    required: ['name', 'description', 'variablePrompt'],
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
  options?.signal?.throwIfAborted()
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
  const variablePromptMode = kind === 'variable-prompt-skill'
  const excludeText = variablePromptMode ? options?.excludeText ?? true : false
  options?.onProgress?.({
    stage: 'prepare',
    message: referenceImages.length > 0
      ? `正在整理 ${referenceImages.length} 张参考图片与生成说明`
      : '正在整理生成说明与元指令',
  })
  const content = buildSopRequestContent(brief, context, referenceImages, kind, excludeText)
  let useChat = settings.agentTextProtocol === 'chat-completions' || shouldPreferChatCompletions(profile.model || settings.model)
  const buildRequestUrl = (useChat: boolean) => buildApiUrl(
    profile.baseUrl,
    useChat ? 'chat/completions' : 'responses',
    proxy,
    shouldUseApiProxy(profile.apiProxy, proxy),
  )
  const baseInstruction = getSopGeneratorInstruction(kind, metaInstruction)
  const responseFormat = variablePromptMode ? VARIABLE_PROMPT_GENERATION_TEXT_FORMAT : SOP_GENERATION_TEXT_FORMAT
  const send = (useStructuredOutput: boolean, useChat: boolean, retryIncomplete = false) => {
    options?.signal?.throwIfAborted()
    const instructions = [
      baseInstruction,
      variablePromptMode
        ? '应用只接收 name、description、variablePrompt 三个字段；不得返回 sop。variablePrompt 必须是可直接拆解生图的完整模板，包含正文变量、单独一行的“可变项：”和逐行变量定义。'
        : '应用只接收 name、description、sop 三个字段；不得省略任何字段，sop 必须包含完整正文。',
      variablePromptMode ? (excludeText ? EXCLUDE_TEXT_SKILL_INSTRUCTION : KEEP_TEXT_SKILL_INSTRUCTION) : '',
      retryIncomplete ? '上一轮结果结构不完整。请重新完整生成，不要复述错误结果。' : '',
    ].filter(Boolean).join('\n\n')
    const body = useChat
      ? {
          model: profile.model || settings.model,
          messages: toChatCompletionMessages(instructions, [{ role: 'user', content }]),
          max_tokens: 8000,
          ...(useStructuredOutput ? { response_format: toChatResponseFormat(responseFormat) } : {}),
        }
      : {
          model: profile.model || settings.model,
          instructions,
          input: [{ role: 'user', content }],
          max_output_tokens: 8000,
          ...(useStructuredOutput ? { text: { format: responseFormat } } : {}),
        }
    return postSopModelRequest(buildRequestUrl(useChat), body, profile.apiKey, profile.timeout, options?.signal, variablePromptMode ? '变量提示词生成' : 'SOP 生成')
  }
  const sendSafely = async (useStructuredOutput: boolean, chat: boolean, retryIncomplete = false) => {
    try {
      return await send(useStructuredOutput, chat, retryIncomplete)
    } catch (error) {
      options?.signal?.throwIfAborted()
      return toBufferedRequestFailure(error)
    }
  }

  options?.onProgress?.({
    stage: 'request',
    message: referenceImages.length > 1
      ? `AI 正在逐张分析 ${referenceImages.length} 张图片并${variablePromptMode ? '反推变量提示词' : '编译 SOP'}`
      : `AI 正在分析输入并${variablePromptMode ? '反推变量提示词' : '编译 SOP'}`,
  })
  let structuredOutputEnabled = true
  let protocolFallbackUsed = false
  let response = await sendSafely(structuredOutputEnabled, useChat)
  options?.signal?.throwIfAborted()
  // 第 1 层：结构化输出被拒（部分模型不支持 json_schema）→ 关掉结构化输出，同一协议重试一次。
  if (!response.ok && structuredOutputEnabled && (response.status === 400 || response.status === 422)) {
    structuredOutputEnabled = false
    options?.onProgress?.({ stage: 'request', message: '当前模型已切换为兼容生成模式' })
    response = await sendSafely(false, useChat)
  }
  // 第 2 层：协议层失败（Responses 端不受支持 / 渠道不可用）→ 自动切换到另一种协议重试一次。
  if (!response.ok) {
    const alternateChat = !useChat
    options?.onProgress?.({
      stage: 'request',
      message: alternateChat ? 'Responses 协议不可用，已自动切换为 Chat Completions' : 'Chat Completions 协议不可用，已自动切换为 Responses',
    })
    useChat = alternateChat
    protocolFallbackUsed = true
    response = await sendSafely(structuredOutputEnabled, useChat)
  }
  if (!response.ok) {
    const status = response.status > 0 ? `（${response.status}）` : ''
    throw new Error(`${variablePromptMode ? '变量提示词' : 'SOP'}生成失败${status}：${response.body.slice(0, 180)}`)
  }
  options?.onProgress?.({ stage: 'parse', message: variablePromptMode ? '正在校验变量提示词语法与选项池' : '正在校验名称、说明与 SOP 正文' })
  const parse = (text: string) => {
    if (!variablePromptMode) return parseGeneratedSop(text)
    const generated = parseGeneratedVariablePrompt(text)
    const contentWithTextPolicy = applyVariablePromptTextPolicy(generated.content, excludeText)
    const validation = parseVariablePrompt(contentWithTextPolicy)
    if (!validation.enabled) {
      throw new Error(`生成的变量提示词格式有误：${validation.errors[0] ?? '未识别到有效变量'}`)
    }
    return { ...generated, content: contentWithTextPolicy }
  }
  let responseText: string
  try {
    responseText = getBufferedResponseText(response, useChat)
  } catch (error) {
    options?.signal?.throwIfAborted()
    if (protocolFallbackUsed) throw error
    const alternateChat = !useChat
    options?.onProgress?.({
      stage: 'request',
      message: alternateChat ? 'Responses 返回空内容，正在切换为 Chat Completions' : 'Chat Completions 返回空内容，正在切换为 Responses',
    })
    const alternateResponse = await sendSafely(structuredOutputEnabled, alternateChat, true)
    if (!alternateResponse.ok) {
      const status = alternateResponse.status > 0 ? `（${alternateResponse.status}）` : ''
      throw new Error(`${error instanceof Error ? error.message : '文本模型返回内容无效'}；备用协议也失败${status}：${alternateResponse.body.slice(0, 180)}`)
    }
    useChat = alternateChat
    response = alternateResponse
    responseText = getBufferedResponseText(response, useChat)
  }
  try {
    options?.signal?.throwIfAborted()
    return parse(responseText)
  } catch (error) {
    options?.signal?.throwIfAborted()
    options?.onProgress?.({ stage: 'repair', message: '返回结构不完整，正在自动修复并重试' })
    const retryResponse = await sendSafely(structuredOutputEnabled, useChat, true)
    options?.signal?.throwIfAborted()
    if (!retryResponse.ok) {
      throw new Error(`${variablePromptMode ? '变量提示词' : 'SOP'}自动修复失败（${retryResponse.status}）：${retryResponse.body.slice(0, 180)}`)
    }
    options?.onProgress?.({ stage: 'parse', message: variablePromptMode ? '正在校验修复后的变量提示词' : '正在校验修复后的 SOP 结构' })
    try {
      const retryResponseText = getBufferedResponseText(retryResponse, useChat)
      options?.signal?.throwIfAborted()
      return parse(retryResponseText)
    } catch (retryError) {
      if (retryError instanceof Error && /开启“排除文字”后/.test(retryError.message)) throw retryError
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
  let useChat = settings.agentTextProtocol === 'chat-completions' || shouldPreferChatCompletions(profile.model || settings.model)
  const buildRequestUrl = (chat: boolean) => buildApiUrl(profile.baseUrl, chat ? 'chat/completions' : 'responses', proxy, shouldUseApiProxy(profile.apiProxy, proxy))
  let structuredOutputEnabled = true

  return generateSopPromptBatches(quantity, async (batchQuantity, existingPrompts) => {
    const requestText = buildSopPromptBatchRequest(sop, batchQuantity, brief, {
      ...options.context,
      existingPrompts,
    })
    // 始终使用列表形式 input，兼容不接受字符串 input 的 Responses 后端（如 GPT-5.x 转发渠道）。
    const input = [{
      role: 'user',
      content: [
        { type: 'input_text', text: requestText },
        ...(options.referenceImages?.length ? options.referenceImages.map((image) => ({ type: 'input_image', image_url: image.dataUrl })) : []),
      ],
    }]
    const send = (useStructuredOutput: boolean, chat: boolean) => {
      const body = chat
        ? {
            model: profile.model || settings.model,
            messages: toChatCompletionMessages(SOP_PROMPT_GENERATOR_INSTRUCTION, input),
            max_tokens: 12000,
            ...(useStructuredOutput ? { response_format: toChatResponseFormat(buildSopPromptTextFormat(batchQuantity)) } : {}),
          }
        : {
            model: profile.model || settings.model,
            instructions: SOP_PROMPT_GENERATOR_INSTRUCTION,
            input,
            max_output_tokens: 12000,
            ...(useStructuredOutput ? { text: { format: buildSopPromptTextFormat(batchQuantity) } } : {}),
          }
      return postSopModelRequest(buildRequestUrl(chat), body, profile.apiKey, profile.timeout, options.signal, 'SOP 提示词生成')
    }
    const sendSafely = async (useStructuredOutput: boolean, chat: boolean) => {
      try {
        return await send(useStructuredOutput, chat)
      } catch (error) {
        options.signal?.throwIfAborted()
        return toBufferedRequestFailure(error)
      }
    }

    let protocolFallbackUsed = false
    let response = await sendSafely(structuredOutputEnabled, useChat)
    // 第 1 层：结构化输出被拒 → 关掉结构化输出，同一协议重试一次。
    if (!response.ok && structuredOutputEnabled && (response.status === 400 || response.status === 422)) {
      structuredOutputEnabled = false
      response = await sendSafely(false, useChat)
    }
    // 第 2 层：协议层失败（Responses 端不受支持 / 渠道不可用）→ 自动切换到另一种协议重试一次。
    if (!response.ok) {
      useChat = !useChat
      protocolFallbackUsed = true
      response = await sendSafely(structuredOutputEnabled, useChat)
    }
    if (!response.ok) {
      const status = response.status > 0 ? `（${response.status}）` : ''
      throw new Error(`提示词生成失败${status}：${response.body.slice(0, 180)}`)
    }
    let responseText: string
    try {
      responseText = getBufferedResponseText(response, useChat)
    } catch (error) {
      options.signal?.throwIfAborted()
      if (protocolFallbackUsed) throw error
      useChat = !useChat
      response = await sendSafely(structuredOutputEnabled, useChat)
      if (!response.ok) {
        const status = response.status > 0 ? `（${response.status}）` : ''
        throw new Error(`${error instanceof Error ? error.message : '文本模型返回内容无效'}；备用协议也失败${status}：${response.body.slice(0, 180)}`)
      }
      responseText = getBufferedResponseText(response, useChat)
    }
    return parseSopPromptBatchResponse(responseText, batchQuantity, {
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
