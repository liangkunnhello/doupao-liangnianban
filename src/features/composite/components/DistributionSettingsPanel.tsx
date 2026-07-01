import { useCompositeV2Store } from '../storeV2'
import { useEffect } from 'react'
import type { CompositeV2DistributionConfig } from '../lib/compositeV2Types'

export function DistributionSettingsPanel() {
  const config = useCompositeV2Store((state) => state.distributionConfig)
  const setConfig = useCompositeV2Store((state) => state.setDistributionConfig)

  // 当组件挂载时，如果本会话还未初始化过日期，或者起始日期为空，则自动填充当前日期
  useEffect(() => {
    if (config) {
      const hasInited = sessionStorage.getItem('doupao_distribution_date_inited')
      if (!hasInited || !config.startDate) {
        sessionStorage.setItem('doupao_distribution_date_inited', '1')
        setConfig({ startDate: new Date().toISOString().slice(0, 10).replace(/-/g, '') })
      }
    }
  }, [config?.startDate, setConfig])

  if (!config) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">分配设置</h3>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => setConfig({ enabled: e.target.checked })}
            />
            <span className="text-xs">自动分配</span>
          </label>
        </div>
        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">导出后将文件按规则移至分配地址。</p>
      </div>

      <div className={`flex flex-col gap-3 overflow-y-auto ${!config.enabled ? 'opacity-50 grayscale pointer-events-none' : ''}`}>
        <label className="block text-xs text-gray-500 dark:text-gray-400">
          起始日期 <span className="text-red-500">*</span>
          <input
            type="text"
            placeholder="YYYYMMDD (必填，例如 20260701)"
            value={config.startDate}
            onChange={(e) => setConfig({ startDate: e.target.value })}
            className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100"
          />
        </label>
        
        <label className="block text-xs text-gray-500 dark:text-gray-400">
          份数（天数）
          <input
            type="number"
            min={1}
            value={config.days}
            onChange={(e) => setConfig({ days: Math.max(1, Number(e.target.value)) })}
            className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100"
          />
        </label>

        <label className="block text-xs text-gray-500 dark:text-gray-400">
          传输模式
          <select
            value={config.mode}
            onChange={(e) => setConfig({ mode: e.target.value as 'copy' | 'move' })}
            className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="copy">复制</option>
            <option value="move">移动</option>
          </select>
        </label>

        <div className="flex flex-col justify-center space-y-2 pt-2 pb-2">
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={config.randomize}
              onChange={(e) => setConfig({ randomize: e.target.checked })}
            />
            <span>随机打乱分配</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={config.skipWeekends}
              onChange={(e) => setConfig({ skipWeekends: e.target.checked })}
            />
            <span>跳过周末</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={config.modifyMd5}
              onChange={(e) => setConfig({ modifyMd5: e.target.checked })}
            />
            <span>修改文件MD5</span>
          </label>
        </div>
        
        <label className="block text-xs text-gray-500 dark:text-gray-400">
          文件重命名模式
          <select
            value={config.renameMode}
            onChange={(e) => setConfig({ renameMode: e.target.value as 'date' | 'sequence' })}
            className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100"
          >
            <option value="date">保留原名并替换日期</option>
            <option value="sequence">使用文件夹名 + 序号</option>
          </select>
        </label>
      </div>
    </div>
  )
}