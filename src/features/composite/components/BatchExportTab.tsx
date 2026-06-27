import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, FolderOpen, Play, RefreshCw, Shuffle } from 'lucide-react'
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
  const selectedPresetGroupId = useCompositeV2Store((state) => state.selectedPresetGroupId)
  const selectedPreviewPresetId = useCompositeV2Store((state) => state.selectedPreviewPresetId)
  const enabledPresetIdsForRun = useCompositeV2Store((state) => state.enabledPresetIdsForRun)
  const customValue = useCompositeV2Store((state) => state.customValue)
  const preserveSourceDir = useCompositeV2Store((state) => state.preserveSourceDir)
  const exportStatus = useCompositeV2Store((state) => state.exportStatus)
  const exportCompleted = useCompositeV2Store((state) => state.exportCompleted)
  const exportTotal = useCompositeV2Store((state) => state.exportTotal)
  const history = useCompositeV2Store((state) => state.history)
  const setBackgroundFolder = useCompositeV2Store((state) => state.setBackgroundFolder)
  const setRecursiveBackgrounds = useCompositeV2Store((state) => state.setRecursiveBackgrounds)
  const setBackgrounds = useCompositeV2Store((state) => state.setBackgrounds)
  const setSelectedPresetGroup = useCompositeV2Store((state) => state.setSelectedPresetGroup)
  const setSelectedPreviewPresetId = useCompositeV2Store((state) => state.setSelectedPreviewPresetId)
  const setEnabledPresetIdsForRun = useCompositeV2Store((state) => state.setEnabledPresetIdsForRun)
  const setCustomValue = useCompositeV2Store((state) => state.setCustomValue)
  const setPreserveSourceDir = useCompositeV2Store((state) => state.setPreserveSourceDir)
  const pushPreviewBackground = useCompositeV2Store((state) => state.pushPreviewBackground)
  const previousPreviewBackground = useCompositeV2Store((state) => state.previousPreviewBackground)
  const nextPreviewBackground = useCompositeV2Store((state) => state.nextPreviewBackground)

  const [backgroundStatus, setBackgroundStatus] = useState('Select a folder to load composite backgrounds.')
  const [previewStatus, setPreviewStatus] = useState('Random preview will appear here after backgrounds load.')
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null)
  const [isLoadingBackgrounds, setIsLoadingBackgrounds] = useState(false)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)

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
  const currentPreviewPath = useMemo(
    () => getPreviewPath(previewHistory, previewHistoryIndex),
    [previewHistory, previewHistoryIndex],
  )
  const currentPreviewBackground = useMemo(
    () => backgrounds.find((background) => background.path === currentPreviewPath) ?? null,
    [backgrounds, currentPreviewPath],
  )
  const canGoPrevious = previewHistoryIndex > 0
  const canGoNext = previewHistoryIndex >= 0 && previewHistoryIndex < previewHistory.length - 1
  const canPickRandom = backgrounds.length > 0
  const canStartExport = backgrounds.length > 0
    && Boolean(selectedGroup)
    && enabledPresets.length > 0
    && enabledPresets.every((preset) => preset.outputRootPath.trim())
  const electronApi = getElectronApi()
  const canBrowseBackgrounds = Boolean(electronApi?.isElectron && electronApi.listCompositeBackgroundFiles)

  useEffect(() => {
    let active = true

    async function loadPreview() {
      if (!currentPreviewPath) {
        setPreviewFile(null)
        setPreviewStatus(backgrounds.length ? 'Pick a preview step to inspect the current background.' : 'Random preview will appear here after backgrounds load.')
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

    setIsLoadingBackgrounds(true)
    setBackgroundStatus(nextRecursive ? 'Loading backgrounds recursively...' : 'Loading backgrounds...')

    try {
      const nextBackgrounds = await electronApi.listCompositeBackgroundFiles(trimmedFolder, nextRecursive)
      setBackgroundFolder(trimmedFolder)
      setRecursiveBackgrounds(nextRecursive)
      setBackgrounds(nextBackgrounds)
      setBackgroundStatus(
        nextBackgrounds.length
          ? `Loaded ${nextBackgrounds.length} background files.`
          : 'No supported background images were found in that folder.',
      )
    } catch (error) {
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
    setRecursiveBackgrounds(nextRecursive)
    if (!backgroundFolder.trim()) {
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
    const index = Math.min(backgrounds.length - 1, Math.max(0, Math.floor(Math.random() * backgrounds.length)))
    const nextBackground = backgrounds[index] ?? backgrounds[0]
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

  function handleStartExport() {
    setBackgroundStatus('Batch export runtime will be wired in a later task. This shell now validates configuration only.')
  }

  return (
    <div className="min-h-0 flex-1 overflow-x-auto">
      <div className="grid min-h-0 min-w-[1160px] grid-cols-[240px_minmax(0,1fr)_320px] grid-rows-[minmax(0,1fr)_auto] gap-4">
        <section className="min-h-0 rounded-md border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-950">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Background Folder</h2>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Pick a folder, decide recursion, then reload whenever the source changes.</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleSelectBackgroundFolder()}
            disabled={isLoadingBackgrounds || !canBrowseBackgrounds}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.04]"
          >
            <FolderOpen className="h-4 w-4" />
            <span>Select Background Folder</span>
          </button>

          <div className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-white/[0.04] dark:text-gray-300">
            <div className="truncate font-medium text-gray-800 dark:text-gray-100">{backgroundFolder || 'No folder selected'}</div>
            <div className="mt-1">{backgroundStatus}</div>
          </div>

          <label className="mt-4 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              aria-label="Recursive backgrounds"
              checked={recursiveBackgrounds}
              onChange={(event) => void handleRecursiveChange(event.target.checked)}
            />
            <span>Include child folders recursively</span>
          </label>

          <button
            type="button"
            onClick={() => void handleReloadBackgrounds()}
            disabled={isLoadingBackgrounds || !backgroundFolder.trim()}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.04]"
          >
            <RefreshCw className={`h-4 w-4 ${isLoadingBackgrounds ? 'animate-spin' : ''}`} />
            <span>Reload Backgrounds</span>
          </button>

          <dl className="mt-4 grid gap-3 text-sm text-gray-600 dark:text-gray-300">
            <div className="rounded-md border border-gray-200 px-3 py-2 dark:border-white/[0.08]">
              <dt className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Loaded</dt>
              <dd className="mt-1 font-medium">{backgrounds.length} files</dd>
            </div>
            <div className="rounded-md border border-gray-200 px-3 py-2 dark:border-white/[0.08]">
              <dt className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">Preview History</dt>
              <dd className="mt-1 font-medium">{previewHistory.length} steps</dd>
            </div>
          </dl>
        </section>

        <section className="min-h-0 rounded-md border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-950">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Preview</h2>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                {currentPreviewBackground?.name ?? 'No background selected yet'}
                {currentPreviewBackground?.relativeDir ? ` - ${currentPreviewBackground.relativeDir}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="上一张"
                title="Previous preview"
                onClick={previousPreviewBackground}
                disabled={!canGoPrevious}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.04]"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="随机下一张"
                title="Random preview"
                onClick={handleRandomPreview}
                disabled={!canPickRandom}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.04]"
              >
                <Shuffle className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="下一张"
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
              {previewFile?.dataUrl ? (
                <img
                  src={previewFile.dataUrl}
                  alt={previewFile.name}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <div className="px-6 text-center text-sm text-gray-400 dark:text-gray-500">
                  {isLoadingPreview ? 'Loading preview...' : 'Preview image unavailable until a background is loaded.'}
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
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Current Run</h2>
            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Choose one preset group, temporarily trim the preset list, and validate export readiness.</p>
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
              Presets in this group
            </div>
            <div className="max-h-[240px] space-y-1 overflow-y-auto p-2">
              {groupPresets.length ? groupPresets.map((preset) => {
                const isEnabled = enabledPresetIdsSet.has(preset.id)
                const isPreviewPreset = selectedPreviewPresetId === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setSelectedPreviewPresetId(preset.id)}
                    aria-pressed={isPreviewPreset}
                    className={`flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition ${
                      isPreviewPreset
                        ? 'bg-blue-50 dark:bg-blue-500/10'
                        : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      value={preset.id}
                      checked={isEnabled}
                      onChange={(event) => handleTogglePreset(preset.id, event.target.checked)}
                      onClick={(event) => event.stopPropagation()}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">{preset.name}</div>
                      <div className="mt-1 truncate text-[11px] text-gray-500 dark:text-gray-400">
                        {preset.outputRootPath.trim() ? preset.outputRootPath : 'Missing output root path'}
                      </div>
                    </div>
                  </button>
                )
              }) : (
                <div className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-xs text-gray-400 dark:border-white/[0.08] dark:text-gray-500">
                  No presets are available in the selected group yet.
                </div>
              )}
            </div>
          </div>

          <label className="mt-4 block text-xs font-medium text-gray-500 dark:text-gray-400">
            Custom
            <input
              value={customValue}
              onChange={(event) => setCustomValue(event.target.value)}
              placeholder="Optional custom token"
              className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100"
            />
          </label>

          <label className="mt-4 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={preserveSourceDir}
              onChange={(event) => setPreserveSourceDir(event.target.checked)}
            />
            <span>Preserve source subdirectory layout</span>
          </label>

          <div className="mt-4 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-white/[0.04] dark:text-gray-300">
            <div>{enabledPresets.length} presets selected for this run.</div>
            <div className="mt-1">{canStartExport ? 'Configuration looks complete for the shell stage.' : 'Start stays disabled until backgrounds and preset output roots are ready.'}</div>
          </div>

          <button
            type="button"
            onClick={handleStartExport}
            disabled={!canStartExport || exportStatus === 'running'}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            <span>Start Export</span>
          </button>
        </section>

        <div className="col-span-3">
          <ExportResultsPanel
            status={exportStatus}
            completed={exportCompleted}
            total={exportTotal}
            history={history}
          />
        </div>
      </div>
    </div>
  )
}
