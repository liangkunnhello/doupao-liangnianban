import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateSopFromStore, getSopPromptGenerationModelFromStore, testSopRevisionFromStore } from './storeSopGeneration'

const storeMocks = vi.hoisted(() => ({
  submitTaskWithData: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('../../../lib/apiProfiles', () => ({
  getAgentTextApiProfile: () => ({
    provider: 'openai',
    apiMode: 'responses',
    apiKey: 'test-key',
    baseUrl: 'https://api.example.com/v1',
    model: 'gpt-test',
    apiProxy: false,
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
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(responsePayload(text)),
    text: vi.fn().mockResolvedValue(''),
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
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
    })).resolves.toEqual({ name: '多图 SOP', description: '说明', sop: '# 正文' })

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
    })).resolves.toEqual({ name: '修复后的 SOP', description: '说明', sop: '# 完整正文' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(progress).toContain('repair')
    expect(progress.at(-1)).toBe('parse')
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
