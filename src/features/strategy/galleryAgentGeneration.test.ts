import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildGalleryAgentPromptBatch,
  generateGalleryAgentVariablePrompts,
  normalizeGalleryAgentPlan,
  shouldUseGalleryAgentReferenceImages,
} from './galleryAgentGeneration'

const storeMocks = vi.hoisted(() => ({
  settings: {
    model: 'gpt-test',
  },
}))

vi.mock('../../lib/apiProfiles', () => ({
  getAgentTextApiProfile: () => ({
    id: 'agent-test',
    name: 'Agent Test',
    provider: 'openai',
    apiMode: 'responses',
    apiKey: 'test-key',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-test',
    apiProxy: false,
  }),
  validateApiProfile: () => null,
}))

vi.mock('../../lib/devProxy', () => ({
  buildApiUrl: () => 'https://api.example.com/v1/responses',
  readClientDevProxyConfig: () => ({}),
  shouldUseApiProxy: () => false,
}))

vi.mock('../../store', () => ({
  submitTaskWithData: vi.fn(),
  useStore: {
    getState: () => storeMocks,
  },
}))

function mockResponse(text: string) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ output: [{ content: [{ type: 'output_text', text }] }] }),
    text: vi.fn().mockResolvedValue(''),
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('gallery agent generation', () => {
  it('limits strategy count by similarity while preserving dynamic directions', () => {
    const raw = {
      productType: '护肤精华',
      hasIntentionalCopy: true,
      skillKind: 'app-copy',
      skillReason: '画面包含标题和卖点',
      strategyDirections: [
        { name: 'A', focus: '产品与功效文案绑定' },
        { name: 'B', focus: '使用过程证据' },
        { name: 'C', focus: '成分结构' },
      ],
    }
    expect(normalizeGalleryAgentPlan(raw, 5).strategyDirections).toHaveLength(1)
    expect(normalizeGalleryAgentPlan(raw, 2).strategyDirections).toHaveLength(3)
    expect(normalizeGalleryAgentPlan(raw, 2).skillKind).toBe('app-copy')
  })

  it('uses the selected skill and accepts variable groups with non-fixed option counts', async () => {
    const plan = JSON.stringify({
      productType: '运动鞋',
      hasIntentionalCopy: false,
      skillKind: 'visual',
      skillReason: '没有需要保留的文字',
      strategyDirections: [
        { name: '悬浮拆解', focus: '鞋体与功能部件形成悬浮层级' },
        { name: '运动轨迹', focus: '通过动作轨迹表现缓震性能' },
      ],
    })
    const promptA = '图片比例为16:9。生成{{鞋体状态}}与{{空间结构}}。\n\n可变项：\n{{鞋体状态}}：悬浮完整鞋体 / 鞋底与鞋面分层\n{{空间结构}}：中心聚合 / 斜向展开 / 环形包围'
    const promptB = '图片比例为16:9。生成{{运动证据}}。\n\n可变项：\n{{运动证据}}：落地压缩鞋底 / 加速扬起颗粒 / 转向留下弧形轨迹 / 腾空展示鞋底纹路'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(plan))
      .mockResolvedValueOnce(mockResponse(JSON.stringify({ name: '悬浮拆解', description: '结构策略', variablePrompt: promptA })))
      .mockResolvedValueOnce(mockResponse(JSON.stringify({ name: '运动轨迹', description: '动作策略', variablePrompt: promptB })))
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateGalleryAgentVariablePrompts({
      images: [{ id: 'image-1', dataUrl: 'data:image/png;base64,AAA' }],
      similarity: 3,
      targetImageCount: 2,
    })

    expect(result.plan.productType).toBe('运动鞋')
    expect(result.plan.skillKind).toBe('visual')
    expect(result.variablePrompts).toHaveLength(2)
    expect(result.variablePrompts[0].variablePrompt).toContain('{{鞋体状态}}')
    expect(result.variablePrompts[1].variablePrompt).toContain('{{运动证据}}')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const strategyRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(strategyRequest.instructions).toContain('变量的组数、每组的选项数量都必须根据当前产品')
    expect(strategyRequest.instructions).toContain('不执行“至少三组”“固定四组”或“每组默认10个”')
  })

  it('routes intentional copy to the copy-preserving skill', async () => {
    const plan = JSON.stringify({
      productType: '菜品配料卡',
      hasIntentionalCopy: true,
      skillKind: 'app-copy',
      skillReason: '存在菜名、配料和用量信息',
      strategyDirections: [{ name: '菜品文案绑定', focus: '菜品主体与菜名、配料必须作为完整内容包' }],
    })
    const variablePrompt = '图片比例为16:9。根据{{主体文案包}}生成菜品卡。\n\n可变项：\n{{主体文案包}}：番茄牛腩，标题“番茄牛腩”，配料“牛腩350克” / 冬瓜丸子，标题“冬瓜丸子汤”，配料“冬瓜400克”'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(plan))
      .mockResolvedValueOnce(mockResponse(JSON.stringify({ name: '菜品文案绑定', description: '主体文案不交叉', variablePrompt })))
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateGalleryAgentVariablePrompts({
      images: [{ id: 'image-1', dataUrl: 'data:image/png;base64,AAA' }],
      similarity: 5,
    })

    expect(result.plan.skillKind).toBe('app-copy')
    const strategyRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(strategyRequest.instructions).toContain('APP 带文案素材策略提取器')
    expect(strategyRequest.instructions).toContain('必须绑定的产品身份、型号、价格、参数、菜名、配料和文案')
    expect(strategyRequest.instructions).not.toContain('禁止出现文案、文字、标题')
  })

  it('does not extract more strategies than the requested final image count', async () => {
    const plan = JSON.stringify({
      productType: '耳机',
      hasIntentionalCopy: false,
      skillKind: 'visual',
      skillReason: '纯产品视觉',
      strategyDirections: [
        { name: '方向A', focus: '悬浮展示' },
        { name: '方向B', focus: '佩戴场景' },
        { name: '方向C', focus: '结构拆解' },
      ],
    })
    const variablePrompt = '生成{{主体}}。\n\n可变项：\n{{主体}}：悬浮耳机 / 佩戴中的耳机'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(plan))
      .mockResolvedValueOnce(mockResponse(JSON.stringify({ name: '方向A', description: '', variablePrompt })))
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateGalleryAgentVariablePrompts({
      images: [{ id: 'image-1', dataUrl: 'data:image/png;base64,AAA' }],
      similarity: 1,
      targetImageCount: 1,
    })

    expect(result.plan.strategyDirections).toHaveLength(1)
    expect(result.variablePrompts).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('aborts during product analysis', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('已停止', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const generation = generateGalleryAgentVariablePrompts({
      images: [{ id: 'image-1', dataUrl: 'data:image/png;base64,AAA' }],
      similarity: 3,
      signal: controller.signal,
    })

    controller.abort()

    await expect(generation).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('allocates the requested images across multiple variable prompts', () => {
    const prompts = buildGalleryAgentPromptBatch([
      {
        name: '策略A',
        description: '',
        variablePrompt: '生成{{主体}}。\n\n可变项：\n{{主体}}：猫 / 狗',
      },
      {
        name: '策略B',
        description: '',
        variablePrompt: '生成{{场景}}。\n\n可变项：\n{{场景}}：厨房 / 花园 / 书房',
      },
    ], 5, 'test-seed')

    expect(prompts).toHaveLength(5)
    expect(prompts.every((prompt) => !prompt.includes('{{'))).toBe(true)
    expect(prompts.some((prompt) => prompt.includes('猫') || prompt.includes('狗'))).toBe(true)
    expect(prompts.some((prompt) => /厨房|花园|书房/.test(prompt))).toBe(true)
  })

  it('uses references only for balanced and high-similarity generation', () => {
    expect(shouldUseGalleryAgentReferenceImages(1)).toBe(false)
    expect(shouldUseGalleryAgentReferenceImages(2)).toBe(false)
    expect(shouldUseGalleryAgentReferenceImages(3)).toBe(true)
    expect(shouldUseGalleryAgentReferenceImages(5)).toBe(true)
  })
})
