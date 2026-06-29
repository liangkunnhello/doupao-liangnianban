import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, FolderOpen, Pause, Play, RefreshCw, Shuffle, Square } from 'lucide-react'
import { naturalSortBackgrounds } from '../lib/compositeBackgrounds'
import { createCompositeExportSnapshot, expandCompositeExportItems } from '../lib/compositeExportPlan'
import { runCompositeV2Export } from '../lib/compositeExportRuntime'
import { renderCompositeV2ToCanvas } from '../lib/compositeRendererV2'
import { useCompositeV2Store } from '../storeV2'
import { ExportResultsPanel } from './ExportResultsPanel'

type PreviewFile = {
  path: string
  name: string
  dataUrl: string
}

function getElectronApi() {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

function getSelectedGroup<T extends { id: string }>(items: T[], selectedId: string) {
  return items.find((item) => item.id === selectedId) ?? items[0] ?? null
}

function getPreviewPath(previewHistory: string[], previewHistoryIndex: number) {
  if (previewHistoryIndex < 0) return ''
  return previewHistory[previewHistoryIndex] ?? ''
}

export function BatchExportTab() {
  const backgroundFolder = useCompositeV2Store((state) => state.backgroundFolder)
  const recursiveBackgrounds = useCompositeV2Store((state) => state.recursiveBackgrounds)
  const backgrounds = useCompositeV2Store((state) => state.backgrounds)
  const previewHistory = useCompositeV2Store((state) => state.previewHistory)
  const previewHistoryIndex = useCompositeV2Store((state) => state.previewHistoryIndex)
  const presets = useCompositeV2Store((state) => state.presets)
  const groups = useCompositeV2Store((state) => state.presetGroups)
  const outputRuleGroups = useCompositeV2Store((state) => state.outputRuleGroups)
  const globalFitMode = useCompositeV2Store((state) => state.globalFitMode)
  const selectedPresetGroupId = useCompositeV2Store((state) => state.selectedPresetGroupId)
  const selectedPreviewPresetId = useCompositeV2Store((state) => state.selectedPreviewPresetId)
  const enabledPresetIdsForRun = useCompositeV2Store((state) => state.enabledPresetIdsForRun)
  const customValue = useCompositeV2Store((state) => state.customValue)
  const preserveSourceDir = useCompositeV2Store((state) => state.preserveSourceDir)
  const exportStatus = useCompositeV2Store((state) => state.exportStatus)
  const exportCompleted = useCompositeV2Store((state) => state.exportCompleted)
  const exportTotal = useCompositeV2Store((state) => state.exportTotal)
  const history = useCompositeV2Store((state) => state.history)
  const exportSuccesses = useCompositeV2Store((state) => state.exportSuccesses)
  const exportFailures = useCompositeV2Store((state) => state.exportFailures)
  const setBackgroundFolder = useCompositeV2Store((state) => state.setBackgroundFolder)
  const setRecursiveBackgrounds = useCompositeV2Store((state) => state.setRecursiveBackgrounds)
  const setBackgrounds = useCompositeV2Store((state) => state.setBackgrounds)
  const setSelectedPresetGroup = useCompositeV2Store((state) => state.setSelectedPresetGroup)
  const setSelectedPreviewPresetId = useCompositeV2Store((state) => state.setSelectedPreviewPresetId)
  const setEnabledPresetIdsForRun = useCompositeV2Store((state) => state.setEnabledPresetIdsForRun)
  const setCustomValue = useCompositeV2Store((state) => state.setCustomValue)
  const setPreserveSourceDir = useCompositeV2Store((state) => state.setPreserveSourceDir)
  const setExportProgress = useCompositeV2Store((state) => state.setExportProgress)
  const setExportStatus = useCompositeV2Store((state) => state.setExportStatus)
  const pushPreviewBackground = useCompositeV2Store((state) => state.pushPreviewBackground)
  const previousPreviewBackground = useCompositeV2Store((state) => state.previousPreviewBackground)
  const nextPreviewBackground = useCompositeV2Store((state) => state.nextPreviewBackground)
  const resetExportResults = useCompositeV2Store((state) => state.resetExportResults)
  const addExportSuccess = useCompositeV2Store((state) => state.addExportSuccess)
  const addExportFailure = useCompositeV2Store((state) => state.addExportFailure)
  const addHistoryRecord = useCompositeV2Store((state) => state.addHistoryRecord)
  const setGlobalFitMode = useCompositeV2Store((state) => state.setGlobalFitMode)
  const updateOutputRule = useCompositeV2Store((state) => state.updateOutputRule)
  const setOutputRuleGroupEnabled = useCompositeV2Store((state) => state.setOutputRuleGroupEnabled)

  const [backgroundStatus, setBackgroundStatus] = useState('选择文件夹后加载背景图片。')
  const [previewStatus, setPreviewStatus] = useState('加载背景后将随机显示一张预览。')
  const [runStatusText, setRunStatusText] = useState('请完成背景、预设和尺寸规则配置。')
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null)
  const [isLoadingBackgrounds, setIsLoadingBackgrounds] = useState(false)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const pausedRef = useRef(false)
  const canceledRef = useRef(false)

  const electronApi = getElectronApi()
  const canBrowseBackgrounds = Boolean(electronApi?.isElectron && electronApi.listCompositeBackgroundFiles)
  const selectedGroup = useMemo(
    () => getSelectedGroup(groups, selectedPresetGroupId),
    [groups, selectedPresetGroupId],
  )
  const groupPresets = useMemo(
    () => (selectedGroup?.presetIds ?? [])
      .map((presetId) => presets.find((preset) => preset.id === presetId) ?? null)
      .filter((preset): preset is NonNullable<typeof preset> => Boolean(preset)),
    [presets, selectedGroup],
  )
  const enabledPresetIdsSet = useMemo(
    () => new Set(enabledPresetIdsForRun),
    [enabledPresetIdsForRun],
  )
  const enabledPresets = useMemo(
    () => groupPresets.filter((preset) => enabledPresetIdsSet.has(preset.id)),
    [enabledPresetIdsSet, groupPresets],
  )
  const plannedExportCount = useMemo(() => {
    if (!selectedGroup || !backgrounds.length || !enabledPresets.length) return 0

    const snapshot = createCompositeExportSnapshot({
      id: 'shell-preview',
      date: 'shell',
      backgroundFolder,
      recursive: recursiveBackgrounds,
      backgrounds,
      presets,
      presetGroup: selectedGroup,
      enabledPresetIds: enabledPresets.map((preset) => preset.id),
      outputRuleGroups,
      custom: customValue,
      fitMode: globalFitMode,
      preserveSourceDir,
    })

    return expandCompositeExportItems(snapshot).length
  }, [
    backgroundFolder,
    backgrounds,
    customValue,
    enabledPresets,
    globalFitMode,
    outputRuleGroups,
    preserveSourceDir,
    presets,
    recursiveBackgrounds,
    selectedGroup,
  ])
  const currentPreviewPath = useMemo(
    () => getPreviewPath(previewHistory, previewHistoryIndex),
    [previewHistory, previewHistoryIndex],
  )
  const currentPreviewBackground = useMemo(
    () => backgrounds.find((background) => background.path === currentPreviewPath) ?? null,
    [backgrounds, currentPreviewPath],
  )
  const selectedPreviewPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPreviewPresetId) ?? enabledPresets[0] ?? null,
    [enabledPresets, presets, selectedPreviewPresetId],
  )
  const canGoPrevious = previewHistoryIndex > 0
  const canGoNext = previewHistoryIndex >= 0 && previewHistoryIndex < previewHistory.length - 1
  const canPickRandom = backgrounds.length > 0
  const canStartExport = backgrounds.length > 0
    && Boolean(selectedGroup)
    && enabledPresets.length > 0
    && enabledPresets.every((preset) => preset.outputRootPath.trim())
    && plannedExportCount > 0

  useEffect(() => {
    let active = true

    async function loadPreview() {
      if (!currentPreviewPath) {
        setPreviewFile(null)
        setPreviewStatus(
          backgrounds.length
            ? 'Pick a preview step to inspect the current background.'
            : 'Random preview will appear here after backgrounds load.',
        )
        return
      }

      if (!electronApi?.isElectron || !electronApi.readImageFile) {
        setPreviewFile(null)
        setPreviewStatus('Desktop preview is unavailable in the current environment.')
        return
      }

      setIsLoadingPreview(true)
      setPreviewStatus('Loading preview background...')

      try {
        const file = await electronApi.readImageFile(currentPreviewPath)
        if (!active) return
        if (!file?.dataUrl) {
          setPreviewFile(null)
          setPreviewStatus('Preview image could not be read from disk.')
          return
        }
        setPreviewFile(file)
        setPreviewStatus('Preview keeps the source image ratio inside a stable frame.')
      } catch (error) {
        if (!active) return
        setPreviewFile(null)
        setPreviewStatus(error instanceof Error ? error.message : 'Preview image failed to load.')
      } finally {
        if (active) setIsLoadingPreview(false)
      }
    }

    void loadPreview()
    return () => {
      active = false
    }
  }, [backgrounds.length, currentPreviewPath, electronApi])

  useEffect(() => {
    if (!previewFile?.dataUrl || !selectedPreviewPreset || !previewCanvasRef.current) return
    let active = true
    void renderCompositeV2ToCanvas({
      backgroundDataUrl: previewFile.dataUrl,
      preset: selectedPreviewPreset,
      targetSize: selectedPreviewPreset.baseCanvas,
      fitMode: globalFitMode,
    }, previewCanvasRef.current).catch((error) => {
      if (active) setPreviewStatus(error instanceof Error ? error.message : 'Composite preview failed.')
    })
    return () => {
      active = false
    }
  }, [globalFitMode, previewFile?.dataUrl, selectedPreviewPreset])

  async function loadBackgroundFolder(nextFolder: string, nextRecursive: boolean) {
    const trimmedFolder = nextFolder.trim()

    if (!electronApi?.isElectron || !electronApi.listCompositeBackgroundFiles) {
      setBackgroundStatus('Desktop directory loading is unavailable in the current environment.')
      return
    }
    if (!trimmedFolder) {
      setBackgroundStatus('Please select a background folder first.')
      return
    }

    setBackgroundFolder(trimmedFolder)
    setRecursiveBackgrounds(nextRecursive)
    setIsLoadingBackgrounds(true)
    setBackgroundStatus(nextRecursive ? 'Loading backgrounds recursively...' : 'Loading backgrounds...')

    try {
      const files = await electronApi.listCompositeBackgroundFiles(trimmedFolder, nextRecursive)
      const nextBackgrounds = naturalSortBackgrounds(files)
      setBackgrounds(nextBackgrounds)
      setBackgroundStatus(
        nextBackgrounds.length
          ? `Loaded ${nextBackgrounds.length} background files.`
          : 'No supported background images were found in that folder.',
      )
    } catch (error) {
      setBackgrounds([])
      setBackgroundStatus(error instanceof Error ? error.message : 'Failed to load background folder.')
    } finally {
      setIsLoadingBackgrounds(false)
    }
  }

  async function handleSelectBackgroundFolder() {
    if (!electronApi?.isElectron || !electronApi.selectDirectory || !electronApi.listCompositeBackgroundFiles) {
      setBackgroundStatus('Desktop folder selection is unavailable in the current environment.')
      return
    }

    const nextFolder = await electronApi.selectDirectory()
    if (!nextFolder) {
      setBackgroundStatus('Background folder selection was canceled.')
      return
    }

    await loadBackgroundFolder(nextFolder, recursiveBackgrounds)
  }

  async function handleRecursiveChange(nextRecursive: boolean) {
    if (!backgroundFolder.trim()) {
      setRecursiveBackgrounds(nextRecursive)
      setBackgroundStatus('Recursive mode updated. Select a background folder to load files.')
      return
    }

    await loadBackgroundFolder(backgroundFolder, nextRecursive)
  }

  async function handleReloadBackgrounds() {
    if (!backgroundFolder.trim()) {
      setBackgroundStatus('Please select a background folder before reloading.')
      return
    }

    await loadBackgroundFolder(backgroundFolder, recursiveBackgrounds)
  }

  function handleRandomPreview() {
    if (!backgrounds.length) return
    const randomIndex = Math.min(backgrounds.length - 1, Math.max(0, Math.floor(Math.random() * backgrounds.length)))
    const nextBackground = backgrounds[randomIndex] ?? backgrounds[0]
    if (!nextBackground) return
    pushPreviewBackground(nextBackground.path)
    setPreviewStatus(`Preview moved to ${nextBackground.name}.`)
  }

  function handleTogglePreset(presetId: string, checked: boolean) {
    const orderedIds = groupPresets.map((preset) => preset.id)
    const nextSelectedIds = checked
      ? orderedIds.filter((id) => id === presetId || enabledPresetIdsSet.has(id))
      : orderedIds.filter((id) => id !== presetId && enabledPresetIdsSet.has(id))
    setEnabledPresetIdsForRun(nextSelectedIds)
  }

  async function handleStartExport() {
    if (!selectedGroup || !canStartExport) return
    const startedAt = Date.now()
    const now = new Date()
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    const snapshot = createCompositeExportSnapshot({
      id: `export-${startedAt}`,
      date,
      backgroundFolder,
      recursive: recursiveBackgrounds,
      backgrounds,
      presets,
      presetGroup: selectedGroup,
      enabledPresetIds: enabledPresets.map((preset) => preset.id),
      outputRuleGroups,
      custom: customValue,
      fitMode: globalFitMode,
      preserveSourceDir,
    }, startedAt)
    resetExportResults()
    pausedRef.current = false
    canceledRef.current = false
    setExportStatus('running')
    setExportProgress(0, plannedExportCount)
    setRunStatusText('正在导出...')
    const successes: typeof exportSuccesses = []
    const failures: typeof exportFailures = []
    try {
      await runCompositeV2Export(snapshot, {
        onProgress: setExportProgress,
        onSuccess: (item) => {
          successes.push(item)
          addExportSuccess(item)
        },
        onFailure: (item) => {
          failures.push(item)
          addExportFailure(item)
        },
        shouldPause: () => pausedRef.current,
        shouldCancel: () => canceledRef.current,
      })
      const canceled = canceledRef.current
      setExportStatus(canceled ? 'canceled' : 'completed')
      setRunStatusText(canceled ? '导出已取消。' : `导出完成：${successes.length} 成功，${failures.length} 失败。`)
      addHistoryRecord({
        id: snapshot.id,
        status: canceled ? 'canceled' : failures.length ? 'completed-with-failures' : 'completed',
        startedAt,
        endedAt: Date.now(),
        backgroundFolder,
        recursive: recursiveBackgrounds,
        backgroundCount: backgrounds.length,
        presetGroupName: selectedGroup.name,
        enabledPresetCount: enabledPresets.length,
        plannedCount: plannedExportCount,
        successCount: successes.length,
        failureCount: failures.length,
        successes,
        failures,
      })
    } catch (error) {
      setExportStatus('canceled')
      setRunStatusText(error instanceof Error ? error.message : '导出运行失败。')
    }
  }

  function handlePauseResume() {
    const nextPaused = !pausedRef.current
    pausedRef.current = nextPaused
    setExportStatus(nextPaused ? 'paused' : 'running')
    setRunStatusText(nextPaused ? '导出已暂停。' : '正在继续导出...')
  }

  async function handleCancel() {
    if (!window.confirm('确定取消当前导出吗？')) return
    canceledRef.current = true
    pausedRef.current = false
    setExportStatus('canceling')
    if (exportSuccesses.length && !window.confirm('保留已经导出的文件？选择“取消”将删除这些文件。')) {
      const cleanup = await window.electronAPI?.deleteCompositeFiles?.(exportSuccesses.map((item) => item.path))
      setRunStatusText(cleanup?.failed.length ? `已取消，${cleanup.failed.length} 个文件删除失败。` : '已取消并删除已导出文件。')
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-x-auto">
      <div className="grid min-h-0 min-w-[1160px] grid-cols-[240px_minmax(0,1fr)_320px] grid-rows-[minmax(0,1fr)_auto] gap-4">
        <section className="min-h-0 rounded-md border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-950">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">背景文件夹</h2>
            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              默认加载全部支持的图片，可选择是否递归子文件夹。
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleSelectBackgroundFolder()}
            disabled={isLoadingBackgrounds || !canBrowseBackgrounds}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.04]"
          >
            <FolderOpen className="h-4 w-4" />
            <span>选择背景文件夹</span>
          </button>

          <div className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-white/[0.04] dark:text-gray-300">
            <div className="truncate font-medium text-gray-800 dark:text-gray-100">
              {backgroundFolder || '尚未选择文件夹'}
            </div>
            <div className="mt-1">{backgroundStatus}</div>
          </div>

          <label className="mt-4 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              aria-label="Recursive backgrounds"
              checked={recursiveBackgrounds}
              onChange={(event) => void handleRecursiveChange(event.target.checked)}
            />
            <span>递归加载子文件夹</span>
          </label>

          <button
            type="button"
            onClick={() => void handleReloadBackgrounds()}
            disabled={isLoadingBackgrounds || !backgroundFolder.trim()}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.04]"
          >
            <RefreshCw className={`h-4 w-4 ${isLoadingBackgrounds ? 'animate-spin' : ''}`} />
            <span>重新加载</span>
          </button>

          <dl className="mt-4 grid gap-3 text-sm text-gray-600 dark:text-gray-300">
            <div className="rounded-md border border-gray-200 px-3 py-2 dark:border-white/[0.08]">
              <dt className="text-[11px] text-gray-400 dark:text-gray-500">已加载</dt>
              <dd className="mt-1 font-medium">{backgrounds.length} 张</dd>
            </div>
            <div className="rounded-md border border-gray-200 px-3 py-2 dark:border-white/[0.08]">
              <dt className="text-[11px] text-gray-400 dark:text-gray-500">预览历史</dt>
              <dd className="mt-1 font-medium">{previewHistory.length} 张</dd>
            </div>
          </dl>
        </section>

        <section className="min-h-0 rounded-md border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-950">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">合成预览</h2>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                {currentPreviewBackground?.name ?? '尚未选择背景'}
                {currentPreviewBackground?.relativeDir ? ` - ${currentPreviewBackground.relativeDir}` : ''}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Previous preview"
                title="Previous preview"
                onClick={previousPreviewBackground}
                disabled={!canGoPrevious}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.04]"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Random preview"
                title="Random preview"
                onClick={handleRandomPreview}
                disabled={!canPickRandom}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.04]"
              >
                <Shuffle className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Next preview"
                title="Next visited preview"
                onClick={nextPreviewBackground}
                disabled={!canGoNext}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.04]"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-4 flex min-h-[360px] items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 dark:border-white/[0.12] dark:bg-white/[0.03]">
            <div className="flex aspect-video w-full max-w-[760px] items-center justify-center overflow-hidden rounded-md bg-white dark:bg-gray-900">
              {previewFile?.dataUrl && selectedPreviewPreset ? (
                <canvas
                  ref={previewCanvasRef}
                  aria-label={`预览 ${previewFile.name} 与 ${selectedPreviewPreset.name}`}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <div className="px-6 text-center text-sm text-gray-400 dark:text-gray-500">
                  {isLoadingPreview ? '正在加载预览...' : '加载背景后在这里显示合成预览。'}
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
            <span>{previewStatus}</span>
            <span>{previewHistoryIndex >= 0 ? `${previewHistoryIndex + 1} / ${previewHistory.length}` : '0 / 0'}</span>
          </div>
        </section>

        <section className="min-h-0 rounded-md border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-950">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">本次导出</h2>
            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              每次选择一个预设组，并临时勾选本次需要导出的产品预设。
            </p>
          </div>

          <div className="mt-4 space-y-2">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                aria-pressed={selectedGroup?.id === group.id}
                onClick={() => setSelectedPresetGroup(group.id)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition ${
                  selectedGroup?.id === group.id
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200'
                    : 'border border-transparent text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.04]'
                }`}
              >
                <span className="truncate">{group.name}</span>
                <span className="ml-3 shrink-0 text-[11px] opacity-70">{group.presetIds.length}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-md border border-gray-200 dark:border-white/[0.08]">
            <div className="border-b border-gray-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-white/[0.08] dark:text-gray-400">
              组内预设
            </div>
            <div className="max-h-[240px] space-y-1 overflow-y-auto p-2">
              {groupPresets.length ? groupPresets.map((preset) => {
                const isEnabled = enabledPresetIdsSet.has(preset.id)
                const isPreviewPreset = selectedPreviewPresetId === preset.id

                return (
                  <div
                    key={preset.id}
                    className={`flex items-start gap-3 rounded-md px-2 py-2 transition ${
                      isPreviewPreset
                        ? 'bg-blue-50 dark:bg-blue-500/10'
                        : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    <button
                      type="button"
                      aria-label={`Preview preset ${preset.name}`}
                      aria-pressed={isPreviewPreset}
                      onClick={() => setSelectedPreviewPresetId(preset.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{preset.name}</div>
                      <div className="mt-1 truncate text-[11px] text-gray-500 dark:text-gray-400">
                        {preset.outputRootPath.trim() ? preset.outputRootPath : '尚未设置输出根目录'}
                      </div>
                    </button>
                    <label className="mt-0.5 inline-flex shrink-0 items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                      <input
                        type="checkbox"
                        aria-label={`Include preset ${preset.name}`}
                        value={preset.id}
                        checked={isEnabled}
                        onChange={(event) => handleTogglePreset(preset.id, event.target.checked)}
                      />
                      <span>导出</span>
                    </label>
                  </div>
                )
              }) : (
                <div className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-xs text-gray-400 dark:border-white/[0.08] dark:text-gray-500">
                  No presets are available in the selected group yet.
                </div>
              )}
            </div>
          </div>

          <label className="mt-4 block text-xs font-medium text-gray-500 dark:text-gray-400">
            自定义参数
            <input
              value={customValue}
              onChange={(event) => setCustomValue(event.target.value)}
              placeholder="本次导出全局共用"
              className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100"
            />
          </label>

          <label className="mt-4 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={preserveSourceDir}
              onChange={(event) => setPreserveSourceDir(event.target.checked)}
            />
            <span>保留源文件夹层级</span>
          </label>

          <div className="mt-4 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-white/[0.04] dark:text-gray-300">
            <div>本次已选择 {enabledPresets.length} 个预设。</div>
            <div className="mt-1">{runStatusText}</div>
            <div className="mt-1">
              {canStartExport
                ? `预计输出 ${plannedExportCount} 张`
                : '请先加载背景、设置输出目录并启用至少一个尺寸规则。'}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleStartExport()}
            disabled={!canStartExport || exportStatus === 'running' || exportStatus === 'paused' || exportStatus === 'canceling'}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            <span>开始导出</span>
          </button>
          {(exportStatus === 'running' || exportStatus === 'paused') && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={handlePauseResume} className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-white/[0.08]">
                {exportStatus === 'paused' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                {exportStatus === 'paused' ? '继续' : '暂停'}
              </button>
              <button type="button" onClick={() => void handleCancel()} className="inline-flex items-center justify-center gap-2 rounded-md border border-red-200 px-3 py-2 text-sm text-red-600 dark:border-red-500/30">
                <Square className="h-4 w-4" />取消
              </button>
            </div>
          )}
        </section>

        <section className="col-span-3 rounded-md border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-950">
          <div className="flex items-center justify-between gap-4">
            <div><h2 className="text-sm font-semibold">全局输出尺寸 / 最大 KB</h2><p className="mt-1 text-[11px] text-gray-500">预设默认共用这些规则；已启用规则决定每张背景的输出数量。</p></div>
            <label className="text-xs text-gray-500">非等比适配
              <select value={globalFitMode} onChange={(event) => setGlobalFitMode(event.target.value as typeof globalFitMode)} className="ml-2 rounded-md border border-gray-200 px-2 py-1 dark:border-white/[0.08] dark:bg-gray-900">
                <option value="crop-fill">裁切填满</option><option value="contain-blur">完整留边（模糊背景）</option><option value="stretch">拉伸变形</option>
              </select>
            </label>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            {outputRuleGroups.map((group) => (
              <div key={group.id} className="rounded-md border border-gray-200 p-3 dark:border-white/[0.08]">
                <label className="mb-2 flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    aria-label={`Select all ${group.name} sizes`}
                    checked={group.rules.length > 0 && group.rules.every((rule) => rule.enabled)}
                    onChange={(event) => setOutputRuleGroupEnabled(group.id, event.target.checked)}
                  />
                  <span>{group.name}</span>
                </label>
                <div className="space-y-2">
                  {group.rules.map((rule) => (
                    <div key={rule.id} className="grid grid-cols-[auto_64px_auto_64px_70px] items-center gap-1 text-xs">
                      <input type="checkbox" checked={rule.enabled} onChange={(event) => updateOutputRule(rule.id, { enabled: event.target.checked })} aria-label={`启用 ${group.name} ${rule.name}`} />
                      <input aria-label={`${rule.name} 宽`} type="number" min={1} value={rule.width} onChange={(event) => updateOutputRule(rule.id, { width: Math.max(1, Number(event.target.value)), name: `${Math.max(1, Number(event.target.value))}x${rule.height}` })} className="w-16 rounded border border-gray-200 px-1 py-0.5 dark:border-white/[0.08] dark:bg-gray-900" />
                      <span>x</span>
                      <input aria-label={`${rule.name} 高`} type="number" min={1} value={rule.height} onChange={(event) => updateOutputRule(rule.id, { height: Math.max(1, Number(event.target.value)), name: `${rule.width}x${Math.max(1, Number(event.target.value))}` })} className="w-16 rounded border border-gray-200 px-1 py-0.5 dark:border-white/[0.08] dark:bg-gray-900" />
                      <label className="flex items-center gap-1"><input type="number" min={1} value={rule.maxSizeKb} onChange={(event) => updateOutputRule(rule.id, { maxSizeKb: Math.max(1, Number(event.target.value)) })} className="w-14 rounded border border-gray-200 px-1 py-0.5 dark:border-white/[0.08] dark:bg-gray-900" />KB</label>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="col-span-3">
          <ExportResultsPanel
            status={exportStatus}
            completed={exportCompleted}
            total={exportTotal}
            history={history}
            successes={exportSuccesses}
            failures={exportFailures}
          />
        </div>
      </div>
    </div>
  )
}
