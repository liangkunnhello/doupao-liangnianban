import { afterEach, describe, expect, it, vi } from 'vitest'
import { generatePromptsFromSopStore, generateSopFromStore } from './storeSopGeneration'

const storeMocks = vi.hoisted(() => ({
  agentTextProtocol: 'chat-completions' as 'responses' | 'chat-completions',
  model: 'kimi-k3',
}))

vi.mock('../../../lib/apiProfiles', () => ({
  getAgentTextApiProfile: () => ({
    provider: 'openai',
    apiMode: 'responses',
    apiKey: 'test-key',
    baseUrl: 'https://api.example.com',
    model: storeMocks.model,
    apiProxy: false,
    timeout: 600,
  }),
}))

vi.mock('../../../lib/devProxy', () => ({
  buildApiUrl: (baseUrl: string, path: string) => `https://api.example.com/v1/${path}`,
  readClientDevProxyConfig: () => ({}),
  shouldUseApiProxy: () => false,
}))

vi.mock('../../../store', () => ({
  submitTaskWithData: vi.fn(),
  useStore: {
    getState: () => ({
      settings: { model: storeMocks.model, agentTextProtocol: storeMocks.agentTextProtocol },
    }),
  },
}))

function chatPayload(content: string) {
  return { choices: [{ message: { role: 'assistant', content } }] }
}

function mockChatResponse(content: string) {
  return new Response(JSON.stringify(chatPayload(content)), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  storeMocks.agentTextProtocol = 'chat-completions'
  storeMocks.model = 'kimi-k3'
})

describe('store SOP generation over Chat Completions', () => {
  it('routes generateSopFromStore to /chat/completions with messages and parses choices', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockChatResponse('{"name":"多图 SOP","description":"说明","sop":"# 正文"}'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(generateSopFromStore('生成 SOP', {}, [
      { name: 'A.png', dataUrl: 'data:image/png;base64,AAA' },
    ], 'general', undefined, {})).resolves.toEqual({
      name: '多图 SOP',
      description: '说明',
      content: '# 正文',
      executionMode: 'prompt-generator',
    })

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/v1/chat/completions')

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.messages[0]).toEqual({ role: 'system', content: expect.any(String) })
    expect(body.messages[1].role).toBe('user')
    expect(body.messages[1].content).toEqual(expect.arrayContaining([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
    ]))
    expect(body.instructions).toBeUndefined()
    expect(body.input).toBeUndefined()
    expect(body.response_format.type).toBe('json_schema')
  })

  it('falls back to unstructured chat body when structured output is rejected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"unsupported"}', { status: 400, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(mockChatResponse('{"name":"修复 SOP","description":"说明","sop":"# 正文"}'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(generateSopFromStore('生成 SOP', {}, [], 'general', undefined, {})).resolves.toMatchObject({
      name: '修复 SOP',
    })

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(secondBody.response_format).toBeUndefined()
    expect(secondBody.messages).toBeDefined()
  })

  it('routes generatePromptsFromSopStore to /chat/completions and parses the prompt list', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(mockChatResponse('{"prompts":["提示词一","提示词二"]}')))
    vi.stubGlobal('fetch', fetchMock)

    const prompts = await generatePromptsFromSopStore({
      id: 'sop-1',
      name: '商品图 SOP',
      description: '',
      content: '# 生成提示词',
      source: 'manual',
      createdBy: 'user-1',
      createdAt: 1,
      updatedAt: 1,
    }, 2, '')

    expect(prompts).toEqual(['提示词一', '提示词二'])
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/v1/chat/completions')
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.messages[0].role).toBe('system')
    expect(body.instructions).toBeUndefined()
  })

  it('prefers Chat Completions for Gemini even when the global protocol is Responses', async () => {
    storeMocks.agentTextProtocol = 'responses'
    storeMocks.model = 'gemini-3.1-pro-preview'
    const fetchMock = vi.fn().mockResolvedValue(mockChatResponse('{"prompts":["Gemini 提示词"]}'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(generatePromptsFromSopStore({
      id: 'sop-gemini',
      name: 'Gemini SOP',
      description: '',
      content: '# 生成提示词',
      source: 'manual',
      createdBy: 'user-1',
      createdAt: 1,
      updatedAt: 1,
    }, 1, '')).resolves.toEqual(['Gemini 提示词'])

    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/chat/completions')
  })

  it('switches to Chat Completions when Responses returns 200 without text', async () => {
    storeMocks.agentTextProtocol = 'responses'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: [] }), { status: 200 }))
      .mockResolvedValueOnce(mockChatResponse('{"prompts":["回退提示词"]}'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(generatePromptsFromSopStore({
      id: 'sop-empty-responses',
      name: '空响应回退 SOP',
      description: '',
      content: '# 生成提示词',
      source: 'manual',
      createdBy: 'user-1',
      createdAt: 1,
      updatedAt: 1,
    }, 1, '')).resolves.toEqual(['回退提示词'])

    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/responses')
    expect(String(fetchMock.mock.calls[1][0])).toContain('/v1/chat/completions')
  })

  it('switches protocols when the initial request throws', async () => {
    storeMocks.agentTextProtocol = 'responses'
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('network failed'))
      .mockResolvedValueOnce(mockChatResponse('{"prompts":["异常回退提示词"]}'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(generatePromptsFromSopStore({
      id: 'sop-request-error',
      name: '请求异常回退 SOP',
      description: '',
      content: '# 生成提示词',
      source: 'manual',
      createdBy: 'user-1',
      createdAt: 1,
      updatedAt: 1,
    }, 1, '')).resolves.toEqual(['异常回退提示词'])

    expect(String(fetchMock.mock.calls[1][0])).toContain('/v1/chat/completions')
  })
})
