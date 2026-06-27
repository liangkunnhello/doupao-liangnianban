import { useMemo, useState } from 'react'
import { filterPresetsForLibrary } from '../lib/compositePresetLibrary'
import { useCompositeV2Store } from '../storeV2'
import { PresetCanvasEditor } from './PresetCanvasEditor'
import type { CompositeFsImage } from '../lib/compositeTypes'

export function PresetManagementTab() {
  const presets = useCompositeV2Store((state) => state.presets)
  const groups = useCompositeV2Store((state) => state.presetGroups)
  const selectedPresetGroupId = useCompositeV2Store((state) => state.selectedPresetGroupId)
  const selectedPreviewPresetId = useCompositeV2Store((state) => state.selectedPreviewPresetId)
  const setSelectedPresetGroup = useCompositeV2Store((state) => state.setSelectedPresetGroup)
  const setSelectedPreviewPresetId = useCompositeV2Store((state) => state.setSelectedPreviewPresetId)
  const updatePreset = useCompositeV2Store((state) => state.updatePreset)
  const addImageLayer = useCompositeV2Store((state) => state.addImageLayer)
  const addTextLayer = useCompositeV2Store((state) => state.addTextLayer)

  const [query, setQuery] = useState('')
  const [logoLibraryPath, setLogoLibraryPath] = useState('')
  const [logoAssets, setLogoAssets] = useState<CompositeFsImage[]>([])
  const [logoStatusText, setLogoStatusText] = useState('选择目录后可插入 LOGO。')
  const [isRefreshingLogos, setIsRefreshingLogos] = useState(false)

  const visiblePresets = useMemo(
    () => filterPresetsForLibrary(presets, groups, { query, groupId: selectedPresetGroupId || undefined }),
    [groups, presets, query, selectedPresetGroupId],
  )

  const activePreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPreviewPresetId) ?? visiblePresets[0] ?? null,
    [presets, selectedPreviewPresetId, visiblePresets],
  )

  async function loadLogoAssets(nextPath: string, reason: 'select' | 'refresh') {
    const trimmedPath = nextPath.trim()
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined

    if (!api?.isElectron || !api.listImageFiles) {
      setLogoStatusText('当前环境不支持读取本地 LOGO 目录。')
      return
    }
    if (!trimmedPath) {
      setLogoStatusText('请输入或选择 LOGO 目录。')
      return
    }

    setIsRefreshingLogos(true)
    setLogoStatusText(reason === 'refresh' ? '正在刷新 LOGO 列表…' : '正在读取 LOGO 目录…')

    try {
      const assets = await api.listImageFiles(trimmedPath)
      setLogoLibraryPath(trimmedPath)
      setLogoAssets(assets)
      setLogoStatusText(assets.length ? `已载入 ${assets.length} 个 LOGO。` : '目录为空，没有可用 LOGO。')
    } catch (error) {
      setLogoStatusText(error instanceof Error ? `读取失败：${error.message}` : '读取 LOGO 目录失败。')
    } finally {
      setIsRefreshingLogos(false)
    }
  }

  async function handleSelectLogoFolder() {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!api?.isElectron || !api.selectDirectory) {
      setLogoStatusText('当前环境不支持选择目录。')
      return
    }

    const nextPath = await api.selectDirectory()
    if (!nextPath) {
      setLogoStatusText('未选择 LOGO 目录。')
      return
    }

    await loadLogoAssets(nextPath, 'select')
  }

  async function handleRefreshLogoFolder() {
    await loadLogoAssets(logoLibraryPath, 'refresh')
  }

  function handlePickLogo(asset: CompositeFsImage) {
    if (!activePreset) {
      setLogoStatusText('请先选择一个预设。')
      return
    }

    addImageLayer(activePreset.id, { kind: 'path', path: asset.path })
    setLogoStatusText(`已将 ${asset.name} 添加为图片图层。`)
  }

  function handleAddTextLayer() {
    if (!activePreset) return
    addTextLayer(activePreset.id)
  }

  function handleAddImageLayer() {
    if (!activePreset) return
    addImageLayer(activePreset.id)
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[220px_280px_minmax(0,1fr)] gap-4">
      <section className="min-h-0 overflow-hidden rounded-md border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-950">
        <div className="border-b border-gray-200 px-3 py-2 dark:border-white/[0.08]">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">预设组</h2>
          <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{groups.length} 个分组</p>
        </div>
        <div className="min-h-0 space-y-1 overflow-y-auto p-2">
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => setSelectedPresetGroup(group.id)}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition ${
                selectedPresetGroupId === group.id
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200'
                  : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.04]'
              }`}
            >
              <span className="truncate">{group.name}</span>
              <span className="ml-3 shrink-0 text-[11px] opacity-70">{group.presetIds.length}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="min-h-0 overflow-hidden rounded-md border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-950">
        <div className="border-b border-gray-200 px-3 py-2 dark:border-white/[0.08]">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">全局预设库</h2>
          <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">筛选并编辑当前预设</p>
        </div>

        <div className="border-b border-gray-200 p-3 dark:border-white/[0.08]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索预设"
            aria-label="Search presets"
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100"
          />
        </div>

        <div className="min-h-0 overflow-y-auto">
          <div className="space-y-1 p-2">
            {visiblePresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setSelectedPreviewPresetId(preset.id)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                  selectedPreviewPresetId === preset.id
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200'
                    : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.04]'
                }`}
              >
                <div className="truncate font-medium">{preset.name}</div>
                <div className="mt-1 truncate text-[11px] opacity-70">
                  {preset.layers.length} 层 · {preset.baseCanvas.width} × {preset.baseCanvas.height}
                </div>
              </button>
            ))}
            {!visiblePresets.length && (
              <div className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-center text-xs text-gray-400 dark:border-white/[0.08] dark:text-gray-500">
                没有匹配的预设。
              </div>
            )}
          </div>

          {activePreset && (
            <div className="border-t border-gray-200 px-3 py-3 dark:border-white/[0.08]">
              <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400">
                预设名称
                <input
                  value={activePreset.name}
                  onChange={(event) => updatePreset(activePreset.id, { name: event.target.value })}
                  className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100"
                />
              </label>
              <label className="mt-3 block text-[11px] font-medium text-gray-500 dark:text-gray-400">
                示例背景路径
                <input
                  value={activePreset.sampleBackgroundPath}
                  onChange={(event) => updatePreset(activePreset.id, { sampleBackgroundPath: event.target.value })}
                  placeholder="可选，用于后续预览接线"
                  className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100"
                />
              </label>
            </div>
          )}
        </div>
      </section>

      <PresetCanvasEditor
        preset={activePreset}
        logoLibraryPath={logoLibraryPath}
        logoAssets={logoAssets}
        logoStatusText={logoStatusText}
        isRefreshingLogos={isRefreshingLogos}
        onLogoLibraryPathChange={setLogoLibraryPath}
        onAddText={handleAddTextLayer}
        onAddImage={handleAddImageLayer}
        onSelectLogoFolder={handleSelectLogoFolder}
        onRefreshLogoFolder={handleRefreshLogoFolder}
        onPickLogo={handlePickLogo}
      />
    </div>
  )
}
