import { beforeEach, describe, expect, it } from 'vitest'
import { executeMcpTool, listMcpToolSchemas, registerMcpTools } from './registry'
import { textResult } from './types'

function makeTool(overrides: Partial<Parameters<typeof registerMcpTools>[0][number]> = {}) {
  return {
    name: 'demo_tool',
    description: 'demo',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        count: { type: 'integer' },
        mode: { type: 'string', enum: ['a', 'b'] },
      },
      required: ['keyword'],
    },
    handler: (args: Record<string, unknown>) => textResult({ echo: args }),
    ...overrides,
  }
}

beforeEach(() => {
  // 每个用例重新注册同名工具覆盖即可（registerMcpTools 覆盖式）
})

describe('mcp registry', () => {
  it('listMcpToolSchemas 输出不含 handler 的清单', () => {
    registerMcpTools([makeTool()])
    const schemas = listMcpToolSchemas()
    const schema = schemas.find((item) => item.name === 'demo_tool')
    expect(schema).toBeTruthy()
    expect(schema).not.toHaveProperty('handler')
    expect(schema!.inputSchema).toMatchObject({ type: 'object' })
  })

  it('执行工具并透传结果', async () => {
    registerMcpTools([makeTool()])
    const result = await executeMcpTool('demo_tool', { keyword: 'hello', count: 2 })
    expect(result.isError).toBeUndefined()
    const payload = JSON.parse((result.content[0] as { text: string }).text)
    expect(payload.echo).toEqual({ keyword: 'hello', count: 2 })
  })

  it('未知工具返回 isError', async () => {
    const result = await executeMcpTool('definitely_missing_tool', {})
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('未知工具')
  })

  it('缺少必填参数时返回校验错误', async () => {
    registerMcpTools([makeTool()])
    const result = await executeMcpTool('demo_tool', {})
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('keyword')
  })

  it('参数类型/枚举错误时返回校验错误', async () => {
    registerMcpTools([makeTool()])
    const wrongType = await executeMcpTool('demo_tool', { keyword: 'x', count: 'two' })
    expect(wrongType.isError).toBe(true)
    const wrongEnum = await executeMcpTool('demo_tool', { keyword: 'x', mode: 'c' })
    expect(wrongEnum.isError).toBe(true)
  })

  it('handler 抛异常时包装为 isError 而不是抛出', async () => {
    registerMcpTools([
      makeTool({
        name: 'boom_tool',
        inputSchema: { type: 'object', properties: {} },
        handler: () => {
          throw new Error('炸了')
        },
      }),
    ])
    const result = await executeMcpTool('boom_tool', {})
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('炸了')
  })
})
