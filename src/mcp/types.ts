// MCP 工具的基础类型与结果构造工具（渲染进程侧，纯类型/工具函数，无运行时依赖）

export type McpTextContent = { type: 'text'; text: string }
export type McpImageContent = { type: 'image'; data: string; mimeType: string }
export type McpContent = McpTextContent | McpImageContent

export type McpToolResult = {
  content: McpContent[]
  isError?: boolean
}

export type McpToolHandler = (args: Record<string, unknown>) => Promise<McpToolResult> | McpToolResult

export type McpToolDefinition = {
  /** 工具名，小写字母/数字/下划线，需全局唯一 */
  name: string
  /** 面向模型的中文描述，写清楚用途、副作用与注意事项 */
  description: string
  /** JSON Schema（draft-07 子集即可），渲染进程侧按此做基础校验 */
  inputSchema: Record<string, unknown>
  /** 执行超时（秒），默认 120；生成类长任务工具可设到 600 */
  timeoutSeconds?: number
  handler: McpToolHandler
}

/** 主进程 mcp-config.json 的形状（与 electron/mcp-server.ts 对齐） */
export type McpBridgeConfig = {
  enabled: boolean
  port: number
  token: string
}

export type McpBridgeStatus = {
  state: 'disabled' | 'running' | 'error'
  url: string | null
  port: number
  error: string | null
  rendererReady: boolean
  rendererToolCount: number
  activeSessions: number
}

export function textResult(data: unknown): McpToolResult {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
  }
}

export function errorResult(message: string): McpToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

export function imageResult(base64: string, mimeType: string, note?: string): McpToolResult {
  const content: McpContent[] = []
  if (note) content.push({ type: 'text', text: note })
  content.push({ type: 'image', data: base64, mimeType })
  return { content }
}

/** 从 dataUrl 拆出 base64 与 mimeType；非法输入返回 null */
export function splitDataUrl(dataUrl: string): { data: string; mimeType: string } | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match || !match[2]) return null
  return { data: match[3], mimeType: match[1] || 'image/png' }
}
