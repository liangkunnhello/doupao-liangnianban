import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDownIcon as ChevronDown,
  ChevronRightIcon as ChevronRight,
  CopyIcon as Copy,
  FileTextIcon as FileText,
  FolderIcon as Folder,
  FolderOpenIcon as FolderOpen,
  ImportIcon as Import,
  Loader2Icon as Loader2,
  PlusIcon as Plus,
  TrashIcon as Trash2,
} from '../../../design-system/icons'
import { filterPresetsForLibrary } from '../lib/compositePresetLibrary'
import type { CompositeFsImage } from '../lib/compositeTypes'
import {
  dataUrlToCompositeBlob,
  getCompositeAssetObjectUrl,
  isCompositeAssetReferenced,
  removeCompositeAsset,
  storeCompositeBlobs,
} from '../lib/compositeAssets'
import { useCompositeV2Store } from '../storeV2'
import { FloatingLogoLibrary } from './FloatingLogoLibrary'
import { PresetCanvasEditor } from './PresetCanvasEditor'
import { PresetLayerPanel } from './PresetLayerPanel'
import { PresetNamingFields } from './PresetNamingFields'
import { useAppDialog } from '../../../hooks/useAppDialog'
import {
  buildHanhaiImportBundle,
  createHanhaiImportPreview,
  normalizeHanhaiAssetPath,
  parseHanhaiPresetConfig,
  type HanhaiImportPreview,
  type HanhaiImportSource,
  type ParsedHanhaiPresetConfig,
} from '../lib/hanhaiPresetImport'

const GROUP_DRAG_TYPE = 'application/x-doupao-preset-group'
const LIBRARY_PRESET_DRAG_TYPE = 'application/x-doupao-library-preset'
const PRESET_BASE_SIZES = [
  { value: '1280x720', label: '1280×720', width: 1280, height: 720 },
  { value: '1080x1920', label: '1080×1920', width: 1080, height: 1920 },
  { value: '800x800', label: '800×800', width: 800, height: 800 },
] as const

type HanhaiImportDialogState = {
  source: HanhaiImportSource
  parsed: ParsedHanhaiPresetConfig
  preview: HanhaiImportPreview
}

function formatNamingDate(date = new Date()) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
}

export function PresetManagementTab() {
  const store = useCompositeV2Store()
  const { openConfirmDialog, openInfoDialog } = useAppDialog()
  const [query, setQuery] = useState('')
  const [logoStatusText, setLogoStatusText] = useState('支持拖拽添加 LOGO。')
  const [isRefreshingLogos, setIsRefreshingLogos] = useState(false)
  const [logoObjectUrls, setLogoObjectUrls] = useState<Record<string, string>>({})
  const [selectedLayerId, setSelectedLayerId] = useState('')
  const [editingGroupId, setEditingGroupId] = useState('')
  const [editingGroupName, setEditingGroupName] = useState('')
  const [draggingGroupId, setDraggingGroupId] = useState('')
  const [editingPresetId, setEditingPresetId] = useState('')
  const [editingPresetName, setEditingPresetName] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [draggingLibraryPresetId, setDraggingLibraryPresetId] = useState('')
  const [hanhaiImportDialog, setHanhaiImportDialog] = useState<HanhaiImportDialogState | null>(null)
  const [isLoadingHanhai, setIsLoadingHanhai] = useState(false)
  const [isImportingHanhai, setIsImportingHanhai] = useState(false)

  const toggleGroup = (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const [librarySplit, setLibrarySplit] = useState(() => {
    try {
      const saved = localStorage.getItem('doupao-composite-library-split')
      if (saved) {
        const val = parseFloat(saved)
        if (Number.isFinite(val) && val >= 20 && val <= 80) {
          return val
        }
      }
    } catch {}
    return 50
  })
  const resizingLibraryRef = useRef(false)

  const sortedLogoAssets = useMemo(() => {
    const assets = store.projectLogos?.map(logo => ({
      path: logo.id, // Use ID as path to satisfy CompositeFsImage interface
      name: logo.name,
      dataUrl: logo.assetId ? logoObjectUrls[logo.assetId] : logo.dataUrl,
    })) || []
    
    if (!store.logoOrder || store.logoOrder.length === 0) return assets
    const orderMap = new Map(store.logoOrder.map((id, index) => [id, index]))
    return [...assets].sort((a, b) => {
      const indexA = orderMap.get(a.path) ?? Infinity
      const indexB = orderMap.get(b.path) ?? Infinity
      return indexA - indexB
    })
  }, [logoObjectUrls, store.projectLogos, store.logoOrder])

  useEffect(() => {
    let active = true
    const logos = store.projectLogos.filter((logo) => logo.assetId)
    void Promise.all(logos.map(async (logo) => [
      logo.assetId!,
      await getCompositeAssetObjectUrl(logo.assetId!).catch(() => null),
    ] as const))
      .then((entries) => {
        if (!active) return
        setLogoObjectUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))))
      })
    return () => { active = false }
  }, [store.projectLogos])

  useEffect(() => {
    try {
      localStorage.setItem('doupao-composite-library-split', String(librarySplit))
    } catch {}
  }, [librarySplit])

  const visiblePresets = useMemo(
    () => filterPresetsForLibrary(store.presets, store.presetGroups, {
      query,
    }),
    [query, store.presetGroups, store.presets],
  )
  const activePreset = store.presets.find((preset) => preset.id === store.selectedPreviewPresetId) ?? null
  const namingPreviewValues = useMemo(() => {
    const groups = activePreset?.useOutputOverrides ? activePreset.outputRuleGroupsOverride : store.outputRuleGroups
    const activeGroup = groups.find((group) => group.rules.some((rule) => rule.enabled)) ?? groups[0]
    const activeRule = activeGroup?.rules.find((rule) => rule.enabled) ?? activeGroup?.rules[0]
    return {
      date: formatNamingDate(),
      channel: activeGroup?.name ?? '渠道',
      size: activeRule?.name ?? (activePreset ? `${activePreset.baseCanvas.width}x${activePreset.baseCanvas.height}` : '尺寸'),
      preset: activePreset?.name ?? '预设',
      index: '1',
      source: '源文件',
      sourceDir: '源目录',
      custom: store.customValue || '自定义值',
    }
  }, [activePreset, store.customValue, store.outputRuleGroups])

  useEffect(() => {
    if (!activePreset && visiblePresets[0]) store.setSelectedPreviewPresetId(visiblePresets[0].id)
  }, [activePreset, store.setSelectedPreviewPresetId, visiblePresets])

  useEffect(() => {
    if (!activePreset?.layers.some((layer) => layer.id === selectedLayerId)) {
      setSelectedLayerId(activePreset?.layers[0]?.id ?? '')
    }
  }, [activePreset, selectedLayerId])

  // Removed file system load logos code, as it's no longer used
  // async function ensureDefaultLogoLibraryPath() ...
  // async function loadLogos(path: string) ...

  async function chooseLogoFolder() {
    // 增加对环境支持的提示
    if (!window.electronAPI) {
      openInfoDialog({ title: '当前环境不支持', message: '请在桌面客户端中选择本地文件。' })
      return
    }
    if (!window.electronAPI.selectFiles) {
      openInfoDialog({ title: '文件选择尚未就绪', message: '请重启应用后再试。' })
      return
    }

    const paths = await window.electronAPI.selectFiles([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }])
    if (paths && paths.length > 0) {
      let imported = 0
      const names: string[] = []
      const blobs: Blob[] = []
      for (const path of paths) {
        try {
          const fileName = path.split(/[\\/]/).pop() || 'logo.png'
          const payload = await window.electronAPI.readImageFile(path)
          if (payload?.dataUrl) {
            names.push(fileName)
            blobs.push(await dataUrlToCompositeBlob(payload.dataUrl))
            imported++
          }
        } catch (e) {
          console.error('Failed to import logo:', e)
        }
      }
      if (imported > 0) {
        const assetIds = await storeCompositeBlobs(blobs)
        store.addProjectLogos(names.map((name, index) => ({
          id: `logo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name,
          assetId: assetIds[index]!,
        })))
      }
    }
  }

  async function importLogoFiles(files: FileList) {
    let imported = 0
    const names: string[] = []
    const blobs: Blob[] = []
    
    for (const file of Array.from(files)) {
      try {
        names.push(file.name)
        blobs.push(file)
        imported++
      } catch (e) {
        console.error('Failed to import logo:', e)
      }
    }
    if (imported > 0) {
      const assetIds = await storeCompositeBlobs(blobs)
      store.addProjectLogos(names.map((name, index) => ({
        id: `logo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        assetId: assetIds[index]!,
      })))
    }
  }

  async function deleteLogoAsset(asset: CompositeFsImage) {
    const logo = useCompositeV2Store.getState().projectLogos.find((item) => item.id === asset.path)
    store.removeProjectLogo(asset.path)
    if (!logo?.assetId) return
    const latest = useCompositeV2Store.getState()
    if (!isCompositeAssetReferenced(latest, logo.assetId)) {
      try {
        await removeCompositeAsset(logo.assetId)
      } catch (error) {
        console.error('删除后期处理资源失败:', error)
      }
    }
  }

  async function renameLogoAsset(asset: CompositeFsImage, newName: string) {
    store.renameProjectLogo(asset.path, newName)
  }

  function createPresetGroup() {
    store.createPresetGroup('新预设组')
    const createdId = useCompositeV2Store.getState().selectedPresetGroupId
    setEditingGroupId(createdId)
    setEditingGroupName(useCompositeV2Store.getState().presetGroups.find((group) => group.id === createdId)?.name ?? '')
  }

  function beginGroupRename(groupId: string, name: string) {
    setEditingGroupId(groupId)
    setEditingGroupName(name)
  }

  function finishGroupRename() {
    if (editingGroupId) store.renamePresetGroup(editingGroupId, editingGroupName)
    setEditingGroupId('')
    setEditingGroupName('')
  }

  function beginPresetRename(presetId: string, name: string) {
    setEditingPresetId(presetId)
    setEditingPresetName(name)
  }

  function finishPresetRename() {
    if (editingPresetId) store.updatePreset(editingPresetId, { name: editingPresetName })
    setEditingPresetId('')
    setEditingPresetName('')
  }

  function resizeLibraryPanes(clientY: number, host: HTMLElement | null) {
    if (!resizingLibraryRef.current || !host) return
    const rect = host.getBoundingClientRect()
    if (rect.height <= 0) return
    const next = (clientY - rect.top) / rect.height * 100
    setLibrarySplit(Math.max(20, Math.min(80, next)))
  }

  function selectNewestLayer(presetId: string) {
    const latestPreset = useCompositeV2Store.getState().presets.find((preset) => preset.id === presetId)
    const newestLayerId = latestPreset?.layers.at(-1)?.id ?? ''
    if (newestLayerId) setSelectedLayerId(newestLayerId)
  }

  function handleAddTextLayer() {
    if (!activePreset) return
    store.addTextLayer(activePreset.id)
    selectNewestLayer(activePreset.id)
  }

  function handleAddImageLayer() {
    if (!activePreset) return
    store.addImageLayer(activePreset.id)
    selectNewestLayer(activePreset.id)
  }

  function handleAddLogoLayer() {
    if (!activePreset) return
    store.addLogoLayer(activePreset.id)
    selectNewestLayer(activePreset.id)
  }

  async function loadHanhaiImport(manualSelection = false) {
    const api = window.electronAPI
    if (!api?.loadHanhaiProcessingPresets) {
      openInfoDialog({ title: '当前环境不支持', message: '请在桌面客户端中导入瀚海产品预设。' })
      return
    }
    setIsLoadingHanhai(true)
    try {
      let filePath: string | null | undefined
      if (manualSelection) {
        filePath = await api.selectFile([{ name: '瀚海产品预设', extensions: ['json'] }])
        if (!filePath) return
      }
      let response = await api.loadHanhaiProcessingPresets(filePath)
      if (response.success && !response.source && !manualSelection) {
        filePath = await api.selectFile([{ name: '瀚海产品预设', extensions: ['json'] }])
        if (!filePath) return
        response = await api.loadHanhaiProcessingPresets(filePath)
      }
      if (!response.success) throw new Error(response.error)
      if (!response.source) throw new Error('没有找到瀚海 processing_presets.json')
      const parsed = parseHanhaiPresetConfig(response.source.jsonText)
      const preview = createHanhaiImportPreview(
        parsed,
        response.source.assets,
        useCompositeV2Store.getState().presets.map((preset) => preset.id),
      )
      setHanhaiImportDialog({ source: response.source, parsed, preview })
    } catch (error) {
      openInfoDialog({
        title: '无法读取瀚海预设',
        message: error instanceof Error ? error.message : '读取瀚海产品预设失败。',
      })
    } finally {
      setIsLoadingHanhai(false)
    }
  }

  async function confirmHanhaiImport() {
    if (!hanhaiImportDialog || hanhaiImportDialog.preview.newCount === 0) return
    setIsImportingHanhai(true)
    try {
      const availableAssets = hanhaiImportDialog.source.assets.filter(
        (asset): asset is Extract<typeof asset, { dataUrl: string }> => Boolean(asset.dataUrl),
      )
      const blobs = await Promise.all(availableAssets.map((asset) => dataUrlToCompositeBlob(asset.dataUrl)))
      const assetIds = await storeCompositeBlobs(blobs)
      const assetIdsByPath = new Map(availableAssets.map((asset, index) => [
        normalizeHanhaiAssetPath(asset.path),
        assetIds[index]!,
      ]))
      const currentPresetIds = useCompositeV2Store.getState().presets.map((preset) => preset.id)
      const bundle = buildHanhaiImportBundle(
        hanhaiImportDialog.parsed,
        hanhaiImportDialog.source.assets,
        assetIdsByPath,
        currentPresetIds,
      )
      const result = useCompositeV2Store.getState().importHanhaiPresets(bundle)
      const missingCount = hanhaiImportDialog.preview.missingAssetPresetCount
      setHanhaiImportDialog(null)
      openInfoDialog({
        title: '瀚海预设导入完成',
        message: `新增 ${result.imported} 条，跳过重复 ${hanhaiImportDialog.preview.duplicateCount + result.skipped} 条${missingCount ? `；${missingCount} 条已标记缺失水印` : ''}。`,
      })
    } catch (error) {
      openInfoDialog({
        title: '导入失败',
        message: error instanceof Error ? error.message : '瀚海产品预设导入失败。',
      })
    } finally {
      setIsImportingHanhai(false)
    }
  }

  return (
    <div
      data-layout="preset-management-workspace"
      className="grid h-full min-h-0 min-w-[1180px] flex-1 grid-cols-[260px_280px_minmax(0,1fr)] overflow-hidden border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-950"
    >
      <div
        data-layout="stacked-library-rail"
        className="grid min-h-0 overflow-hidden border-r border-gray-200 dark:border-white/[0.08]"
        style={{ gridTemplateRows: `${librarySplit}% 5px minmax(0, 1fr)` }}
      >
        <section className="flex min-h-0 flex-col overflow-hidden bg-white dark:bg-gray-950">
          <header className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-white/[0.08]">
            <div><h2 className="text-sm font-semibold">预设组</h2><p className="text-[11px] text-gray-500">{store.presetGroups.length} 个分组</p></div>
            <button type="button" title="新建预设组" onClick={createPresetGroup} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 dark:border-white/[0.08]"><Plus className="h-4 w-4" /></button>
          </header>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {store.presetGroups.map((group) => {
              const selected = group.id === store.selectedPresetGroupId
              const editing = group.id === editingGroupId
              return (
                <div
                  key={group.id}
                  data-preset-group-id={group.id}
                  draggable={!editing}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move'
                    ;(event.dataTransfer as { setData?: (type: string, value: string) => void }).setData?.(GROUP_DRAG_TYPE, group.id)
                    setDraggingGroupId(group.id)
                  }}
                  onDragEnd={() => setDraggingGroupId('')}
                  onDragOver={(event) => {
                    const transfer = event.dataTransfer as { types?: readonly string[]; dropEffect?: string } | undefined
                    const types = Array.from(transfer?.types ?? [])
                    if (types.includes(GROUP_DRAG_TYPE) || types.includes(LIBRARY_PRESET_DRAG_TYPE)) {
                      event.preventDefault()
                      if (transfer) transfer.dropEffect = types.includes(LIBRARY_PRESET_DRAG_TYPE) ? 'copy' : 'move'
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    const transfer = event.dataTransfer as { getData?: (type: string) => string } | undefined
                    const draggedPresetId = transfer?.getData?.(LIBRARY_PRESET_DRAG_TYPE) ?? ''
                    if (draggedPresetId) {
                      store.addPresetToGroup(draggedPresetId, group.id)
                      setDraggingLibraryPresetId('')
                      return
                    }
                    const draggedGroupId = transfer?.getData?.(GROUP_DRAG_TYPE) || draggingGroupId
                    if (draggedGroupId) store.movePresetGroup(draggedGroupId, store.presetGroups.findIndex((item) => item.id === group.id))
                    setDraggingGroupId('')
                  }}
                  className={`rounded-md ${editing ? '' : 'cursor-grab active:cursor-grabbing'} ${draggingGroupId === group.id ? 'opacity-50' : ''} ${selected && !editing ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200' : ''}`}
                >
                  {editing ? (
                    <input
                      autoFocus
                      aria-label={`重命名预设组 ${group.name}`}
                      value={editingGroupName}
                      onChange={(event) => setEditingGroupName(event.target.value)}
                      onBlur={finishGroupRename}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          finishGroupRename()
                        } else if (event.key === 'Escape') {
                          setEditingGroupId('')
                          setEditingGroupName('')
                        }
                      }}
                      className="m-2 w-[calc(100%-1rem)] rounded border border-blue-300 bg-white px-2 py-1 text-sm text-gray-900 outline-none dark:bg-gray-900 dark:text-gray-100"
                    />
                  ) : (
                    <div className="flex w-full items-center justify-between px-2 py-1.5 text-left text-sm group">
                      <div className="flex items-center gap-1.5 overflow-hidden flex-1 min-w-0">
                        <button type="button" onClick={(e) => toggleGroup(group.id, e)} className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0">
                          {expandedGroups.has(group.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                        <button type="button" className="flex items-center gap-1.5 overflow-hidden flex-1 min-w-0" aria-pressed={selected} onClick={() => store.setSelectedPresetGroup(group.id)} onDoubleClick={() => beginGroupRename(group.id, group.name)}>
                          {expandedGroups.has(group.id) ? <FolderOpen className="h-4 w-4 shrink-0 text-blue-400" /> : <Folder className="h-4 w-4 shrink-0 text-blue-400" />}
                          <span className="truncate">{group.name}</span>
                        </button>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 pl-2">
                        {selected && (
                          <div className="flex items-center gap-0.5 mr-1">
                            <button
                              type="button"
                              title="添加当前选中预设到组"
                              disabled={!store.selectedPreviewPresetId || group.presetIds.includes(store.selectedPreviewPresetId)}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (!store.selectedPreviewPresetId) return
                                store.addPresetToGroup(store.selectedPreviewPresetId, group.id)
                              }}
                              className="cursor-pointer p-1 text-gray-500 hover:bg-gray-100 rounded disabled:cursor-not-allowed disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-800"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" title="复制组" onClick={(e) => { e.stopPropagation(); store.duplicatePresetGroup(group.id); }} className="cursor-pointer p-1 text-blue-500 hover:bg-blue-100 rounded dark:text-blue-400 dark:hover:bg-blue-500/20"><Copy className="h-3.5 w-3.5" /></button>
                            <button type="button" title="删除组" disabled={store.presetGroups.length <= 1} onClick={(e) => {
                              e.stopPropagation()
                              openConfirmDialog({
                                title: '删除预设组？',
                                message: `将删除预设组「${group.name}」，组内预设不会被删除。`,
                                confirmText: '确认删除',
                                tone: 'danger',
                                action: () => store.deletePresetGroup(group.id),
                              })
                            }} className="cursor-pointer p-1 text-red-500 hover:bg-red-100 rounded disabled:cursor-not-allowed disabled:opacity-30 dark:text-red-400 dark:hover:bg-red-500/20"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        )}
                        <span className="text-[11px] opacity-70 w-4 text-right">{group.presetIds.length}</span>
                      </div>
                    </div>
                  )}
                  {expandedGroups.has(group.id) && !editing && (
                    <div className="pl-6 pr-2 py-1 space-y-0.5">
                      {group.presetIds.map(presetId => {
                        const preset = store.presets.find(p => p.id === presetId)
                        if (!preset) return null
                        const isPresetSelected = preset.id === store.selectedPreviewPresetId
                        return (
                          <div
                            key={preset.id}
                            className={`group/item flex items-center gap-1 rounded-md px-2 py-1.5 text-xs ${isPresetSelected ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                store.setSelectedPresetGroup(group.id)
                                store.setSelectedPreviewPresetId(preset.id)
                              }}
                              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                            >
                              <FileText className="h-3.5 w-3.5 shrink-0 opacity-50" />
                              <span className="truncate">{preset.name}</span>
                            </button>
                            <button
                              type="button"
                              title="从组中移除预设"
                              onClick={(e) => {
                                e.stopPropagation()
                                store.removePresetFromGroup(preset.id, group.id)
                              }}
                              className="p-1 text-red-500 opacity-0 transition group-hover/item:opacity-100 hover:bg-red-100 rounded dark:text-red-400 dark:hover:bg-red-500/20"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <div
          data-layout="rail-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-valuenow={Math.round(librarySplit)}
          tabIndex={0}
          onPointerDown={(event) => {
            resizingLibraryRef.current = true
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => resizeLibraryPanes(event.clientY, event.currentTarget.parentElement)}
          onPointerUp={(event) => {
            resizingLibraryRef.current = false
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          className="cursor-row-resize border-y border-gray-200 bg-gray-50 hover:bg-blue-50 dark:border-white/[0.08] dark:bg-gray-900 dark:hover:bg-blue-500/10"
        />

        <section className="min-h-0 flex flex-col overflow-hidden bg-white dark:bg-gray-950">
          <header className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-white/[0.08] shrink-0">
            <h2 className="text-sm font-semibold">全局水印预设库</h2>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                title="导入瀚海产品预设"
                aria-label="导入瀚海产品预设"
                disabled={isLoadingHanhai}
                onClick={() => void loadHanhaiImport()}
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-gray-200 text-blue-600 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60 dark:border-white/[0.08] dark:text-blue-400 dark:hover:bg-blue-500/10"
              >
                {isLoadingHanhai ? <Loader2 className="h-4 w-4 animate-spin" /> : <Import className="h-4 w-4" />}
              </button>
              <button type="button" title="新建预设" onClick={() => store.createPreset('新预设')} className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-gray-200 dark:border-white/[0.08] hover:bg-gray-50 dark:hover:bg-gray-900"><Plus className="h-4 w-4" /></button>
            </div>
          </header>
          <div className="p-3 shrink-0"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按名称搜索" aria-label="搜索预设" className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-gray-900" /></div>
          <div className="flex-1 overflow-y-auto space-y-0.5 px-2 pb-2">
            {visiblePresets.map((preset) => (
              <div
                key={preset.id}
                draggable={editingPresetId !== preset.id}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'copy'
                  ;(event.dataTransfer as { setData?: (type: string, value: string) => void }).setData?.(LIBRARY_PRESET_DRAG_TYPE, preset.id)
                  setDraggingLibraryPresetId(preset.id)
                }}
                onDragEnd={() => setDraggingLibraryPresetId('')}
                className={`group relative rounded-md px-2 py-1.5 transition-colors ${preset.id === store.selectedPreviewPresetId ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200' : 'hover:bg-gray-50 dark:hover:bg-gray-900'} ${draggingLibraryPresetId === preset.id ? 'opacity-50' : ''}`}
              >
                {editingPresetId === preset.id ? (
                  <input
                    autoFocus
                    value={editingPresetName}
                    onChange={(e) => setEditingPresetName(e.target.value)}
                    onBlur={finishPresetRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); finishPresetRename() }
                      if (e.key === 'Escape') { setEditingPresetId(''); setEditingPresetName('') }
                    }}
                    className="w-full rounded border border-blue-300 bg-white px-2 py-0.5 text-[13px] text-gray-900 outline-none dark:bg-gray-900 dark:text-gray-100"
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-pressed={preset.id === store.selectedPreviewPresetId}
                      onClick={() => store.setSelectedPreviewPresetId(preset.id)}
                      onDoubleClick={() => beginPresetRename(preset.id, preset.name)}
                      className="flex min-w-0 flex-1 items-center justify-between text-left"
                    >
                      <div className="truncate font-medium text-[13px]">{preset.name}</div>
                      <div className="ml-2 shrink-0 text-[10px] opacity-70">{preset.layers.length}层 · {preset.baseCanvas.width}x{preset.baseCanvas.height}</div>
                    </button>
                    {preset.id === store.selectedPreviewPresetId && (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button type="button" title="复制为新预设" onClick={() => store.duplicatePreset(preset.id)} className="cursor-pointer p-1 text-blue-600 hover:bg-blue-100 rounded-md dark:text-blue-400 dark:hover:bg-blue-500/20"><Copy className="h-3.5 w-3.5" /></button>
                        <button type="button" title="删除预设" onClick={() => openConfirmDialog({
                          title: '删除预设？',
                          message: `将永久删除预设「${preset.name}」。`,
                          confirmText: '确认删除',
                          tone: 'danger',
                          action: () => store.deletePreset(preset.id),
                        })} className="cursor-pointer p-1 text-red-500 hover:bg-red-100 rounded-md dark:text-red-400 dark:hover:bg-red-500/20"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="flex min-h-0 flex-col border-r border-gray-200 bg-gray-50/30 dark:border-white/[0.08] dark:bg-gray-900/10">
        <header className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-white/[0.08] shrink-0">
          <h2 className="text-sm font-semibold">预设详情</h2>
          {activePreset && (
            <span className="text-sm text-gray-500 font-medium truncate max-w-[150px]">{activePreset.name}</span>
          )}
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          {activePreset ? (
            <div className="divide-y divide-gray-200 dark:divide-white/[0.08]">
              {/* 基本设置 */}
              <div className="space-y-4 pb-4">
                <label className="block text-[11px] font-medium text-gray-500">基准尺寸
                  <select
                    aria-label="基准尺寸"
                    value={`${activePreset.baseCanvas.width}x${activePreset.baseCanvas.height}`}
                    onChange={(event) => {
                      const selected = PRESET_BASE_SIZES.find((size) => size.value === event.target.value)
                      if (selected) {
                        store.updatePreset(activePreset.id, {
                          baseCanvas: { width: selected.width, height: selected.height },
                        })
                      }
                    }}
                    className="mt-1 w-full cursor-pointer rounded-md border border-gray-200 bg-white px-3 py-2 text-sm dark:border-white/[0.08] dark:bg-gray-900"
                  >
                    {PRESET_BASE_SIZES.map((size) => (
                      <option key={size.value} value={size.value}>{size.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              {/* 输出与分配设置 */}
              <div className="space-y-4 py-4">
                <div className="rounded-md border border-gray-200 bg-white/50 p-3 dark:border-white/[0.08] dark:bg-gray-950/50">
                  <PresetNamingFields
                    preset={activePreset}
                    customVariables={store.customVariables}
                    previewValues={namingPreviewValues}
                    onUpdatePreset={(patch) => store.updatePreset(activePreset.id, patch)}
                    onAddCustomVariable={(name, value) => store.addCustomVariable(name, value, activePreset.id)}
                    onUpdateCustomVariableValue={(name, value) => store.setPresetCustomVariableValue(activePreset.id, name, value)}
                    onRemoveCustomVariable={store.removeCustomVariable}
                    onSelectOutputDirectory={async () => {
                      const path = await window.electronAPI?.selectDirectory?.()
                      if (path) store.updatePreset(activePreset.id, { outputRootPath: path })
                    }}
                  />
                </div>
              </div>

              {/* 覆盖全局渠道/尺寸规则 */}
              <div className="space-y-4 pt-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <input className="cursor-pointer" type="checkbox" checked={activePreset.useOutputOverrides} onChange={(event) => store.updatePreset(activePreset.id, {
                    useOutputOverrides: event.target.checked,
                    outputRuleGroupsOverride: activePreset.outputRuleGroupsOverride.length ? activePreset.outputRuleGroupsOverride : structuredClone(store.outputRuleGroups),
                  })} />
                  覆盖全局渠道与尺寸配置
                </label>
                {activePreset.useOutputOverrides && (
                  <div className="space-y-3">
                    {(activePreset.outputRuleMode === 'replace'
                      ? activePreset.outputRuleGroupsOverride
                      : [
                          ...store.outputRuleGroups,
                          ...activePreset.outputRuleGroupsOverride.filter(
                            (group) => !store.outputRuleGroups.some((globalGroup) => globalGroup.id === group.id),
                          ),
                        ]
                    ).map((globalGroup) => {
                      const overrideGroup = activePreset.outputRuleGroupsOverride.find(g => g.id === globalGroup.id)
                      const mergedRules = globalGroup.rules.map(globalRule => {
                        const overrideRule = overrideGroup?.rules.find(r => r.id === globalRule.id)
                        return { ...globalRule, enabled: overrideRule ? overrideRule.enabled : globalRule.enabled }
                      })
                      const distributionPaths = overrideGroup?.distributionPaths ?? globalGroup.distributionPaths ?? []
                      const allEnabled = mergedRules.length > 0 && mergedRules.every(r => r.enabled)

                      return (
                        <div key={globalGroup.id} className="rounded-md border border-gray-200 bg-gray-50/50 p-2 dark:border-white/[0.08] dark:bg-gray-900/30">
                          <div className="mb-2 flex items-center justify-between">
                            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-200">
                              <input
                                className="cursor-pointer"
                                type="checkbox"
                                aria-label={`全选覆盖 ${globalGroup.name} 尺寸`}
                                checked={allEnabled}
                                onChange={(e) => {
                                  const newOverrides = structuredClone(activePreset.outputRuleGroupsOverride)
                                  let targetGroup = newOverrides.find(g => g.id === globalGroup.id)
                                  if (!targetGroup) {
                                    targetGroup = { id: globalGroup.id, name: globalGroup.name, rules: [], distributionPaths: [] }
                                    newOverrides.push(targetGroup)
                                  }
                                  globalGroup.rules.forEach(gr => {
                                    let targetRule = targetGroup!.rules.find(r => r.id === gr.id)
                                    if (!targetRule) {
                                      targetRule = { ...gr, enabled: e.target.checked }
                                      targetGroup!.rules.push(targetRule)
                                    } else {
                                      targetRule.enabled = e.target.checked
                                    }
                                  })
                                  store.updatePreset(activePreset.id, { outputRuleGroupsOverride: newOverrides })
                                }}
                              />
                              {globalGroup.name}
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                const newOverrides = structuredClone(activePreset.outputRuleGroupsOverride)
                                let targetGroup = newOverrides.find(g => g.id === globalGroup.id)
                                if (!targetGroup) {
                                  targetGroup = { id: globalGroup.id, name: globalGroup.name, rules: [], distributionPaths: [] }
                                  newOverrides.push(targetGroup)
                                }
                                targetGroup.distributionPaths = [...(targetGroup.distributionPaths || []), '']
                                store.updatePreset(activePreset.id, { outputRuleGroupsOverride: newOverrides })
                              }}
                              className="cursor-pointer text-[11px] text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                            >
                              + 分配地址
                            </button>
                          </div>
                          
                          {distributionPaths.length > 0 && (
                            <div className="mb-2 space-y-1">
                              {distributionPaths.map((path, idx) => (
                                <div key={idx} className="flex items-center gap-1">
                                  <input
                                    value={path}
                                    onChange={(e) => {
                                      const newOverrides = structuredClone(activePreset.outputRuleGroupsOverride)
                                      const targetGroup = newOverrides.find(g => g.id === globalGroup.id)!
                                      targetGroup.distributionPaths[idx] = e.target.value
                                      store.updatePreset(activePreset.id, { outputRuleGroupsOverride: newOverrides })
                                    }}
                                    placeholder="输入渠道分配地址..."
                                    className="min-w-0 flex-1 cursor-text rounded border border-gray-200 bg-white px-2 py-1 text-[11px] dark:border-white/[0.08] dark:bg-gray-950"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newOverrides = structuredClone(activePreset.outputRuleGroupsOverride)
                                      const targetGroup = newOverrides.find(g => g.id === globalGroup.id)!
                                      targetGroup.distributionPaths.splice(idx, 1)
                                      store.updatePreset(activePreset.id, { outputRuleGroupsOverride: newOverrides })
                                    }}
                                    className="cursor-pointer p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-1.5">
                            {mergedRules.map(rule => (
                              <label
                                key={rule.id}
                                className={`flex cursor-pointer items-center justify-center rounded border px-2 py-1.5 text-[11px] transition-colors ${rule.enabled ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-200' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-400 dark:hover:bg-gray-900'}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={rule.enabled}
                                  onChange={(e) => {
                                    const newOverrides = structuredClone(activePreset.outputRuleGroupsOverride)
                                    let targetGroup = newOverrides.find(g => g.id === globalGroup.id)
                                    if (!targetGroup) {
                                      targetGroup = { id: globalGroup.id, name: globalGroup.name, rules: [], distributionPaths: [] }
                                      newOverrides.push(targetGroup)
                                    }
                                    let targetRule = targetGroup.rules.find(r => r.id === rule.id)
                                    if (!targetRule) {
                                      targetRule = { ...rule, enabled: e.target.checked }
                                      targetGroup.rules.push(targetRule)
                                    } else {
                                      targetRule.enabled = e.target.checked
                                    }
                                    store.updatePreset(activePreset.id, { outputRuleGroupsOverride: newOverrides })
                                  }}
                                  className="hidden cursor-pointer"
                                />
                                {rule.width} × {rule.height}
                                {globalGroup.id.startsWith('hanhai:output:') && (
                                  <span className="ml-1 opacity-70">· {rule.maxSizeKb}KB · Q{Math.round((rule.jpegQuality ?? 0.9) * 100)}</span>
                                )}
                              </label>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">
              请在左侧选择一个预设
            </div>
          )}
        </div>
      </div>

      <div
        data-layout="editor-shell"
        className="grid min-h-0 grid-cols-[minmax(0,1fr)_288px] grid-rows-[minmax(0,1fr)_280px] overflow-hidden"
      >
        <div data-layout="canvas-pane" className="min-h-0 overflow-hidden">
          <PresetCanvasEditor
            preset={activePreset}
            selectedLayerId={selectedLayerId}
            onSelectLayer={setSelectedLayerId}
            onAddText={handleAddTextLayer}
            onAddImage={handleAddImageLayer}
            onAddLogo={handleAddLogoLayer}
            onUpdatePreset={(patch) => activePreset && store.updatePreset(activePreset.id, patch)}
          />
        </div>

        <div className="min-h-0 overflow-hidden border-l border-gray-200 dark:border-white/[0.08]">
          <FloatingLogoLibrary
            variant="sidebar"
            path={store.logoLibraryPath}
            assets={sortedLogoAssets}
            statusText={logoStatusText}
            isRefreshing={isRefreshingLogos}
            assetsDisabled={!activePreset}
            assetDisabledReason="请先选择预设以插入该 LOGO"
            onSelectFolder={() => void chooseLogoFolder()}
            onRefresh={() => {}}
            onDeleteAsset={deleteLogoAsset}
            onRenameAsset={renameLogoAsset}
            onReorderAssets={(newAssets) => store.setLogoOrder(newAssets.map((a) => a.path))}
            onImportFiles={importLogoFiles}
            onPickAsset={(asset) => {
              if (!activePreset) return
              const logo = store.projectLogos.find((item) => item.id === asset.path)
              if (!logo?.assetId) return
              const layerId = store.replaceOrAddLogoLayer(
                activePreset.id,
                { kind: 'stored', assetId: logo.assetId, name: logo.name },
                selectedLayerId,
              )
              setSelectedLayerId(layerId)
            }}
          />
        </div>

        <div
          data-layout="layer-bottom-panel"
          className="col-span-2 min-h-0 overflow-hidden border-t border-gray-200 dark:border-white/[0.08]"
        >
          <PresetLayerPanel
            preset={activePreset}
            selectedLayerId={selectedLayerId}
            onSelectLayer={setSelectedLayerId}
            onUpdatePreset={(patch) => activePreset && store.updatePreset(activePreset.id, patch)}
          />
        </div>
      </div>

      {hanhaiImportDialog && (
        <div
          className="ds-modal-layer fixed inset-0 flex items-center justify-center p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isImportingHanhai) setHanhaiImportDialog(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="hanhai-import-title"
            className="ds-modal-surface relative z-10 flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border"
          >
            <header className="border-b border-gray-200 px-5 py-4 dark:border-white/[0.08]">
              <h2 id="hanhai-import-title" className="text-base font-semibold">导入瀚海产品预设</h2>
              <p className="mt-1 truncate text-xs text-gray-500" title={hanhaiImportDialog.source.configPath}>{hanhaiImportDialog.source.configPath}</p>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="grid grid-cols-5 gap-2">
                {[
                  ['检测总数', hanhaiImportDialog.preview.totalCount],
                  ['本次新增', hanhaiImportDialog.preview.newCount],
                  ['重复跳过', hanhaiImportDialog.preview.duplicateCount],
                  ['配置完整', hanhaiImportDialog.preview.completeCount],
                  ['缺少素材', hanhaiImportDialog.preview.missingAssetPresetCount],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-white/[0.08] dark:bg-gray-900">
                    <div className="text-[11px] text-gray-500">{label}</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-md border border-blue-100 bg-blue-50/60 p-3 text-xs leading-5 text-blue-900 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-100">
                导入不会覆盖豆泡已有预设。图片水印会复制到豆泡内部素材库；再次导入相同来源 ID 时直接跳过。
              </div>
              {hanhaiImportDialog.preview.missingAssets.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-300">缺失水印明细</h3>
                  <div className="mt-2 max-h-52 space-y-2 overflow-y-auto rounded-md border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-500/20 dark:bg-amber-500/10">
                    {hanhaiImportDialog.preview.missingAssets.map((item, index) => (
                      <div key={`${item.presetId}:${item.path}:${index}`} className="text-xs">
                        <div className="font-medium text-gray-800 dark:text-gray-100">{item.presetName}</div>
                        <div className="mt-0.5 break-all text-amber-700 dark:text-amber-300">{item.path}</div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-gray-500">这些预设仍会导入，并以“缺水印”标记；补齐图片后可在图层面板替换。</p>
                </div>
              )}
            </div>
            <footer className="flex items-center justify-between border-t border-gray-200 px-5 py-4 dark:border-white/[0.08]">
              <button type="button" disabled={isImportingHanhai} onClick={() => void loadHanhaiImport(true)} className="rounded-md border border-gray-200 px-3 py-2 text-xs font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-white/[0.08] dark:hover:bg-gray-900">选择其他 JSON</button>
              <div className="flex items-center gap-2">
                <button type="button" disabled={isImportingHanhai} onClick={() => setHanhaiImportDialog(null)} className="rounded-md border border-gray-200 px-4 py-2 text-xs font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-white/[0.08] dark:hover:bg-gray-900">取消</button>
                <button
                  type="button"
                  disabled={isImportingHanhai || hanhaiImportDialog.preview.newCount === 0}
                  onClick={() => void confirmHanhaiImport()}
                  className="inline-flex min-w-24 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isImportingHanhai && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {hanhaiImportDialog.preview.newCount === 0 ? '没有可导入项' : `确认导入 ${hanhaiImportDialog.preview.newCount} 条`}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}
