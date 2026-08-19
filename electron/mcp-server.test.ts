import { mkdtempSync, rmSync } from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const userDataRoot = mkdtempSync(path.join(os.tmpdir(), 'doupao-mcp-'))

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataRoot,
    getVersion: () => '0.0.0-test',
    on: vi.fn(),
  },
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
  },
}))

const TEST_PORT = 41977
const BASE_URL = `http://127.0.0.1:${TEST_PORT}/mcp`

type McpModule = typeof import('./mcp-server')
let mcp: McpModule

async function postMcp(body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status: response.status, headers: response.headers, body: parsed }
}

function authHeaders(token: string, sessionId?: string) {
  return {
    Authorization: `Bearer ${token}`,
    ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
  }
}

async function initializeSession(token: string) {
  const init = await postMcp(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'vitest', version: '0.0.1' },
      },
    },
    authHeaders(token),
  )
  expect(init.status).toBe(200)
  const sessionId = init.headers.get('mcp-session-id')
  expect(sessionId).toBeTruthy()
  await postMcp(
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    authHeaders(token, sessionId!),
  )
  return sessionId!
}

beforeAll(async () => {
  mcp = await import('./mcp-server')
  await mcp.initMcpServer({ getMainWindow: () => null })
  await mcp.updateMcpConfig({ port: TEST_PORT })
})

afterAll(async () => {
  await mcp.updateMcpConfig({ enabled: false })
  rmSync(userDataRoot, { recursive: true, force: true })
})

describe('mcp-server 纯函数', () => {
  it('normalizeMcpConfig 填充默认值并收敛端口范围', () => {
    const config = mcp.normalizeMcpConfig(null)
    expect(config.enabled).toBe(true)
    expect(config.port).toBe(mcp.MCP_DEFAULT_PORT)
    expect(config.token.length).toBeGreaterThanOrEqual(16)

    expect(mcp.normalizeMcpConfig({ port: 80 }).port).toBe(mcp.MCP_MIN_PORT)
    expect(mcp.normalizeMcpConfig({ port: 99999 }).port).toBe(mcp.MCP_MAX_PORT)
    expect(mcp.normalizeMcpConfig({ enabled: false, port: 5000, token: 'x'.repeat(20) })).toEqual({
      enabled: false,
      port: 5000,
      token: 'x'.repeat(20),
    })
  })

  it('isAllowedHostHeader 只放行本机回环', () => {
    expect(mcp.isAllowedHostHeader('127.0.0.1:41317')).toBe(true)
    expect(mcp.isAllowedHostHeader('localhost')).toBe(true)
    expect(mcp.isAllowedHostHeader('[::1]:41317')).toBe(true)
    expect(mcp.isAllowedHostHeader('evil.com')).toBe(false)
    expect(mcp.isAllowedHostHeader('192.168.1.10:41317')).toBe(false)
    expect(mcp.isAllowedHostHeader(undefined)).toBe(false)
  })

  it('isAllowedOriginHeader 允许无 Origin 或本机 Origin', () => {
    expect(mcp.isAllowedOriginHeader(undefined)).toBe(true)
    expect(mcp.isAllowedOriginHeader('http://127.0.0.1:5173')).toBe(true)
    expect(mcp.isAllowedOriginHeader('http://localhost')).toBe(true)
    expect(mcp.isAllowedOriginHeader('https://evil.com')).toBe(false)
    expect(mcp.isAllowedOriginHeader('not-a-url')).toBe(false)
  })

  it('isAuthorizedRequest 校验 Bearer 令牌', () => {
    expect(mcp.isAuthorizedRequest({ authorization: 'Bearer abc' }, 'abc')).toBe(true)
    expect(mcp.isAuthorizedRequest({ authorization: 'bearer abc' }, 'abc')).toBe(true)
    expect(mcp.isAuthorizedRequest({ authorization: 'Bearer abd' }, 'abc')).toBe(false)
    expect(mcp.isAuthorizedRequest({}, 'abc')).toBe(false)
    expect(mcp.isAuthorizedRequest({ authorization: 'abc' }, 'abc')).toBe(false)
  })

  it('sanitizeRegisteredTools 过滤非法工具并截断超时', () => {
    const tools = mcp.sanitizeRegisteredTools([
      { name: 'good_tool', description: 'ok', inputSchema: { type: 'object' }, timeoutSeconds: 99999 },
      { name: 'Bad-Name', inputSchema: { type: 'object' } },
      { name: 'no_schema' },
      { name: 'good_tool', inputSchema: { type: 'object' } },
      'garbage',
      null,
    ])
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('good_tool')
    expect(tools[0].timeoutSeconds).toBe(900)
  })
})

describe('mcp-server HTTP 集成', () => {
  it('无令牌时返回 401', async () => {
    const response = await postMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(response.status).toBe(401)
  })

  it('错误令牌返回 401', async () => {
    const response = await postMcp(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      authHeaders('wrong-token'),
    )
    expect(response.status).toBe(401)
  })

  it('404 非 /mcp 路径', async () => {
    const config = mcp.getMcpConfig()
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/other`, {
      headers: authHeaders(config.token),
    })
    expect(response.status).toBe(404)
  })

  it('完成 initialize → tools/list → tools/call 全流程', async () => {
    const token = mcp.getMcpConfig().token
    const sessionId = await initializeSession(token)

    const list = await postMcp(
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      authHeaders(token, sessionId),
    )
    expect(list.status).toBe(200)
    const tools = (list.body as { result: { tools: Array<{ name: string }> } }).result.tools
    // 渲染进程未注册时至少包含内置状态工具
    expect(tools.map((tool) => tool.name)).toContain('get_server_status')

    const call = await postMcp(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_server_status', arguments: {} } },
      authHeaders(token, sessionId),
    )
    expect(call.status).toBe(200)
    const result = (call.body as { result: { content: Array<{ text: string }> } }).result
    const status = JSON.parse(result.content[0].text)
    expect(status.state).toBe('running')
    expect(status.port).toBe(TEST_PORT)

    const unknown = await postMcp(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'not_a_tool', arguments: {} } },
      authHeaders(token, sessionId),
    )
    expect(unknown.status).toBe(200)
    const unknownResult = (unknown.body as { result: { isError?: boolean } }).result
    expect(unknownResult.isError).toBe(true)
  })

  it('未知会话 id 返回 404', async () => {
    const token = mcp.getMcpConfig().token
    const response = await postMcp(
      { jsonrpc: '2.0', id: 5, method: 'tools/list', params: {} },
      authHeaders(token, 'non-existent-session'),
    )
    expect(response.status).toBe(404)
  })
})
