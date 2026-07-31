import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  ChevronDownIcon as ChevronDown,
  ChevronRightIcon as ChevronRight,
  FileTextIcon as FileText,
  FolderIcon as Folder,
  FolderOpenIcon as FolderOpen,
  PauseIcon as Pause,
  PlayIcon as Play,
  PlusIcon as Plus,
  RefreshIcon as RefreshCw,
  SearchIcon as Search,
  ShuffleIcon as Shuffle,
  SquareIcon as Square,
  TrashIcon as Trash2,
} from '../../../design-system/icons'
import { naturalSortBackgrounds } from '../lib/compositeBackgrounds'
import { createCompositeExportSnapshot, expandCompositeExportItems } from '../lib/compositeExportPlan'
import { runCompositeV2Export } from '../lib/compositeExportRuntime'
import { renderCompositeV2ToCanvas } from '../lib/compositeRendererV2'
import { useCompositeV2Store } from '../storeV2'
import { ExportResultsPanel } from './ExportResultsPanel'
import { DistributionSettingsPanel } from './DistributionSettingsPanel'
import { GlobalOutputRulesPanel } from './GlobalOutputRulesPanel'
import { runDistribution } from '../lib/compositeDistribution'
import { useAppDialog } from '../../../hooks/useAppDialog'

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
  const { openConfirmDialog } = useAppDialog()
  const backgroundFolders = useCompositeV2Store((state) => state.backgroundFolders)
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
  const smartMatchOrientation = useCompositeV2Store((state) => state.smartMatchOrientation)
  const customValue = useCompositeV2Store((state) => state.customValue)
  const customVariables = useCompositeV2Store((state) => state.customVariables)
  const preserveSourceDir = useCompositeV2Store((state) => state.preserveSourceDir)
  const exportStatus = useCompositeV2Store((state) => state.exportStatus)
  const exportCompleted = useCompositeV2Store((state) => state.exportCompleted)
  const exportTotal = useCompositeV2Store((state) => state.exportTotal)
  const history = useCompositeV2Store((state) => state.history)
  const exportSuccesses = useCompositeV2Store((state) => state.exportSuccesses)
  const exportFailures = useCompositeV2Store((state) => state.exportFailures)
  const setBackgroundFolders = useCompositeV2Store((state) => state.setBackgroundFolders)
  const setRecursiveBackgrounds = useCompositeV2Store((state) => state.setRecursiveBackgrounds)
  const setBackgrounds = useCompositeV2Store((state) => state.setBackgrounds)
  const setSelectedPresetGroup = useCompositeV2Store((state) => state.setSelectedPresetGroup)
  const setSelectedPreviewPresetId = useCompositeV2Store((state) => state.setSelectedPreviewPresetId)
  const setEnabledPresetIdsForRun = useCompositeV2Store((state) => state.setEnabledPresetIdsForRun)
  const setSmartMatchOrientation = useCompositeV2Store((state) => state.setSmartMatchOrientation)
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
  const setDistributionProgress = useCompositeV2Store((state) => state.setDistributionProgress)
  const setDistributionStatus = useCompositeV2Store((state) => state.setDistributionStatus)
  const resetDistributionResults = useCompositeV2Store((state) => state.resetDistributionResults)
  const addDistributionSuccess = useCompositeV2Store((state) => state.addDistributionSuccess)
  const addDistributionFailure = useCompositeV2Store((state) => state.addDistributionFailure)
  const addHistoryRecord = useCompositeV2Store((state) => state.addHistoryRecord)
  const distributionConfig = useCompositeV2Store((state) => state.distributionConfig)
  const distributionStatus = useCompositeV2Store((state) => state.distributionStatus)
  const distributionCompleted = useCompositeV2Store((state) => state.distributionCompleted)
  const distributionTotal = useCompositeV2Store((state) => state.distributionTotal)
  const distributionSuccesses = useCompositeV2Store((state) => state.distributionSuccesses)
  const distributionFailures = useCompositeV2Store((state) => state.distributionFailures)

  const [backgroundStatus, setBackgroundStatus] = useState('选择文件夹后加载背景图片。')
  const [previewStatus, setPreviewStatus] = useState('加载背景后将随机显示一张预览。')
  const [runStatusText, setRunStatusText] = useState('请完成背景、预设和尺寸规则配置。')
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null)
  const [isLoadingBackgrounds, setIsLoadingBackgrounds] = useState(false)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [folderInputs, setFolderInputs] = useState<string[]>(
    backgroundFolders.length ? backgroundFolders : [''],
  )
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scanRequestRef = useRef(0)
  const pausedRef = useRef(false)
  const canceledRef = useRef(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const toggleGroup = (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const electronApi = getElectronApi()
  const canBrowseBackgrounds = Boolean(
    electronApi?.isElectron
    && electronApi.scanEnteredCompositeBackgroundFolder,
  )
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
      backgroundFolders,
      recursive: recursiveBackgrounds,
      backgrounds,
      presets,
      presetGroup: selectedGroup,
      enabledPresetIds: enabledPresets.map((preset) => preset.id),
      outputRuleGroups,
      smartMatchOrientation,
      custom: customValue,
      customVariables,
      fitMode: globalFitMode,
      preserveSourceDir,
    })

    return expandCompositeExportItems(snapshot).length
  }, [
    backgroundFolders,
    backgrounds,
    customValue,
    customVariables,
    smartMatchOrientation,
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
  
  const missingRequirements: string[] = []
  if (backgrounds.length === 0) missingRequirements.push('未加载背景图片')
  if (!selectedGroup) missingRequirements.push('未选择预设组')
  if (enabledPresets.length === 0) missingRequirements.push('未勾选任何预设')
  else {
    const presetsMissingDir = enabledPresets.filter((preset) => !preset.outputRootPath.trim())
    if (presetsMissingDir.length > 0) {
      missingRequirements.push(`以下预设缺少输出目录：${presetsMissingDir.map(p => p.name).join('、')}`)
    }
  }
  if (plannedExportCount === 0 && enabledPresets.length > 0 && backgrounds.length > 0) {
    const hasEnabledRules = enabledPresets.some(preset => 
      preset.outputRuleGroupsOverride?.some(g => g.rules.some(r => r.enabled)) || 
      outputRuleGroups.some(g => g.rules.some(r => r.enabled))
    )
    if (!hasEnabledRules) {
      missingRequirements.push('当前预设均未启用任何尺寸规则')
    } else if (smartMatchOrientation) {
      missingRequirements.push('原图比例与启用的尺寸规则比例不匹配（横版配横版，竖版配竖版，方形配方形）')
    } else {
      missingRequirements.push('由于未知原因无法生成导出计划')
    }
  }

  const canStartExport = missingRequirements.length === 0

  useEffect(() => {
    if (backgroundFolders.length > 0 && backgrounds.length === 0 && !isLoadingBackgrounds) {
      void loadBackgroundFolders(backgroundFolders, recursiveBackgrounds)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // run once on mount

  useEffect(() => () => {
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
  }, [])

  useEffect(() => {
    let active = true

    async function loadPreview() {
      if (!currentPreviewPath) {
        setPreviewFile(null)
        setPreviewStatus(
            backgrounds.length
              ? '选择预览步骤以查看当前背景。'
              : '加载背景后，这里将显示随机预览。',
          )
        return
      }

      if (!electronApi?.isElectron || !electronApi.readImageFile) {
        setPreviewFile(null)
        setPreviewStatus('当前环境不支持桌面端预览。')
        return
      }

      setIsLoadingPreview(true)
      setPreviewStatus('正在加载预览背景...')

      try {
        const file = await electronApi.readImageFile(currentPreviewPath)
        if (!active) return
        if (!file?.dataUrl) {
          setPreviewFile(null)
          setPreviewStatus('无法从磁盘读取预览图片。')
          return
        }
        setPreviewFile(file)
        setPreviewStatus('预览将原图比例保持在稳定框架内。')
      } catch (error) {
        if (!active) return
        setPreviewFile(null)
        setPreviewStatus(error instanceof Error ? error.message : '预览图片加载失败。')
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
      if (active) setPreviewStatus(error instanceof Error ? error.message : '合成预览失败。')
    })
    return () => {
      active = false
    }
  }, [globalFitMode, previewFile?.dataUrl, selectedPreviewPreset])

  async function loadBackgroundFolders(nextFolders: string[], nextRecursive: boolean) {
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current)
      scanTimerRef.current = null
    }
    const seenFolders = new Set<string>()
    const validFolders = nextFolders.map(folder => folder.trim()).filter((folder) => {
      if (!folder) return false
      const key = folder.replace(/[\\/]+$/, '').toLocaleLowerCase()
      if (seenFolders.has(key)) return false
      seenFolders.add(key)
      return true
    })
    const requestId = ++scanRequestRef.current

    if (!electronApi?.isElectron || !electronApi.scanEnteredCompositeBackgroundFolder) {
      setIsLoadingBackgrounds(false)
      setBackgroundStatus('桌面端文件夹读取在当前环境不可用。')
      return
    }

    setRecursiveBackgrounds(nextRecursive)

    if (validFolders.length === 0) {
      setIsLoadingBackgrounds(false)
      setBackgroundStatus('请添加至少一个背景文件夹。')
      setBackgroundFolders([])
      setBackgrounds([])
      return
    }

    setIsLoadingBackgrounds(true)
    setBackgroundStatus(nextRecursive ? '正在递归加载背景图片...' : '正在加载背景图片...')

    try {
      let allFiles: typeof backgrounds = []
      const resolvedFolders: string[] = []
      for (const folder of validFolders) {
        const result = await electronApi.scanEnteredCompositeBackgroundFolder(folder, nextRecursive)
        if (requestId !== scanRequestRef.current) return
        if (!result.success) throw new Error(`${folder}：${result.error}`)
        resolvedFolders.push(result.folderPath)
        allFiles = [...allFiles, ...result.files]
      }
      if (requestId !== scanRequestRef.current) return
      const nextBackgrounds = naturalSortBackgrounds(allFiles)
      setBackgroundFolders(resolvedFolders)
      setBackgrounds(nextBackgrounds)
      setBackgroundStatus(
        nextBackgrounds.length
          ? `已加载 ${nextBackgrounds.length} 个背景文件。`
          : '在选择的文件夹中没有找到支持的背景图片。',
      )
    } catch (error) {
      if (requestId !== scanRequestRef.current) return
      setBackgrounds([])
      setBackgroundStatus(error instanceof Error ? error.message : '加载背景文件夹失败。')
    } finally {
      if (requestId === scanRequestRef.current) setIsLoadingBackgrounds(false)
    }
  }

  function scheduleFolderScan(nextFolders: string[]) {
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
    scanTimerRef.current = setTimeout(() => {
      void loadBackgroundFolders(nextFolders, recursiveBackgrounds)
    }, 500)
  }

  function updateFolderInput(index: number, value: string, immediate = false) {
    const nextFolders = folderInputs.map((folder, folderIndex) => folderIndex === index ? value : folder)
    setFolderInputs(nextFolders)
    if (immediate) void loadBackgroundFolders(nextFolders, recursiveBackgrounds)
    else scheduleFolderScan(nextFolders)
  }

  async function handleBrowseBackgroundFolder(index: number) {
    if (!electronApi?.isElectron || !electronApi.selectDirectory || !electronApi.scanEnteredCompositeBackgroundFolder) {
      setBackgroundStatus('桌面端文件夹选择在当前环境不可用。')
      return
    }

    const nextFolder = await electronApi.selectDirectory()
    if (!nextFolder) {
      setBackgroundStatus('已取消选择背景文件夹。')
      return
    }

    const nextFolders = folderInputs.map((folder, folderIndex) => folderIndex === index ? nextFolder : folder)
    setFolderInputs(nextFolders)
    await loadBackgroundFolders(nextFolders, recursiveBackgrounds)
  }

  async function handleRemoveBackgroundFolder(index: number) {
    const remainingFolders = folderInputs.filter((_, folderIndex) => folderIndex !== index)
    const nextFolders = remainingFolders.length ? remainingFolders : ['']
    setFolderInputs(nextFolders)
    await loadBackgroundFolders(nextFolders, recursiveBackgrounds)
  }

  async function handleRecursiveChange(nextRecursive: boolean) {
    if (!folderInputs.some(folder => folder.trim())) {
      setRecursiveBackgrounds(nextRecursive)
      setBackgroundStatus('递归模式已更新，请输入文件夹地址。')
      return
    }

    await loadBackgroundFolders(folderInputs, nextRecursive)
  }

  async function handleReloadBackgrounds() {
    if (!folderInputs.some(folder => folder.trim())) {
      setBackgroundStatus('请先添加背景文件夹。')
      return
    }

    await loadBackgroundFolders(folderInputs, recursiveBackgrounds)
  }

  function handleRandomPreview() {
    if (!backgrounds.length) return
    const randomIndex = Math.min(backgrounds.length - 1, Math.max(0, Math.floor(Math.random() * backgrounds.length)))
    const nextBackground = backgrounds[randomIndex] ?? backgrounds[0]
    if (!nextBackground) return
    pushPreviewBackground(nextBackground.path)
    setPreviewStatus(`预览已切换至 ${nextBackground.name}。`)
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
      backgroundFolders,
      recursive: recursiveBackgrounds,
      backgrounds,
      presets,
      presetGroup: selectedGroup,
      enabledPresetIds: enabledPresets.map((preset) => preset.id),
      outputRuleGroups,
      smartMatchOrientation,
      custom: customValue,
      customVariables,
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
      
      let finalStatusText = canceled ? '导出已取消。' : `导出完成：${successes.length} 成功，${failures.length} 失败。`
      
      // Auto distribution
      let distributionStatus: 'pending' | 'running' | 'completed' | 'failed' | undefined
      let distributionSuccessCount = 0
      let distributionFailureCount = 0
      let distributionErrors: string[] = []
      const distributionSuccesses: import('../lib/compositeV2Types').CompositeV2DistributionSuccessItem[] = []
      const distributionFailures: import('../lib/compositeV2Types').CompositeV2DistributionFailureItem[] = []

      if (!canceled && distributionConfig.enabled && successes.length > 0 && electronApi) {
        if (!distributionConfig.startDate || !/^(\d{4})(\d{2})(\d{2})$/.test(distributionConfig.startDate)) {
          finalStatusText += `\n分配跳过：起始日期格式错误（期望 YYYYMMDD）。`
          distributionStatus = 'failed'
          distributionErrors.push('起始日期格式错误，期望 YYYYMMDD')
        } else {
          setRunStatusText('正在执行分配...')
          distributionStatus = 'running'
          setDistributionStatus('running')
          resetDistributionResults()
          const distResult = await runDistribution(successes, distributionConfig, electronApi, presets, {
            onProgress: setDistributionProgress,
            onSuccess: (item) => {
              distributionSuccesses.push(item)
              addDistributionSuccess(item)
            },
            onFailure: (item) => {
              distributionFailures.push(item)
              addDistributionFailure(item)
            }
          })
          distributionSuccessCount = distResult.success
          distributionFailureCount = distResult.failed
          distributionErrors = distResult.errors
          distributionStatus = distResult.errors.length > 0 && distResult.success === 0 ? 'failed' : 'completed'
          setDistributionStatus(distributionStatus)
          finalStatusText += `\n分配完成：${distributionSuccessCount} 成功，${distributionFailureCount} 失败。`
          if (distResult.errors.length > 0) {
            console.error('分发错误：', distResult.errors)
          }
        }
      }
      
      setRunStatusText(finalStatusText)

      addHistoryRecord({
        id: snapshot.id,
        status: canceled ? 'canceled' : failures.length ? 'completed-with-failures' : 'completed',
        startedAt,
        endedAt: Date.now(),
        backgroundFolders,
        recursive: recursiveBackgrounds,
        backgroundCount: backgrounds.length,
        presetGroupName: selectedGroup.name,
        enabledPresetCount: enabledPresets.length,
        plannedCount: plannedExportCount,
        successCount: successes.length,
        failureCount: failures.length,
        successes,
        failures,
        distributionStatus,
        distributionSuccessCount,
        distributionFailureCount,
        distributionErrors,
        distributionSuccesses,
        distributionFailures,
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

  async function cancelExport(deleteExportedFiles: boolean) {
    canceledRef.current = true
    pausedRef.current = false
    setExportStatus('canceling')
    if (deleteExportedFiles && exportSuccesses.length) {
      const cleanup = await window.electronAPI?.deleteCompositeFiles?.(exportSuccesses.map((item) => item.path))
      setRunStatusText(cleanup?.failed.length ? `已取消，${cleanup.failed.length} 个文件删除失败。` : '已取消并删除已导出文件。')
    }
  }

  function handleCancel() {
    openConfirmDialog({
      title: '取消当前导出？',
      message: '导出任务会立即停止，尚未处理的文件不会继续生成。',
      confirmText: '继续取消',
      tone: 'warning',
      action: () => {
        if (!exportSuccesses.length) {
          void cancelExport(false)
          return
        }
        openConfirmDialog({
          title: '处理已导出的文件',
          message: `已经导出 ${exportSuccesses.length} 个文件。是否同时删除这些文件？`,
          confirmText: '删除文件',
          cancelText: '保留文件',
          tone: 'danger',
          action: () => void cancelExport(true),
          cancelAction: () => void cancelExport(false),
        })
      },
    })
  }

  return (
    <div className="grid h-full min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px_300px] overflow-hidden border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-950">
      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden border-r border-gray-200 dark:border-white/[0.08]">
        <div className="grid min-h-0 grid-cols-[230px_minmax(0,1fr)_240px] overflow-hidden border-b border-gray-200 dark:border-white/[0.08]">
          <section className="flex min-h-0 flex-col overflow-hidden border-r border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-950">
            <div className="border-b border-gray-200 px-3 py-2 dark:border-white/[0.08]">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">原图文件夹</h2>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                默认加载全部支持的图片，可选择是否递归子文件夹。
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3 flex flex-col">
              <div className="flex flex-col gap-2 mb-3 shrink-0">
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">文件夹地址</span>
                {folderInputs.map((folder, index) => (
                  <div key={index} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      aria-label={`文件夹地址 ${index + 1}`}
                      placeholder="输入或粘贴文件夹地址"
                      value={folder}
                      onChange={(event) => updateFolderInput(index, event.target.value)}
                      onPaste={(event) => {
                        event.preventDefault()
                        updateFolderInput(index, event.clipboardData.getData('text'), true)
                      }}
                      onBlur={() => void loadBackgroundFolders(folderInputs, recursiveBackgrounds)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') return
                        event.preventDefault()
                        void loadBackgroundFolders(folderInputs, recursiveBackgrounds)
                      }}
                      className="min-w-0 flex-1 rounded-md border border-gray-200 px-3 py-1.5 text-xs outline-none transition focus:border-blue-400 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100"
                    />
                  <button
                    type="button"
                    aria-label={`浏览文件夹地址 ${index + 1}`}
                    onClick={() => void handleBrowseBackgroundFolder(index)}
                    disabled={isLoadingBackgrounds || !canBrowseBackgrounds}
                    className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md border border-gray-200 text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.04] shrink-0"
                  >
                    <Search className="h-3.5 w-3.5" />
                  </button>
                    <button
                      type="button"
                      aria-label={`删除文件夹地址 ${index + 1}`}
                      onClick={() => void handleRemoveBackgroundFolder(index)}
                      className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md border border-gray-200 text-gray-400 transition hover:bg-red-50 hover:text-red-600 dark:border-white/[0.08] dark:hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setFolderInputs([...folderInputs, ''])}
                  className="inline-flex h-[30px] w-full items-center justify-center gap-1.5 rounded-md bg-blue-50 px-3 text-xs font-medium text-blue-600 transition hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20"
                >
                  <Plus className="h-3.5 w-3.5" />
                  添加文件夹地址
                </button>
              </div>

              <div className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-white/[0.04] dark:text-gray-300 shrink-0">
                <div className="mt-1">{backgroundStatus}</div>
              </div>

              <label className="mt-4 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 shrink-0">
                <input
                  type="checkbox"
                  aria-label="包含子文件夹背景"
                  checked={recursiveBackgrounds}
                  onChange={(event) => void handleRecursiveChange(event.target.checked)}
                />
                <span>递归加载子文件夹</span>
              </label>

              <button
                type="button"
                onClick={() => void handleReloadBackgrounds()}
                disabled={isLoadingBackgrounds || backgroundFolders.length === 0}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-white/[0.04] shrink-0"
              >
                <RefreshCw className={`h-4 w-4 ${isLoadingBackgrounds ? 'animate-spin' : ''}`} />
                <span>重新加载</span>
              </button>

              <dl className="mt-4 grid gap-3 text-sm text-gray-600 dark:text-gray-300">
                <div className="rounded-md border border-gray-200 px-3 py-2 dark:border-white/[0.08]">
                  <dt className="text-[11px] text-gray-400 dark:text-gray-500">已加载</dt>
                  <dd className="mt-1 font-medium">{backgrounds.length} 张</dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="flex min-h-0 flex-col overflow-hidden border-r border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-950">
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-2 dark:border-white/[0.08]">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">合成预览</h2>
                <p className="mt-1 truncate text-[11px] text-gray-500 dark:text-gray-400">
                  {currentPreviewBackground?.name ?? '尚未选择背景'}
                  {currentPreviewBackground?.relativeDir ? ` - ${currentPreviewBackground.relativeDir}` : ''}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  aria-label="上一个预览"
                  title="上一个预览"
                  onClick={previousPreviewBackground}
                  disabled={!canGoPrevious}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.04]"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="随机预览"
                  title="随机预览"
                  onClick={handleRandomPreview}
                  disabled={!canPickRandom}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.04]"
                >
                  <Shuffle className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="下一个预览"
                  title="下一个预览"
                  onClick={nextPreviewBackground}
                  disabled={!canGoNext}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.04]"
                >
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col p-4">
              <div className="flex flex-1 min-h-0 items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50 p-2 dark:border-white/[0.12] dark:bg-white/[0.03]">
                <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-md bg-white dark:bg-gray-900">
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

              <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span className="truncate">{previewStatus}</span>
                <span className="shrink-0">{previewHistoryIndex >= 0 ? `${previewHistoryIndex + 1} / ${previewHistory.length}` : '0 / 0'}</span>
              </div>
            </div>
          </section>

          <div className="min-h-0 overflow-hidden bg-white dark:bg-gray-950">
            <div className="h-full min-h-0 p-4">
              <DistributionSettingsPanel />
            </div>
          </div>
        </div>

        <div className="shrink-0 bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-white/[0.08]">
          <div className="p-4 pt-3 pb-[14px]">
            <GlobalOutputRulesPanel />
          </div>
        </div>
      </div>

      <section className="flex min-h-0 flex-col overflow-hidden border-r border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-950">
        <div className="border-b border-gray-200 px-4 py-2 dark:border-white/[0.08]">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">本次导出</h2>
          <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
            每次选择一个预设组，并临时勾选本次需要导出的产品预设。
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-4">
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="space-y-1">
              {groups.map((group) => {
                const isSelected = group.id === selectedGroup?.id
                const isExpanded = expandedGroups.has(group.id)
                const currentGroupPresets = group.presetIds
                  .map((presetId) => presets.find((preset) => preset.id === presetId))
                  .filter((preset): preset is NonNullable<typeof preset> => Boolean(preset))

                return (
                  <div key={group.id} className="space-y-0.5">
                    <div className={`rounded-md ${isSelected ? 'bg-blue-50 dark:bg-blue-500/10' : ''}`}>
                      <div className="flex w-full items-center justify-between px-2 py-1.5 text-left text-sm group">
                        <div className="flex items-center gap-1.5 overflow-hidden flex-1 min-w-0">
                          <button type="button" onClick={(e) => toggleGroup(group.id, e)} className="p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0">
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            type="button"
                            className="flex items-center gap-1.5 overflow-hidden flex-1 min-w-0"
                            onClick={() => setSelectedPresetGroup(group.id)}
                          >
                            {isExpanded ? <FolderOpen className="h-4 w-4 shrink-0 text-blue-400" /> : <Folder className="h-4 w-4 shrink-0 text-blue-400" />}
                            <span className={`truncate ${isSelected ? 'text-blue-700 dark:text-blue-200' : 'text-gray-700 dark:text-gray-200'}`}>{group.name}</span>
                          </button>
                        </div>
                        <span className="text-[11px] opacity-70 w-4 text-right">{group.presetIds.length}</span>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="pl-6 pr-2 py-1 space-y-0.5">
                        {currentGroupPresets.map((preset) => {
                          const isEnabled = enabledPresetIdsSet.has(preset.id)
                          const isPreviewPreset = selectedPreviewPresetId === preset.id

                          return (
                            <div
                              key={preset.id}
                              className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition ${
                                isPreviewPreset
                                  ? 'bg-blue-100 dark:bg-blue-500/20'
                                  : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                              }`}
                            >
                              <FileText className="h-3.5 w-3.5 shrink-0 opacity-50 text-gray-400" />
                              <button
                                type="button"
                                aria-pressed={isPreviewPreset}
                                aria-label={`预览预设 ${preset.name}`}
                                onClick={() => {
                                  if (group.id !== selectedGroup?.id) {
                                    setSelectedPresetGroup(group.id)
                                  }
                                  setSelectedPreviewPresetId(preset.id)
                                }}
                                className="flex-1 min-w-0 text-left"
                              >
                                <span className={`truncate text-xs ${isPreviewPreset ? 'text-blue-700 dark:text-blue-200 font-medium' : 'text-gray-700 dark:text-gray-200'}`}>{preset.name}</span>
                              </button>
                              <label className="mt-0.5 inline-flex shrink-0 items-center text-xs text-gray-600 dark:text-gray-300">
                                <input
                                  type="checkbox"
                                  value={preset.id}
                                  aria-label={`包含预设 ${preset.name}`}
                                  checked={isEnabled}
                                  onChange={(event) => {
                                    if (group.id !== selectedGroup?.id) {
                                      setSelectedPresetGroup(group.id)
                                    }
                                    handleTogglePreset(preset.id, event.target.checked)
                                  }}
                                />
                              </label>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="mt-4 shrink-0 border-t border-gray-200 pt-4 dark:border-white/[0.08]">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">
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
                aria-label="保留源文件夹层级"
                checked={preserveSourceDir}
                onChange={(event) => setPreserveSourceDir(event.target.checked)}
              />
              <span>保留源文件夹层级</span>
            </label>

            <label className="mt-2 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <input
                type="checkbox"
                aria-label="智能匹配原图与尺寸比例"
                checked={smartMatchOrientation}
                onChange={(event) => setSmartMatchOrientation(event.target.checked)}
              />
              <span>智能匹配原图与尺寸比例（横配横、竖配竖）</span>
            </label>

            <div className="mt-4 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-white/[0.04] dark:text-gray-300">
              <div>本次已选择 {enabledPresets.length} 个预设。</div>
              {exportStatus === 'idle' ? (
                <>
                  {missingRequirements.length > 0 ? (
                    <div className="mt-1 text-red-500 dark:text-red-400">
                      无法导出，缺少以下配置：
                      <ul className="list-inside list-disc pl-1 mt-0.5">
                        {missingRequirements.map((req, i) => <li key={i}>{req}</li>)}
                      </ul>
                    </div>
                  ) : (
                    <div className="mt-1 text-green-600 dark:text-green-400">配置已就绪。</div>
                  )}
                  <div className="mt-1">
                    {canStartExport ? `预计输出 ${plannedExportCount} 张` : ''}
                  </div>
                </>
              ) : (
                <div className="mt-1">{runStatusText}</div>
              )}
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
          </div>
        </div>
      </section>

      <div className="min-h-0 overflow-hidden bg-white dark:bg-gray-950">
        <ExportResultsPanel
          status={exportStatus}
          completed={exportCompleted}
          total={exportTotal}
          history={history}
          successes={exportSuccesses}
          failures={exportFailures}
          distributionStatus={distributionStatus}
          distributionCompleted={distributionCompleted}
          distributionTotal={distributionTotal}
          distributionSuccesses={distributionSuccesses}
          distributionFailures={distributionFailures}
        />
      </div>
    </div>
  )
}
