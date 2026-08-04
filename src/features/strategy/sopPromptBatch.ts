import type { SopLibraryItem } from './types'

export const MAX_SOP_PROMPTS_PER_MODEL_REQUEST = 10
export const SOP_PROMPT_BATCH_MAX_ATTEMPTS = 2
export const MAX_SOP_IMAGES_PER_PROMPT = 20
export const SOP_HIGH_VOLUME_WARNING_THRESHOLD = 20

export interface SopPromptSourceLike {
  id: string
}

export interface SopPromptBatchContext {
  sourceLabel?: string
  sourceIndex?: number
  sourceCount?: number
  totalPromptCount?: number
  existingPrompts?: string[]
}

export const SOP_PROMPT_GENERATOR_INSTRUCTION = `你是中文图像提示词编排专家，也是严格的 SOP 执行器。

执行优先级：
1. 当前请求规定的数量与 JSON 传输封装最高优先，SOP 中自带的示例输出格式不得改变该封装。
2. SOP 中的明确强制项、视觉常量和禁止项必须完整保留。
3. 用户补充要求与参考图用于填写 SOP 的变量和未定义项；冲突时不得覆盖 SOP 的强制项与禁止项。
4. 对仍未定义的部分做专业且保守的补全，不虚构品牌、产品、文字、功效或规格事实。

先在内部完成“拆解 SOP → 提取强制项/可变项/禁止项 → 规划批次差异 → 逐条自检”，不要输出分析过程。每条结果必须独立、完整、可直接用于图片生成；批量结果应保持同一 SOP 视觉骨架，同时在 SOP 允许的维度上形成实质差异，禁止只换序号、近义词或少量形容词。

最终只输出请求指定的 JSON 传输封装，不要输出 Markdown、标题、编号、解释或自检记录。`

function throwIfSopPromptGenerationAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new DOMException('提示词生成已取消', 'AbortError')
}

function normalizeSopPromptCount(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.trunc(value))
}

export function getSopRunCounts(promptCount: number, imagesPerPrompt: number) {
  return {
    promptCount: normalizeSopPromptCount(promptCount),
    imagesPerPrompt: Math.max(1, Math.min(MAX_SOP_IMAGES_PER_PROMPT, Math.trunc(imagesPerPrompt || 1))),
  }
}

export function getSopTotalImageCount(promptCount: number, imagesPerPrompt: number) {
  const normalized = getSopRunCounts(promptCount, imagesPerPrompt)
  return normalized.promptCount * normalized.imagesPerPrompt
}

export function getSopPromptBatchSizes(
  totalPromptCount: number,
  maxBatchSize = MAX_SOP_PROMPTS_PER_MODEL_REQUEST,
) {
  const total = normalizeSopPromptCount(totalPromptCount)
  const batchSize = Math.max(1, Math.min(MAX_SOP_PROMPTS_PER_MODEL_REQUEST, Math.trunc(maxBatchSize || 1)))
  const sizes: number[] = []
  for (let remaining = total; remaining > 0; remaining -= batchSize) {
    sizes.push(Math.min(batchSize, remaining))
  }
  return sizes
}

export function allocateSopPromptCounts(totalPromptCount: number, sourceCount: number) {
  const count = normalizeSopPromptCount(totalPromptCount)
  const sources = Math.max(0, Math.trunc(sourceCount || 0))
  if (sources === 0) return []
  const base = Math.floor(count / sources)
  const remainder = count % sources
  return Array.from({ length: sources }, (_, index) => base + (index < remainder ? 1 : 0))
}

export function getMentionedSopSourceIndexes(text: string, sourceCount: number) {
  const indexes: number[] = []
  const seen = new Set<number>()
  for (const match of text.matchAll(/@图\s*(\d+)/g)) {
    const index = Number(match[1]) - 1
    if (Number.isInteger(index) && index >= 0 && index < sourceCount && !seen.has(index)) {
      seen.add(index)
      indexes.push(index)
    }
  }
  return indexes
}

export function selectSopPromptSources<T extends SopPromptSourceLike>(
  sources: T[],
  targetPromptCount: number,
  brief: string,
) {
  const count = normalizeSopPromptCount(targetPromptCount)
  const mentionedIndexes = getMentionedSopSourceIndexes(brief, sources.length)
  if (mentionedIndexes.length > 0) return mentionedIndexes.slice(0, count).map((index) => sources[index])
  return sources.slice(0, Math.min(sources.length, count))
}

function stripSopPromptListLabel(value: string) {
  return value.trim().replace(/^(?:(?:prompt|提示词)\s*)?(?:第\s*)?\d+\s*(?:条)?\s*[:：、.)）-]\s*/i, '').trim()
}

function getSopPromptDeduplicationKey(value: string) {
  return stripSopPromptListLabel(value)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

export function normalizeSopPromptCandidates(candidates: string[], limit: number, existingPrompts: string[] = []) {
  const seen = new Set(existingPrompts.map(getSopPromptDeduplicationKey).filter(Boolean))
  const normalized: string[] = []
  for (const candidate of candidates) {
    const prompt = stripSopPromptListLabel(candidate)
    const key = getSopPromptDeduplicationKey(prompt)
    if (!prompt || !key || seen.has(key)) continue
    seen.add(key)
    normalized.push(prompt)
    if (normalized.length >= limit) break
  }
  return normalized
}

export async function generateSopPromptBatches(
  totalPromptCount: number,
  generateBatch: (quantity: number, existingPrompts: string[]) => Promise<string[]>,
  options: {
    exact?: boolean
    existingPrompts?: string[]
    maxBatchSize?: number
    maxAttempts?: number
    onProgress?: (completed: number, total: number) => void
    onBatch?: (prompts: string[], completed: number, total: number) => void | Promise<void>
    beforeBatch?: () => void | Promise<void>
    signal?: AbortSignal
  } = {},
) {
  const expected = normalizeSopPromptCount(totalPromptCount)
  const batchSize = getSopPromptBatchSizes(expected, options.maxBatchSize)[0]
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? SOP_PROMPT_BATCH_MAX_ATTEMPTS))
  const generated: string[] = []

  while (generated.length < expected) {
    const quantity = Math.min(batchSize, expected - generated.length)
    let batch: string[] = []
    let lastError: unknown

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await options.beforeBatch?.()
      throwIfSopPromptGenerationAborted(options.signal)
      const existingPrompts = [...(options.existingPrompts ?? []), ...generated]
      try {
        const candidates = await generateBatch(quantity, existingPrompts)
        throwIfSopPromptGenerationAborted(options.signal)
        batch = normalizeSopPromptCandidates(candidates, quantity, existingPrompts)
        if (!batch.length) throw new Error('模型未返回新的可用提示词')
        break
      } catch (error) {
        throwIfSopPromptGenerationAborted(options.signal)
        lastError = error
      }
    }

    if (!batch.length) {
      if (options.exact === false && generated.length > 0) break
      const message = lastError instanceof Error ? lastError.message : '提示词生成失败'
      throw new Error(`提示词批次生成失败，已自动尝试 ${maxAttempts} 次：${message}`)
    }
    generated.push(...batch)
    await options.onBatch?.([...batch], generated.length, expected)
    options.onProgress?.(generated.length, expected)
  }

  if (options.exact !== false && generated.length !== expected) {
    throw new Error(`模型应返回 ${expected} 条提示词，实际返回 ${generated.length} 条，请重试`)
  }
  return generated
}

export function buildSopPromptBatchRequest(
  sop: SopLibraryItem,
  quantity: number,
  brief: string,
  context: SopPromptBatchContext = {},
) {
  const count = normalizeSopPromptCount(quantity)
  const comparisonPrompts = context.existingPrompts?.filter((item) => item.trim()) ?? []
  const boundedComparisonPrompts = comparisonPrompts.length <= 12
    ? comparisonPrompts
    : [...comparisonPrompts.slice(0, 3), ...comparisonPrompts.slice(-9)]
  return [
    `任务：严格执行 SOP，生成 ${count} 条彼此不同、可直接用于图片生成模型的完整中文提示词。`,
    context.totalPromptCount ? `本轮总目标提示词数量：${context.totalPromptCount} 条。当前只生成分配给本参考图的 ${count} 条。` : '',
    context.sourceLabel ? `当前参考图：${context.sourceLabel}${context.sourceIndex && context.sourceCount ? `（${context.sourceIndex}/${context.sourceCount}）` : ''}。将图中可见事实作为内容依据，并用 SOP 规定的视觉规则组织提示词。` : '',
    '',
    '执行契约：',
    '1. 先在内部从 SOP 提取强制项、可变项、禁止项和每条提示词必备字段，再生成；不要输出拆解过程。',
    '2. 补充要求只能补全 SOP 未定义的内容，不得覆盖 SOP 明确锁定的常量和禁止项。',
    '3. 每条都要写全主体、场景/背景、构图/视角、光影/色彩、材质/风格及 SOP 要求的限制；SOP 未要求的模型专用参数不要擅自添加。',
    '4. 批次内必须在 SOP 允许的主体、场景、构图、镜头或装饰等维度形成实质差异，不得只替换序号、近义词或少量形容词。',
    '5. SOP 内若自带 JSON、编号或其他输出示例，只提取其中对提示词内容的要求；最终仍使用本请求末尾规定的 JSON 传输封装。',
    brief.trim() ? `本批补充要求：
<BRIEF>
${brief.trim()}
</BRIEF>` : '本批补充要求：无',
    boundedComparisonPrompts.length ? `已有提示词样本（不得与已有结果重复或仅做同义改写）：
<EXISTING_PROMPTS>
${JSON.stringify(boundedComparisonPrompts)}
</EXISTING_PROMPTS>` : '',
    '',
    '<SOP>',
    `名称：${sop.name}`,
    sop.description.trim() ? `用途说明：${sop.description.trim()}` : '',
    sop.content,
    '</SOP>',
    '',
    '输出前逐条自检：SOP 强制项无遗漏、禁止项未违反、事实未臆造、条目之间有实质差异、每条都能脱离上下文独立使用。',
    `只返回合法 JSON：{"prompts":["完整提示词 1","完整提示词 2","共严格 ${count} 条"]}`,
    '禁止 Markdown 代码围栏、解释、标题和列表编号；禁止使用“同上”“保持一致”等省略表达。',
  ].filter(Boolean).join('\n')
}

export function parseSopPromptBatchResponse(
  text: string,
  quantity: number,
  options: { exact?: boolean; existingPrompts?: string[] } = {},
) {
  const source = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型未返回可识别的提示词列表')
  let parsed: unknown
  try {
    parsed = JSON.parse(source.slice(start, end + 1))
  } catch {
    throw new Error('模型返回的提示词 JSON 格式不正确，请重试')
  }
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  const promptList = record.prompts ?? record.Ready_To_Use_Prompts ?? record.ready_to_use_prompts
  const prompts = Array.isArray(promptList)
    ? promptList.map((item) => String(item).trim()).filter(Boolean)
    : []
  const expected = normalizeSopPromptCount(quantity)
  const normalized = normalizeSopPromptCandidates(prompts, expected, options.existingPrompts)
  if (options.exact !== false && normalized.length !== expected) throw new Error(`模型应返回 ${expected} 条提示词，实际返回 ${normalized.length} 条，请重试`)
  if (options.exact === false && normalized.length === 0) throw new Error('模型未返回可用提示词，请重试')
  return normalized
}
