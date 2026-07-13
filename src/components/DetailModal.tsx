import { useEffect, useState, useMemo, useRef } from 'react'
import { useStore, getCachedImage, ensureImageCached, reuseConfig, editOutputs, removeTask, showCodexCliPrompt, getCodexCliPromptKey, retryTask } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useTooltip } from '../hooks/useTooltip'
import { formatImageRatio } from '../lib/size'
import { ActualValueBadge, DetailParamValue } from '../lib/paramDisplay'
import { copyImageSourceToClipboard, copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import { createMaskPreviewDataUrl } from '../lib/canvasImage'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import { downloadImageEntries, downloadImageEntriesAsZip, getGeneratedImageDownloadEntries } from '../lib/downloadImages'
import { isAgentTaskPromptPending } from '../lib/taskPromptDisplay'
import { getTaskProgressDisplay } from '../lib/taskProgressDisplay'
import { replaceImageMentionsForApi, getPromptMentionParts } from '../lib/promptImageMentions'
import { getHoverPreviewPosition, getHoverPreviewSize } from '../lib/hoverPreviewPosition'
import { getLocalImageSaveDirectory, isElectron as isElectronEnv, openInExplorer } from '../lib/localSave'
import { CloseIcon, CodeIcon, CopyIcon, DownloadIcon, EditIcon, FolderOpenIcon, LinkIcon, TrashIcon } from './icons'
import Select from './Select'
import SizePickerModal from './SizePickerModal'
import PromptVariableEditor from './PromptVariableEditor'
import HoverImagePreview from './HoverImagePreview'
import { type TaskParams, DEFAULT_PARAMS } from '../types'
import { updateTaskInStore } from '../store'

import ViewportTooltip from './ViewportTooltip'

const HOVER_PREVIEW_MAX_LONG_EDGE = 1024

export default function DetailModal() {
  const tasks = useStore((s) => s.tasks)
  const detailTaskId = useStore((s) => s.detailTaskId)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const setMaskEditorImageId = useStore((s) => s.setMaskEditorImageId)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const openFavoritePicker = useStore((s) => s.openFavoritePicker)
  const workspaceTabs = useStore((s) => s.workspaceTabs)
  const settings = useStore((s) => s.settings)
  const dismissedCodexCliPrompts = useStore((s) => s.dismissedCodexCliPrompts)
  const streamPreviewSrc = useStore((s) => detailTaskId ? s.streamPreviews[detailTaskId] || '' : '')
  const streamPreviewSlots = useStore((s) => detailTaskId ? s.streamPreviewSlots[detailTaskId] : undefined)

  const [imageIndex, setImageIndex] = useState(0)
  const [imageSrcs, setImageSrcs] = useState<Record<string, string>>({})
  const [outputPreviewSrcs, setOutputPreviewSrcs] = useState<Record<string, string>>({})
  const [imageRatios, setImageRatios] = useState<Record<string, string>>({})
  const [imageSizes, setImageSizes] = useState<Record<string, string>>({})
  const [maskPreviewSrc, setMaskPreviewSrc] = useState('')
  const [now, setNow] = useState(Date.now())
  const [showRawUrlsModal, setShowRawUrlsModal] = useState(false)
  const [showRawResponseModal, setShowRawResponseModal] = useState(false)
  const [streamPreviewLoaded, setStreamPreviewLoaded] = useState(false)
  const [hoverPreview, setHoverPreview] = useState<{
    imageId: string
    src: string
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const rawUrlsModalRef = useRef<HTMLDivElement>(null)
  const rawResponseModalRef = useRef<HTMLDivElement>(null)

  const rawUrlsBackdropPointerDownRef = useRef(false)
  const rawResponseBackdropPointerDownRef = useRef(false)

  const copyErrorTooltip = useTooltip()
  const copyRawUrlsTooltip = useTooltip()
  const viewRawResponseTooltip = useTooltip()
  const downloadPartialImagesTooltip = useTooltip()
  const retryTooltip = useTooltip()
  const downloadImageTooltip = useTooltip()
  const downloadAllTooltip = useTooltip()
  const openImageDirectoryTooltip = useTooltip()

  const task = useMemo(
    () => tasks.find((t) => t.id === detailTaskId) ?? null,
    [tasks, detailTaskId],
  )

  const wordLibraryEntries = useStore((s) => s.wordLibraryEntries)
  
  const VAR_COLOR_MAP = useMemo(() => {
    const sorted = [...wordLibraryEntries].filter((e) => e.deletedAt == null).sort((a, b) => a.key.localeCompare(b.key, 'zh-CN'))
    const map: Record<string, string> = {}
    const colors = ['#10b981', '#f97316', '#3b82f6', '#a855f7', '#ec4899', '#06b6d4']
    sorted.forEach((entry, i) => {
      map[entry.key] = colors[i % colors.length]
    })
    return map
  }, [wordLibraryEntries])

  const promptParts = useMemo(() => task ? getPromptMentionParts(task.prompt || '', []) : [], [task?.prompt])

  const [isEditingParams, setIsEditingParams] = useState(false)
  const [editPrompt, setEditPrompt] = useState('')
  const [editParams, setEditParams] = useState<TaskParams>(DEFAULT_PARAMS)
  const [showSizePicker, setShowSizePicker] = useState(false)
  
  useEffect(() => {
    if (task && task.isFavorite) {
      setIsEditingParams(true)
      setEditPrompt(task.prompt)
      setEditParams(task.params)
    } else {
      setIsEditingParams(false)
    }
  }, [task?.id]) // Run once when the modal opens for a task

  const clearTextSelection = () => {
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) selection.removeAllRanges()
  }

  const updateHoverPreviewPosition = (imageId: string, src: string, e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse' || !src) return
    const [widthText, heightText] = (imageSizes[imageId] || '').split('×')
    const imageWidth = Number(widthText) || HOVER_PREVIEW_MAX_LONG_EDGE
    const imageHeight = Number(heightText) || HOVER_PREVIEW_MAX_LONG_EDGE
    const size = getHoverPreviewSize({
      imageWidth,
      imageHeight,
      maxLongEdge: HOVER_PREVIEW_MAX_LONG_EDGE,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    })
    const position = getHoverPreviewPosition({
      pointerX: e.clientX,
      pointerY: e.clientY,
      previewWidth: size.width,
      previewHeight: size.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    })
    setHoverPreview({ imageId, src, ...position, ...size })
  }

  const containingTab = useMemo(
    () => detailTaskId ? workspaceTabs.find((tab) => tab.tasks.some((t) => t.id === detailTaskId)) : undefined,
    [detailTaskId, workspaceTabs],
  )

  const streamPreviewItems = useMemo(() => {
    const slotEntries = streamPreviewSlots
      ? Object.entries(streamPreviewSlots)
          .filter(([, src]) => Boolean(src))
          .sort(([a], [b]) => Number(a) - Number(b))
      : []
    const outputLen = task?.outputImages?.length || 0
    const remainingSlots = task?.status === 'running' ? Math.max(0, task.params.n - outputLen) : 0
    const count = Math.max(
      remainingSlots,
      slotEntries.length ? Math.max(...slotEntries.map(([key]) => Number(key) + 1)) : 0,
      streamPreviewSrc ? 1 : 0,
    )
    const byIndex = new Map(slotEntries.map(([key, src]) => [Number(key), src]))

    return Array.from({ length: count }, (_, index) => ({
      key: String(index),
      src: byIndex.get(index) ?? (index === 0 ? streamPreviewSrc : ''),
    }))
  }, [task?.params.n, task?.status, task?.outputImages?.length, streamPreviewSlots, streamPreviewSrc])
  const activeStreamPreviewSrc = streamPreviewItems[imageIndex]?.src || ''

  useEffect(() => {
    setStreamPreviewLoaded(false)
  }, [activeStreamPreviewSrc, detailTaskId, imageIndex])

  useEffect(() => {
    const count = task?.status === 'running'
      ? (task?.outputImages?.length || 0) + streamPreviewItems.length
      : task?.outputImages?.length ?? 0
    if (count > 0 && imageIndex >= count) setImageIndex(count - 1)
  }, [imageIndex, streamPreviewItems.length, task?.outputImages?.length, task?.status])

  useCloseOnEscape(Boolean(task), () => setDetailTaskId(null))
  usePreventBackgroundScroll(Boolean(task), [modalRef, rawUrlsModalRef, rawResponseModalRef])

  // Reset index when task changes
  useEffect(() => {
    setImageIndex(0)
  }, [detailTaskId])

  useEffect(() => {
    if (task?.status !== 'running' && !(task?.status === 'error' && (task.falRecoverable || task.customRecoverable))) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    setNow(Date.now())
    return () => window.clearInterval(id)
  }, [task?.customRecoverable, task?.falRecoverable, task?.status])

  // 加载所有相关图片
  useEffect(() => {
    if (!task) {
      setImageSrcs({})
      setOutputPreviewSrcs({})
      setImageRatios({})
      setImageSizes({})
      return
    }

    let cancelled = false
    const ids = [...new Set([
      ...(task.inputImageIds || []),
      ...(task.maskImageId ? [task.maskImageId] : []),
    ])]
    const initial: Record<string, string> = {}
    for (const id of ids) {
      const cached = getCachedImage(id)
      if (cached) initial[id] = cached
    }
    setImageSrcs(initial)
    for (const id of ids) {
      if (initial[id]) continue
      ensureImageCached(id).then((url) => {
        if (!cancelled && url) setImageSrcs((prev) => ({ ...prev, [id]: url }))
      })
    }

    return () => {
      cancelled = true
    }
  }, [task])

  const currentOutputImageId = (imageIndex < (task?.outputImages?.length || 0) ? task?.outputImages?.[imageIndex] : '') || ''
  const currentOutputPreviewSrc = currentOutputImageId ? outputPreviewSrcs[currentOutputImageId] || '' : ''
  const maskTargetId = task?.maskTargetImageId || null
  const maskTargetSrc = maskTargetId ? imageSrcs[maskTargetId] || '' : ''
  const maskSrc = task?.maskImageId ? imageSrcs[task.maskImageId] || '' : ''
  const allInputImageIds = task?.inputImageIds ?? []

  useEffect(() => {
    const outputImageIds = task?.outputImages ?? []
    if (outputImageIds.length === 0) {
      setOutputPreviewSrcs({})
      return
    }

    // 从任务参数预先推断图片比例
    const initialRatios: Record<string, string> = {}
    const initialSizes: Record<string, string> = {}
    
    if (task && task.actualParamsByImage) {
      for (const imageId of outputImageIds) {
        const params = task.actualParamsByImage[imageId]
        if (params?.size && typeof params.size === 'string') {
          const [w, h] = params.size.split('x').map(Number)
          if (w && h) {
            initialRatios[imageId] = formatImageRatio(w, h)
            initialSizes[imageId] = `${w}×${h}`
          }
        }
      }
    }
    if (Object.keys(initialRatios).length > 0) {
      setImageRatios((prev) => ({ ...prev, ...initialRatios }))
      setImageSizes((prev) => ({ ...prev, ...initialSizes }))
    }

    let cancelled = false
    const setOutputImage = (imageId: string, dataUrl: string) => {
      if (!cancelled) setOutputPreviewSrcs((prev) => ({ ...prev, [imageId]: dataUrl }))
    }

    for (const imageId of outputImageIds) {
      const cached = getCachedImage(imageId)
      if (cached) {
        setOutputImage(imageId, cached)
      } else {
        ensureImageCached(imageId)
          .then((dataUrl) => {
            if (dataUrl) setOutputImage(imageId, dataUrl)
          })
          .catch(() => {})
      }
    }

    return () => {
      cancelled = true
    }
  }, [task?.outputImages, task?.actualParamsByImage])

  useEffect(() => {
    let cancelled = false
    setMaskPreviewSrc('')
    if (!maskTargetSrc || !maskSrc) return

    createMaskPreviewDataUrl(maskTargetSrc, maskSrc)
      .then((url) => {
        if (!cancelled) setMaskPreviewSrc(url)
      })
      .catch(() => {
        if (!cancelled) setMaskPreviewSrc('')
      })

    return () => {
      cancelled = true
    }
  }, [maskTargetSrc, maskSrc])

  if (!task) return null

  const isAgentTask = task.sourceMode === 'agent' || Boolean(task.agentConversationId || task.agentRoundId)
  const showPendingPrompt = isAgentTaskPromptPending(task)
  const isAgentEditTool = task.status === 'done' && String(task.agentToolAction ?? '').toLowerCase() === 'edit'
  const showReferenceSection = allInputImageIds.length > 0 || isAgentEditTool

  const outputLen = task.outputImages?.length || 0
  const currentImageRatio = currentOutputImageId ? imageRatios[currentOutputImageId] : ''
  const currentImageSize = currentOutputImageId ? imageSizes[currentOutputImageId] : ''
  const currentActualParams = currentOutputImageId ? task.actualParamsByImage?.[currentOutputImageId] : undefined
  const currentRevisedPrompt = currentOutputImageId ? task.revisedPromptByImage?.[currentOutputImageId]?.trim() : ''
  // 将 @图N 等 mention 标记转换为实际发送给 API 的形式（如 [image 1]）后再比较，
  // 这样仅由标签渲染差异导致的不一致不会被当作“被改写”。
  const promptSentToApi = replaceImageMentionsForApi(task.prompt, task.inputImageIds.length).trim()
  const showRevisedPrompt = Boolean(currentRevisedPrompt && currentRevisedPrompt !== promptSentToApi)
  const codexCliPromptKey = getCodexCliPromptKey(settings)
  const hasHandledPromptWarning = settings.codexCli || dismissedCodexCliPrompts.includes(codexCliPromptKey)
  const taskProvider = task.apiProvider
  const isOpenAiTask = (taskProvider ?? 'openai') === 'openai'
  const showPromptWarning = Boolean(isOpenAiTask && task.apiMode === 'responses' && currentOutputImageId && (!currentRevisedPrompt || showRevisedPrompt) && !hasHandledPromptWarning)
  const taskProviderName = taskProvider === 'fal' ? 'fal.ai' : taskProvider ? 'OpenAI' : '未知'
  const taskProfileName = task.apiProfileName || '未知'
  const taskModel = task.apiModel || '未知'
  const showSourceInfo = Boolean(task.apiProvider || task.apiProfileName || task.apiModel)
  const isFalReconnecting = task.status === 'error' && task.falRecoverable
  const isCustomReconnecting = task.status === 'error' && task.customRecoverable
  const hasPartialSuccess = task.status === 'error' && (task.outputImages?.length ?? 0) > 0 && !isFalReconnecting && !isCustomReconnecting
  const progressDisplay = getTaskProgressDisplay(task)
  const showProgressDetails = task.status !== 'done' || progressDisplay.cardLabel === '数量不够'
  const rawImageUrls = task.rawImageUrls ?? []
  const streamPreviewLen = streamPreviewItems.length
  const currentStreamPreviewSrc = activeStreamPreviewSrc
  const streamPartialImageIds = task.streamPartialImageIds ?? []

  const formatTime = (ts: number | null) => {
    if (!ts) return ''
    return new Date(ts).toLocaleString('zh-CN')
  }

  const formatDuration = () => {
    if (task.status === 'running' || isFalReconnecting || isCustomReconnecting) {
      const seconds = Math.max(0, Math.floor((now - task.createdAt) / 1000))
      const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
      const ss = String(seconds % 60).padStart(2, '0')
      return `${mm}:${ss}`
    }
    if (task.elapsed == null) return null
    const seconds = Math.floor(task.elapsed / 1000)
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
    const ss = String(seconds % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }

  const handleReuse = () => {
    reuseConfig(task)
    setDetailTaskId(null)
  }

  const handleEdit = () => {
    editOutputs(task)
    setDetailTaskId(null)
  }

  const handleMaskEditCurrentOutput = () => {
    const imgId = task.outputImages?.[imageIndex]
    if (!imgId) return
    setMaskEditorImageId(imgId)
    setDetailTaskId(null)
  }

  const handleDelete = () => {
    setDetailTaskId(null)
    setConfirmDialog({
      title: '删除任务',
      message: '确定要删除这个任务吗？关联的图片资源也会被清理（如果没有其他任务引用）。',
      action: () => removeTask(task),
    })
  }

  const handleToggleFavorite = () => {
    openFavoritePicker([task.id])
  }

  const handleCopyError = async () => {
    const errorText = task.error || '生成失败'
    try {
      await copyTextToClipboard(errorText)
      showToast('完整报错已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制报错失败', err), 'error')
    }
  }

  const handleCopyPrompt = async () => {
    if (!task.prompt) return
    try {
      await copyTextToClipboard(task.prompt)
      showToast('提示词已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制提示词失败', err), 'error')
    }
  }

  const handleShowPromptWarning = () => {
    showCodexCliPrompt(
      true,
      currentRevisedPrompt ? '接口返回的提示词已被改写' : '接口没有返回官方 API 会返回的部分信息',
    )
  }

  const handleCopyInputImage = async () => {
    const imgId = allInputImageIds[0]
    const src = imgId ? imageSrcs[imgId] : ''
    if (!src) return
    try {
      await copyImageSourceToClipboard(src)
      showToast('参考图已复制', 'success')
    } catch (err) {
      console.error(err)
      showToast(getClipboardFailureMessage('复制参考图失败', err), 'error')     
    }
  }

  const handleStartEdit = () => {
    if (!task) return
    setEditPrompt(task.prompt)
    setEditParams(task.params)
    setIsEditingParams(true)
  }

  const handleSaveEdit = () => {
    if (!task) return
    updateTaskInStore(task.id, { prompt: editPrompt, params: editParams })
    setIsEditingParams(false)
  }

  const updateEditPromptValue = (val: string) => {
    setEditPrompt(val)
    if (task && task.isFavorite) {
      updateTaskInStore(task.id, { prompt: val })
    }
  }

  const handleParamChange = (newParams: Partial<TaskParams>) => {
    const updated = { ...editParams, ...newParams }
    setEditParams(updated)
    if (task && task.isFavorite) {
      updateTaskInStore(task.id, { params: updated })
    }
  }

  const handleCancelEdit = () => {
    setIsEditingParams(false)
  }

  const handleDownloadCurrentOutput = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!currentOutputImageId || !task) return

    try {
      const entries = getGeneratedImageDownloadEntries([task], workspaceTabs, settings, [currentOutputImageId])
      const result = await downloadImageEntries(entries)
      if (result.successCount === 0) {
        showToast('下载失败', 'error')
      } else {
        showToast('下载成功', 'success')
      }
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
  }

  const handleDownloadOutputImage = async (imageId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!imageId || !task) return

    try {
      const entries = getGeneratedImageDownloadEntries([task], workspaceTabs, settings, [imageId])
      const result = await downloadImageEntries(entries)
      if (result.successCount === 0) {
        showToast('下载失败', 'error')
      } else {
        showToast('下载成功', 'success')
      }
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
  }

  const handleOpenImageDirectory = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isElectronEnv()) {
      showToast('仅桌面端支持打开图片目录', 'error')
      return
    }

    try {
      const dirPath = await getLocalImageSaveDirectory(containingTab?.name)
      if (!dirPath) {
        showToast('未设置本地保存目录', 'error')
        return
      }
      await openInExplorer(dirPath)
    } catch (err) {
      console.error(err)
      showToast('打开图片目录失败', 'error')
    }
  }

  const handleDownloadAllOutputs = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!task?.outputImages?.length) return

    try {
      const fileNameBase = `task-${task.id}`
      const entries = getGeneratedImageDownloadEntries([task], workspaceTabs, settings)
      const result = settings.zipDownloadRoutes.includes('task-detail-all')
        ? await downloadImageEntriesAsZip(entries, fileNameBase)
        : await downloadImageEntries(entries)
      if (result.successCount === 0) {
        showToast('下载失败', 'error')
      } else if (result.failCount > 0) {
        showToast(`部分下载失败：成功 ${result.successCount}，失败 ${result.failCount}`, 'error')
      } else {
        showToast(result.successCount > 1 ? `下载成功：${result.successCount} 张图片` : '下载成功', 'success')
      }
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
  }

  const handleDownloadPartialImages = async () => {
    if (!task || !streamPartialImageIds.length) return

    try {
      const fileNameBase = `task-${task.id}-partial`
      const entries = getGeneratedImageDownloadEntries([task], workspaceTabs, settings, streamPartialImageIds)
      const result = settings.zipDownloadRoutes.includes('task-detail-partial')
        ? await downloadImageEntriesAsZip(entries, fileNameBase)
        : await downloadImageEntries(entries)
      if (result.successCount === 0) {
        showToast('下载失败', 'error')
      } else if (result.failCount > 0) {
        showToast(`部分下载失败：成功 ${result.successCount}，失败 ${result.failCount}`, 'error')
      } else {
        showToast(`下载成功：${result.successCount} 张中间步骤图`, 'success')
      }
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
  }

  const handleRetry = () => {
    retryTask(task)
    setDetailTaskId(null)
  }

  return (
    <div
      data-no-drag-select
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={() => setDetailTaskId(null)}
    >
      <div className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-md animate-overlay-in" />
      <div
        ref={modalRef}
        className="relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border border-white/50 dark:border-white/[0.08] rounded-3xl shadow-[0_8px_40px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_40px_rgb(0,0,0,0.4)] max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col md:flex-row z-10 ring-1 ring-black/5 dark:ring-white/10 animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-14 items-center justify-end px-4 md:hidden">
          <button
            onClick={() => setDetailTaskId(null)}
            className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-white/[0.06] transition text-gray-400"
            aria-label="关闭"
          >
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>

        {/* 左侧：图片 */}
        <div className="md:w-1/2 w-full h-72 md:h-auto bg-gray-100 dark:bg-black/20 relative flex flex-col flex-shrink-0 min-h-[18rem]">
          {!task.isFavorite && outputLen > 0 && (
            <div className="flex items-center justify-between gap-3 border-b border-black/5 px-4 py-3 dark:border-white/[0.06]">
              <div data-selectable-text className="min-w-0 flex items-center gap-1.5">
                {currentImageRatio && currentImageSize ? (
                  <>
                    <span className="rounded bg-black/60 px-2 py-0.5 font-mono text-xs text-white backdrop-blur-sm">{currentImageRatio}</span>
                    <span className="rounded bg-black/60 px-2 py-0.5 text-xs font-medium text-white/90 backdrop-blur-sm">{currentImageSize}</span>
                  </>
                ) : formatDuration() ? (
                  <span className="rounded bg-black/60 px-2 py-0.5 font-mono text-xs text-white backdrop-blur-sm">{formatDuration()}</span>
                ) : null}
                <span className="rounded-full bg-black/45 px-2 py-0.5 text-xs text-white backdrop-blur-sm">
                  {Math.min(imageIndex + 1, outputLen)} / {outputLen}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <div className="relative group flex">
                  <button
                    type="button"
                    {...openImageDirectoryTooltip.handlers}
                    onClick={(e) => {
                      openImageDirectoryTooltip.handlers.onClick()
                      handleOpenImageDirectory(e)
                    }}
                    className="flex items-center justify-center rounded bg-black/60 p-1 text-white backdrop-blur-sm transition hover:bg-black/75 focus:outline-none focus:ring-1 focus:ring-white/50"
                    aria-label="打开图片目录"
                  >
                    <FolderOpenIcon className="h-4 w-4" />
                  </button>
                  <ViewportTooltip visible={openImageDirectoryTooltip.visible} className="whitespace-nowrap">打开图片目录</ViewportTooltip>
                </div>
                {task.status === 'running' && (
                  <span className="flex items-center gap-1 rounded bg-blue-500 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
                    <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {progressDisplay.cardLabel}
                  </span>
                )}
                {hasPartialSuccess && <span className="rounded bg-yellow-500 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">{progressDisplay.cardLabel}</span>}
                {outputLen > 1 && (
                  <div className="relative group flex">
                    <button type="button" {...downloadAllTooltip.handlers} onClick={(e) => { downloadAllTooltip.handlers.onClick(); handleDownloadAllOutputs(e) }} className="flex items-center justify-center gap-0.5 rounded bg-black/60 py-0.5 pl-1.5 pr-2 text-white backdrop-blur-sm transition hover:bg-black/75 focus:outline-none focus:ring-1 focus:ring-white/50" aria-label="下载全部">
                      <DownloadIcon className="h-4 w-4" />
                      <span className="mt-[1px] text-[9px] font-bold leading-none">ALL</span>
                    </button>
                    <ViewportTooltip visible={downloadAllTooltip.visible} className="whitespace-nowrap">下载全部</ViewportTooltip>
                  </div>
                )}
              </div>
            </div>
          )}

          {outputLen > 0 ? (
            task.isFavorite ? (
              <div className="flex-1 w-full h-full p-4 flex items-center justify-center bg-black/5">
                <img 
                  src={outputPreviewSrcs[task.outputImages[0]] || ''} 
                  className="max-w-full max-h-full object-contain drop-shadow-md rounded-md" 
                  alt="Preview"
                  onClick={() => setLightboxImageId(task.outputImages[0], task.outputImages)}
                />
              </div>
            ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {task.outputImages.map((imageId, index) => {
                  const src = outputPreviewSrcs[imageId] || ''
                  const itemStatus = task.batchItemStatuses?.[index]
                  const isSelected = imageId === currentOutputImageId
                  
                  // 尝试从多个来源获取尺寸信息
                  let width: number | null = null
                  let height: number | null = null
                  
                  // 1. 先从已有的 imageSizes/imageRatios 获取
                  const currentRatio = imageRatios[imageId]
                  const currentSize = imageSizes[imageId]
                  if (currentSize) {
                    const [w, h] = currentSize.split('×').map(Number)
                    if (w && h) {
                      width = w
                      height = h
                    }
                  }
                  
                  // 2. 从任务的 actualParamsByImage 获取
                  if ((width === null || height === null) && task.actualParamsByImage) {
                    const params = task.actualParamsByImage[imageId]
                    if (params?.size && typeof params.size === 'string') {
                      const [w, h] = params.size.split('x').map(Number)
                      if (w && h) {
                        width = w
                        height = h
                      }
                    }
                  }
                  
                  // 3. 从任务的 actualParams 获取
                  if ((width === null || height === null) && task.actualParams?.size) {
                    const [w, h] = task.actualParams.size.split('x').map(Number)
                    if (w && h) {
                      width = w
                      height = h
                    }
                  }
                  
                  // 4. 从任务的 params 获取
                  if ((width === null || height === null) && task.params.size !== 'auto') {
                    const [w, h] = task.params.size.split('x').map(Number)
                    if (w && h) {
                      width = w
                      height = h
                    }
                  }
                  
                  // 根据尺寸确定比例
                  let aspectClass = 'aspect-video' // 默认回到横版，确保不会都是方形
                  if (width && height) {
                    if (width > height) {
                      aspectClass = 'aspect-video' // 横版 (16:9)
                    } else if (height > width) {
                      aspectClass = 'aspect-[9/16]' // 竖版 (9:16)
                    } else {
                      aspectClass = 'aspect-square' // 方形
                    }
                  }
                  
                  return (
                    <div key={imageId} className={['group relative overflow-hidden rounded-lg border bg-black/20 transition', aspectClass, isSelected ? 'border-blue-400 shadow-[0_0_0_1px_rgba(96,165,250,0.75)]' : itemStatus === 'error' ? 'border-red-400/60' : 'border-white/10 hover:border-white/40'].join(' ')} onPointerEnter={(e) => { setImageIndex(index); updateHoverPreviewPosition(imageId, src, e) }} onPointerMove={(e) => updateHoverPreviewPosition(imageId, src, e)} onPointerLeave={() => setHoverPreview((preview) => preview?.imageId === imageId ? null : preview)}>
                      {src ? (
                        <img src={src} data-image-id={imageId} className="saveable-image h-full w-full cursor-pointer object-cover transition duration-150 group-hover:scale-[1.03]" onLoad={(e) => { const image = e.currentTarget; if (image.naturalWidth > 0 && image.naturalHeight > 0) { setImageRatios((prev) => ({ ...prev, [imageId]: formatImageRatio(image.naturalWidth, image.naturalHeight) })); setImageSizes((prev) => ({ ...prev, [imageId]: image.naturalWidth + '×' + image.naturalHeight })) } }} onClick={() => { setImageIndex(index); setLightboxImageId(imageId, task.outputImages) }} alt="" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center"><svg className="h-6 w-6 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></div>
                      )}
                      <div className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">{index + 1}</div>
                      {itemStatus === 'error' && <div className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-red-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white">失败</div>}
                      {src && <button type="button" onClick={(e) => handleDownloadOutputImage(imageId, e)} className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded bg-black/60 text-white opacity-0 backdrop-blur-sm transition hover:bg-black/75 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-white/60" aria-label="下载图片"><DownloadIcon className="h-4 w-4" /></button>}
                    </div>
                  )
                })}
              </div>
            </div>
            )
          ) : task.status === 'running' ? (
            <div className="m-auto flex flex-col items-center gap-3 text-blue-400"><svg className="h-10 w-10 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>{formatDuration() && <span className="rounded bg-black/50 px-2 py-0.5 font-mono text-xs text-white">{formatDuration()}</span>}</div>
          ) : task.status === 'error' ? (
            <div className="m-auto w-full max-w-md px-4 text-center">
              <svg className="w-10 h-10 text-red-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="overflow-hidden whitespace-pre-line text-sm leading-6 text-red-500 break-words">{task.error || '生成失败'}</p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyError}
                  className="inline-flex items-center justify-center rounded-full border border-red-200/80 bg-white/80 px-3 py-1.5 text-red-500 transition hover:bg-red-50 dark:border-red-400/20 dark:bg-white/[0.04] dark:hover:bg-red-500/10"
                  aria-label="复制完整报错"
                >
                  <CopyIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="inline-flex items-center justify-center rounded-full border border-blue-200/80 bg-white/80 px-3 py-1.5 text-blue-500 transition hover:bg-blue-50 dark:border-blue-400/20 dark:bg-white/[0.04] dark:hover:bg-blue-500/10"
                  aria-label="重试任务"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* 右侧：信息 */}
        <div className="md:w-1/2 w-full p-5 overflow-y-auto overscroll-contain flex flex-col">
          <button
            onClick={() => setDetailTaskId(null)}
            className="absolute top-3 right-3 hidden p-1 rounded-full hover:bg-gray-100 dark:hover:bg-white/[0.06] transition text-gray-400 z-10 md:block"
            aria-label="关闭"
          >
            <CloseIcon className="w-5 h-5" />
          </button>

          <div data-selectable-text className="flex-1">
            <div className="flex items-center gap-1.5 mb-2">
              <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                输入内容
              </h3>
              {!isEditingParams && task.prompt && !showPendingPrompt && (
                <button
                  onClick={handleCopyPrompt}
                  className="p-1 rounded text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-white/[0.06] transition"
                  title="复制提示词"
                >
                  <CopyIcon className="h-4 w-4" />
                </button>
              )}
              {!isEditingParams && showPromptWarning && (
                <span className="relative inline-flex">
                  <button
                    type="button"
                    className="p-1 rounded text-amber-500 hover:bg-amber-50 dark:text-yellow-300 dark:hover:bg-yellow-500/10 transition"
                    onClick={handleShowPromptWarning}
                    aria-label="提示词已被改写"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    </svg>
                  </button>
                </span>
              )}
            </div>
            {isEditingParams ? (
              <PromptVariableEditor
                value={editPrompt}
                onChange={updateEditPromptValue}
                spellCheck={false}
                className="mb-4 h-32 w-full overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words text-gray-700 outline-none transition focus:ring-2 focus:ring-blue-500/50 dark:border-white/10 dark:bg-black/20 dark:text-gray-300"
              />
            ) : showPendingPrompt ? (
              <div className="mb-4 leading-relaxed">
                <p className="text-sm text-gray-700 dark:text-gray-300">正在生成……</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">输入内容将在响应完成时接收</p>
              </div>
            ) : (
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap mb-4">
                {task.prompt ? (
                  promptParts.map((part, index) => {
                    if (part.type === 'variable') {
                      const color = VAR_COLOR_MAP[part.varName] ?? ''
                      return (
                        <span key={index}
                          className="inline-flex items-center px-1 rounded text-xs font-medium"
                          style={{
                            backgroundColor: color ? `${color}18` : 'rgba(156,163,175,0.1)',
                            color: color || '#9ca3af',
                            borderColor: color ? color : 'rgba(156,163,175,0.2)',
                            borderWidth: '1px',
                            borderStyle: 'solid'
                          }}
                        >
                          {part.text}
                        </span>
                      )
                    } else {
                      return <span key={index}>{part.text}</span>
                    }
                  })
                ) : (
                  '(无提示词)'
                )}
              </p>
            )}
            {!isEditingParams && showRevisedPrompt && currentRevisedPrompt && (
              <div className="mb-4">
                <ActualValueBadge
                  value={currentRevisedPrompt}
                  className="max-w-full rounded px-2 py-1 text-left text-xs leading-relaxed whitespace-pre-wrap"
                />
              </div>
            )}

            {/* 参考图 */}
            {showReferenceSection && (
              <div className="mb-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    参考图
                  </h3>
                  {allInputImageIds.length > 0 && (
                    <button
                      onClick={handleCopyInputImage}
                      className="p-1 rounded text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-white/[0.06] transition"
                      title="复制参考图"
                    >
                      <CopyIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {allInputImageIds.length > 0 ? (
                  <>
                    <div className="flex gap-2 flex-wrap">
                      {allInputImageIds.map((imgId) => {
                        const isMaskTarget = imgId === maskTargetId
                        const displaySrc = (isMaskTarget && maskPreviewSrc) ? maskPreviewSrc : (imageSrcs[imgId] || '')
                        return (
                          <div key={imgId} className="relative group inline-block">
                            <div
                              className={`relative w-16 h-16 rounded-lg overflow-hidden border cursor-pointer hover:opacity-80 transition ${
                                isMaskTarget ? 'border-blue-500 border-2 shadow-sm' : 'border-gray-200 dark:border-white/[0.08]'
                              }`}
                              onClick={() => setLightboxImageId(imgId, allInputImageIds)}
                            >
                              {displaySrc && (
                                <img
                                  src={displaySrc}
                                  data-image-id={imgId}
                                  className="w-full h-full object-cover"
                                  alt=""
                                />
                              )}
                              {isMaskTarget && (
                                <span className="absolute left-1 top-1 rounded bg-blue-500/90 px-1.5 py-0.5 text-[8px] leading-none text-white font-bold tracking-wider backdrop-blur-sm z-10 pointer-events-none">
                                  MASK
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {isAgentEditTool && (
                      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        由模型自主选择，可能包含其他图片
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    由模型自主选择
                  </div>
                )}
              </div>
            )}

            {/* 参数 */}
            <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
              参数配置
            </h3>
            {!isEditingParams && showSourceInfo && (
              <div className="mb-2 rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-white/[0.03]">
                <span className="text-gray-400 dark:text-gray-500">来源</span>  
                <br />
                <span className="font-medium text-gray-700 dark:text-gray-200">{taskProviderName}</span>
                <span className="text-gray-400 dark:text-gray-500"> · {taskProfileName} · {taskModel}</span>
              </div>
            )}
            {!isEditingParams && (task.scheduledOutputPath || task.scheduledOutputSubFolder) && (   
              <div className="mb-2 rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-white/[0.03]">
                <span className="text-gray-400 dark:text-gray-500">输出地址</span>
                <br />
                <span className="font-medium text-gray-700 dark:text-gray-200 break-all select-text">
                  {task.scheduledOutputPath || task.scheduledOutputSubFolder}   
                </span>
              </div>
            )}
            
            {isEditingParams && task.isFavorite ? (
              <div className="grid grid-cols-2 gap-2 text-xs mb-4">
                <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2 flex flex-col justify-center">
                  <span className="text-gray-400 dark:text-gray-500 mb-1">尺寸</span>
                  <Select
                    value={editParams.size || DEFAULT_PARAMS.size}
                    onChange={(val) => handleParamChange({ size: val as string })}
                    options={[
                      { label: 'auto', value: 'auto' },
                      { label: '1024x1024 (1:1 推荐)', value: '1024x1024' },
                      { label: '1536x1024 (3:2 推荐)', value: '1536x1024' },
                      { label: '1024x1536 (2:3 推荐)', value: '1024x1536' },
                      { label: '1280x720 (16:9 推荐)', value: '1280x720' },
                      { label: '720x1280 (9:16 推荐)', value: '720x1280' },
                      { label: '1024x768 (4:3)', value: '1024x768' },
                      { label: '768x1024 (3:4)', value: '768x1024' },
                      { label: '2048x2048 (1:1 推荐)', value: '2048x2048' },
                      { label: '2160x1440 (3:2)', value: '2160x1440' },
                      { label: '1440x2160 (2:3)', value: '1440x2160' },
                      { label: '2560x1440 (16:9)', value: '2560x1440' },
                      { label: '1440x2560 (9:16)', value: '1440x2560' },
                      { label: '3840x2160 (16:9 推荐)', value: '3840x2160' },
                      { label: '2160x3840 (9:16 推荐)', value: '2160x3840' }
                    ]}
                    className="w-full font-medium text-gray-700 dark:text-gray-200 px-2 py-1 rounded bg-white dark:bg-black/40 border border-gray-200 dark:border-white/10"
                  />
                </div>
                <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2 flex flex-col justify-center">
                  <span className="text-gray-400 dark:text-gray-500 mb-1">质量</span>
                  <Select
                    value={editParams.quality}
                    onChange={(val) => handleParamChange({ quality: val as any })}
                    options={[
                      { label: 'auto', value: 'auto' },
                      { label: 'low', value: 'low' },
                      { label: 'medium', value: 'medium' },
                      { label: 'high', value: 'high' }
                    ]}
                    className="w-full font-medium text-gray-700 dark:text-gray-200 px-2 py-1 rounded bg-white dark:bg-black/40 border border-gray-200 dark:border-white/10"
                  />
                </div>
                <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2 flex flex-col justify-center">
                  <span className="text-gray-400 dark:text-gray-500 mb-1">格式</span>
                  <Select
                    value={editParams.output_format}
                    onChange={(val) => handleParamChange({ output_format: val as any })}
                    options={[
                      { label: 'png', value: 'png' },
                      { label: 'jpeg', value: 'jpeg' },
                      { label: 'webp', value: 'webp' }
                    ]}
                    className="w-full font-medium text-gray-700 dark:text-gray-200 px-2 py-1 rounded bg-white dark:bg-black/40 border border-gray-200 dark:border-white/10"
                  />
                </div>
                {!isAgentTask && (
                  <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2 flex flex-col justify-center">
                    <span className="text-gray-400 dark:text-gray-500 mb-1">数量</span>
                    <input
                      type="number"
                      value={editParams.n}
                      onChange={(e) => handleParamChange({ n: Math.max(1, parseInt(e.target.value) || 1) })}
                      min={1}
                      className="w-full font-medium text-gray-700 dark:text-gray-200 px-2 py-1 rounded bg-white dark:bg-black/40 border border-gray-200 dark:border-white/10 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                    />
                  </div>
                )}
                {task.isFavorite && (
                  <div className="col-span-2 bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2 flex flex-col justify-center">
                    <span className="text-gray-400 dark:text-gray-500 mb-1">输出地址</span>
                    <input
                      type="text"
                      value={task.scheduledOutputPath || task.scheduledOutputSubFolder || ''}
                      onChange={(e) => {
                        const val = e.target.value
                        updateTaskInStore(task.id, { 
                          scheduledOutputPath: val,
                          scheduledOutputSubFolder: val 
                        })
                      }}
                      placeholder="输入保存路径..."
                      className="w-full font-medium text-gray-700 dark:text-gray-200 px-2 py-1 rounded bg-white dark:bg-black/40 border border-gray-200 dark:border-white/10 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-xs mb-4">
                <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2">
                  <span className="text-gray-400 dark:text-gray-500">尺寸</span> 
                  <br />
                  <DetailParamValue task={task} paramKey="size" className="font-medium" actualParams={currentActualParams} />
                </div>
                <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2">
                  <span className="text-gray-400 dark:text-gray-500">质量</span>
                  <br />
                  <DetailParamValue task={task} paramKey="quality" className="font-medium" actualParams={currentActualParams} />
                </div>
                <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2">
                  <span className="text-gray-400 dark:text-gray-500">格式</span>
                  <br />
                  <DetailParamValue task={task} paramKey="output_format" className="font-medium" actualParams={currentActualParams} />
                </div>
                <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2">
                  <span className="text-gray-400 dark:text-gray-500">审核</span> 
                  <br />
                  <DetailParamValue task={task} paramKey="moderation" className="font-medium" actualParams={currentActualParams} />
                </div>
                {!isAgentTask && (
                  <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2">
                    <span className="text-gray-400 dark:text-gray-500">数量</span>
                    <br />
                    <DetailParamValue task={task} paramKey="n" className="font-medium" />
                  </div>
                )}
                {task.params.output_compression != null && (
                  <div className="bg-gray-50 dark:bg-white/[0.03] rounded-lg px-3 py-2">
                    <span className="text-gray-400 dark:text-gray-500">压缩率</span>
                    <br />
                    <DetailParamValue task={task} paramKey="output_compression" className="font-medium" actualParams={currentActualParams} />
                  </div>
                )}
              </div>
            )}

            {!isEditingParams && showProgressDetails && (
              <div className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-white/[0.03]">
                <div className="mb-1 text-gray-400 dark:text-gray-500">进度情况</div>
                <div className="font-medium text-gray-700 dark:text-gray-200">{progressDisplay.detailTitle}</div>
                <div className="mt-1 whitespace-pre-line leading-5 text-gray-500 dark:text-gray-400">
                  {progressDisplay.detailDescription}
                </div>
                {progressDisplay.reasons.length > 0 && (
                  <ul className="mt-2 space-y-1 text-gray-500 dark:text-gray-400">
                    {progressDisplay.reasons.map((reason, index) => (
                      <li key={index}>{reason}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* 时间 */}
            {!task.isFavorite && (
              <div className="text-xs text-gray-400 dark:text-gray-500 mb-4">
                <span>创建于 {formatTime(task.createdAt)}</span>
                {formatDuration() && <span> · 耗时 {formatDuration()}</span>}
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="grid grid-cols-4 sm:flex gap-2 pt-4 border-t border-gray-100 dark:border-white/[0.08]">
            {isEditingParams && !task.isFavorite ? (
              <div className="col-span-4 sm:flex-1 flex gap-2 w-full justify-end">
                <button
                  onClick={handleCancelEdit}
                  className="flex-1 sm:flex-none px-6 py-2 flex items-center justify-center rounded-xl transition bg-gray-50 text-gray-700 hover:bg-gray-100 dark:bg-white/[0.04] dark:text-gray-300 dark:hover:bg-white/10 text-sm font-medium"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="flex-1 sm:flex-none px-6 py-2 flex items-center justify-center rounded-xl transition bg-blue-500 text-white hover:bg-blue-600 shadow-sm text-sm font-medium"
                >
                  保存修改
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={handleReuse}
                  className="col-span-2 sm:flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition text-sm font-medium whitespace-nowrap"
                >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              复用配置
            </button>
            <button
              onClick={handleEdit}
              disabled={!outputLen}
              className="col-span-2 sm:flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm font-medium whitespace-nowrap"
            >
              <EditIcon className="w-4 h-4 flex-shrink-0" />
              编辑输出
            </button>
            <button
              onClick={handleDelete}
              className="col-span-3 sm:flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition text-sm font-medium whitespace-nowrap"
            >
              <TrashIcon className="w-4 h-4 flex-shrink-0" />
              删除任务
            </button>
            {!task.isFavorite && (
              <button
                onClick={handleToggleFavorite}
                className="col-span-1 sm:flex-none sm:w-11 w-full flex items-center justify-center rounded-xl transition bg-gray-50 text-gray-400 hover:bg-yellow-50 hover:text-yellow-500 dark:bg-white/[0.04] dark:hover:bg-yellow-500/10"
                title="收藏任务"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </button>
            )}
            </>
            )}
          </div>
        </div>
      </div>

      {showSizePicker && (
        <SizePickerModal
          currentSize={editParams.size}
          onSelect={(size) => {
            handleParamChange({ size })
            setShowSizePicker(false)
          }}
          onClose={() => setShowSizePicker(false)}
        />
      )}

      {hoverPreview && (
        <HoverImagePreview
          preview={hoverPreview}
          sizeText={imageSizes[hoverPreview.imageId] || ''}
        />
      )}

      {showRawUrlsModal && rawImageUrls.length > 0 && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm sm:p-6"
          onPointerDown={(e) => {
            rawUrlsBackdropPointerDownRef.current = e.target === e.currentTarget
          }}
          onClick={(e) => {
            e.stopPropagation()
            if (rawUrlsBackdropPointerDownRef.current && e.target === e.currentTarget) setShowRawUrlsModal(false)
            rawUrlsBackdropPointerDownRef.current = false
          }}
        >
          <div ref={rawUrlsModalRef} className="flex w-full max-w-2xl max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-[#1c1c1e]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/[0.08] shrink-0">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">原始图片链接 ({rawImageUrls.length})</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await copyTextToClipboard(rawImageUrls.join('\n'))
                      showToast('复制成功', 'success')
                    } catch (err) {
                      showToast(getClipboardFailureMessage('复制失败', err), 'error')
                    }
                  }}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.08] transition-colors text-xs font-medium"
                >
                  <CopyIcon className="w-3.5 h-3.5" />
                  全部复制
                </button>
                <button
                  type="button"
                  onClick={() => setShowRawUrlsModal(false)}
                  className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:hover:bg-white/[0.08] dark:hover:text-gray-300 transition-colors"
                >
                  <CloseIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 bg-gray-50/50 dark:bg-black/20 overscroll-contain">
              <div className="space-y-2.5">
                {rawImageUrls.map((url, i) => (
                  <div key={i} className="group flex items-center gap-3 p-3 sm:p-4 rounded-xl bg-white dark:bg-[#1c1c1e] border border-gray-100 dark:border-white/[0.06] shadow-sm hover:shadow-md transition-all">
                    <div className="flex-1 min-w-0 flex flex-col gap-1">
                      <div className="text-xs font-medium text-gray-400 dark:text-gray-500">
                        图片 {i + 1}
                      </div>
                      <div className="text-sm text-gray-700 dark:text-gray-300 truncate select-text" title={url}>
                        {url}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await copyTextToClipboard(url)
                          showToast('复制成功', 'success')
                        } catch (err) {
                          showToast(getClipboardFailureMessage('复制失败', err), 'error')
                        }
                      }}
                      className="flex-shrink-0 p-2 sm:px-3 sm:py-1.5 flex items-center justify-center gap-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.08] transition-colors text-xs font-medium border border-transparent dark:border-white/[0.04]"
                      title="复制链接"
                    >
                      <CopyIcon className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                      <span className="hidden sm:inline">复制</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {showRawResponseModal && task?.rawResponsePayload && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm sm:p-6"
          onPointerDown={(e) => {
            rawResponseBackdropPointerDownRef.current = e.target === e.currentTarget
          }}
          onClick={(e) => {
            e.stopPropagation()
            if (rawResponseBackdropPointerDownRef.current && e.target === e.currentTarget) setShowRawResponseModal(false)
            rawResponseBackdropPointerDownRef.current = false
          }}
        >
          <div
            ref={rawResponseModalRef}
            className="flex w-full max-w-3xl max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-[#1c1c1e]"
            onPointerDown={(e) => {
              if (!(e.target as Element).closest('[data-selectable-text]')) clearTextSelection()
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/[0.08] shrink-0">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">原始响应数据</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await copyTextToClipboard(task.rawResponsePayload!)
                      showToast('复制成功', 'success')
                    } catch (err) {
                      showToast(getClipboardFailureMessage('复制失败', err), 'error')
                    }
                  }}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.08] transition-colors text-xs font-medium"
                >
                  <CopyIcon className="w-3.5 h-3.5" />
                  全部复制
                </button>
                <button
                  type="button"
                  onClick={() => setShowRawResponseModal(false)}
                  className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:hover:bg-white/[0.08] dark:hover:text-gray-300 transition-colors"
                >
                  <CloseIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-5 bg-gray-50/50 dark:bg-black/20 overscroll-contain">
              <pre data-selectable-text className="text-[11px] sm:text-xs text-gray-600 dark:text-gray-300 font-mono whitespace-pre-wrap break-all select-text">
                {task.rawResponsePayload.replace(/"(b64_json|base64|data)":\s*"[^"]+"/g, '"$1": "<base64_data>"')}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
