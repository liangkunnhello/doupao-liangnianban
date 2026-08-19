// 设置板块工具（API Key 一律打码，绝不外泄完整密钥）

import { useStore } from '../../store'
import { normalizeSettings } from '../../lib/apiProfiles'
import type { ApiProfile } from '../../types'
import { errorResult, textResult, type McpToolDefinition } from '../types'

export function maskApiKey(apiKey: string | undefined | null): string {
  if (!apiKey) return ''
  const trimmed = apiKey.trim()
  if (!trimmed) return ''
  return `${trimmed.slice(0, 3)}***（已隐藏，共 ${trimmed.length} 字符）`
}

/** 深拷贝并打码所有 apiKey 字段 */
export function maskSecretsDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => maskSecretsDeep(item)) as T
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = key === 'apiKey' && typeof item === 'string' ? maskApiKey(item) : maskSecretsDeep(item)
    }
    return result as T
  }
  return value
}

function serializeProfile(profile: ApiProfile, activeProfileId: string | null | undefined, agentProfileId: string | null | undefined) {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    model: profile.model,
    apiMode: profile.apiMode,
    codexCli: !!profile.codexCli,
    apiProxy: !!profile.apiProxy,
    apiKey: maskApiKey(profile.apiKey),
    isActive: profile.id === activeProfileId,
    isAgentProfile: profile.id === agentProfileId,
  }
}

export const settingsTools: McpToolDefinition[] = [
  {
    name: 'settings_get',
    description: '查看应用设置（主题、API 配置列表、Agent 配置、自定义服务商、习惯配置等）。所有 API Key 均已打码。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const settings = normalizeSettings(useStore.getState().settings)
      return textResult(maskSecretsDeep(settings))
    },
  },
  {
    name: 'profiles_list',
    description: '列出 API 配置（服务商、Base URL、模型、模式、是否当前/Agent 配置；Key 已打码）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const settings = normalizeSettings(useStore.getState().settings)
      return textResult({
        activeProfileId: settings.activeProfileId,
        agentProfileId: settings.agentProfileId,
        profiles: settings.profiles.map((profile) => serializeProfile(profile, settings.activeProfileId, settings.agentProfileId)),
        customProviders: settings.customProviders.map((provider) => ({ id: provider.id, name: provider.name })),
      })
    },
  },
  {
    name: 'profile_switch',
    description: '切换当前使用的 API 配置（影响后续生图任务使用的服务商/模型/Key）。',
    inputSchema: {
      type: 'object',
      properties: { profileId: { type: 'string', description: 'API 配置 id（见 profiles_list）' } },
      required: ['profileId'],
      additionalProperties: false,
    },
    handler: (args) => {
      const state = useStore.getState()
      const settings = normalizeSettings(state.settings)
      const profile = settings.profiles.find((item) => item.id === args.profileId)
      if (!profile) return errorResult(`API 配置 ${args.profileId} 不存在`)
      state.setSettings({ activeProfileId: profile.id })
      return textResult(`已切换当前 API 配置为「${profile.name}」（${profile.provider} / ${profile.model}）`)
    },
  },
]
