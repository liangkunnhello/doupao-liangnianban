import { afterEach, describe, expect, it, vi } from 'vitest'
import { generatePromptsFromSopStore, generateSopFromStore, getSopPromptGenerationModelFromStore, testSopRevisionFromStore } from './storeSopGeneration'

const storeMocks = vi.hoisted(() => ({
  submitTaskWithData: vi.fn(),
  showToast: vi.fn(),
  profileTimeout: 600,
}))

vi.mock('../../../lib/apiProfiles', () => ({
  getAgentTextApiProfile: () => ({
    provider: 'openai',
    apiMode: 'responses',
    apiKey: 'test-key',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-test',
    apiProxy: false,
    timeout: storeMocks.profileTimeout,
  }),
}))

vi.mock('../../../lib/devProxy', () => ({
  buildApiUrl: () => 'https://api.example.com/v1/responses',
  readClientDevProxyConfig: () => ({}),
  shouldUseApiProxy: () => false,
}))

vi.mock('../../../store', () => ({
  submitTaskWithData: storeMocks.submitTaskWithData,
  useStore: {
    getState: () => ({
      settings: { model: 'gpt-test' },
      workspaceTabs: [{ id: 'tab-1', name: '测试画廊' }],
      activeWorkspaceTabId: 'tab-1',
      inputImages: [{ id: 'reference-1', dataUrl: 'data:image/png;base64,AAA' }],
      inputImageFolder: null,
      params: { n: 4, size: '1024x1024' },
      customOutputPath: '',
      showToast: storeMocks.showToast,
    }),
  },
}))

function responsePayload(text: string) {
  return {
    output: [{ content: [{ type: 'output_text', text }] }],
  }
}

function mockResponse(text: string) {
  return new Response(JSON.stringify(responsePayload(text)), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  storeMocks.profileTimeout = 600
})

describe('store SOP generation', () => {
  it('reports the actual text model used for prompt generation', () => {
    expect(getSopPromptGenerationModelFromStore()).toBe('gpt-test')
  })

  it('sends all reference images with strict structured output and reports real phases', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse('{"name":"多图 SOP","description":"说明","sop":"# 正文"}'))
    vi.stubGlobal('fetch', fetchMock)
    const progress: string[] = []

    await expect(generateSopFromStore('', {}, [
      { name: 'A.png', dataUrl: 'data:image/png;base64,AAA' },
      { name: 'B.jpg', dataUrl: 'data:image/jpeg;base64,BBB' },
    ], 'image-prompt', undefined, {
      onProgress: (item) => progress.push(item.stage),
    })).resolves.toEqual({ name: '多图 SOP', description: '说明', content: '# 正文', executionMode: 'prompt-generator' })

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(request.text.format).toMatchObject({ type: 'json_schema', strict: true })
    expect(request.text.format.schema.required).toEqual(['name', 'description', 'sop'])
    expect(request.input[0].content).toEqual(expect.arrayContaining([
      { type: 'input_text', text: '参考图 1/2：A.png' },
      { type: 'input_image', image_url: 'data:image/png;base64,AAA' },
      { type: 'input_text', text: '参考图 2/2：B.jpg' },
      { type: 'input_image', image_url: 'data:image/jpeg;base64,BBB' },
    ]))
    expect(progress).toEqual(['validate', 'prepare', 'request', 'parse'])
  })

  it('automatically retries an incomplete model response before surfacing an error', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse('{"name":"缺少正文"}'))
      .mockResolvedValueOnce(mockResponse('{"name":"修复后的 SOP","description":"说明","sop":"# 完整正文"}'))
    vi.stubGlobal('fetch', fetchMock)
    const progress: string[] = []

    await expect(generateSopFromStore('生成 SOP', {}, [], 'general', undefined, {
      onProgress: (item) => progress.push(item.stage),
    })).resolves.toEqual({ name: '修复后的 SOP', description: '说明', content: '# 完整正文', executionMode: 'prompt-generator' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(progress).toContain('repair')
    expect(progress.at(-1)).toBe('parse')
  })

  it('aborts the active model request without starting a repair retry', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (signal?.aborted) {
        reject(new DOMException('已停止', 'AbortError'))
        return
      }
      signal?.addEventListener('abort', () => reject(new DOMException('已停止', 'AbortError')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const generation = generateSopFromStore('生成 SOP', {}, [], 'general', undefined, {
      signal: controller.signal,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.signal).not.toBe(controller.signal)
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false)

    controller.abort()

    await expect(generation).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('times out a stalled prompt response and lets the batch retry finish with an error', async () => {
    vi.useFakeTimers()
    storeMocks.profileTimeout = 1
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: () => new Promise<string>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      }),
    } as Response))
    vi.stubGlobal('fetch', fetchMock)

    const generation = generatePromptsFromSopStore({
      id: 'sop-timeout',
      name: '超时测试',
      description: '',
      content: '# 生成提示词',
      source: 'manual',
      createdBy: 'user-1',
      createdAt: 1,
      updatedAt: 1,
    }, 1)
    const assertion = expect(generation).rejects.toThrow('提示词批次生成失败，已自动尝试 2 次：提示词生成失败：SOP 提示词生成超时：超过 1 秒')

    // Each batch attempt now tries both text protocols before failing.
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(1_000)

    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('uses the skill schema and validates a direct variable prompt before returning it', async () => {
    const variablePrompt = '图片比例为16:9。生成{{主体}}，使用{{构图}}。\n\n可变项：\n{{主体}}：猫 / 狗\n{{构图}}：近景 / 全景'
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(JSON.stringify({
      name: '参考图变量策略',
      description: '直接拆解后生图。',
      variablePrompt,
    })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(generateSopFromStore('反推图片', {}, [
      { name: 'A.png', dataUrl: 'data:image/png;base64,AAA' },
    ], 'variable-prompt-skill', '技能元指令', { excludeText: false })).resolves.toEqual({
      name: '参考图变量策略',
      description: '直接拆解后生图。',
      content: variablePrompt,
      executionMode: 'variable-prompt',
    })

    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(request.text.format.schema.required).toEqual(['name', 'description', 'variablePrompt'])
    expect(request.instructions).toContain('不得返回 sop')
    expect(request.input[0].content[0].text).toContain('不生成 SOP')
  })

  it('retries an invalid skill template and accepts the repaired variable prompt', async () => {
    const repaired = '图片比例为16:9。生成{{主体}}。\n\n可变项：\n{{主体}}：猫 / 狗'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse('{"name":"错误模板","description":"说明","variablePrompt":"生成{{主体}}。\\n可变项：{{主体}}：猫 / 狗"}'))
      .mockResolvedValueOnce(mockResponse(JSON.stringify({ name: '修复模板', description: '说明', variablePrompt: repaired })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(generateSopFromStore('', {}, [
      { name: 'A.png', dataUrl: 'data:image/png;base64,AAA' },
    ], 'variable-prompt-skill', '技能元指令', { excludeText: false })).resolves.toMatchObject({
      name: '修复模板',
      content: repaired,
      executionMode: 'variable-prompt',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('enforces the persisted no-text policy in the request and saved template', async () => {
    const prompt = '图片比例为16:9。生成{{主体}}。\n\n可变项：\n{{主体}}：猫 / 狗'
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(JSON.stringify({ name: '纯视觉', description: '说明', variablePrompt: prompt })))
    vi.stubGlobal('fetch', fetchMock)

    const generated = await generateSopFromStore('', {}, [
      { name: 'A.png', dataUrl: 'data:image/png;base64,AAA' },
    ], 'variable-prompt-skill', '技能元指令', { excludeText: true })

    expect(generated.content).toContain('忽略参考图中的所有文字与文案排版')
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(request.instructions).toContain('禁止出现文案、文字、标题')
    expect(request.input[0].content[0].text).toContain('排除全部文字与文案排版')
  })

  it('rejects copy variables when no-text mode remains enabled after retry', async () => {
    const copyPrompt = '图片比例为16:9。生成{{主体文案包}}。\n\n可变项：\n{{主体文案包}}：猫，标题“萌宠” / 狗，标题“伙伴”'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(JSON.stringify({ name: '错误', description: '说明', variablePrompt: copyPrompt })))
      .mockResolvedValueOnce(mockResponse(JSON.stringify({ name: '仍错误', description: '说明', variablePrompt: copyPrompt })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(generateSopFromStore('', {}, [
      { name: 'A.png', dataUrl: 'data:image/png;base64,AAA' },
    ], 'variable-prompt-skill', '技能元指令', { excludeText: true })).rejects.toThrow('开启“排除文字”后不能生成变量')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('turns a revision proposal into one prompt and submits one image with current gallery context', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse('{"prompts":["测试商品图提示词"]}'))
    vi.stubGlobal('fetch', fetchMock)
    storeMocks.submitTaskWithData.mockResolvedValue('task-test-1')

    await testSopRevisionFromStore({
      id: 'sop-1',
      name: '商品图 SOP',
      description: '',
      content: '# 修订 SOP',
      source: 'manual',
      createdBy: 'user-1',
      createdAt: 1,
      updatedAt: 1,
    })

    expect(storeMocks.submitTaskWithData).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '测试商品图提示词',
      inputImages: [{ id: 'reference-1', dataUrl: 'data:image/png;base64,AAA' }],
      params: expect.objectContaining({ n: 1 }),
      maskDraft: null,
      targetTabId: 'tab-1',
      scheduledOutputSubFolder: '测试画廊',
    }), { silentSuccess: true })
    expect(storeMocks.showToast).toHaveBeenCalledWith('测试任务已提交，可在当前画廊查看生成结果', 'success')
  })
})
