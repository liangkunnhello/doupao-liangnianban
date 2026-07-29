import { describe, expect, it } from 'vitest'
import {
  allocateSopPromptCounts,
  buildSopPromptBatchRequest,
  generateSopPromptBatches,
  getMentionedSopSourceIndexes,
  getSopRunCounts,
  getSopPromptBatchSizes,
  getSopTotalImageCount,
  parseSopPromptBatchResponse,
  selectSopPromptSources,
  selectSharedSopPromptSources,
} from './sopPromptBatch'
import type { SopLibraryItem } from './types'

const sop: SopLibraryItem = {
  id: 'sop-1',
  name: '测试 SOP',
  description: '测试批量提示词',
  content: '保持蓝色背景，每条提示词更换主体。',
  source: 'manual',
  createdBy: 'user-1',
  createdAt: 1,
  updatedAt: 1,
}

describe('SOP prompt batch', () => {
  it('builds a strict request with the requested quantity', () => {
    const request = buildSopPromptBatchRequest(sop, 3, '使用产品摄影风格', {
      sourceLabel: '图1',
      totalPromptCount: 10,
    })
    expect(request).toContain('生成 3 条')
    expect(request).toContain('本轮总目标提示词数量：10 条')
    expect(request).toContain('当前参考图：图1')
    expect(request).toContain('使用产品摄影风格')
    expect(request).toContain(sop.content)
  })

  it('allocates a global prompt count across selected sources', () => {
    expect(allocateSopPromptCounts(10, 3)).toEqual([4, 3, 3])
    expect(allocateSopPromptCounts(2, 3)).toEqual([1, 1, 0])
  })

  it('splits large prompt runs into small model requests', () => {
    expect(getSopPromptBatchSizes(30)).toEqual([10, 10, 10])
    expect(getSopPromptBatchSizes(23)).toEqual([10, 10, 3])
  })

  it('retries a malformed batch without discarding successful batches', async () => {
    const requests: number[] = []
    let failedOnce = false

    const prompts = await generateSopPromptBatches(12, async (count, existingPrompts) => {
      requests.push(count)
      if (!failedOnce) {
        failedOnce = true
        throw new Error('模型返回的提示词 JSON 格式不正确，请重试')
      }
      return Array.from({ length: count }, (_, index) => `提示词-${existingPrompts.length + index + 1}`)
    })

    expect(requests).toEqual([10, 10, 2])
    expect(prompts).toHaveLength(12)
    expect(new Set(prompts).size).toBe(12)
  })

  it('reports completed prompt progress after every successful model batch', async () => {
    const progress: Array<[number, number]> = []

    await generateSopPromptBatches(
      12,
      async (count, existingPrompts) => Array.from(
        { length: count },
        (_, index) => `提示词 ${existingPrompts.length + index + 1}`,
      ),
      { onProgress: (completed, total) => progress.push([completed, total]) },
    )

    expect(progress).toEqual([[10, 12], [12, 12]])
  })

  it('keeps completed batches when a later batch still fails after retry', async () => {
    let calls = 0
    const prompts = await generateSopPromptBatches(25, async (count, existingPrompts) => {
      calls += 1
      if (existingPrompts.length >= 20) throw new Error('模型返回的提示词 JSON 格式不正确，请重试')
      return Array.from({ length: count }, (_, index) => `提示词-${existingPrompts.length + index + 1}`)
    }, { exact: false })

    expect(calls).toBe(4)
    expect(prompts).toHaveLength(20)
  })

  it('selects mentioned sources in mention order and limits by prompt count', () => {
    const sources = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    expect(getMentionedSopSourceIndexes('@图3 @图1 @图3', sources.length)).toEqual([2, 0])
    expect(selectSopPromptSources(sources, 1, '@图3 @图1')).toEqual([{ id: 'c' }])
  })

  it('uses at most three default sources without mentions', () => {
    const sources = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

    expect(selectSopPromptSources(sources, 10, '')).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    expect(selectSopPromptSources(sources, 2, '')).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('keeps every shared reference in source order', () => {
    const sources = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

    expect(selectSharedSopPromptSources(sources)).toEqual(sources)
  })

  it('normalizes prompt and per-prompt image counts independently', () => {
    expect(getSopRunCounts(10, 2)).toEqual({ promptCount: 10, imagesPerPrompt: 2 })
    expect(getSopRunCounts(0, 0)).toEqual({ promptCount: 1, imagesPerPrompt: 1 })
    expect(getSopRunCounts(80, 50)).toEqual({ promptCount: 50, imagesPerPrompt: 20 })
    expect(getSopTotalImageCount(10, 2)).toBe(20)
  })

  it('parses an exact prompt list', () => {
    expect(parseSopPromptBatchResponse('{"prompts":["提示词一","提示词二"]}', 2))
      .toEqual(['提示词一', '提示词二'])
  })

  it('rejects an incomplete list', () => {
    expect(() => parseSopPromptBatchResponse('{"prompts":["只有一条"]}', 2))
      .toThrow('应返回 2 条提示词')
  })

  it('can keep partial unique prompts for source-level runs', () => {
    expect(parseSopPromptBatchResponse('{"prompts":["提示词一","提示词一","提示词二"]}', 3, { exact: false, existingPrompts: ['提示词二'] }))
      .toEqual(['提示词一'])
  })
})
