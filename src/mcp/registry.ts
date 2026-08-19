// MCP 工具注册表：聚合各板块工具、基础参数校验、统一异常包装

import type { McpToolDefinition, McpToolResult } from './types'
import { errorResult } from './types'

const tools = new Map<string, McpToolDefinition>()

export function registerMcpTools(definitions: McpToolDefinition[]) {
  for (const definition of definitions) {
    if (tools.has(definition.name)) {
      console.warn(`[mcp] 工具名重复，已覆盖: ${definition.name}`)
    }
    tools.set(definition.name, definition)
  }
}

export function getMcpTool(name: string): McpToolDefinition | undefined {
  return tools.get(name)
}

export function getMcpToolCount(): number {
  return tools.size
}

/** 上报给主进程的工具清单（JSON Schema 描述，不含 handler） */
export function listMcpToolSchemas() {
  return Array.from(tools.values()).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.timeoutSeconds !== undefined ? { timeoutSeconds: tool.timeoutSeconds } : {}),
  }))
}

function validateArgs(schema: Record<string, unknown>, args: Record<string, unknown>): string | null {
  const required = Array.isArray(schema.required) ? (schema.required as unknown[]) : []
  for (const key of required) {
    if (typeof key === 'string' && (args[key] === undefined || args[key] === null)) {
      return `缺少必填参数: ${key}`
    }
  }
  const properties = (schema.properties ?? {}) as Record<string, { type?: string | string[]; enum?: unknown[] }>
  for (const [key, value] of Object.entries(args)) {
    const prop = properties[key]
    if (!prop || value === undefined || value === null) continue
    const expected = prop.type
    if (expected) {
      const types = Array.isArray(expected) ? expected : [expected]
      const actual = Array.isArray(value) ? 'array' : typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value
      const matches = types.some((type) =>
        type === actual || (type === 'number' && actual === 'integer'),
      )
      if (!matches) return `参数 ${key} 类型错误：期望 ${types.join('|')}，实际 ${actual}`
    }
    if (prop.enum && !prop.enum.includes(value)) {
      return `参数 ${key} 取值非法：期望 ${prop.enum.map(String).join('|')} 之一`
    }
  }
  return null
}

export async function executeMcpTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  const tool = tools.get(name)
  if (!tool) return errorResult(`未知工具: ${name}`)
  try {
    const validationError = validateArgs(tool.inputSchema, args ?? {})
    if (validationError) return errorResult(validationError)
    return await tool.handler(args ?? {})
  } catch (error) {
    console.error(`[mcp] 工具 ${name} 执行失败`, error)
    return errorResult(error instanceof Error ? error.message : String(error))
  }
}
