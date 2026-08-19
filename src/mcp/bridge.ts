// MCP 桥接：把渲染进程的 zustand stores / 业务能力暴露给主进程的 MCP 服务
// 仅在 Electron 桌面端生效；网页版无 preload 能力，自动跳过。

import { isElectron } from '../lib/localSave'
import { executeMcpTool, getMcpToolCount, listMcpToolSchemas } from './registry'
import { registerAllMcpTools } from './tools'

let initialized = false

export function initMcpBridge() {
  if (initialized) return
  if (!isElectron()) return
  const api = window.electronAPI
  if (!api?.mcpRegisterTools || !api.onMcpToolCall || !api.mcpRespondToolCall) return
  initialized = true

  registerAllMcpTools()
  api.mcpRegisterTools(listMcpToolSchemas())
  console.log(`[mcp] 已向主进程注册 ${getMcpToolCount()} 个工具`)

  api.onMcpToolCall(({ id, name, args }) => {
    void executeMcpTool(name, args ?? {}).then(
      (result) => api.mcpRespondToolCall?.(id, { result }),
      (error) => api.mcpRespondToolCall?.(id, { error: error instanceof Error ? error.message : String(error) }),
    )
  })
}
