// 汇总注册全部板块的 MCP 工具

import { registerMcpTools } from '../registry'
import { appTools } from './app'
import { galleryTools } from './gallery'
import { favoritesTools, workspaceTabTools } from './favorites'
import { agentTools } from './agent'
import { strategyTools } from './strategy'
import { orderingTools } from './ordering'
import { compositeTools } from './composite'
import { wordLibraryTools } from './wordLibrary'
import { scheduleTools } from './schedule'
import { settingsTools } from './settings'
import { assistantTools } from './assistant'
import { backupTools } from './backup'

let registered = false

export function registerAllMcpTools() {
  if (registered) return
  registered = true
  registerMcpTools([
    ...appTools,
    ...galleryTools,
    ...favoritesTools,
    ...workspaceTabTools,
    ...agentTools,
    ...strategyTools,
    ...orderingTools,
    ...compositeTools,
    ...wordLibraryTools,
    ...scheduleTools,
    ...settingsTools,
    ...assistantTools,
    ...backupTools,
  ])
}
