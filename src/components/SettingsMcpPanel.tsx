// 设置 - MCP 面板：桌面端 MCP 服务的开关、端口、令牌与客户端配置片段

import { useCallback, useEffect, useMemo, useState } from 'react'
import { copyTextToClipboard } from '../lib/clipboard'
import { isElectron } from '../lib/localSave'
import type { McpBridgeConfig, McpBridgeStatus } from '../mcp/types'
import { useStore } from '../store'

function buildClientConfigSnippet(port: number, token: string) {
  return JSON.stringify(
    {
      mcpServers: {
        doupao: {
          type: 'http',
          url: `http://127.0.0.1:${port}/mcp`,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  )
}

const inputClass =
  'w-full rounded-lg border border-gray-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] px-3 py-2 text-sm text-gray-800 dark:text-gray-200 outline-none focus:border-blue-400 dark:focus:border-blue-500 font-mono'

const buttonClass =
  'rounded-lg px-3 py-2 text-sm font-medium transition-colors bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-white/[0.06] dark:hover:bg-white/[0.1] dark:text-gray-200'

const primaryButtonClass =
  'rounded-lg px-3 py-2 text-sm font-medium transition-colors bg-blue-600 hover:bg-blue-500 text-white'

export function SettingsMcpPanel() {
  const showToast = useStore((state) => state.showToast)
  const electronReady = isElectron() && !!window.electronAPI?.mcpGetConfig
  const [config, setConfig] = useState<McpBridgeConfig | null>(null)
  const [status, setStatus] = useState<McpBridgeStatus | null>(null)
  const [portDraft, setPortDraft] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.mcpGetConfig || !api.mcpGetStatus) return
    const [nextConfig, nextStatus] = await Promise.all([api.mcpGetConfig(), api.mcpGetStatus()])
    setConfig(nextConfig)
    setStatus(nextStatus)
    setPortDraft((draft) => draft || String(nextConfig.port))
  }, [])

  useEffect(() => {
    if (!electronReady) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    return () => window.clearInterval(timer)
  }, [electronReady, refresh])

  const snippet = useMemo(
    () => (config ? buildClientConfigSnippet(config.port, config.token) : ''),
    [config],
  )

  const applyPatch = async (patch: { enabled?: boolean; port?: number; regenerateToken?: boolean }, successMessage: string) => {
    const api = window.electronAPI
    if (!api?.mcpUpdateConfig || busy) return
    setBusy(true)
    try {
      const result = await api.mcpUpdateConfig(patch)
      setConfig(result.config)
      setStatus(result.status)
      showToast(successMessage, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!electronReady) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 dark:border-white/[0.1] p-6 text-sm text-gray-500 dark:text-gray-400">
        MCP 服务仅在桌面端（Electron）可用。网页版无法开放本机端口，请使用桌面版体验通过对话操作软件。
      </div>
    )
  }

  const statusLabel = !config?.enabled
    ? { text: '已停用', className: 'text-gray-500 dark:text-gray-400' }
    : status?.state === 'running'
      ? { text: '运行中', className: 'text-emerald-600 dark:text-emerald-400' }
      : { text: `异常：${status?.error ?? '未知'}`, className: 'text-red-600 dark:text-red-400' }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200">MCP 服务（通过对话操作豆泡）</h3>
        <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
          开启后，豆泡会在本机 <span className="font-mono">127.0.0.1</span> 上运行一个 MCP 服务，把画廊、Agent 对话、SOP、下单、词库、日程等各板块能力暴露为工具。
          在 ZCode 等支持 MCP 的客户端中填入下方配置，即可让 AI 通过对话直接操作本软件。服务仅监听本机回环地址并要求令牌鉴权。
        </p>
      </div>

      <div className="rounded-xl border border-gray-100 dark:border-white/[0.08] bg-gray-50/60 dark:bg-white/[0.03] p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            服务状态：
            <span className={`font-medium ${statusLabel.className}`}>{statusLabel.text}</span>
            {status?.state === 'running' && status.url && (
              <span className="ml-2 font-mono text-xs text-gray-400 dark:text-gray-500">{status.url}</span>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 select-none">
            <input
              type="checkbox"
              className="h-4 w-4 accent-blue-600"
              checked={config?.enabled ?? false}
              disabled={busy || !config}
              onChange={(event) => void applyPatch({ enabled: event.target.checked }, event.target.checked ? 'MCP 服务已启用' : 'MCP 服务已停用')}
            />
            启用
          </label>
        </div>
        {status?.state === 'running' && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            已注册工具 {status.rendererToolCount} 个{status.rendererReady ? '' : '（渲染进程尚未就绪）'} · 活跃会话 {status.activeSessions} 个
          </div>
        )}
        {status?.error && <div className="text-xs text-red-600 dark:text-red-400">{status.error}</div>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">监听端口（1024-65535）</label>
          <div className="flex gap-2">
            <input
              className={inputClass}
              value={portDraft}
              disabled={busy || !config}
              onChange={(event) => setPortDraft(event.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
              placeholder="41317"
            />
            <button
              type="button"
              className={buttonClass}
              disabled={busy || !config || !portDraft || Number(portDraft) === config.port}
              onClick={() => {
                const port = Number(portDraft)
                if (port < 1024 || port > 65535) {
                  showToast('端口需在 1024-65535 之间', 'error')
                  return
                }
                void applyPatch({ port }, '端口已更新，服务已重启')
              }}
            >
              保存
            </button>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">访问令牌（Authorization: Bearer）</label>
          <div className="flex gap-2">
            <input
              className={inputClass}
              readOnly
              value={config ? (showToken ? config.token : '•'.repeat(24)) : ''}
              onFocus={(event) => event.target.select()}
            />
            <button type="button" className={buttonClass} disabled={!config} onClick={() => setShowToken((value) => !value)}>
              {showToken ? '隐藏' : '显示'}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy || !config}
              onClick={() => void applyPatch({ regenerateToken: true }, '令牌已重新生成，请更新客户端配置')}
            >
              重置
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">客户端配置片段（粘贴到 ZCode 的 MCP 配置中）</label>
          <button
            type="button"
            className={primaryButtonClass}
            disabled={!config}
            onClick={async () => {
              const ok = await copyTextToClipboard(snippet).then(() => true).catch(() => false)
              showToast(ok ? '配置已复制，粘贴到 ZCode MCP 配置即可' : '复制失败，请手动选择文本复制', ok ? 'success' : 'error')
            }}
          >
            复制配置
          </button>
        </div>
        <pre className="max-h-56 overflow-auto rounded-xl border border-gray-100 dark:border-white/[0.08] bg-gray-900 p-3 text-xs leading-5 text-gray-100 dark:bg-black/40 select-all">{snippet}</pre>
        <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
          修改端口或重置令牌后服务会自动重启，需同步更新客户端配置。若提示端口被占用，请更换端口。生图、删任务等操作类工具调用前，客户端仍会逐次向你确认。
        </p>
      </div>
    </div>
  )
}
