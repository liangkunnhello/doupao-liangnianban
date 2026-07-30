import type { SopLibraryItem } from './types'

export const MAX_DEFAULT_SOP_PROMPT_SOURCES = 3
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
}

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

export function selectSharedSopPromptSources<T extends SopPromptSourceLike>(sources: T[]) {
  return [...sources]
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
  return sources.slice(0, Math.min(sources.length, count, MAX_DEFAULT_SOP_PROMPT_SOURCES))
}

export function normalizeSopPromptCandidates(candidates: string[], limit: number, existingPrompts: string[] = []) {
  const seen = new Set(existingPrompts.map((item) => item.trim()).filter(Boolean))
  const normalized: string[] = []
  for (const candidate of candidates) {
    const prompt = candidate.trim()
    if (!prompt || seen.has(prompt)) continue
    seen.add(prompt)
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
  const sizes = getSopPromptBatchSizes(expected, options.maxBatchSize)
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? SOP_PROMPT_BATCH_MAX_ATTEMPTS))
  const generated: string[] = []

  for (const plannedSize of sizes) {
    const quantity = Math.min(plannedSize, expected - generated.length)
    if (quantity <= 0) break
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
  return [
    `请严格执行以下 SOP，并生成 ${count} 条彼此不同、可直接用于图片生成模型的完整中文提示词。`,
    context.totalPromptCount ? `本轮总目标提示词数量：${context.totalPromptCount} 条。当前只生成分配给本参考图的 ${count} 条。` : '',
    context.sourceLabel ? `当前参考图：${context.sourceLabel}${context.sourceIndex && context.sourceCount ? `（${context.sourceIndex}/${context.sourceCount}）` : ''}。提示词必须围绕当前参考图生成。` : '',
    brief.trim() ? `本批补充要求：${brief.trim()}` : '',
    `SOP 名称：${sop.name}`,
    `SOP 说明：${sop.description}`,
    'SOP 正文：',
    sop.content,
    '',
    '只返回合法 JSON，不要 Markdown 代码围栏或解释。格式必须为：',
    `{"prompts":["提示词 1","提示词 2","...严格输出 ${count} 条"]}`,
    '每条提示词必须独立完整，不得使用“同上”“保持一致”等省略表达。',
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
  const prompts = Array.isArray((parsed as { prompts?: unknown })?.prompts)
    ? (parsed as { prompts: unknown[] }).prompts.map((item) => String(item).trim()).filter(Boolean)
    : []
  const expected = normalizeSopPromptCount(quantity)
  const normalized = normalizeSopPromptCandidates(prompts, expected, options.existingPrompts)
  if (options.exact !== false && normalized.length !== expected) throw new Error(`模型应返回 ${expected} 条提示词，实际返回 ${normalized.length} 条，请重试`)
  if (options.exact === false && normalized.length === 0) throw new Error('模型未返回可用提示词，请重试')
  return normalized
}
