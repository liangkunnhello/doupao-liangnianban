import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateSopFromStore } from './storeSopGeneration'

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
  useStore: {
    getState: () => ({ settings: { model: 'gpt-test' } }),
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
})

describe('store SOP generation', () => {
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
})
