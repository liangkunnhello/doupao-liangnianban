import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { useVersionCheck } from '../hooks/useVersionCheck'
import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import {
  formatGenerationStatsDuration,
  getGenerationStats,
  getGenerationStatsRangeLabel,
  getNextGenerationStatsRange,
  type GenerationStatsRange,
  type GenerationStatsTabCount,
} from '../lib/generationStats'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import { useFavoriteCollectionTitle } from './FavoriteCollections'
import { HelpCircleIcon, MoonIcon, SettingsIcon, SunIcon } from './icons'

type GenerationStatsMetricKey = 'total' | 'elapsedMs' | 'success' | 'failure'

function formatGenerationStatsValue(key: GenerationStatsMetricKey, value: number) {
  if (key === 'elapsedMs') return formatGenerationStatsDuration(value)
  return String(value)
}

function getGenerationStatsMetricValueClass(key: GenerationStatsMetricKey) {
  if (key === 'total') return 'text-blue-600 dark:text-blue-400'
  if (key === 'elapsedMs') return 'text-gray-950 dark:text-white'
  if (key === 'success') return 'text-green-600 dark:text-green-400'
  return 'text-red-600 dark:text-red-400'
}

function getGenerationStatsMetricLabel(key: GenerationStatsMetricKey) {
  if (key === 'total') return '总数'
  if (key === 'elapsedMs') return '时长'
  if (key === 'success') return '成功'
  return '失败'
}

function GenerationStatsMetric({
  metricKey,
  value,
  tabs,
}: {
  metricKey: GenerationStatsMetricKey
  value: number
  tabs: GenerationStatsTabCount[]
}) {
  const tooltip = useTooltip()
  const label = getGenerationStatsMetricLabel(metricKey)

  return (
    <div
      className="relative"
      {...tooltip.handlers}
    >
      <div className="flex min-w-[3.5rem] flex-col items-start rounded-md px-2 py-1 transition-colors hover:bg-white/70 dark:hover:bg-white/[0.06]">
        <span className="text-[10px] leading-none text-gray-400 dark:text-gray-500">{label}</span>
        <span className={`mt-0.5 text-xs font-semibold leading-none ${getGenerationStatsMetricValueClass(metricKey)}`}>
          {formatGenerationStatsValue(metricKey, value)}
        </span>
      </div>
      <ViewportTooltip visible={tooltip.visible} className="w-56">
        <div className="space-y-1.5">
          <div className="font-medium text-gray-700 dark:text-gray-200">按标签统计：{label}</div>
          {tabs.length ? (
            <div className="space-y-1">
              {tabs.map((tab) => (
                <div key={tab.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-gray-500 dark:text-gray-400">{tab.name}</span>
                  <span className="shrink-0 font-mono text-gray-800 dark:text-gray-100">
                    {formatGenerationStatsValue(metricKey, tab[metricKey])}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-500 dark:text-gray-400">暂无标签数据</div>
          )}
        </div>
      </ViewportTooltip>
    </div>
  )
}

function GenerationStatsBar() {
  const tasks = useStore((s) => s.tasks)
  const workspaceTabs = useStore((s) => s.workspaceTabs)
  const [range, setRange] = useState<GenerationStatsRange>('today')
  const [now, setNow] = useState(Date.now())
  const hasRunningTasks = tasks.some((task) => task.status === 'running' || task.falRecoverable || task.customRecoverable)

  useEffect(() => {
    if (!hasRunningTasks) {
      setNow(Date.now())
      return
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hasRunningTasks])

  const stats = useMemo(() => getGenerationStats(tasks, workspaceTabs, range, now), [tasks, workspaceTabs, range, now])
  const metrics: Array<{ key: GenerationStatsMetricKey; value: number }> = [
    { key: 'total', value: stats.totals.total },
    { key: 'elapsedMs', value: stats.totals.elapsedMs },
    { key: 'success', value: stats.totals.success },
    { key: 'failure', value: stats.totals.failure },
  ]

  return (
    <div className="hidden lg:flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-100/70 p-1 text-xs dark:border-white/[0.08] dark:bg-white/[0.04]">
      <div className="flex items-center divide-x divide-gray-200 dark:divide-white/[0.08]">
        {metrics.map((metric) => (
          <GenerationStatsMetric
            key={metric.key}
            metricKey={metric.key}
            value={metric.value}
            tabs={stats.byTab}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => setRange((current) => getNextGenerationStatsRange(current))}
        className="ml-1 min-w-[3rem] rounded-lg bg-white/80 px-2.5 py-1.5 text-[11px] font-medium leading-none text-gray-700 shadow-sm transition-colors hover:bg-white hover:text-gray-950 dark:bg-white/[0.08] dark:text-gray-100 dark:hover:bg-white/[0.14] dark:hover:text-white"
        title="切换统计范围"
      >
        {getGenerationStatsRangeLabel(range)}
      </button>
    </div>
  )
}

export default function Header() {
  const appMode = useStore((s) => s.appMode)
  const setAppMode = useStore((s) => s.setAppMode)
  const themeMode = useStore((s) => s.settings.themeMode)
  const setSettings = useStore((s) => s.setSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const agentMobileHeaderVisible = useStore((s) => s.agentMobileHeaderVisible)
  const setAgentMobileHeaderVisible = useStore((s) => s.setAgentMobileHeaderVisible)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const favoriteCollectionTitle = useFavoriteCollectionTitle()
  const showFavoriteCollectionTitle = appMode === 'gallery' && Boolean(activeFavoriteCollectionId)
  const { hasUpdate, latestRelease, dismiss } = useVersionCheck()
  const [showHelp, setShowHelp] = useState(false)
  const [hintVisible, setHintVisible] = useState(false)
  const [scrollDirection, setScrollDirection] = useState<'up' | 'down'>('up')

  useEffect(() => {
    if (appMode === 'agent') {
      setScrollDirection('up')
      return
    }

    let lastScrollY = window.scrollY
    let ticking = false

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const currentScrollY = window.scrollY
          if (currentScrollY < 20) {
            setScrollDirection('up')
          } else if (currentScrollY > lastScrollY + 10) {
            setScrollDirection('down')
          } else if (currentScrollY < lastScrollY - 10) {
            setScrollDirection('up')
          }
          lastScrollY = currentScrollY
          ticking = false
        })
        ticking = true
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [appMode])

  useEffect(() => {
    if (appMode === 'agent' && !agentMobileHeaderVisible) {
      setHintVisible(true)
      const timer = setTimeout(() => {
        setHintVisible(false)
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [appMode, agentMobileHeaderVisible])

  const helpTooltip = useTooltip()
  const themeTooltip = useTooltip()
  const settingsTooltip = useTooltip()
  const nextThemeMode = themeMode === 'dark' ? 'light' : 'dark'
  const themeTooltipText = nextThemeMode === 'dark' ? '切换深色主题' : '切换浅色主题'

  return (
    <>
      <header data-no-drag-select className={`safe-area-top fixed top-0 left-0 right-0 z-40 bg-white/80 dark:bg-gray-950/80 backdrop-blur border-b border-gray-200 dark:border-white/[0.08] transition-transform duration-300 ease-in-out ${appMode === 'agent' && !agentMobileHeaderVisible ? '-translate-y-full sm:translate-y-0' : 'translate-y-0'}`}>
        <div className="safe-area-x safe-header-inner max-w-7xl mx-auto flex items-center justify-between relative">
          <div className="flex-1 min-w-0 pr-2 flex items-center gap-2">
            <h1 className="inline-flex min-w-0 items-start relative mr-2">
              {showFavoriteCollectionTitle ? (
                <>
                  <span className="min-w-0 truncate text-[17px] font-bold tracking-tight text-gray-800 dark:text-gray-100 sm:hidden" title={favoriteCollectionTitle}>{favoriteCollectionTitle}</span>
                  <a
                    href="https://github.com/nideyilian/doupao"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hidden items-center gap-2 text-lg font-bold tracking-tight text-gray-800 transition-colors hover:text-gray-600 dark:text-gray-100 dark:hover:text-gray-300 sm:inline-flex"
                  >
                    <img src="./app-icon.png" alt="" className="h-6 w-6 rounded-full" />
                    豆泡
                  </a>
                </>
              ) : (
                <a
                  href="https://github.com/nideyilian/doupao"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[17px] font-bold tracking-tight text-gray-800 transition-colors hover:text-gray-600 dark:text-gray-100 dark:hover:text-gray-300 sm:text-lg"
                >
                  <img src="./app-icon.png" alt="" className="h-6 w-6 rounded-full" />
                  豆泡
                </a>
              )}
              {hasUpdate && latestRelease && (
                <a
                  href={latestRelease.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={dismiss}
                  className="absolute -right-1 -top-1 translate-x-full -translate-y-1/4 px-1 py-0.5 rounded-[4px] border border-red-500/30 text-[9px] font-black bg-red-500 text-white hover:bg-red-600 transition-all animate-fade-in leading-none shadow-sm"
                  title={`新版本 ${latestRelease.tag}`}
                >
                  NEW
                </a>
              )}
            </h1>
          </div>
          {showFavoriteCollectionTitle && (
            <div className="absolute left-1/2 top-1/2 hidden max-w-[30%] -translate-x-1/2 -translate-y-1/2 sm:flex">
              <div className="truncate rounded px-2 py-1 text-sm font-semibold text-gray-700 dark:text-gray-300" title={favoriteCollectionTitle}>
                {favoriteCollectionTitle}
              </div>
            </div>
          )}
          <div className="mr-3">
            <GenerationStatsBar />
          </div>
          <div className="hidden sm:flex items-center gap-1 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-gray-100/70 dark:bg-white/[0.04] p-1 mr-4">
            <button
              type="button"
              onClick={() => setAppMode('gallery')}
              className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${appMode === 'gallery' ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm font-medium' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
            >
              画廊
            </button>
            <button
              type="button"
              onClick={() => setAppMode('postprocess')}
              className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${appMode === 'postprocess' ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm font-medium' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
            >
              后期处理
            </button>
            <button
              type="button"
              onClick={() => setAppMode('agent')}
              className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${appMode === 'agent' ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm font-medium' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
            >
              Agent
            </button>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <div
              className="relative"
              {...themeTooltip.handlers}
            >
              <button
                onClick={() => {
                  dismissAllTooltips()
                  setSettings({ themeMode: nextThemeMode })
                }}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label={themeTooltipText}
              >
                {themeMode === 'dark' ? (
                  <SunIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                ) : (
                  <MoonIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                )}
              </button>
              <ViewportTooltip visible={themeTooltip.visible} className="whitespace-nowrap">
                {themeTooltipText}
              </ViewportTooltip>
            </div>
            <div
              className="relative"
              {...helpTooltip.handlers}
            >
              <button
                onClick={() => {
                  dismissAllTooltips()
                  setShowHelp(true)
                }}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label="操作指南"
              >
                <HelpCircleIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              <ViewportTooltip visible={helpTooltip.visible} className="whitespace-nowrap">
                操作指南
              </ViewportTooltip>
            </div>
            <div
              className="relative"
              {...settingsTooltip.handlers}
            >
              <button
                onClick={() => setShowSettings(true)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label="设置"
              >
                <SettingsIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              <ViewportTooltip visible={settingsTooltip.visible} className="whitespace-nowrap">
                设置
              </ViewportTooltip>
            </div>
          </div>
        </div>
        <div className={`safe-area-x sm:hidden overflow-hidden transition-all duration-300 ease-in-out ${appMode === 'gallery' && scrollDirection === 'down' ? 'max-h-0 opacity-0 pb-0' : 'max-h-20 opacity-100 pb-2'}`}>
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-gray-100/70 dark:bg-white/[0.04] p-1 mx-2">
            <button
              type="button"
              onClick={() => setAppMode('gallery')}
              className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${appMode === 'gallery' ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm font-medium' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
            >
              画廊
            </button>
            <button
              type="button"
              onClick={() => setAppMode('postprocess')}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${appMode === 'postprocess' ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm font-medium' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
            >
              自动化分发
            </button>
            <button
              type="button"
              onClick={() => setAppMode('agent')}
              className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${appMode === 'agent' ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm font-medium' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}
            >
              Agent
            </button>
          </div>
        </div>
      </header>
      
      {/* Hint for sliding down */}
      <div className={`fixed top-0 left-0 right-0 z-30 flex justify-center pointer-events-none transition-all duration-300 ease-in-out sm:hidden ${appMode === 'agent' && hintVisible && !agentMobileHeaderVisible ? 'translate-y-[env(safe-area-inset-top,0px)] opacity-100' : '-translate-y-full opacity-0'}`}>
        <div className="bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-b-xl shadow-lg">
          下拉展示顶栏
        </div>
      </div>

      <div className={`safe-area-top invisible pointer-events-none transition-all duration-300 ease-in-out ${appMode === 'agent' && !agentMobileHeaderVisible ? 'max-h-0 sm:max-h-[500px] opacity-0 sm:opacity-100 overflow-hidden sm:overflow-visible' : 'max-h-[500px] opacity-100'}`} aria-hidden="true">
        <div className="safe-header-inner" />
        <div className={`safe-area-x sm:hidden overflow-hidden transition-all duration-300 ease-in-out ${appMode === 'gallery' && scrollDirection === 'down' ? 'max-h-0 pb-0' : 'max-h-20 pb-2'}`}>
          <div className="p-1">
            <div className="py-1.5 text-sm">占位</div>
          </div>
        </div>
      </div>
      {showHelp && <HelpModal appMode={appMode} isFavoriteCollectionOverview={appMode === 'gallery' && filterFavorite && !activeFavoriteCollectionId} onClose={() => setShowHelp(false)} />}
    </>
  )
}
