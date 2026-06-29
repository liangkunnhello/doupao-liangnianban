import { useEffect, useMemo, useState } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { filterPresetsForLibrary } from '../lib/compositePresetLibrary'
import type { CompositeFsImage } from '../lib/compositeTypes'
import { useCompositeV2Store } from '../storeV2'
import { PresetCanvasEditor } from './PresetCanvasEditor'

export function PresetManagementTab() {
  const store = useCompositeV2Store()
  const [query, setQuery] = useState('')
  const [logoAssets, setLogoAssets] = useState<CompositeFsImage[]>([])
  const [logoStatusText, setLogoStatusText] = useState('选择目录后可插入 LOGO。')
  const [isRefreshingLogos, setIsRefreshingLogos] = useState(false)
  const [selectedLayerId, setSelectedLayerId] = useState('')

  const visiblePresets = useMemo(
    () => filterPresetsForLibrary(store.presets, store.presetGroups, {
      query,
      groupId: store.selectedPresetGroupId || undefined,
    }),
    [query, store.presetGroups, store.presets, store.selectedPresetGroupId],
  )
  const activePreset = visiblePresets.find((preset) => preset.id === store.selectedPreviewPresetId) ?? null

  useEffect(() => {
    if (!activePreset && visiblePresets[0]) store.setSelectedPreviewPresetId(visiblePresets[0].id)
  }, [activePreset, store.setSelectedPreviewPresetId, visiblePresets])

  useEffect(() => {
    if (!activePreset?.layers.some((layer) => layer.id === selectedLayerId)) {
      setSelectedLayerId(activePreset?.layers[0]?.id ?? '')
    }
  }, [activePreset, selectedLayerId])

  useEffect(() => {
    if (store.logoLibraryPath) void loadLogos(store.logoLibraryPath)
  }, [])

  async function loadLogos(path: string) {
    if (!window.electronAPI?.listImageFiles || !path.trim()) {
      setLogoStatusText('请选择有效的 LOGO 目录。')
      return
    }
    setIsRefreshingLogos(true)
    try {
      const assets = await window.electronAPI.listImageFiles(path.trim())
      store.setLogoLibraryPath(path.trim())
      setLogoAssets(assets)
      setLogoStatusText(`已加载 ${assets.length} 个 LOGO。`)
    } catch (error) {
      setLogoStatusText(error instanceof Error ? error.message : 'LOGO 目录读取失败。')
    } finally {
      setIsRefreshingLogos(false)
    }
  }

  async function chooseLogoFolder() {
    const path = await window.electronAPI?.selectDirectory?.()
    if (path) await loadLogos(path)
  }

  return (
    <div
      data-layout="preset-management-workspace"
      className="grid h-full min-h-0 min-w-[1180px] flex-1 grid-cols-[300px_minmax(0,1fr)] gap-4 overflow-hidden"
    >
      <div data-layout="stacked-library-rail" className="flex min-h-0 flex-col gap-4">
        <section className="max-h-[220px] min-h-[170px] shrink-0 overflow-hidden rounded-md border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-950">
          <header className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-white/[0.08]">
            <div><h2 className="text-sm font-semibold">预设组</h2><p className="text-[11px] text-gray-500">{store.presetGroups.length} 个分组</p></div>
            <button type="button" title="新建预设组" onClick={() => store.createPresetGroup(window.prompt('预设组名称') ?? '')} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 dark:border-white/[0.08]"><Plus className="h-4 w-4" /></button>
          </header>
          <div className="space-y-1 overflow-y-auto p-2">
            {store.presetGroups.map((group) => {
              const selected = group.id === store.selectedPresetGroupId
              return (
                <div key={group.id} className={`rounded-md ${selected ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200' : ''}`}>
                  <button type="button" aria-pressed={selected} onClick={() => store.setSelectedPresetGroup(group.id)} onDoubleClick={() => store.renamePresetGroup(group.id, window.prompt('重命名预设组', group.name) ?? group.name)} className="flex w-full justify-between px-3 py-2 text-left text-sm">
                    <span className="truncate">{group.name}</span><span className="text-[11px] opacity-70">{group.presetIds.length}</span>
                  </button>
                  {selected && (
                    <div className="flex justify-end gap-1 px-2 pb-2">
                      <button type="button" title="复制组" onClick={() => store.duplicatePresetGroup(group.id)} className="p-1"><Copy className="h-3.5 w-3.5" /></button>
                      <button type="button" title="删除组" disabled={store.presetGroups.length <= 1} onClick={() => window.confirm('删除这个预设组？') && store.deletePresetGroup(group.id)} className="p-1 text-red-500 disabled:opacity-30"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <section className="min-h-0 flex-1 overflow-y-auto rounded-md border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-950">
          <header className="border-b border-gray-200 px-3 py-2 dark:border-white/[0.08]"><h2 className="text-sm font-semibold">全局水印预设库</h2></header>
          <div className="p-3"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按名称搜索" aria-label="Search presets" className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-gray-900" /></div>
          <div className="space-y-1 px-2">
            {visiblePresets.map((preset) => (
              <div key={preset.id} className={`rounded-md px-3 py-2 text-sm ${preset.id === store.selectedPreviewPresetId ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200' : ''}`}>
                <button type="button" aria-pressed={preset.id === store.selectedPreviewPresetId} onClick={() => store.setSelectedPreviewPresetId(preset.id)} className="w-full text-left">
                  <div className="truncate font-medium">{preset.name}</div><div className="text-[11px] opacity-70">{preset.layers.length} 层 · {preset.baseCanvas.width} x {preset.baseCanvas.height}</div>
                </button>
                {preset.id === store.selectedPreviewPresetId && (
                  <div className="mt-2 flex gap-3 text-[11px]">
                    <button type="button" onClick={() => store.duplicatePresetIntoGroup(preset.id, store.selectedPresetGroupId)} className="text-blue-600">复制为新预设</button>
                    <button type="button" onClick={() => store.removePresetFromGroup(preset.id, store.selectedPresetGroupId)} className="text-red-500">移出当前组</button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {activePreset && (
            <div className="mt-3 space-y-3 border-t border-gray-200 p-3 dark:border-white/[0.08]">
              <label className="block text-[11px] text-gray-500">预设名称<input value={activePreset.name} onChange={(event) => store.updatePreset(activePreset.id, { name: event.target.value })} className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-gray-900" /></label>
              <label className="block text-[11px] text-gray-500">输出根目录<div className="mt-1 flex gap-2"><input value={activePreset.outputRootPath} onChange={(event) => store.updatePreset(activePreset.id, { outputRootPath: event.target.value })} className="min-w-0 flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-gray-900" /><button type="button" onClick={async () => { const path = await window.electronAPI?.selectDirectory?.(); if (path) store.updatePreset(activePreset.id, { outputRootPath: path }) }} className="rounded-md border border-gray-200 px-2 text-xs dark:border-white/[0.08]">选择</button></div></label>
              <label className="block text-[11px] text-gray-500">示例背景路径<input value={activePreset.sampleBackgroundPath} onChange={(event) => store.updatePreset(activePreset.id, { sampleBackgroundPath: event.target.value })} className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-gray-900" /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] text-gray-500">基准宽<input type="number" min={1} value={activePreset.baseCanvas.width} onChange={(event) => store.updatePreset(activePreset.id, { baseCanvas: { ...activePreset.baseCanvas, width: Math.max(1, Number(event.target.value)) } })} className="mt-1 w-full rounded border border-gray-200 px-2 py-1 dark:border-white/[0.08] dark:bg-gray-900" /></label>
                <label className="text-[11px] text-gray-500">基准高<input type="number" min={1} value={activePreset.baseCanvas.height} onChange={(event) => store.updatePreset(activePreset.id, { baseCanvas: { ...activePreset.baseCanvas, height: Math.max(1, Number(event.target.value)) } })} className="mt-1 w-full rounded border border-gray-200 px-2 py-1 dark:border-white/[0.08] dark:bg-gray-900" /></label>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={activePreset.useOutputOverrides} onChange={(event) => store.updatePreset(activePreset.id, {
                  useOutputOverrides: event.target.checked,
                  outputRuleGroupsOverride: activePreset.outputRuleGroupsOverride.length ? activePreset.outputRuleGroupsOverride : structuredClone(store.outputRuleGroups),
                })} />
                覆盖全局渠道/尺寸勾选规则
              </label>
              {activePreset.useOutputOverrides && (
                <div className="max-h-36 space-y-2 overflow-auto rounded border border-gray-200 p-2 text-xs dark:border-white/[0.08]">
                  {activePreset.outputRuleGroupsOverride.map((group) => (
                    <div key={group.id}>
                      <label className="flex items-center gap-2 font-medium">
                        <input
                          type="checkbox"
                          aria-label={`Select all override ${group.name} sizes`}
                          checked={group.rules.length > 0 && group.rules.every((rule) => rule.enabled)}
                          onChange={(event) => store.updatePreset(activePreset.id, {
                            outputRuleGroupsOverride: activePreset.outputRuleGroupsOverride.map((item) => item.id === group.id
                              ? { ...item, rules: item.rules.map((rule) => ({ ...rule, enabled: event.target.checked })) }
                              : item),
                          })}
                        />
                        <span>{group.name}</span>
                      </label>
                      {group.rules.map((rule) => (
                      <label key={rule.id} className="mt-1 flex items-center gap-2"><input type="checkbox" checked={rule.enabled} onChange={(event) => store.updatePreset(activePreset.id, {
                        outputRuleGroupsOverride: activePreset.outputRuleGroupsOverride.map((item) => ({ ...item, rules: item.rules.map((candidate) => candidate.id === rule.id ? { ...candidate, enabled: event.target.checked } : candidate) })),
                      })} />{rule.name}</label>
                    ))}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <PresetCanvasEditor
        preset={activePreset}
        logoLibraryPath={store.logoLibraryPath}
        logoAssets={logoAssets}
        logoStatusText={logoStatusText}
        isRefreshingLogos={isRefreshingLogos}
        selectedLayerId={selectedLayerId}
        onSelectLayer={setSelectedLayerId}
        onLogoLibraryPathChange={store.setLogoLibraryPath}
        onAddText={() => activePreset && store.addTextLayer(activePreset.id)}
        onAddImage={() => activePreset && store.addImageLayer(activePreset.id)}
        onSelectLogoFolder={() => void chooseLogoFolder()}
        onRefreshLogoFolder={() => void loadLogos(store.logoLibraryPath)}
        onPickLogo={(asset) => {
          if (!activePreset) return
          const layerId = store.replaceOrAddLogoLayer(
            activePreset.id,
            { kind: 'path', path: asset.path },
            selectedLayerId,
          )
          setSelectedLayerId(layerId)
        }}
        onUpdatePreset={(patch) => activePreset && store.updatePreset(activePreset.id, patch)}
      />
    </div>
  )
}
