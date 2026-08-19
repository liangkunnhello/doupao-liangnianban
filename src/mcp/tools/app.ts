// 通用工具：应用状态总览、界面导航

import { useStore, type SettingsTab } from '../../store'
import { useRequirementPrototype } from '../../features/requirementPrototype/store'
import { useCompositeV2Store } from '../../features/composite/storeV2'
import { isElectron } from '../../lib/localSave'
import type { AppMode } from '../../types'
import { textResult, type McpToolDefinition } from '../types'
import { getMcpToolCount } from '../registry'

const APP_MODES: AppMode[] = ['gallery', 'strategy', 'ordering', 'agent', 'postprocess']
const SETTINGS_TABS: SettingsTab[] = ['api', 'general', 'agent', 'data', 'backup', 'mcp', 'about']

export const appTools: McpToolDefinition[] = [
  {
    name: 'get_app_status',
    description:
      '获取豆泡两年半的整体状态：应用版本、当前所在板块、各板块数据量（任务/对话/SOP/订单/词库/收藏夹/合成预设等）、MCP 注册工具数。适合会话开始时了解应用概况。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const state = useStore.getState()
      const requirement = useRequirementPrototype.getState()
      const composite = useCompositeV2Store.getState()
      let version: string | null = null
      if (isElectron()) {
        version = await window.electronAPI?.getAppVersion().catch(() => null) ?? null
      }
      return textResult({
        version,
        appMode: state.appMode,
        mcpToolCount: getMcpToolCount(),
        gallery: {
          tasks: state.tasks.length,
          running: state.tasks.filter((task) => task.status === 'running').length,
          failed: state.tasks.filter((task) => task.status === 'error').length,
          favorites: state.tasks.filter((task) => task.isFavorite).length,
          favoriteCollections: state.favoriteCollections.length,
          workspaceTabs: state.workspaceTabs.length,
        },
        agent: { conversations: state.agentConversations.length },
        strategy: {
          strategyAssets: requirement.strategyAssets.length,
          sopItems: requirement.sopLibrary.length,
          sopGroups: requirement.sopGroups.length,
          sopMetaInstructions: requirement.sopMetaInstructions.length,
        },
        ordering: { orders: requirement.orders.length },
        composite: { presets: composite.presets.length },
        wordLibrary: {
          groups: state.wordLibraryGroups.length,
          entries: state.wordLibraryEntries.length,
        },
        schedule: {
          rows: state.schedule.rows.length,
          items: state.schedule.items.length,
          runningWeeks: state.schedule.runningWeekStarts.length,
        },
        settings: {
          profiles: state.settings.profiles.length,
          activeProfileId: state.settings.activeProfileId,
          customProviders: state.settings.customProviders.length,
        },
      })
    },
  },
  {
    name: 'navigate',
    description:
      '切换豆泡两年半的界面：切换到指定板块（gallery 画廊 / agent 对话 / strategy 策略 / ordering 下单 / postprocess 后期处理），或打开设置（可指定页签）、日程面板、词库侧栏。仅影响界面展示，不改变数据。',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: [...APP_MODES, 'settings', 'schedule', 'wordLibrary'],
          description: '要打开的板块或面板',
        },
        settingsTab: {
          type: 'string',
          enum: SETTINGS_TABS,
          description: 'target=settings 时要打开的页签，默认 api',
        },
      },
      required: ['target'],
      additionalProperties: false,
    },
    handler: (args) => {
      const state = useStore.getState()
      const target = args.target as string
      if ((APP_MODES as string[]).includes(target)) {
        state.setAppMode(target as AppMode)
        return textResult(`已切换到板块：${target}`)
      }
      if (target === 'settings') {
        const tab = (args.settingsTab as SettingsTab | undefined) ?? 'api'
        state.setShowSettings(true, tab)
        return textResult(`已打开设置页签：${tab}`)
      }
      if (target === 'schedule') {
        state.setScheduleModalOpen(true)
        return textResult('已打开日程面板')
      }
      if (target === 'wordLibrary') {
        state.setWordLibrarySidebarOpen(true)
        return textResult('已打开词库侧栏')
      }
      return textResult(`未知目标：${target}`)
    },
  },
]
