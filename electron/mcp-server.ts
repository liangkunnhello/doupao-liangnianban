import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server as NodeHttpServer, type ServerResponse } from 'node:http'
import path from 'node:path'
import { app, ipcMain, type BrowserWindow, type WebContents } from 'electron'
import { Server as McpProtocolServer } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js'

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

export type McpConfig = {
  enabled: boolean
  port: number
  token: string
}

export type McpServerStatus = {
  state: 'disabled' | 'running' | 'error'
  url: string | null
  port: number
  error: string | null
  rendererReady: boolean
  rendererToolCount: number
  activeSessions: number
}

export const MCP_DEFAULT_PORT = 41317
export const MCP_MAX_PORT = 65535
export const MCP_MIN_PORT = 1024
const MAX_BODY_BYTES = 32 * 1024 * 1024
const DEFAULT_TOOL_TIMEOUT_SECONDS = 120
const MAX_TOOL_TIMEOUT_SECONDS = 900

function generateToken() {
  return randomBytes(24).toString('hex')
}

export function normalizeMcpConfig(value: unknown): McpConfig {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const port = typeof input.port === 'number' && Number.isInteger(input.port) ? input.port : MCP_DEFAULT_PORT
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
    port: Math.min(Math.max(port, MCP_MIN_PORT), MCP_MAX_PORT),
    token: typeof input.token === 'string' && input.token.length >= 16 ? input.token : generateToken(),
  }
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'mcp-config.json')
}

function loadMcpConfig(): McpConfig {
  try {
    if (existsSync(getConfigPath())) {
      const parsed = JSON.parse(readFileSync(getConfigPath(), 'utf-8'))
      return normalizeMcpConfig(parsed)
    }
  } catch (error) {
    console.error('[mcp] 读取配置失败，使用默认配置', error)
  }
  const config = normalizeMcpConfig(null)
  persistMcpConfig(config)
  return config
}

function persistMcpConfig(config: McpConfig) {
  try {
    mkdirSync(path.dirname(getConfigPath()), { recursive: true })
    writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
  } catch (error) {
    console.error('[mcp] 写入配置失败', error)
  }
}

// ---------------------------------------------------------------------------
// 鉴权与请求校验（纯函数，便于测试）
// ---------------------------------------------------------------------------

export function isAllowedHostHeader(host: unknown): boolean {
  if (typeof host !== 'string' || !host) return false
  const trimmed = host.trim().toLowerCase()
  // IPv6 字面量形如 [::1]:41317
  const hostname = trimmed.startsWith('[')
    ? trimmed.slice(1, trimmed.indexOf(']'))
    : trimmed.split(':')[0]
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
}

export function isAllowedOriginHeader(origin: unknown): boolean {
  // 无 Origin（Node 客户端）直接放行；有 Origin 必须来自本机页面，防 DNS rebinding
  if (origin === undefined || origin === null) return true
  if (typeof origin !== 'string') return false
  try {
    const url = new URL(origin)
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
  } catch {
    return false
  }
}

export function isAuthorizedRequest(headers: IncomingMessage['headers'], token: string): boolean {
  const value = headers.authorization
  if (typeof value !== 'string') return false
  const match = /^Bearer\s+(.+)$/i.exec(value.trim())
  return !!match && match[1] === token
}

// ---------------------------------------------------------------------------
// 渲染进程工具注册与调用路由
// ---------------------------------------------------------------------------

export type RegisteredMcpTool = {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  timeoutSeconds?: number
}

type ToolCallResultPayload = {
  content?: unknown
  isError?: unknown
  [key: string]: unknown
}

type PendingToolCall = {
  resolve: (value: ToolCallResultPayload) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

let rendererTools: RegisteredMcpTool[] = []
let rendererToolsSender: WebContents | null = null
const pendingToolCalls = new Map<string, PendingToolCall>()

export function sanitizeRegisteredTools(value: unknown): RegisteredMcpTool[] {
  if (!Array.isArray(value)) return []
  const tools: RegisteredMcpTool[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    if (typeof raw.name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(raw.name)) continue
    if (seen.has(raw.name)) continue
    if (!raw.inputSchema || typeof raw.inputSchema !== 'object') continue
    seen.add(raw.name)
    tools.push({
      name: raw.name,
      description: typeof raw.description === 'string' ? raw.description.slice(0, 2048) : undefined,
      inputSchema: raw.inputSchema as Record<string, unknown>,
      timeoutSeconds:
        typeof raw.timeoutSeconds === 'number' && Number.isFinite(raw.timeoutSeconds)
          ? Math.min(Math.max(Math.round(raw.timeoutSeconds), 5), MAX_TOOL_TIMEOUT_SECONDS)
          : undefined,
    })
  }
  return tools
}

function clearRendererTools(sender?: WebContents) {
  if (sender && rendererToolsSender && sender.id !== rendererToolsSender.id) return
  rendererTools = []
  rendererToolsSender = null
}

function rejectAllPendingToolCalls(reason: string) {
  for (const [, pending] of pendingToolCalls) {
    clearTimeout(pending.timer)
    pending.reject(new Error(reason))
  }
  pendingToolCalls.clear()
}

/** 渲染进程崩溃 / 重载时由 main.ts 调用：拒绝 pending 调用并要求重新注册工具 */
export function mcpNotifyRendererGone() {
  clearRendererTools()
  rejectAllPendingToolCalls('应用界面已重载，请重试')
}

function normalizeToolCallResult(value: unknown): ToolCallResultPayload {
  if (value && typeof value === 'object' && Array.isArray((value as ToolCallResultPayload).content)) {
    return value as ToolCallResultPayload
  }
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value ?? null) }],
  }
}

let getMainWindow: () => BrowserWindow | null = () => null

function callRendererTool(name: string, args: unknown): Promise<ToolCallResultPayload> {
  const tool = rendererTools.find((item) => item.name === name)
  if (!tool) {
    return Promise.reject(new Error(`未知工具：${name}。可用工具请通过 tools/list 查询。`))
  }
  const win = getMainWindow()
  if (!win || win.isDestroyed() || !rendererToolsSender || rendererToolsSender.isDestroyed()) {
    return Promise.reject(new Error('豆泡应用尚未完成初始化，请稍后再试'))
  }
  const id = randomUUID()
  const timeoutMs = (tool.timeoutSeconds ?? DEFAULT_TOOL_TIMEOUT_SECONDS) * 1000
  return new Promise<ToolCallResultPayload>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingToolCalls.delete(id)
      reject(new Error(`工具 ${name} 执行超时（${timeoutMs / 1000}s）`))
    }, timeoutMs)
    pendingToolCalls.set(id, { resolve, reject, timer })
    rendererToolsSender!.send('mcp:tool-call', { id, name, args: args ?? {} })
  })
}

// ---------------------------------------------------------------------------
// MCP 协议服务器（每个会话一个实例）
// ---------------------------------------------------------------------------

const SERVER_STATUS_TOOL_NAME = 'get_server_status'

function buildServerStatus(): McpServerStatus {
  return {
    state: httpServer ? 'running' : config.enabled ? (serverError ? 'error' : 'disabled') : 'disabled',
    url: httpServer ? `http://127.0.0.1:${config.port}/mcp` : null,
    port: config.port,
    error: serverError,
    rendererReady: rendererTools.length > 0,
    rendererToolCount: rendererTools.length,
    activeSessions: sessions.size,
  }
}

function createMcpProtocolServer(): McpProtocolServer {
  const server = new McpProtocolServer(
    { name: 'doupao-liangnianban', version: app.getVersion() },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: SERVER_STATUS_TOOL_NAME,
        description:
          '查看豆泡两年半 MCP 服务状态：服务地址、渲染进程是否已注册业务工具、已注册工具数量、活跃会话数。当业务工具尚未就绪时可先调用本工具确认。',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      ...rendererTools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema,
      })),
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    if (name === SERVER_STATUS_TOOL_NAME) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(buildServerStatus(), null, 2) }],
      }
    }
    try {
      const result = normalizeToolCallResult(await callRendererTool(name, args ?? {}))
      return result as never
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      }
    }
  })

  return server
}

// ---------------------------------------------------------------------------
// HTTP 服务（Streamable HTTP transport，有状态会话）
// ---------------------------------------------------------------------------

type McpSession = {
  server: McpProtocolServer
  transport: StreamableHTTPServerTransport
}

const sessions = new Map<string, McpSession>()
let httpServer: NodeHttpServer | null = null
let serverError: string | null = null
let config: McpConfig = { enabled: false, port: MCP_DEFAULT_PORT, token: '' }

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(text)
}

function readRequestBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')))
      } catch {
        reject(new Error('请求体不是合法的 JSON'))
      }
    })
    req.on('error', reject)
  })
}

async function closeSession(sessionId: string) {
  const session = sessions.get(sessionId)
  if (!session) return
  sessions.delete(sessionId)
  try {
    await session.transport.close()
  } catch {
    // ignore
  }
  try {
    await session.server.close()
  } catch {
    // ignore
  }
}

async function handleMcpPost(req: IncomingMessage, res: ServerResponse, body: unknown) {
  const sessionId = req.headers['mcp-session-id']
  if (typeof sessionId === 'string' && sessionId) {
    const session = sessions.get(sessionId)
    if (!session) {
      sendJson(res, 404, { jsonrpc: '2.0', error: { code: -32000, message: '会话不存在或已过期' }, id: null })
      return
    }
    await session.transport.handleRequest(req, res, body)
    return
  }

  if (!isInitializeRequest(body)) {
    sendJson(res, 400, {
      jsonrpc: '2.0',
      error: { code: -32000, message: '缺少会话：请先发送 initialize 请求' },
      id: null,
    })
    return
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (newSessionId) => {
      sessions.set(newSessionId, { server, transport })
    },
  })
  const server = createMcpProtocolServer()
  transport.onclose = () => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId)
    }
    server.close().catch(() => {})
  }
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/mcp') {
      sendJson(res, 404, { error: 'Not Found' })
      return
    }
    if (!isAllowedHostHeader(req.headers.host) || !isAllowedOriginHeader(req.headers.origin)) {
      sendJson(res, 403, { error: 'Forbidden' })
      return
    }
    if (!isAuthorizedRequest(req.headers, config.token)) {
      sendJson(res, 401, { error: 'Unauthorized：请在请求头携带 Authorization: Bearer <token>' })
      return
    }

    if (req.method === 'POST') {
      const body = await readRequestBody(req)
      await handleMcpPost(req, res, body)
      return
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id']
      const session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined
      if (!session) {
        sendJson(res, 400, { error: '缺少或未知的 mcp-session-id' })
        return
      }
      await session.transport.handleRequest(req, res)
      return
    }

    sendJson(res, 405, { error: 'Method Not Allowed' })
  } catch (error) {
    console.error('[mcp] 请求处理失败', error)
    if (!res.headersSent) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    } else {
      res.end()
    }
  }
}

async function startHttpServer(): Promise<void> {
  await stopHttpServer()
  serverError = null
  await new Promise<void>((resolve) => {
    const server = createServer((req, res) => {
      void handleRequest(req, res)
    })
    server.on('error', (error: NodeJS.ErrnoException) => {
      serverError = error.code === 'EADDRINUSE' ? `端口 ${config.port} 已被占用` : error.message
      console.error('[mcp] 服务启动失败:', serverError)
      httpServer = null
      resolve()
    })
    server.listen(config.port, '127.0.0.1', () => {
      httpServer = server
      console.log(`[mcp] 豆泡 MCP 服务已启动: http://127.0.0.1:${config.port}/mcp`)
      resolve()
    })
  })
}

async function stopHttpServer(): Promise<void> {
  for (const sessionId of Array.from(sessions.keys())) {
    await closeSession(sessionId)
  }
  if (httpServer) {
    const server = httpServer
    httpServer = null
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------

export function getMcpServerStatus(): McpServerStatus {
  return buildServerStatus()
}

export function getMcpConfig(): McpConfig {
  return { ...config }
}

export async function updateMcpConfig(patch: {
  enabled?: boolean
  port?: number
  regenerateToken?: boolean
}): Promise<{ config: McpConfig; status: McpServerStatus }> {
  const next: McpConfig = normalizeMcpConfig({
    ...config,
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : config.enabled,
    port: typeof patch.port === 'number' ? patch.port : config.port,
    token: patch.regenerateToken ? generateToken() : config.token,
  })
  config = next
  persistMcpConfig(config)
  if (config.enabled) {
    await startHttpServer()
  } else {
    await stopHttpServer()
  }
  return { config: getMcpConfig(), status: getMcpServerStatus() }
}

export async function initMcpServer(options: { getMainWindow: () => BrowserWindow | null }): Promise<void> {
  getMainWindow = options.getMainWindow
  config = loadMcpConfig()

  ipcMain.on('mcp:register-tools', (event, tools) => {
    if (rendererToolsSender && !rendererToolsSender.isDestroyed() && rendererToolsSender.id !== event.sender.id) {
      clearRendererTools()
    }
    rendererTools = sanitizeRegisteredTools(tools)
    rendererToolsSender = event.sender
    event.sender.once('destroyed', () => {
      clearRendererTools(event.sender)
      rejectAllPendingToolCalls('应用界面已关闭')
    })
    console.log(`[mcp] 渲染进程已注册 ${rendererTools.length} 个工具`)
  })

  ipcMain.on('mcp:tool-result', (event, payload) => {
    if (!payload || typeof payload !== 'object') return
    const { id, result, error } = payload as { id?: unknown; result?: unknown; error?: unknown }
    if (typeof id !== 'string') return
    const pending = pendingToolCalls.get(id)
    if (!pending) return
    pendingToolCalls.delete(id)
    clearTimeout(pending.timer)
    if (typeof error === 'string' && error) {
      pending.reject(new Error(error))
    } else {
      pending.resolve(normalizeToolCallResult(result))
    }
  })

  ipcMain.handle('mcp:get-config', () => getMcpConfig())
  ipcMain.handle('mcp:get-status', () => getMcpServerStatus())
  ipcMain.handle('mcp:update-config', async (_event, patch) => {
    const input = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>
    return updateMcpConfig({
      enabled: typeof input.enabled === 'boolean' ? input.enabled : undefined,
      port: typeof input.port === 'number' ? input.port : undefined,
      regenerateToken: input.regenerateToken === true,
    })
  })

  app.on('will-quit', () => {
    void stopHttpServer()
  })

  if (config.enabled) {
    await startHttpServer()
  }
}
