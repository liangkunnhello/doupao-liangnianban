import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiProfile, AppSettings, TaskParams } from '../../types'
import { callAgentResponsesApi } from '../../lib/agentApi'
import { DEFAULT_WORD_DERIVE_SETTINGS } from './matcher'
import { runAssistantAction } from './runner'
import type { AssistantInputContext } from './types'

vi.mock('../../lib/agentApi', () => ({
  callAgentResponsesApi: vi.fn(),
}))

const mockedCallAgentResponsesApi = vi.mocked(callAgentResponsesApi)

const settings = {} as AppSettings
const profile = { apiKey: 'test-key' } as ApiProfile
const params = {} as TaskParams

function context(patch: Partial<AssistantInputContext> = {}): AssistantInputContext {
  return {
    text: '生成一张信息流广告图',
    hasText: true,
    images: [],
    hasImage: false,
    imageCount: 0,
    ...patch,
  }
}

describe('assistant action runner', () => {
  beforeEach(() => {
    mockedCallAgentResponsesApi.mockReset()
  })

  it('adds the information-flow compliance guardrail to every skill request', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({ finalPrompt: '客观展示产品设计与使用场景', prompts: [] }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    await runAssistantAction('prompt-optimize', context(), { settings, profile, params })

    const request = mockedCallAgentResponsesApi.mock.calls[0]?.[0]
    expect(JSON.stringify(request?.input)).toContain('信息流广告合规负面约束')
    expect(JSON.stringify(request?.input)).toContain('参考图片和用户原始文字是最高事实源')
    expect(JSON.stringify(request?.input)).toContain('不能只在分析中提到参考图')
    expect(JSON.stringify(request?.input)).toContain('严禁把 sourceAnchors 列表、原始文字全文、分析过程')
    expect(JSON.stringify(request?.input)).toContain('不得承诺保本、保收益')
    expect(JSON.stringify(request?.input)).toContain('不得生成烟草或电子烟推广')
  })

  it('does not turn prompt optimization output into variable chips', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({
        finalPrompt: '优化后的普通信息流广告提示词',
        variablePrompt: '{{画幅比例}}，{{风格}}，突出产品卖点',
        prompts: ['优化后的普通信息流广告提示词'],
        wordEntries: [
          { category: '画幅比例', entries: ['9:16'] },
          { category: '风格', entries: ['写实'] },
        ],
      }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    const result = await runAssistantAction('prompt-optimize', context(), { settings, profile, params })

    expect(result.variablePrompt).toBeUndefined()
    expect(result.wordEntries).toBeUndefined()
    expect(result.primaryText).toBe('优化后的普通信息流广告提示词')
  })

  it('uses the concise style-first concept extraction workflow for image derive', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({
        finalPrompt: '思考过程：先分析配色和材质。最终提示词：生成一组功能图标；整体视觉风格和画面参数严格沿用参考图；每张图片只变化核心功能符号。',
        variablePrompt: '{{产品主体}}，{{视觉钩子}}',
        prompts: ['不应保留的候选提示词'],
        sections: [{ title: '不应保留的分析', items: ['营销分析'] }],
        wordEntries: [{ category: '产品主体', entries: ['钥匙图标'] }],
      }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    const result = await runAssistantAction('image-derive', context({
      images: [{ id: 'reference-1', dataUrl: 'data:image/png;base64,AAAA' }],
      hasImage: true,
      imageCount: 1,
    }), {
      settings,
      profile,
      params,
      actionSettings: { wordDerive: { ...DEFAULT_WORD_DERIVE_SETTINGS, variableCount: 1 } },
    })

    const requestText = JSON.stringify(mockedCallAgentResponsesApi.mock.calls[0]?.[0].input)
    expect(requestText).toContain('你是“概念抽取”提示词助手')
    expect(requestText).toContain('只描述当前要生成的一张独立画面')
    expect(requestText).toContain('不要把这些参数重新写死成颜色名')
    expect(requestText).toContain('禁止把观察过程、思考过程')
    expect(requestText).toContain('80–160 个汉字')
    expect(requestText).not.toContain('信息流广告合规负面约束')
    expect(requestText).not.toContain('跑量结构保留项')
    expect(requestText).toContain('data:image/png;base64,AAAA')

    expect(result.title).toBe('概念抽取')
    expect(result.primaryText).toBe('生成一张独立画面，呈现功能图标；整体视觉风格和画面参数严格沿用参考图；当前画面只变化核心功能符号。')
    expect(result.primaryText).not.toContain('思考过程')
    expect(result.primaryText).not.toContain('一组')
    expect(result.primaryText).not.toContain('每张')
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates?.[0]).toBe(result.primaryText)
    expect(result.variablePrompt).toBeUndefined()
    expect(result.sections).toBeUndefined()
    expect(result.wordEntries).toBeUndefined()
    expect(result.testPlan).toBeUndefined()
  })

  it('throws a generation failure instead of a template fallback when the model returns empty', async () => {
    mockedCallAgentResponsesApi
      .mockResolvedValueOnce({ text: '' } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
      .mockResolvedValueOnce({ text: '' } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    await expect(
      runAssistantAction('image-derive', context({ hasImage: true, imageCount: 1 }), {
        settings,
        profile,
        params,
      }),
    ).rejects.toThrow(/未返回可用内容/)

    // One initial call plus exactly one automatic retry.
    expect(mockedCallAgentResponsesApi).toHaveBeenCalledTimes(2)
  })

  it('does not invent extra entries when extracting existing variables', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({
        wordEntries: [{ category: '产品主体', entries: ['钥匙图标'] }],
      }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    const result = await runAssistantAction('word-extract', context(), {
      settings,
      profile,
      params,
      actionSettings: { wordDerive: { ...DEFAULT_WORD_DERIVE_SETTINGS, variableCount: 20 } },
    })

    expect(mockedCallAgentResponsesApi).toHaveBeenCalledTimes(1)
    expect(result.wordEntries).toEqual([{ category: '产品主体', entries: ['钥匙图标'] }])
  })

  it('keeps only variable placeholders that have matching word entries for variable-enabled skills', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({
        finalPrompt: '图片衍生提示词',
        variablePrompt: '{{产品主体}}，{{画幅比例}}，{{风格}}',
        prompts: ['图片衍生提示词'],
        wordEntries: [
          { category: '产品主体', entries: ['产品特写'] },
          { category: '无关分类', entries: ['不应保存'] },
        ],
      }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    const result = await runAssistantAction('super-derive', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
      actionSettings: { wordDerive: { ...DEFAULT_WORD_DERIVE_SETTINGS, variableCount: 1 } },
    })

    expect(result.variablePrompt).toBe('{{产品主体}}，画幅比例，风格')
    expect(result.wordEntries).toEqual([{ category: '产品主体', entries: ['产品特写'] }])
  })

  it('does not auto-fill variable word entries to a target count', async () => {
    mockedCallAgentResponsesApi
      .mockResolvedValueOnce({
        text: JSON.stringify({
          finalPrompt: '图片衍生提示词',
          variablePrompt: '{{产品主体}}',
          prompts: ['图片衍生提示词'],
          wordEntries: [{ category: '产品主体', entries: ['产品特写'] }],
        }),
      } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    const result = await runAssistantAction('super-derive', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
      actionSettings: { wordDerive: { ...DEFAULT_WORD_DERIVE_SETTINGS, variableCount: 3 } },
    })

    // No second model call: entries are never auto-filled to a target count.
    expect(mockedCallAgentResponsesApi).toHaveBeenCalledTimes(1)
    expect(result.wordEntries).toEqual([
      { category: '产品主体', entries: ['产品特写'] },
    ])
    expect(result.qualityState).toBe('complete')
  })

  it('does not assemble a variable main prompt locally when the model returns word entries but no variable prompt', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({
        finalPrompt: '图片衍生提示词',
        variablePrompt: '',
        prompts: ['图片衍生提示词'],
        wordEntries: [
          { category: '产品主体', entries: ['产品特写'] },
          { category: '目标人群', entries: ['年轻女性'] },
        ],
      }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    const result = await runAssistantAction('super-derive', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
      actionSettings: { wordDerive: { ...DEFAULT_WORD_DERIVE_SETTINGS, variableCount: 1 } },
    })

    // P1: 宁可少生成，也不把分类裸拼成看起来“像完成”的变量皮肤。
    expect(result.variablePrompt).toBeUndefined()
    expect(result.qualityState).toBe('insufficient-data')
    expect(result.qualityNote).toContain('没有返回可替换的变量主提示词')
    expect(result.wordEntries).toEqual([
      { category: '产品主体', entries: ['产品特写'] },
      { category: '目标人群', entries: ['年轻女性'] },
    ])
  })

  it('only patches missing placeholders when the model returns a variable prompt', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({
        finalPrompt: '图片衍生提示词',
        variablePrompt: '{{产品主体}}，突出卖点',
        prompts: ['图片衍生提示词'],
        wordEntries: [
          { category: '产品主体', entries: ['产品特写'] },
          { category: '目标人群', entries: ['年轻女性'] },
        ],
      }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    const result = await runAssistantAction('super-derive', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
      actionSettings: { wordDerive: { ...DEFAULT_WORD_DERIVE_SETTINGS, variableCount: 1 } },
    })

    // 模型已返回变量主提示词：只允许局部补缺少的占位符，不重建原文。
    expect(result.variablePrompt).toBe('{{产品主体}}，突出卖点，{{目标人群}}')
    expect(result.qualityState).toBe('repaired')
  })

  it('returns the input fact card so the result page can show grounding', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({ finalPrompt: '客观展示产品设计与使用场景', prompts: [] }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    const result = await runAssistantAction('prompt-optimize', context({ text: '一款玻璃水瓶；适合健身人群' }), { settings, profile, params })

    expect(result.grounding?.observedFacts.length).toBe(2)
    expect(result.grounding?.observedFacts[0]?.fact).toContain('玻璃水瓶')
    expect(result.grounding?.observedFacts[1]?.fact).toContain('健身人群')
  })

  it('surfaces model-reported source anchors and assumptions separately', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({
        finalPrompt: '生成画面',
        sourceAnchors: ['图片中为哑光黑瓶身'],
        assumptions: ['推断目标人群为男性健身用户'],
        prompts: [],
      }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    const result = await runAssistantAction('super-derive', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
      actionSettings: { wordDerive: { ...DEFAULT_WORD_DERIVE_SETTINGS, variableCount: 1 } },
    })

    expect(result.sourceAnchors).toEqual(['图片中为哑光黑瓶身'])
    expect(result.assumptions).toEqual(['推断目标人群为男性健身用户'])
  })

  it('backfills the structured visualIdentity into the input fact card', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({
        finalPrompt: '生成画面',
        visualIdentity: {
          subject: '哑光黑瓶身',
          composition: '居中、占画面 60%',
          color: '黑、银灰',
          scene: '健身工作室',
          textLayout: '左下角小字标语',
          style: '写实、硬光',
        },
        prompts: [],
      }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    const result = await runAssistantAction('super-derive', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
      actionSettings: { wordDerive: { ...DEFAULT_WORD_DERIVE_SETTINGS, variableCount: 1 } },
    })

    expect(result.grounding?.visualIdentity.subject).toBe('哑光黑瓶身')
    expect(result.grounding?.visualIdentity.style).toBe('写实、硬光')
  })

  it('keeps a custom skill contract conservative when the model is silent', async () => {
    const { normalizeCustomSkills } = await import('./matcher')
    const normalized = normalizeCustomSkills([
      { id: 'c1', name: '安静技能', instruction: '只做素材拆解，不投放', trigger: 'always' },
    ])

    expect(normalized).toHaveLength(1)
    const skill = normalized[0]!
    expect(skill.requiresAdContext).toBe(false)
    expect(skill.allowWordEntries).toBe(false)
    expect(skill.allowExploreSellingPoint).toBe(false)
    expect(skill.contract?.output.wordEntries).toBe(false)
    expect(skill.contract?.requiresAdContext).toBe(false)
  })

  it('preserves a custom skill contract returned by the model and reflects the three toggles', async () => {
    const { normalizeCustomSkills } = await import('./matcher')
    const normalized = normalizeCustomSkills([
      {
        id: 'c2',
        name: '跑量技能',
        instruction: '做信息流跑量衍生',
        trigger: 'image',
        requiresAdContext: true,
        allowWordEntries: true,
        allowExploreSellingPoint: true,
        contract: {
          taskType: 'creative-expansion',
          objective: '跑量衍生',
          preserve: ['产品事实'],
          editable: ['场景'],
          forbidden: ['虚构功效'],
          variationLevel: 'high',
          requiresAdContext: true,
          allowExploreSellingPoint: true,
          primaryOutput: 'variablePrompt',
          output: { finalPrompt: true, candidates: true, analysis: true, wordEntries: true },
        },
      },
    ])

    const skill = normalized[0]!
    expect(skill.requiresAdContext).toBe(true)
    expect(skill.allowWordEntries).toBe(true)
    expect(skill.allowExploreSellingPoint).toBe(true)
    expect(skill.contract?.taskType).toBe('creative-expansion')
    expect(skill.contract?.objective).toBe('跑量衍生')
    expect(skill.contract?.allowExploreSellingPoint).toBe(true)
  })

  it('uses the effective locked selling point policy for custom ad skills that forbid exploration', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({
      text: JSON.stringify({ finalPrompt: '保留原始卖点生成素材', prompts: ['保留原始卖点生成素材'] }),
    } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    const result = await runAssistantAction('custom-ad', context({ text: '产品卖点：轻便耐用' }), {
      settings,
      profile,
      params,
      actionSettings: { sellingPointPolicy: 'explore' },
      customSkill: {
        id: 'custom-ad',
        name: '投放改写',
        icon: 'sparkles',
        instruction: '只做广告投放改写，不得扩展新卖点',
        steps: [],
        trigger: 'text',
        enabled: true,
        priority: 65,
        when: { text: 'required', image: 'optional' },
        outputMode: 'show-candidates',
        isCustom: true,
        requiresAdContext: true,
        allowWordEntries: false,
        allowExploreSellingPoint: false,
        contract: {
          taskType: 'prompt-optimize',
          objective: '投放改写',
          preserve: ['原始卖点'],
          editable: ['表达方式'],
          forbidden: ['扩展新卖点'],
          variationLevel: 'low',
          requiresAdContext: true,
          allowExploreSellingPoint: false,
          primaryOutput: 'finalPrompt',
          output: { finalPrompt: true, candidates: true, analysis: true, wordEntries: false },
        },
      },
    })

    expect(result.sellingPointPolicy).toBe('lock')
    expect(result.testPlan).toContain('锁定原卖点')
  })
})
