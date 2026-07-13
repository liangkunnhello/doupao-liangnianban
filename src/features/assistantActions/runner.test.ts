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

  it('uses an unambiguous reference-driven single-image fallback for concept extraction', async () => {
    mockedCallAgentResponsesApi.mockResolvedValueOnce({ text: '' } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    const result = await runAssistantAction('image-derive', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
    })

    expect(result.primaryText).toContain('生成一张独立画面')
    expect(result.primaryText).toContain('均严格沿用参考图')
    expect(result.primaryText).toContain('禁止拼图、九宫格、多联画和同画布多方案')
    expect(result.primaryText).not.toMatch(/一组|系列图片|每张/)
    expect(result.primaryText).not.toMatch(/蓝色|青色|白色|3D|写实/)
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

  it('repairs variable word entries that are below the configured count', async () => {
    mockedCallAgentResponsesApi
      .mockResolvedValueOnce({
        text: JSON.stringify({
          finalPrompt: '图片衍生提示词',
          variablePrompt: '{{产品主体}}',
          prompts: ['图片衍生提示词'],
          wordEntries: [{ category: '产品主体', entries: ['产品特写'] }],
        }),
      } as Awaited<ReturnType<typeof callAgentResponsesApi>>)
      .mockResolvedValueOnce({
        text: JSON.stringify({
          wordEntries: [{ category: '产品主体', entries: ['手持产品', '产品使用瞬间'] }],
        }),
      } as Awaited<ReturnType<typeof callAgentResponsesApi>>)

    const result = await runAssistantAction('super-derive', context({ hasImage: true, imageCount: 1 }), {
      settings,
      profile,
      params,
      actionSettings: { wordDerive: { ...DEFAULT_WORD_DERIVE_SETTINGS, variableCount: 3 } },
    })

    expect(mockedCallAgentResponsesApi).toHaveBeenCalledTimes(2)
    expect(result.wordEntries).toEqual([
      { category: '产品主体', entries: ['产品特写', '手持产品', '产品使用瞬间'] },
    ])
  })

  it('rebuilds a variable prompt when word entries are present but placeholders are missing', async () => {
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

    expect(result.variablePrompt).toContain('{{产品主体}}')
    expect(result.variablePrompt).toContain('{{目标人群}}')
    expect(result.primaryText).toBe(result.variablePrompt)
  })
})
