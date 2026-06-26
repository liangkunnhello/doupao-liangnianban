import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useStore } from '../../store'
import { CalendarIcon, DownloadIcon, FolderOpenIcon, RefreshIcon, TrashIcon } from '../../components/icons'
import { escapePromptHtmlAttribute, escapePromptHtmlText } from '../../lib/promptImageMentions'
import {
  createCompositeColorBlockLayer,
  createCompositeImageLayer,
  createCompositeLogoLayer,
  createCompositeTextLayer,
  createCompositeVectorShapeLayer,
  createDefaultCompositeLayerStyle,
} from './lib/compositeDefaults'
import { createCompositeProductSizeRule } from './lib/compositeProducts'
import { buildCompositeFileName, buildCompositeFolderName, getCompositeProgress } from './lib/compositeDistribution'
import { summarizeCompositeExportHistory } from './lib/compositeExportHistory'
import { createDefaultCompositeOutputPresetGroups, getSelectedCompositeOutputRules } from './lib/compositeOutputPresets'
import { renderCompositePresetToCanvas, renderCompositePresetToDataUrl } from './lib/compositeRenderer'
import { applyWatermarkPresetsToPreset, createWatermarkPresetFromLayers } from './lib/compositeWatermarks'
import { getActiveCompositePage, useCompositeStore } from './store'
import type { CompositeCanvas, CompositeFsImage, CompositeImageLayer, CompositeLayer, CompositePreset, CompositeProductSizeRule, CompositeTextLayer, CompositeWatermarkPreset } from './lib/compositeTypes'

type ElectronCompositeApi = NonNullable<typeof window.electronAPI>

const NAMING_TEMPLATE_TOKENS = [
  { label: '日期', value: '{date}' },
  { label: '预设', value: '{product}' },
  { label: '尺寸', value: '{size}' },
  { label: '分类', value: '{category}' },
  { label: '源文件', value: '{file}' },
  { label: '序号', value: '{index}' },
]
const NAMING_TEMPLATE_TOKEN_VALUES = new Set(NAMING_TEMPLATE_TOKENS.map((token) => token.value))

type NamingTemplatePreviewValues = {
  date: string
  product: string
  size: string
  category: string
  file: string
  index: string
}

function todayTokenInput() {
  return new Date().toISOString().slice(0, 10)
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function clonePreset(preset: CompositePreset): CompositePreset {
  return JSON.parse(JSON.stringify(preset)) as CompositePreset
}

function isElectronReady(api: ElectronCompositeApi | undefined): api is ElectronCompositeApi {
  return Boolean(api?.isElectron)
}

function getLayerLabel(layer: CompositeLayer) {
  if (layer.type === 'background') return '背景'
  if (layer.type === 'image') return layer.name || '贴片'
  if (layer.type === 'logo') return layer.name || 'Logo'
  if (layer.type === 'watermark') return layer.name || '水印文字'
  if (layer.type === 'colorBlock') return layer.name || '矢量形状'
  if (layer.type === 'text') return layer.name || layer.text || '文字'
  return layer.name
}

function getLayerKind(layer: CompositeLayer) {
  if (layer.type === 'background') return '背景'
  if (layer.type === 'image') return '图片'
  if (layer.type === 'logo') return 'LOGO'
  if (layer.type === 'watermark') return '文字'
  if (layer.type === 'colorBlock') return '矢量'
  return '文字'
}

function getLayerTypeTitle(layer: CompositeLayer) {
  if (layer.type === 'text' || layer.type === 'watermark') return '文字属性'
  if (layer.type === 'image') return '图片属性'
  if (layer.type === 'logo') return 'LOGO占位属性'
  if (layer.type === 'colorBlock') return '矢量形状属性'
  return '图层属性'
}

type ImageDimensions = { width: number; height: number }

let textMeasureCanvas: HTMLCanvasElement | null = null

function getTextMeasureContext() {
  if (typeof document === 'undefined') return null
  textMeasureCanvas ??= document.createElement('canvas')
  return textMeasureCanvas.getContext('2d')
}

function getTextLayerContentBounds(layer: CompositeTextLayer, canvas: CompositeCanvas) {
  const context = getTextMeasureContext()
  const scale = canvas.width / 1280
  const fontSize = Math.max(1, layer.fontSize * scale)
  const strokePadding = Math.max(0, layer.strokeWidth || 0) * 2
  let textWidthPx = layer.width / 100 * canvas.width
  if (context) {
    context.font = `${layer.fontWeight} ${fontSize}px ${layer.fontFamily || 'sans-serif'}`
    textWidthPx = Math.max(1, context.measureText(layer.text || ' ').width + strokePadding + 4)
  }
  const textHeightPx = Math.max(1, fontSize * 1.18 + strokePadding)
  const maxWidth = layer.width / 100 * canvas.width
  const maxHeight = layer.height / 100 * canvas.height
  const width = Math.min(maxWidth, textWidthPx) / canvas.width * 100
  const height = Math.min(maxHeight, textHeightPx) / canvas.height * 100
  const alignOffset = layer.align === 'right' ? layer.width - width : layer.align === 'center' ? (layer.width - width) / 2 : 0
  return {
    left: layer.x + Math.max(0, alignOffset),
    top: layer.y + Math.max(0, (layer.height - height) / 2),
    width: Math.max(0.2, width),
    height: Math.max(0.2, height),
  }
}

function getImageLayerContentBounds(layer: CompositeImageLayer, canvas: CompositeCanvas, dimensions?: ImageDimensions) {
  const sourceWidth = layer.sourceWidth || dimensions?.width
  const sourceHeight = layer.sourceHeight || dimensions?.height
  if (!sourceWidth || !sourceHeight || layer.width <= 0 || layer.height <= 0) return null
  const imageRatio = sourceWidth / sourceHeight
  const rectRatio = (canvas.width * layer.width) / (canvas.height * layer.height)
  if (imageRatio > rectRatio) {
    const drawHeight = (canvas.width * layer.width) / imageRatio / canvas.height
    return {
      left: layer.x,
      top: layer.y + ((layer.height - drawHeight) / 2),
      width: layer.width,
      height: drawHeight,
    }
  }
  const drawWidth = (canvas.height * layer.height) * imageRatio / canvas.width
  return {
    left: layer.x + ((layer.width - drawWidth) / 2),
    top: layer.y,
    width: drawWidth,
    height: layer.height,
  }
}

function getLayerPreviewStyle(layer: CompositeLayer, canvas?: CompositeCanvas, dimensions?: ImageDimensions): CSSProperties {
  const base = {
    left: `${layer.x}%`,
    top: `${layer.y}%`,
    opacity: layer.opacity,
  }
  if (canvas && (layer.type === 'text' || layer.type === 'watermark')) {
    const bounds = getTextLayerContentBounds(layer, canvas)
    return {
      left: `${bounds.left}%`,
      top: `${bounds.top}%`,
      width: `${bounds.width}%`,
      height: `${bounds.height}%`,
      opacity: layer.opacity,
    }
  }
  if (canvas && (layer.type === 'image' || layer.type === 'logo')) {
    const bounds = getImageLayerContentBounds(layer, canvas, dimensions)
    if (bounds) {
      return {
        left: `${bounds.left}%`,
        top: `${bounds.top}%`,
        width: `${bounds.width}%`,
        height: `${bounds.height}%`,
        opacity: layer.opacity,
      }
    }
  }
  return {
    ...base,
    width: `${layer.width}%`,
    height: `${layer.height}%`,
  }
}

function getLayerHitStyle(layer: CompositeLayer): CSSProperties {
  return {
    left: `${layer.x}%`,
    top: `${layer.y}%`,
    width: `${layer.width}%`,
    height: `${layer.height}%`,
    opacity: layer.opacity,
  }
}

function getLayerSelectionStyle(layer: CompositeLayer, canvas?: CompositeCanvas, dimensions?: ImageDimensions): CSSProperties {
  const style = getLayerPreviewStyle(layer, canvas, dimensions)
  const left = Number.parseFloat(String(style.left ?? layer.x))
  const top = Number.parseFloat(String(style.top ?? layer.y))
  const width = Number.parseFloat(String(style.width ?? layer.width))
  const height = Number.parseFloat(String(style.height ?? layer.height))
  return {
    left: `${layer.width > 0 ? ((left - layer.x) / layer.width) * 100 : 0}%`,
    top: `${layer.height > 0 ? ((top - layer.y) / layer.height) * 100 : 0}%`,
    width: `${layer.width > 0 ? (width / layer.width) * 100 : 100}%`,
    height: `${layer.height > 0 ? (height / layer.height) * 100 : 100}%`,
  }
}

function stripTemplateLayers(preset: CompositePreset): CompositePreset {
  return {
    ...preset,
    layers: preset.layers.filter((layer) => layer.type === 'background'),
  }
}

function setBackgroundImage(preset: CompositePreset, image: CompositeFsImage): CompositePreset {
  return {
    ...preset,
    backgroundPath: image.path,
    layers: preset.layers.map((layer) => layer.type === 'background'
      ? { ...layer, enabled: true, sourcePath: image.path, sourceDataUrl: image.dataUrl }
      : layer),
  }
}

function readDataUrlDimensions(dataUrl: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve(null)
    image.src = dataUrl
  })
}

function getWatermarkSizeRules(preset: CompositeWatermarkPreset | null) {
  if (preset?.sizeRules?.length) return preset.sizeRules
  return [createCompositeProductSizeRule(`${preset?.id ?? 'watermark'}-main`, '主尺寸输出')]
}

function getWatermarkDistribution(preset: CompositeWatermarkPreset) {
  return preset.distribution ?? { enabled: false, outputPath: '', count: 0 }
}

function getPresetOutputSettings(preset: CompositeWatermarkPreset | null) {
  const rule = getWatermarkSizeRules(preset)[0]
  return {
    outputPath: rule.outputPath,
    namingTemplate: rule.namingTemplate,
  }
}

function getOutputRuleCategoryName(rule: CompositeProductSizeRule) {
  return 'categoryName' in rule && typeof rule.categoryName === 'string' ? rule.categoryName : undefined
}

function getCompositeLayerStyle(layer: CompositeLayer) {
  if (layer.style) return layer.style
  if (layer.type === 'text' || layer.type === 'watermark') return createDefaultCompositeLayerStyle(layer.color)
  if (layer.type === 'colorBlock') return createDefaultCompositeLayerStyle(layer.fill)
  return createDefaultCompositeLayerStyle('#ffffff')
}

function getTemplateTokenPreview(token: string, values: NamingTemplatePreviewValues) {
  if (token === '{date}') return values.date
  if (token === '{product}') return values.product
  if (token === '{size}') return values.size
  if (token === '{category}') return values.category
  if (token === '{file}') return values.file
  if (token === '{index}') return values.index
  return token
}

function renderNamingTemplateHtml(template: string, values: NamingTemplatePreviewValues) {
  const tokenPattern = /(\{date\}|\{product\}|\{size\}|\{category\}|\{file\}|\{index\})/g
  return template
    .split(tokenPattern)
    .filter((part) => part.length > 0)
    .map((part) => {
      if (!NAMING_TEMPLATE_TOKEN_VALUES.has(part)) return escapePromptHtmlText(part)
      const preview = getTemplateTokenPreview(part, values)
      return `<span contenteditable="false" class="wildcard-var" data-template-token="${escapePromptHtmlAttribute(part)}" title="${escapePromptHtmlAttribute(part)}">${escapePromptHtmlText(preview)}</span>`
    })
    .join('')
}

function readNamingTemplateFromEditor(el: HTMLElement) {
  let text = ''
  const appendNodeText = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
      return
    }
    if (node instanceof HTMLElement && node.dataset.templateToken) {
      text += node.dataset.templateToken
      return
    }
    node.childNodes.forEach(appendNodeText)
  }
  el.childNodes.forEach(appendNodeText)
  return text.replace(/\r\n?/g, '')
}

function NamingTemplateEditor({
  value,
  previewValues,
  onChange,
}: {
  value: string
  previewValues: NamingTemplatePreviewValues
  onChange: (value: string) => void
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const isUserInputRef = useRef(false)
  const renderedHtml = useMemo(() => renderNamingTemplateHtml(value, previewValues), [previewValues, value])

  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    if (isUserInputRef.current) {
      isUserInputRef.current = false
      return
    }
    if (el.innerHTML !== renderedHtml) el.innerHTML = renderedHtml
  }, [renderedHtml])

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      className="min-h-[34px] w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 leading-6 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-gray-900"
      onInput={(event) => {
        isUserInputRef.current = true
        onChange(readNamingTemplateFromEditor(event.currentTarget))
      }}
      onPaste={(event) => {
        event.preventDefault()
        const text = event.clipboardData.getData('text/plain')
        document.execCommand('insertText', false, text)
      }}
    />
  )
}

export default function CompositeWorkspace() {
  const showToast = useStore((state) => state.showToast)
  const state = useCompositeStore()
  const {
    categories,
    activeCategoryId,
    activePageId,
    products,
    watermarkPresets,
    outputPresetGroups,
    iconLibraryPath,
    iconLibraryAssets,
    exportRecords,
    isExporting,
    exportCompleted,
    exportTotal,
    updateActivePreset,
    updateLayer,
    addLayer,
    deleteLayer,
    moveLayer,
    updateProduct,
    addWatermarkPreset,
    updateWatermarkPreset,
    duplicateWatermarkPreset,
    deleteWatermarkPreset,
    updateOutputPresetRule,
    setIconLibrary,
    setExportProgress,
    setExporting,
    setExportRecords,
  } = state
  const { page: activePage } = getActiveCompositePage({ categories, activeCategoryId, activePageId })
  const templatePreset = activePage?.preset ?? null
  const batchTask = products[0] ?? null
  const [selectedLayerId, setSelectedLayerId] = useState('main-text')
  const [selectedSizeId, setSelectedSizeId] = useState('')
  const [materialAssets, setMaterialAssets] = useState<CompositeFsImage[]>([])
  const [previewMaterialImage, setPreviewMaterialImage] = useState<CompositeFsImage | null>(null)
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0)
  const [batchDate, setBatchDate] = useState(todayTokenInput())
  const [statusText, setStatusText] = useState('')
  const [customNamingToken, setCustomNamingToken] = useState('')
  const [dragState, setDragState] = useState<{ layerId: string; startX: number; startY: number; layerX: number; layerY: number } | null>(null)
  const [logoLibraryWidth, setLogoLibraryWidth] = useState(200)
  const [logoResizeState, setLogoResizeState] = useState<{ startX: number; startWidth: number } | null>(null)
  const [editingLogoPath, setEditingLogoPath] = useState('')
  const [draggingLogoPath, setDraggingLogoPath] = useState('')
  const [editingTextLayerId, setEditingTextLayerId] = useState('')
  const [layerImageDimensions, setLayerImageDimensions] = useState<Record<string, ImageDimensions>>({})
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const previewFrameRef = useRef<HTMLDivElement>(null)
  const lastLayerPointerRef = useRef({ layerId: '', time: 0 })
  const lastLayerMouseRef = useRef({ layerId: '', time: 0 })
  const [previewFrameSize, setPreviewFrameSize] = useState({ width: 0, height: 0 })
  const electronApi = typeof window !== 'undefined' ? window.electronAPI : undefined
  const electronReady = isElectronReady(electronApi)
  const progress = getCompositeProgress(exportCompleted, exportTotal)
  const historySummary = useMemo(() => summarizeCompositeExportHistory(exportRecords), [exportRecords])
  const selectedWatermarkPresets = useMemo(() => (
    watermarkPresets.filter((preset) => batchTask?.selectedWatermarkPresetIds.includes(preset.id))
  ), [batchTask?.selectedWatermarkPresetIds, watermarkPresets])
  const activeWatermarkPreset = selectedWatermarkPresets[0] ?? watermarkPresets[0] ?? null
  const safeOutputPresetGroups = useMemo(() => (
    outputPresetGroups?.length ? outputPresetGroups : createDefaultCompositeOutputPresetGroups()
  ), [outputPresetGroups])
  const selectedOutputRules = useMemo(() => getSelectedCompositeOutputRules(safeOutputPresetGroups), [safeOutputPresetGroups])
  const allOutputRules = useMemo(() => safeOutputPresetGroups.flatMap((group) => group.rules), [safeOutputPresetGroups])
  const previewOutputRule = selectedOutputRules[0] ?? allOutputRules[0] ?? null
  const selectedSize = selectedOutputRules.find((rule) => rule.id === selectedSizeId) ?? previewOutputRule
  const selectedLayer = templatePreset?.layers.find((layer) => layer.id === selectedLayerId)
    ?? templatePreset?.layers.find((layer) => layer.type !== 'background')
    ?? null
  const displayedLayers = useMemo(() => [...(templatePreset?.layers ?? [])].reverse(), [templatePreset?.layers])
  const editableLayerCount = useMemo(() => (
    templatePreset?.layers.filter((layer) => layer.type !== 'background' && layer.enabled).length ?? 0
  ), [templatePreset?.layers])
  const previewImage = materialAssets[selectedPreviewIndex] ?? materialAssets[0] ?? null
  const namingTemplatePreviewValues = useMemo(() => ({
    date: batchDate.replaceAll('-', ''),
    product: activeWatermarkPreset?.name ?? '预设',
    size: selectedSize?.name ?? `${templatePreset?.canvas.width ?? 1280}x${templatePreset?.canvas.height ?? 720}`,
    category: selectedSize ? getOutputRuleCategoryName(selectedSize) ?? '分类' : '分类',
    file: previewImage?.name?.replace(/\.[^.]+$/, '') ?? '源文件',
    index: '1',
  }), [activeWatermarkPreset?.name, batchDate, previewImage?.name, selectedSize, templatePreset?.canvas.height, templatePreset?.canvas.width])
  const previewPreset = useMemo(() => {
    if (!templatePreset) return null
    const canvas = selectedSize ? { width: selectedSize.width, height: selectedSize.height } : templatePreset.canvas
    let next = { ...clonePreset(templatePreset), canvas }
    if (previewMaterialImage) next = setBackgroundImage(next, previewMaterialImage)
    return next
  }, [previewMaterialImage, selectedSize, templatePreset])
  const canvasPreviewPreset = useMemo(() => {
    if (!previewPreset || !selectedLayerId) return previewPreset
    return {
      ...previewPreset,
      layers: previewPreset.layers.filter((layer) => layer.id !== selectedLayerId),
    }
  }, [previewPreset, selectedLayerId])
  const previewStageSize = useMemo(() => {
    const canvasWidth = previewPreset?.canvas.width || 1280
    const canvasHeight = previewPreset?.canvas.height || 720
    const frameWidth = previewFrameSize.width || 1024
    const frameHeight = previewFrameSize.height || 480
    const maxWidth = Math.max(1, Math.min(frameWidth - 24, 1024))
    const maxHeight = Math.max(1, frameHeight - 24)
    const scale = Math.min(maxWidth / canvasWidth, maxHeight / canvasHeight)
    return {
      width: Math.max(1, Math.floor(canvasWidth * scale)),
      height: Math.max(1, Math.floor(canvasHeight * scale)),
    }
  }, [previewFrameSize.height, previewFrameSize.width, previewPreset?.canvas.height, previewPreset?.canvas.width])

  useEffect(() => {
    if (selectedSizeId || !selectedSize) return
    setSelectedSizeId(selectedSize.id)
  }, [selectedSize, selectedSizeId])

  useEffect(() => {
    let active = true
    async function loadPreviewImage() {
      if (!previewImage) {
        setPreviewMaterialImage(null)
        return
      }
      if (previewImage.dataUrl || !electronReady) {
        setPreviewMaterialImage(previewImage)
        return
      }
      const image = await electronApi.readImageFile(previewImage.path)
      if (active) setPreviewMaterialImage(image ?? previewImage)
    }
    void loadPreviewImage()
    return () => { active = false }
  }, [electronApi, electronReady, previewImage])

  useEffect(() => {
    let active = true
    let timer: number | undefined
    async function render() {
      if (!canvasPreviewPreset || !canvasRef.current || dragState || editingTextLayerId) return
      try {
        await renderCompositePresetToCanvas(canvasPreviewPreset, canvasRef.current)
      } catch (error) {
        if (active) console.error(error)
      }
    }
    timer = window.setTimeout(() => void render(), 24)
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [canvasPreviewPreset, dragState, editingTextLayerId])

  useEffect(() => {
    if (!templatePreset) return
    let active = true
    const layers = templatePreset.layers.filter((layer): layer is CompositeImageLayer => (
      (layer.type === 'image' || layer.type === 'logo') && Boolean(layer.sourceDataUrl || layer.sourcePath)
    ))
    void Promise.all(layers.map(async (layer) => {
      if (layer.sourceWidth && layer.sourceHeight) return [layer.id, { width: layer.sourceWidth, height: layer.sourceHeight }] as const
      const source = layer.sourceDataUrl || layer.sourcePath
      if (!source) return null
      const dimensions = await readDataUrlDimensions(source)
      return dimensions ? [layer.id, dimensions] as const : null
    })).then((entries) => {
      if (!active) return
      setLayerImageDimensions((current) => {
        const next: Record<string, ImageDimensions> = {}
        for (const entry of entries) {
          if (entry) next[entry[0]] = entry[1]
        }
        const currentKeys = Object.keys(current)
        const nextKeys = Object.keys(next)
        if (currentKeys.length === nextKeys.length && nextKeys.every((key) => current[key]?.width === next[key].width && current[key]?.height === next[key].height)) {
          return current
        }
        return next
      })
    })
    return () => { active = false }
  }, [templatePreset])

  useEffect(() => {
    if (!selectedLayer || (selectedLayer.type !== 'text' && selectedLayer.type !== 'watermark')) {
      setEditingTextLayerId('')
    }
  }, [selectedLayer])

  useEffect(() => {
    const node = previewFrameRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const updateSize = () => {
      setPreviewFrameSize((current) => {
        const next = { width: node.clientWidth, height: node.clientHeight }
        return current.width === next.width && current.height === next.height ? current : next
      })
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const selectPath = async (kind: 'file' | 'directory') => {
    if (!electronReady) {
      showToast('仅 Electron 桌面端支持选择本地路径', 'info')
      return null
    }
    return kind === 'file' ? electronApi.selectFile() : electronApi.selectDirectory()
  }

  const loadMaterialFolder = async (path: string) => {
    if (!electronReady || !path.trim()) return []
    const assets = await electronApi.listImageFiles(path.trim())
    setMaterialAssets(assets)
    setSelectedPreviewIndex(0)
    return assets
  }

  const chooseMaterialFolder = async () => {
    if (!batchTask) return
    const dir = await selectPath('directory')
    if (!dir) return
    updateProduct(batchTask.id, { inputPath: dir })
    const assets = await loadMaterialFolder(dir)
    showToast(`已载入 ${assets.length} 张素材`, 'success')
  }

  const updatePresetOutputSettings = (preset: CompositeWatermarkPreset, patch: Partial<Pick<CompositeProductSizeRule, 'outputPath' | 'namingTemplate'>>) => {
    const sizeRules = getWatermarkSizeRules(preset)
    const [first, ...rest] = sizeRules
    updateWatermarkPreset(preset.id, {
      sizeRules: [{ ...first, ...patch }, ...rest],
    })
  }

  const choosePresetOutputPath = async (preset: CompositeWatermarkPreset) => {
    const dir = await selectPath('directory')
    if (dir) updatePresetOutputSettings(preset, { outputPath: dir })
  }

  const chooseDistributionPath = async (preset: CompositeWatermarkPreset) => {
    const dir = await selectPath('directory')
    if (dir) updateWatermarkPreset(preset.id, { distribution: { ...(preset.distribution ?? { enabled: false, outputPath: '', count: 0 }), outputPath: dir } })
  }

  const appendNamingTemplateText = (preset: CompositeWatermarkPreset, text: string) => {
    const current = getPresetOutputSettings(preset).namingTemplate
    updatePresetOutputSettings(preset, { namingTemplate: `${current}${text}` })
  }

  const addCustomNamingToken = (preset: CompositeWatermarkPreset) => {
    const token = customNamingToken.trim()
    if (!token) return
    const current = preset.namingTokens ?? []
    updateWatermarkPreset(preset.id, { namingTokens: current.includes(token) ? current : [...current, token] })
    setCustomNamingToken('')
  }

  const refreshIconLibrary = async (path = iconLibraryPath) => {
    if (!electronReady || !path.trim()) return
    const assets = await electronApi.listImageFiles(path.trim())
    setIconLibrary(path.trim(), assets)
    showToast(`已载入 ${assets.length} 个图标`, 'success')
  }

  const chooseIconLibrary = async () => {
    const dir = await selectPath('directory')
    if (!dir || !electronReady) return
    const assets = await electronApi.listImageFiles(dir)
    setIconLibrary(dir, assets)
  }

  const applyIconAsLogo = async (asset: CompositeFsImage) => {
    if (!electronReady) return
    const image = await electronApi.readImageFile(asset.path)
    if (!image) return
    const dimensions = image.dataUrl ? await readDataUrlDimensions(image.dataUrl) : null
    const targetLogoId = selectedLayer?.type === 'logo'
      ? selectedLayer.id
      : templatePreset?.layers.find((layer) => layer.type === 'logo')?.id
    const nextLogoId = targetLogoId ?? makeId('logo')
    updateActivePreset((current) => ({
      ...current,
      layers: targetLogoId ? current.layers.map((layer) => layer.type === 'logo'
        && layer.id === targetLogoId
        ? { ...layer, sourcePath: image.path, sourceName: image.name, sourceDataUrl: image.dataUrl, sourceWidth: dimensions?.width, sourceHeight: dimensions?.height }
        : layer) : [
        ...current.layers,
        { ...createCompositeLogoLayer(nextLogoId), sourcePath: image.path, sourceName: image.name, sourceDataUrl: image.dataUrl, sourceWidth: dimensions?.width, sourceHeight: dimensions?.height },
      ],
    }))
    setSelectedLayerId(nextLogoId)
  }

  const addToolLayer = (kind: 'text' | 'image' | 'logo' | 'shape') => {
    const id = makeId(kind)
    const layer = kind === 'text'
      ? createCompositeTextLayer(id, '文字')
      : kind === 'image'
        ? createCompositeImageLayer(id, '图片')
        : kind === 'logo'
          ? createCompositeLogoLayer(id)
          : createCompositeVectorShapeLayer(id)
    addLayer(layer)
    setSelectedLayerId(layer.id)
  }

  const updateLogoLibraryAssets = (assets: CompositeFsImage[]) => {
    setIconLibrary(iconLibraryPath, assets)
  }

  const renameLogoAsset = (assetPath: string, name: string) => {
    updateLogoLibraryAssets(iconLibraryAssets.map((asset) => asset.path === assetPath ? { ...asset, name } : asset))
  }

  const deleteLogoAsset = (assetPath: string) => {
    updateLogoLibraryAssets(iconLibraryAssets.filter((asset) => asset.path !== assetPath))
    if (editingLogoPath === assetPath) setEditingLogoPath('')
  }

  const moveLogoAsset = (sourcePath: string, targetPath: string) => {
    if (!sourcePath || sourcePath === targetPath) return
    const sourceIndex = iconLibraryAssets.findIndex((asset) => asset.path === sourcePath)
    const targetIndex = iconLibraryAssets.findIndex((asset) => asset.path === targetPath)
    if (sourceIndex < 0 || targetIndex < 0) return
    const next = [...iconLibraryAssets]
    const [item] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, item)
    updateLogoLibraryAssets(next)
  }

  const startLogoLibraryResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    setLogoResizeState({ startX: event.clientX, startWidth: logoLibraryWidth })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleLogoLibraryResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!logoResizeState) return
    const nextWidth = logoResizeState.startWidth - (event.clientX - logoResizeState.startX)
    setLogoLibraryWidth(Math.max(128, Math.min(360, Math.round(nextWidth))))
  }

  const alignSelectedLayer = (position: 'h-center' | 'v-center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => {
    if (!selectedLayer || selectedLayer.type === 'background') return
    const patch: Partial<CompositeLayer> = {}
    if (position === 'h-center') patch.x = (100 - selectedLayer.width) / 2
    if (position === 'v-center') patch.y = (100 - selectedLayer.height) / 2
    if (position === 'top-left') Object.assign(patch, { x: 0, y: 0 })
    if (position === 'top-right') Object.assign(patch, { x: 100 - selectedLayer.width, y: 0 })
    if (position === 'bottom-left') Object.assign(patch, { x: 0, y: 100 - selectedLayer.height })
    if (position === 'bottom-right') Object.assign(patch, { x: 100 - selectedLayer.width, y: 100 - selectedLayer.height })
    updateLayer(selectedLayer.id, patch)
  }

  const updateSelectedLayerStyle = (updater: (style: ReturnType<typeof getCompositeLayerStyle>) => ReturnType<typeof getCompositeLayerStyle>) => {
    if (!selectedLayer) return
    updateLayer(selectedLayer.id, { style: updater(getCompositeLayerStyle(selectedLayer)) } as Partial<CompositeLayer>)
  }

  const updateSelectedLayerPatch = (patch: Partial<CompositeLayer>) => {
    if (!selectedLayer) return
    updateLayer(selectedLayer.id, patch)
  }

  const clearTemplateSampleLayers = () => {
    updateActivePreset((current) => ({
      ...current,
      layers: current.layers.filter((layer) => layer.type === 'background' || !['title-bg', 'patch-main', 'main-text', 'logo', 'watermark'].includes(layer.id)),
    }))
    setSelectedLayerId('')
  }

  const saveCurrentAsWatermark = () => {
    if (!templatePreset) return
    const layers = templatePreset.layers.filter((layer) => layer.type !== 'background')
    if (!layers.length) {
      showToast('当前没有可保存的水印图层', 'info')
      return
    }
    const preset = createWatermarkPresetFromLayers({
      id: makeId('watermark'),
      name: activePage?.name ? `${activePage.name} 水印` : `水印 ${watermarkPresets.length + 1}`,
      layers,
    })
    addWatermarkPreset(preset)
    if (batchTask) updateProduct(batchTask.id, { selectedWatermarkPresetIds: [...batchTask.selectedWatermarkPresetIds, preset.id] })
    showToast('已保存并选中水印预设', 'success')
  }

  const toggleWatermarkPreset = (presetId: string) => {
    if (!batchTask) return
    const current = batchTask.selectedWatermarkPresetIds
    updateProduct(batchTask.id, {
      selectedWatermarkPresetIds: current.includes(presetId)
        ? current.filter((id) => id !== presetId)
        : [...current, presetId],
    })
  }

  const getTextOverlayStyle = (layer: CompositeTextLayer): CSSProperties => {
    const style = getCompositeLayerStyle(layer)
    const fill = style.fill.type === 'solid' ? style.fill.color : layer.color
    return {
      color: fill,
      fontFamily: layer.fontFamily,
      fontSize: Math.max(8, layer.fontSize * previewStageSize.width / 1280),
      fontWeight: layer.fontWeight,
      lineHeight: 1.18,
      textAlign: layer.align,
      textShadow: style.shadow.enabled
        ? `${style.shadow.x}px ${style.shadow.y}px ${style.shadow.blur}px ${style.shadow.color}`
        : undefined,
      WebkitTextStroke: layer.strokeWidth ? `${Math.max(1, layer.strokeWidth * previewStageSize.width / 1280)}px ${layer.strokeColor}` : undefined,
    }
  }

  const getColorBlockOverlayStyle = (layer: CompositeLayer): CSSProperties => {
    if (layer.type !== 'colorBlock') return {}
    const style = getCompositeLayerStyle(layer)
    const fill = style.fill.type === 'linear-gradient'
      ? `linear-gradient(90deg, ${style.fill.color}, ${style.fill.color2})`
      : layer.fill
    return {
      width: '100%',
      height: '100%',
      borderRadius: `${layer.radius}px`,
      background: fill,
    }
  }

  const renderSelectedLayerContent = (layer: CompositeLayer) => {
    if (layer.id !== selectedLayerId) return null
    if (layer.type === 'image' || layer.type === 'logo') {
      const source = layer.sourceDataUrl || layer.sourcePath
      return source ? <img src={source} alt="" className="h-full w-full object-contain" draggable={false} /> : null
    }
    if (layer.type === 'text' || layer.type === 'watermark') {
      const textStyle = getTextOverlayStyle(layer)
      if (editingTextLayerId === layer.id) {
        return (
          <input
            value={layer.text}
            autoFocus
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onChange={(event) => updateLayer(layer.id, { text: event.target.value })}
            onBlur={() => setEditingTextLayerId('')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault()
                setEditingTextLayerId('')
              }
            }}
            className="h-full w-full border-0 bg-transparent p-0 outline-none"
            style={textStyle}
          />
        )
      }
      return (
        <span className="block h-full w-full overflow-hidden whitespace-nowrap" style={textStyle}>
          {layer.text}
        </span>
      )
    }
    if (layer.type === 'colorBlock') {
      return <span className="block" style={getColorBlockOverlayStyle(layer)} />
    }
    return null
  }

  const handleLayerPointerDown = (event: React.PointerEvent<HTMLElement>, layer: CompositeLayer) => {
    if (layer.locked || layer.type === 'background' || layer.watermarkPresetId) return
    const now = Date.now()
    const isDoublePointer = lastLayerPointerRef.current.layerId === layer.id && now - lastLayerPointerRef.current.time < 360
    lastLayerPointerRef.current = { layerId: layer.id, time: now }
    if ((event.detail >= 2 || isDoublePointer) && (layer.type === 'text' || layer.type === 'watermark')) {
      setSelectedLayerId(layer.id)
      setEditingTextLayerId(layer.id)
      return
    }
    if (layer.type !== 'text' && layer.type !== 'watermark') event.preventDefault()
    setSelectedLayerId(layer.id)
    setDragState({
      layerId: layer.id,
      startX: event.clientX,
      startY: event.clientY,
      layerX: layer.x,
      layerY: layer.y,
    })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleLayerMouseDown = (event: React.MouseEvent<HTMLElement>, layer: CompositeLayer) => {
    if (layer.locked || layer.type === 'background' || layer.watermarkPresetId) return
    if (layer.type !== 'text' && layer.type !== 'watermark') return
    const now = Date.now()
    const isDoubleMouse = lastLayerMouseRef.current.layerId === layer.id && now - lastLayerMouseRef.current.time < 360
    lastLayerMouseRef.current = { layerId: layer.id, time: now }
    if (event.detail >= 2 || isDoubleMouse) {
      setSelectedLayerId(layer.id)
      setEditingTextLayerId(layer.id)
    }
  }

  const handleLayerPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState || !stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const dx = ((event.clientX - dragState.startX) / rect.width) * 100
    const dy = ((event.clientY - dragState.startY) / rect.height) * 100
    updateLayer(dragState.layerId, {
      x: Math.max(0, Math.min(100, dragState.layerX + dx)),
      y: Math.max(0, Math.min(100, dragState.layerY + dy)),
    })
  }

  const handleStageDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!templatePreset || !stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * 100
    const y = ((event.clientY - rect.top) / rect.height) * 100
    const targetLayer = [...templatePreset.layers].reverse().find((layer) => (
      layer.enabled
      && !layer.locked
      && (layer.type === 'text' || layer.type === 'watermark')
      && x >= layer.x
      && x <= layer.x + layer.width
      && y >= layer.y
      && y <= layer.y + layer.height
    ))
    if (!targetLayer) return
    event.preventDefault()
    setSelectedLayerId(targetLayer.id)
    setEditingTextLayerId(targetLayer.id)
  }

  const makeOutputPreset = async (
    source: CompositeFsImage,
    watermark: CompositeWatermarkPreset,
    size: CompositeProductSizeRule,
  ) => {
    if (!templatePreset || !electronReady) return null
    const image = source.dataUrl ? source : await electronApi.readImageFile(source.path)
    if (!image) return null
    const base = setBackgroundImage(stripTemplateLayers({ ...clonePreset(templatePreset), canvas: { width: size.width, height: size.height } }), image)
    return applyWatermarkPresetsToPreset(base, [watermark])
  }

  const renderAndSave = async ({
    runId,
    preset,
    outputPath,
    namingTemplate,
    maxSizeKb,
    source,
    watermark,
    size,
    date,
    index,
  }: {
    runId: string
    preset: CompositePreset
    outputPath: string
    namingTemplate: string
    maxSizeKb: number
    source: CompositeFsImage
    watermark: CompositeWatermarkPreset
    size: CompositeProductSizeRule
    date: string
    index: number
  }) => {
    if (!electronReady || !outputPath.trim()) return null
    let dataUrl = await renderCompositePresetToDataUrl(preset)
    const maxBytes = maxSizeKb > 0 ? maxSizeKb * 1024 : 0
    if (maxBytes > 0) {
      for (const quality of [0.86, 0.78, 0.7, 0.62, 0.54, 0.46]) {
        const estimatedBytes = Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)
        if (estimatedBytes <= maxBytes) break
        dataUrl = await renderCompositePresetToDataUrl(preset, quality)
      }
    }
    const fileName = buildCompositeFileName({
      template: namingTemplate,
      date,
      pageName: watermark.name,
      productName: watermark.name,
      sizeName: size.name,
      categoryName: getOutputRuleCategoryName(size),
      fileName: source.name,
      index,
      extension: 'jpg',
    })
    const folderName = buildCompositeFolderName({
      template: namingTemplate,
      date,
      pageName: watermark.name,
      productName: watermark.name,
      sizeName: size.name,
      categoryName: getOutputRuleCategoryName(size),
      fileName: source.name,
      index,
    })
    const filePath = await electronApi.pathJoin(outputPath.trim(), folderName, fileName)
    const ok = await electronApi.saveCompositeImage(filePath, dataUrl, maxSizeKb)
    return ok ? { runId, outputPath: await electronApi.pathJoin(outputPath.trim(), folderName), count: 1, createdAt: Date.now() } : null
  }

  const startExport = async () => {
    if (!electronReady || !batchTask) {
      showToast('完整分配功能仅支持 Electron 桌面端', 'info')
      return
    }
    const assets = materialAssets.length ? materialAssets : await loadMaterialFolder(batchTask.inputPath)
    const watermarks = selectedWatermarkPresets
    const outputRules = selectedOutputRules
    const total = watermarks.reduce((sum, watermark) => {
      const output = getPresetOutputSettings(watermark)
      return sum + (output.outputPath.trim() ? assets.length * outputRules.length : 0)
    }, 0)
    if (!assets.length) {
      showToast('请先选择包含图片的素材文件夹', 'info')
      return
    }
    if (!watermarks.length) {
      showToast('请至少选择一个水印预设', 'info')
      return
    }
    if (!outputRules.length) {
      showToast('请至少勾选一个全局输出尺寸/KB预设', 'info')
      return
    }
    if (!total) {
      showToast('请为选中预设配置输出目录', 'info')
      return
    }

    const runId = `watermark-run-${Date.now()}`
    const records = []
    let completed = 0
    setExporting(true)
    setExportProgress(0, total)
    setExportRecords([])
    try {
      for (const watermark of watermarks) {
        const output = getPresetOutputSettings(watermark)
        const sizes = output.outputPath.trim() ? outputRules : []
        const distribution = getWatermarkDistribution(watermark)
        let distributedForPreset = 0
        for (const source of assets) {
          for (const size of sizes) {
            setStatusText(`正在贴水印 ${completed + 1}/${total}`)
            const preset = await makeOutputPreset(source, watermark, size)
            if (!preset) continue
            const record = await renderAndSave({
                runId,
                preset,
                outputPath: output.outputPath,
                namingTemplate: output.namingTemplate,
                maxSizeKb: size.maxSizeKb,
              source,
              watermark,
              size,
              date: batchDate.replaceAll('-', ''),
              index: completed + 1,
            })
            if (record) records.push(record)

            if (distribution.enabled && distribution.outputPath.trim() && distribution.count > 0 && distributedForPreset < distribution.count) {
              const distributionRule = { ...size, name: `${size.name}-分配`, outputPath: distribution.outputPath, namingTemplate: `{product}-{size}-{file}-{index}` }
              const distributionRecord = await renderAndSave({
                runId,
                preset,
                outputPath: distribution.outputPath,
                namingTemplate: distributionRule.namingTemplate,
                maxSizeKb: size.maxSizeKb,
                source,
                watermark,
                size: distributionRule,
                date: batchDate.replaceAll('-', ''),
                index: completed + 1,
              })
              if (distributionRecord) records.push(distributionRecord)
              distributedForPreset += 1
            }

            completed += 1
            setExportProgress(completed, total)
          }
        }
      }
      setExportRecords(records)
      showToast(`批量贴水印完成：${completed}/${total}`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setExporting(false)
      setStatusText('')
    }
  }

  return (
    <main className="h-[calc(100vh-var(--app-header-offset))] overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-gray-200 bg-white/90 px-4 text-xs shadow-sm dark:border-white/[0.08] dark:bg-gray-950/90">
          <div className="flex items-center gap-2 font-semibold">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            <span>图片批量贴水印</span>
          </div>
          <span className={`rounded-full px-2 py-0.5 ${electronReady ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'}`}>
            {electronReady ? '桌面端就绪' : '仅桌面端完整可用'}
          </span>
          <button type="button" onClick={saveCurrentAsWatermark} className="ml-auto rounded-lg border border-gray-200 px-2.5 py-1.5 text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.06]">
            保存为水印预设
          </button>
          <button type="button" onClick={startExport} disabled={isExporting} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-950 px-3 py-1.5 font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-gray-950">
            <DownloadIcon className="h-3.5 w-3.5" /> {isExporting ? '处理中' : '开始处理'}
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[290px] shrink-0 flex-col border-r border-gray-200 bg-white/80 dark:border-white/[0.08] dark:bg-gray-950/70">
            <div className="flex h-9 items-center justify-between border-b border-gray-100 px-3 dark:border-white/[0.08]">
              <h3 className="text-sm font-semibold">水印预设</h3>
              <span className="text-xs text-gray-400">{selectedWatermarkPresets.length}/{watermarkPresets.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
              {watermarkPresets.map((preset) => (
                <div key={preset.id} className="mb-2 rounded-md border border-gray-200 bg-gray-50 p-2 dark:border-white/[0.08] dark:bg-white/[0.03]">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={Boolean(batchTask?.selectedWatermarkPresetIds.includes(preset.id))} onChange={() => toggleWatermarkPreset(preset.id)} />
                    <input
                      value={preset.name}
                      onChange={(event) => updateWatermarkPreset(preset.id, { name: event.target.value })}
                      className="min-w-0 flex-1 bg-transparent font-semibold outline-none"
                    />
                    <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] dark:bg-white/[0.08]">{preset.kind}</span>
                    <button type="button" onClick={() => duplicateWatermarkPreset(preset.id)} className="text-[10px] text-gray-400 hover:text-blue-600">复制</button>
                    <TrashIcon onClick={() => deleteWatermarkPreset(preset.id)} className="h-3.5 w-3.5 text-gray-400 hover:text-red-500" />
                  </label>
                  <div className="mt-1 text-[10px] text-gray-500">
                    {preset.layers.length} 个图层 · {getWatermarkSizeRules(preset).length} 个尺寸 · {preset.distribution?.enabled ? '已配置分配' : '未分配'}
                  </div>
                </div>
              ))}
              {!watermarkPresets.length && (
                <div className="rounded-md border border-dashed border-gray-200 p-3 text-gray-400 dark:border-white/[0.08]">
                  在右侧图层里设置好水印后，点击顶部“保存为水印预设”
                </div>
              )}
            </div>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-gray-200 bg-white/90 p-3 text-xs dark:border-white/[0.08] dark:bg-gray-950/70">
              {batchTask && (
                <div className="flex items-center gap-2 overflow-x-auto">
                  <label className="flex min-w-[360px] flex-1 items-center gap-2">
                    <span className="shrink-0 text-gray-500">素材文件夹</span>
                    <input value={batchTask.inputPath} onChange={(event) => updateProduct(batchTask.id, { inputPath: event.target.value })} className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 dark:border-white/[0.08] dark:bg-gray-900" />
                  </label>
                  <button type="button" onClick={chooseMaterialFolder} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 px-2 py-1.5 dark:border-white/[0.08]"><FolderOpenIcon className="h-3.5 w-3.5" />浏览</button>
                  <button type="button" onClick={() => void loadMaterialFolder(batchTask.inputPath)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 px-2 py-1.5 dark:border-white/[0.08]"><RefreshIcon className="h-3.5 w-3.5" />读取</button>
                  <span className="shrink-0 rounded bg-gray-100 px-2 py-1.5 text-gray-500 dark:bg-white/[0.06]">素材 {materialAssets.length}</span>
                  <label className="flex shrink-0 items-center gap-2">日期<input type="date" value={batchDate} onChange={(event) => setBatchDate(event.target.value)} className="rounded-md border border-gray-200 bg-white px-2 py-1.5 dark:border-white/[0.08] dark:bg-gray-900" /></label>
                </div>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col p-3">
              <div className="mb-2 flex shrink-0 items-center justify-between text-xs">
                <div>
                  <span className="font-semibold">{previewImage?.name ?? '预览素材'}</span>
                  <span className="ml-2 text-gray-500">画布 {previewPreset?.canvas.width ?? 0} x {previewPreset?.canvas.height ?? 0}</span>
                  <span className="ml-2 rounded bg-blue-50 px-2 py-0.5 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200">图层 {editableLayerCount}</span>
                </div>
                <div className="flex items-center gap-1">
                  {(selectedOutputRules.length ? selectedOutputRules : allOutputRules).map((rule) => (
                    <button key={rule.id} type="button" onClick={() => setSelectedSizeId(rule.id)} className={`rounded-md border px-2 py-1 dark:border-white/[0.08] ${selectedSize?.id === rule.id ? 'border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200' : 'border-gray-200'}`}>{rule.width}x{rule.height}</button>
                  ))}
                </div>
              </div>
              <div ref={previewFrameRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-dashed border-gray-300 bg-slate-100 p-3 dark:border-white/[0.12] dark:bg-white/[0.04]">
                <div className="absolute left-3 top-1/2 z-20 flex -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white/95 text-gray-700 shadow-lg backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/90 dark:text-gray-200">
                  {[
                    { kind: 'text' as const, label: 'T', title: '新建文字图层' },
                    { kind: 'image' as const, label: '▧', title: '新建图片图层' },
                    { kind: 'logo' as const, label: '◆', title: '新建LOGO占位' },
                    { kind: 'shape' as const, label: '○', title: '新建矢量形状' },
                  ].map((tool) => (
                    <button
                      key={tool.kind}
                      type="button"
                      onClick={() => addToolLayer(tool.kind)}
                      className="flex h-9 w-9 items-center justify-center border-b border-gray-100 text-base font-semibold hover:bg-blue-50 hover:text-blue-700 last:border-b-0 dark:border-white/[0.08] dark:hover:bg-blue-500/10 dark:hover:text-blue-200"
                      title={tool.title}
                    >
                      {tool.label}
                    </button>
                  ))}
                </div>
                <div
                  ref={stageRef}
                  onPointerMove={handleLayerPointerMove}
                  onPointerUp={() => setDragState(null)}
                  onPointerCancel={() => setDragState(null)}
                  onDoubleClick={handleStageDoubleClick}
                  className="relative overflow-hidden rounded-md shadow-inner"
                  data-composite-stage
                  style={{ width: previewStageSize.width, height: previewStageSize.height }}
                >
                  <canvas ref={canvasRef} className="block h-full w-full" />
                  {templatePreset?.layers.filter((layer) => layer.type !== 'background' && layer.enabled).map((layer) => (
                    <div
                      key={layer.id}
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        setSelectedLayerId(layer.id)
                        if (event.detail >= 2 && (layer.type === 'text' || layer.type === 'watermark')) {
                          setEditingTextLayerId(layer.id)
                        }
                      }}
                      onPointerDown={(event) => handleLayerPointerDown(event, layer)}
                      onDoubleClick={(event) => {
                        if (layer.type === 'text' || layer.type === 'watermark') {
                          event.preventDefault()
                          event.stopPropagation()
                          setSelectedLayerId(layer.id)
                          setEditingTextLayerId(layer.id)
                        }
                      }}
                      className="group absolute box-border cursor-move overflow-visible"
                      style={getLayerHitStyle(layer)}
                      title={getLayerLabel(layer)}
                      onMouseDown={(event) => handleLayerMouseDown(event, layer)}
                    >
                      <div
                        className={`absolute box-border h-full w-full overflow-visible border transition ${selectedLayerId === layer.id ? 'border-blue-500 bg-blue-500/10' : 'border-transparent group-hover:border-blue-300'}`}
                        style={getLayerSelectionStyle(layer, previewPreset?.canvas, layerImageDimensions[layer.id])}
                      >
                        {renderSelectedLayerContent(layer)}
                      </div>
                    </div>
                  ))}
                </div>
                <div
                  className="absolute bottom-3 right-3 top-3 flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white/95 text-xs shadow-lg backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/90"
                  style={{ width: logoLibraryWidth }}
                  onPointerMove={handleLogoLibraryResize}
                  onPointerUp={() => setLogoResizeState(null)}
                  onPointerCancel={() => setLogoResizeState(null)}
                >
                  <div
                    className="absolute bottom-0 left-0 top-0 z-10 w-1 cursor-ew-resize bg-transparent hover:bg-blue-400/50"
                    onPointerDown={startLogoLibraryResize}
                    title="拖动调整宽度"
                  />
                  <div className="flex h-8 shrink-0 items-center justify-between border-b border-gray-100 px-2 dark:border-white/[0.08]">
                    <h3 className="font-semibold">LOGO库</h3>
                    <button type="button" onClick={chooseIconLibrary} className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] dark:border-white/[0.08]">选择</button>
                  </div>
                  <div className="flex shrink-0 gap-1 border-b border-gray-100 p-1.5 dark:border-white/[0.08]">
                    <input value={iconLibraryPath} onChange={(event) => setIconLibrary(event.target.value, iconLibraryAssets)} className="min-w-0 flex-1 rounded border border-gray-200 bg-white px-1 py-1 text-[10px] dark:border-white/[0.08] dark:bg-gray-900" />
                    <button type="button" onClick={() => void refreshIconLibrary()} className="rounded border border-gray-200 px-1 dark:border-white/[0.08]"><RefreshIcon className="h-3.5 w-3.5" /></button>
                  </div>
                  <div
                    className="grid min-h-0 flex-1 content-start gap-1 overflow-y-auto p-1.5"
                    style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}
                  >
                    {iconLibraryAssets.map((asset) => (
                      <div
                        key={asset.path}
                        draggable
                        onDragStart={(event) => {
                          setDraggingLogoPath(asset.path)
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('text/plain', asset.path)
                        }}
                        onDragOver={(event) => {
                          event.preventDefault()
                          event.dataTransfer.dropEffect = 'move'
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          moveLogoAsset(draggingLogoPath || event.dataTransfer.getData('text/plain'), asset.path)
                          setDraggingLogoPath('')
                        }}
                        onDragEnd={() => setDraggingLogoPath('')}
                        className={`group relative min-w-0 rounded border bg-gray-50 p-1 text-[9px] hover:border-blue-300 hover:bg-blue-50 dark:bg-white/[0.03] dark:hover:bg-blue-500/10 ${draggingLogoPath === asset.path ? 'border-blue-400 opacity-60' : 'border-gray-200 dark:border-white/[0.08]'}`}
                      >
                        <button type="button" onDoubleClick={() => void applyIconAsLogo(asset)} className="block w-full cursor-grab active:cursor-grabbing" title="双击替换当前LOGO占位">
                          {asset.dataUrl ? (
                            <img src={asset.dataUrl} alt="" className="aspect-square w-full rounded bg-white object-contain dark:bg-gray-900" />
                          ) : (
                            <div className="aspect-square rounded bg-white dark:bg-gray-900" />
                          )}
                        </button>
                        {editingLogoPath === asset.path ? (
                          <input
                            value={asset.name}
                            autoFocus
                            onChange={(event) => renameLogoAsset(asset.path, event.target.value)}
                            onBlur={() => setEditingLogoPath('')}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') setEditingLogoPath('')
                              if (event.key === 'Escape') setEditingLogoPath('')
                            }}
                            className="mt-0.5 w-full rounded border border-blue-200 bg-white px-1 py-0.5 text-[9px] outline-none dark:border-blue-400/40 dark:bg-gray-900"
                          />
                        ) : (
                          <button type="button" onDoubleClick={() => setEditingLogoPath(asset.path)} onClick={(event) => event.stopPropagation()} className="mt-0.5 block w-full truncate text-left" title="双击重命名">
                            {asset.name}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => deleteLogoAsset(asset.path)}
                          className="absolute right-1 top-1 hidden rounded bg-white/90 px-1 text-[10px] text-red-500 shadow group-hover:block dark:bg-gray-950/90"
                          title="从LOGO库移除"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="h-[220px] shrink-0 border-t border-gray-200 bg-white/90 dark:border-white/[0.08] dark:bg-gray-950/70">
              <div className="flex h-9 items-center justify-between border-b border-gray-100 px-3 dark:border-white/[0.08]">
                <h3 className="text-sm font-semibold">全局输出尺寸 / 最大KB</h3>
                <span className="text-xs text-gray-400">已选 {selectedOutputRules.length}</span>
              </div>
              <div className="grid h-[181px] grid-cols-3 gap-3 overflow-auto p-3 text-xs">
                {safeOutputPresetGroups.map((group) => (
                  <div key={group.id} className="rounded-md border border-gray-200 bg-gray-50 p-2 dark:border-white/[0.08] dark:bg-white/[0.03]">
                    <div className="mb-2 font-semibold">{group.name}</div>
                    <div className="space-y-2">
                      {group.rules.map((rule) => (
                        <label key={rule.id} className="grid grid-cols-[20px_1fr_64px] items-center gap-2 rounded-md bg-white px-2 py-1.5 dark:bg-gray-900">
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            onChange={(event) => updateOutputPresetRule(group.id, rule.id, { enabled: event.target.checked })}
                          />
                          <span className="font-mono">{rule.width}x{rule.height}</span>
                          <span className="text-right font-mono text-gray-500">{rule.maxSizeKb}KB</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l border-gray-200 bg-white/80 text-xs dark:border-white/[0.08] dark:bg-gray-950/70">
            <div className="border-b border-gray-100 dark:border-white/[0.08]">
              <div className="flex h-9 items-center justify-between px-3">
                <h3 className="text-sm font-semibold">水印图层</h3>
                <button type="button" onClick={clearTemplateSampleLayers} className="text-[10px] text-gray-400 hover:text-red-500">清理默认示例</button>
              </div>
              <div className="max-h-[190px] overflow-y-auto p-2">
                {displayedLayers.filter((layer) => layer.type !== 'background').map((layer) => (
                  <button key={layer.id} type="button" onClick={() => setSelectedLayerId(layer.id)} className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${selectedLayerId === layer.id ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200' : 'hover:bg-gray-50 dark:hover:bg-white/[0.05]'}`}>
                    <input type="checkbox" checked={layer.enabled} onChange={(event) => updateLayer(layer.id, { enabled: event.target.checked })} onClick={(event) => event.stopPropagation()} />
                    <span className="w-12 shrink-0 text-[10px] text-gray-400">{getLayerKind(layer)}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{getLayerLabel(layer)}</span>
                    <span className="flex shrink-0 gap-1 text-[10px] text-gray-400">
                      <span onClick={(event) => { event.stopPropagation(); moveLayer(layer.id, 'up') }} className="hover:text-blue-600">上</span>
                      <span onClick={(event) => { event.stopPropagation(); moveLayer(layer.id, 'down') }} className="hover:text-blue-600">下</span>
                    </span>
                    <TrashIcon onClick={(event) => { event.stopPropagation(); deleteLayer(layer.id) }} className="h-3.5 w-3.5 text-gray-400 hover:text-red-500" />
                  </button>
                ))}
                {!displayedLayers.some((layer) => layer.type !== 'background') && (
                  <div className="rounded-md border border-dashed border-gray-200 p-3 text-gray-400 dark:border-white/[0.08]">使用画布左侧工具条新建图层</div>
                )}
              </div>
            </div>

            {selectedLayer && (
              <div className="border-b border-gray-100 p-3 dark:border-white/[0.08]">
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-semibold">{getLayerTypeTitle(selectedLayer)}：{getLayerLabel(selectedLayer)}</div>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-white/[0.08]">{getLayerKind(selectedLayer)}</span>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {(['x', 'y', 'width', 'height', 'opacity'] as const).map((key) => (
                    <label key={key} className="text-gray-500">{key}<input type="number" step={key === 'opacity' ? 0.05 : 1} value={selectedLayer[key]} onChange={(event) => updateSelectedLayerPatch({ [key]: Number(event.target.value) } as Partial<CompositeLayer>)} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-1.5 py-1 dark:border-white/[0.08] dark:bg-gray-900" /></label>
                  ))}
                </div>
                <div className="mt-3 rounded-md border border-gray-100 p-2 dark:border-white/[0.08]">
                  <div className="mb-2 text-[11px] font-semibold text-gray-500">单独属性</div>
                  <div className="grid grid-cols-4 gap-2">
                  {(selectedLayer.type === 'text' || selectedLayer.type === 'watermark') && (
                    <>
                      <label className="col-span-4 text-gray-500">文字<input value={selectedLayer.text} onChange={(event) => updateSelectedLayerPatch({ text: event.target.value } as Partial<CompositeLayer>)} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1 dark:border-white/[0.08] dark:bg-gray-900" /></label>
                      <label className="text-gray-500">字号<input type="number" value={selectedLayer.fontSize} onChange={(event) => updateSelectedLayerPatch({ fontSize: Number(event.target.value) } as Partial<CompositeLayer>)} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1 dark:border-white/[0.08] dark:bg-gray-900" /></label>
                      <label className="text-gray-500">字重<input type="number" value={selectedLayer.fontWeight} onChange={(event) => updateSelectedLayerPatch({ fontWeight: Number(event.target.value) } as Partial<CompositeLayer>)} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1 dark:border-white/[0.08] dark:bg-gray-900" /></label>
                      <label className="col-span-2 text-gray-500">对齐<select value={selectedLayer.align} onChange={(event) => updateSelectedLayerPatch({ align: event.target.value } as Partial<CompositeLayer>)} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1 dark:border-white/[0.08] dark:bg-gray-900"><option value="left">左</option><option value="center">居中</option><option value="right">右</option></select></label>
                    </>
                  )}
                  {(selectedLayer.type === 'image' || selectedLayer.type === 'logo') && (
                    <>
                      <label className="col-span-4 text-gray-500">素材<input value={selectedLayer.sourceName} onChange={(event) => updateSelectedLayerPatch({ sourceName: event.target.value } as Partial<CompositeLayer>)} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1 dark:border-white/[0.08] dark:bg-gray-900" /></label>
                      <label className="col-span-2 flex items-center gap-2 text-gray-500"><input type="checkbox" checked={selectedLayer.mirrorX} onChange={(event) => updateSelectedLayerPatch({ mirrorX: event.target.checked } as Partial<CompositeLayer>)} />水平镜像</label>
                      <label className="col-span-2 flex items-center gap-2 text-gray-500"><input type="checkbox" checked={selectedLayer.mirrorY} onChange={(event) => updateSelectedLayerPatch({ mirrorY: event.target.checked } as Partial<CompositeLayer>)} />垂直镜像</label>
                      {selectedLayer.type === 'logo' && <div className="col-span-4 rounded bg-blue-50 px-2 py-1 text-[10px] text-blue-700 dark:bg-blue-500/10 dark:text-blue-200">双击 LOGO库中的 LOGO 可替换当前占位</div>}
                    </>
                  )}
                  {selectedLayer.type === 'colorBlock' && (
                    <>
                      <label className="col-span-2 text-gray-500">形状<select className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1 dark:border-white/[0.08] dark:bg-gray-900"><option>矩形</option><option>圆角矩形</option></select></label>
                      <label className="col-span-2 text-gray-500">圆角<input type="number" value={selectedLayer.radius} onChange={(event) => updateSelectedLayerPatch({ radius: Number(event.target.value) } as Partial<CompositeLayer>)} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1 dark:border-white/[0.08] dark:bg-gray-900" /></label>
                    </>
                  )}
                  </div>
                </div>
                <div className="mt-3 rounded-md border border-gray-100 p-2 dark:border-white/[0.08]">
                  <div className="mb-2 text-[11px] font-semibold text-gray-500">通用样式</div>
                  {(() => {
                    const style = getCompositeLayerStyle(selectedLayer)
                    return (
                      <div className="space-y-2">
                        <div className="grid grid-cols-4 gap-2">
                          <label className="col-span-2 text-gray-500">填充<select value={style.fill.type} onChange={(event) => updateSelectedLayerStyle((current) => ({ ...current, fill: { ...current.fill, type: event.target.value as 'solid' | 'linear-gradient' } }))} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1 dark:border-white/[0.08] dark:bg-gray-900"><option value="solid">纯色</option><option value="linear-gradient">渐变</option></select></label>
                          <label className="text-gray-500">颜色<input type="color" value={style.fill.color} onChange={(event) => updateSelectedLayerStyle((current) => ({ ...current, fill: { ...current.fill, color: event.target.value } }))} className="mt-1 h-7 w-full rounded border border-gray-200 bg-white dark:border-white/[0.08]" /></label>
                          <label className="text-gray-500">渐变<input type="color" value={style.fill.color2} onChange={(event) => updateSelectedLayerStyle((current) => ({ ...current, fill: { ...current.fill, color2: event.target.value } }))} className="mt-1 h-7 w-full rounded border border-gray-200 bg-white dark:border-white/[0.08]" /></label>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <label className="col-span-1 flex items-center gap-1 text-gray-500"><input type="checkbox" checked={style.stroke.enabled} onChange={(event) => updateSelectedLayerStyle((current) => ({ ...current, stroke: { ...current.stroke, enabled: event.target.checked } }))} />描边</label>
                          <label className="text-gray-500">位置<select value={style.stroke.position} onChange={(event) => updateSelectedLayerStyle((current) => ({ ...current, stroke: { ...current.stroke, position: event.target.value as 'inside' | 'center' | 'outside' } }))} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-1 py-1 dark:border-white/[0.08] dark:bg-gray-900"><option value="inside">内</option><option value="center">居中</option><option value="outside">外</option></select></label>
                          <label className="text-gray-500">宽度<input type="number" value={style.stroke.width} onChange={(event) => updateSelectedLayerStyle((current) => ({ ...current, stroke: { ...current.stroke, width: Number(event.target.value) } }))} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-1 py-1 dark:border-white/[0.08] dark:bg-gray-900" /></label>
                          <label className="text-gray-500">颜色<input type="color" value={style.stroke.paint.color} onChange={(event) => updateSelectedLayerStyle((current) => ({ ...current, stroke: { ...current.stroke, paint: { ...current.stroke.paint, color: event.target.value } } }))} className="mt-1 h-7 w-full rounded border border-gray-200 bg-white dark:border-white/[0.08]" /></label>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <label className="flex items-center gap-1 text-gray-500"><input type="checkbox" checked={style.outerGlow.enabled} onChange={(event) => updateSelectedLayerStyle((current) => ({ ...current, outerGlow: { ...current.outerGlow, enabled: event.target.checked } }))} />外发光</label>
                          <label className="flex items-center gap-1 text-gray-500"><input type="checkbox" checked={style.innerGlow.enabled} onChange={(event) => updateSelectedLayerStyle((current) => ({ ...current, innerGlow: { ...current.innerGlow, enabled: event.target.checked } }))} />内发光</label>
                          <label className="flex items-center gap-1 text-gray-500"><input type="checkbox" checked={style.shadow.enabled} onChange={(event) => updateSelectedLayerStyle((current) => ({ ...current, shadow: { ...current.shadow, enabled: event.target.checked } }))} />投影</label>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <label className="text-gray-500">光色<input type="color" value={style.outerGlow.color} onChange={(event) => updateSelectedLayerStyle((current) => ({ ...current, outerGlow: { ...current.outerGlow, color: event.target.value }, innerGlow: { ...current.innerGlow, color: event.target.value } }))} className="mt-1 h-7 w-full rounded border border-gray-200 bg-white dark:border-white/[0.08]" /></label>
                          <label className="text-gray-500">光尺寸<input type="number" value={style.outerGlow.size} onChange={(event) => updateSelectedLayerStyle((current) => ({ ...current, outerGlow: { ...current.outerGlow, size: Number(event.target.value) } }))} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-1 py-1 dark:border-white/[0.08] dark:bg-gray-900" /></label>
                          <label className="text-gray-500">投影X<input type="number" value={style.shadow.x} onChange={(event) => updateSelectedLayerStyle((current) => ({ ...current, shadow: { ...current.shadow, x: Number(event.target.value) } }))} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-1 py-1 dark:border-white/[0.08] dark:bg-gray-900" /></label>
                          <label className="text-gray-500">投影Y<input type="number" value={style.shadow.y} onChange={(event) => updateSelectedLayerStyle((current) => ({ ...current, shadow: { ...current.shadow, y: Number(event.target.value) } }))} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-1 py-1 dark:border-white/[0.08] dark:bg-gray-900" /></label>
                        </div>
                      </div>
                    )
                  })()}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <button type="button" onClick={() => alignSelectedLayer('h-center')} className="rounded-md border border-gray-200 px-2 py-1 dark:border-white/[0.08]">水平</button>
                  <button type="button" onClick={() => alignSelectedLayer('v-center')} className="rounded-md border border-gray-200 px-2 py-1 dark:border-white/[0.08]">垂直</button>
                </div>
              </div>
            )}

            <div className="mt-auto border-t border-gray-100 p-3 dark:border-white/[0.08]">
              <div className="mb-2 font-semibold">当前预设参数</div>
              {activeWatermarkPreset ? (
                <div className="space-y-2">
                  <label className="block text-gray-500">输出母文件夹</label>
                  <div className="flex gap-2">
                    <input
                      value={getPresetOutputSettings(activeWatermarkPreset).outputPath}
                      onChange={(event) => updatePresetOutputSettings(activeWatermarkPreset, { outputPath: event.target.value })}
                      className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 dark:border-white/[0.08] dark:bg-gray-900"
                    />
                    <button type="button" onClick={() => void choosePresetOutputPath(activeWatermarkPreset)} className="rounded-md border border-gray-200 px-2 dark:border-white/[0.08]">浏览</button>
                  </div>
                  <label className="block text-gray-500">命名模板</label>
                  <NamingTemplateEditor
                    value={getPresetOutputSettings(activeWatermarkPreset).namingTemplate}
                    previewValues={namingTemplatePreviewValues}
                    onChange={(namingTemplate) => updatePresetOutputSettings(activeWatermarkPreset, { namingTemplate })}
                  />
                  <div className="space-y-1">
                    <div className="text-[10px] text-gray-400">变量词条</div>
                    <div className="flex flex-wrap gap-1">
                      {NAMING_TEMPLATE_TOKENS.map((token) => (
                        <button
                          key={token.value}
                          type="button"
                          onClick={() => appendNamingTemplateText(activeWatermarkPreset, token.value)}
                          className="wildcard-var border-0 px-2 py-0.5 text-[11px]"
                          title={token.value}
                        >
                          {token.label}
                        </button>
                      ))}
                      {(activeWatermarkPreset.namingTokens ?? []).map((token) => (
                        <button
                          key={token}
                          type="button"
                          onClick={() => appendNamingTemplateText(activeWatermarkPreset, token)}
                          className="mention-tag border-0 px-2 py-0.5 text-[11px]"
                          title={token}
                        >
                          {token}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <span className="shrink-0 self-center text-[10px] text-gray-400">自定义</span>
                      <input
                        value={customNamingToken}
                        onChange={(event) => setCustomNamingToken(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            addCustomNamingToken(activeWatermarkPreset)
                          }
                        }}
                        placeholder="自定义词条"
                        className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1 dark:border-white/[0.08] dark:bg-gray-900"
                      />
                      <button type="button" onClick={() => addCustomNamingToken(activeWatermarkPreset)} className="rounded-md border border-gray-200 px-2 dark:border-white/[0.08]">添加</button>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      checked={Boolean(activeWatermarkPreset.distribution?.enabled)}
                      onChange={(event) => updateWatermarkPreset(activeWatermarkPreset.id, {
                        distribution: { ...(activeWatermarkPreset.distribution ?? { enabled: false, outputPath: '', count: 0 }), enabled: event.target.checked },
                      })}
                    />
                    <span className="font-semibold">启用分配副本</span>
                  </label>
                  <label className="block text-gray-500">分配目录</label>
                  <div className="flex gap-2">
                    <input
                      value={activeWatermarkPreset.distribution?.outputPath ?? ''}
                      onChange={(event) => updateWatermarkPreset(activeWatermarkPreset.id, {
                        distribution: { ...(activeWatermarkPreset.distribution ?? { enabled: false, outputPath: '', count: 0 }), outputPath: event.target.value },
                      })}
                      className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 dark:border-white/[0.08] dark:bg-gray-900"
                    />
                    <button type="button" onClick={() => void chooseDistributionPath(activeWatermarkPreset)} className="rounded-md border border-gray-200 px-2 dark:border-white/[0.08]">浏览</button>
                  </div>
                  <label className="block text-gray-500">指定数量</label>
                  <input
                    type="number"
                    min={0}
                    value={activeWatermarkPreset.distribution?.count ?? 0}
                    onChange={(event) => updateWatermarkPreset(activeWatermarkPreset.id, {
                      distribution: { ...(activeWatermarkPreset.distribution ?? { enabled: false, outputPath: '', count: 0 }), count: Math.max(0, Number(event.target.value) || 0) },
                    })}
                    className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 dark:border-white/[0.08] dark:bg-gray-900"
                  />
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-gray-200 p-3 text-gray-400 dark:border-white/[0.08]">请先保存一个完整预设</div>
              )}
            </div>
          </aside>
        </div>

        <div className="flex h-14 shrink-0 items-center gap-3 border-t border-gray-200 bg-white/90 px-4 text-xs dark:border-white/[0.08] dark:bg-gray-950/90">
          <button type="button" onClick={startExport} disabled={isExporting} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
            <DownloadIcon className="h-4 w-4" /> {isExporting ? '执行中' : '开始处理'}
          </button>
          <div className="flex min-w-[220px] flex-1 items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-gray-400" />
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-white/[0.08]"><div className="h-full bg-blue-600" style={{ width: `${progress.percent}%` }} /></div>
            <span className="w-16 font-mono">{progress.completed}/{progress.total}</span>
          </div>
          <div className="hidden min-w-0 flex-[1.2] items-center gap-2 xl:flex">
            <span className="shrink-0 text-gray-500">最近导出</span>
            {historySummary.length ? historySummary.slice(0, 2).map((item) => (
              <span key={item.outputPath} className="min-w-0 truncate rounded bg-gray-100 px-2 py-1 font-mono text-[10px] dark:bg-white/[0.08]">{item.outputPath} · {item.count}</span>
            )) : <span className="text-gray-400">暂无记录</span>}
          </div>
          {statusText && <span className="max-w-48 truncate text-gray-500">{statusText}</span>}
        </div>
      </div>
    </main>
  )
}
