import { useCallback, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { getImage } from '../lib/db'
import {
  buildWatermarkExportJobs,
  createWatermarkShapeLayer,
  createWatermarkTextLayer,
  createDistributedFileName,
  replaceLogoLayer,
  type WatermarkImageInput,
  type WatermarkLayer,
  type WatermarkLogoSource,
  type WatermarkPreset,
} from '../lib/watermarkWorkbench'
import { DownloadIcon, FolderOpenIcon, PlusIcon, RefreshIcon, TrashIcon } from './icons'

type DragState = {
  layerId: string
  startX: number
  startY: number
  layerX: number
  layerY: number
}

type ExportedImage = {
  id: string
  imageName: string
  presetName: string
  dataUrl: string
  fileName: string
}

type DistributionRoute = {
  id: string
  enabled: boolean
  name: string
  path: string
  pattern: string
  status: 'idle' | 'ready' | 'done'
}

const DEFAULT_LOGO = '/app-icon.png'

function createDefaultLayers(): WatermarkLayer[] {
  return [
    {
      id: 'logo',
      type: 'image',
      x: 50,
      y: 18,
      width: 18,
      height: 18,
      opacity: 0.92,
      sourceId: 'app-logo',
      sourceName: '豆包图标',
      sourceDataUrl: DEFAULT_LOGO,
    },
    {
      id: 'title',
      type: 'text',
      x: 24,
      y: 80,
      width: 52,
      height: 8,
      opacity: 1,
      text: '产品保障 · 官方出品',
      fontSize: 24,
      color: '#111827',
    },
    {
      id: 'caption',
      type: 'text',
      x: 18,
      y: 89,
      width: 64,
      height: 6,
      opacity: 0.7,
      text: '导出图片将叠加当前选中的水印预设',
      fontSize: 14,
      color: '#4b5563',
    },
  ]
}

function createEditorDefaultLayers(): WatermarkLayer[] {
  const title = createWatermarkTextLayer('title', '产品保障 · 官方出品')
  const caption = createWatermarkTextLayer('caption', '导出图片将叠加当前选中的水印预设')

  return [
    {
      id: 'logo',
      type: 'image',
      x: 6,
      y: 7,
      width: 12,
      height: 12,
      opacity: 0.92,
      sourceId: 'app-logo',
      sourceName: '豆包图标',
      sourceDataUrl: DEFAULT_LOGO,
    },
    {
      ...createWatermarkShapeLayer('title-bg', 'rect'),
      x: 24,
      y: 76,
      width: 52,
      height: 12,
      opacity: 0.26,
      fill: '#ffffff',
      strokeColor: '#60a5fa',
      strokeWidth: 1,
      radius: 12,
    },
    {
      ...title,
      x: 24,
      y: 78,
      width: 52,
      height: 8,
    },
    {
      ...caption,
      x: 18,
      y: 89,
      width: 64,
      height: 6,
      opacity: 0.7,
      fontSize: 14,
      color: '#4b5563',
      fontWeight: 500,
    },
  ]
}

const initialPresets: WatermarkPreset[] = [
  {
    id: 'preset-default',
    name: '保障主图',
    layers: createEditorDefaultLayers(),
    selected: true,
  },
]

const initialRoutes: DistributionRoute[] = [
  {
    id: 'route-headline',
    enabled: true,
    name: '头条素材',
    path: 'F:\\保险\\待分配\\头条',
    pattern: '{date}-{image}-{preset}',
    status: 'ready',
  },
  {
    id: 'route-template',
    enabled: false,
    name: '模板备份',
    path: 'F:\\保险\\待分配\\模板',
    pattern: '{date}-{preset}-{image}',
    status: 'idle',
  },
]

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = src
  })
}

async function renderWatermarkedImage(image: WatermarkImageInput, preset: WatermarkPreset): Promise<string> {
  const source = await loadImageElement(image.dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = source.naturalWidth || 1280
  canvas.height = source.naturalHeight || 720
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')

  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  for (const layer of preset.layers) {
    ctx.save()
    ctx.globalAlpha = layer.opacity
    const x = canvas.width * (layer.x / 100)
    const y = canvas.height * (layer.y / 100)
    const width = canvas.width * (layer.width / 100)
    const height = canvas.height * (layer.height / 100)

    if (layer.type === 'image') {
      const logo = await loadImageElement(layer.sourceDataUrl)
      ctx.drawImage(logo, x, y, width, height)
    } else if (layer.type === 'shape') {
      ctx.fillStyle = layer.fill
      ctx.strokeStyle = layer.strokeColor
      ctx.lineWidth = Math.max(0, layer.strokeWidth * (canvas.width / 1280))
      if (layer.shape === 'ellipse') {
        ctx.beginPath()
        ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
        ctx.fill()
        if (layer.strokeWidth > 0) ctx.stroke()
      } else if (layer.shape === 'line') {
        ctx.beginPath()
        ctx.moveTo(x, y + height / 2)
        ctx.lineTo(x + width, y + height / 2)
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.roundRect(x, y, width, height, layer.radius * (canvas.width / 1280))
        ctx.fill()
        if (layer.strokeWidth > 0) ctx.stroke()
      }
    } else {
      const scaledFontSize = Math.round(layer.fontSize * (canvas.width / 1280))
      ctx.fillStyle = layer.color
      ctx.strokeStyle = layer.strokeColor ?? '#ffffff'
      ctx.lineWidth = Math.max(0, (layer.strokeWidth ?? 0) * (canvas.width / 1280))
      ctx.font = `${layer.italic ? 'italic ' : ''}${layer.fontWeight ?? 700} ${scaledFontSize}px ${layer.fontFamily ?? 'sans-serif'}`
      ctx.textAlign = layer.align ?? 'center'
      ctx.textBaseline = 'middle'
      const textX = layer.align === 'left' ? x : layer.align === 'right' ? x + width : x + width / 2
      if ((layer.strokeWidth ?? 0) > 0) ctx.strokeText(layer.text, textX, y + height / 2, width)
      ctx.fillText(layer.text, textX, y + height / 2, width)
    }
    ctx.restore()
  }

  return canvas.toDataURL('image/webp', 0.92)
}

function getLayerStyle(layer: WatermarkLayer) {
  return {
    left: `${layer.x}%`,
    top: `${layer.y}%`,
    width: `${layer.width}%`,
    height: `${layer.height}%`,
    opacity: layer.opacity,
  }
}

function getLayerName(layer: WatermarkLayer) {
  if (layer.type === 'image') return layer.sourceName
  if (layer.type === 'shape') return layer.shape === 'ellipse' ? '椭圆形状' : layer.shape === 'line' ? '线条形状' : '矩形形状'
  return layer.text
}

function getLayerTypeLabel(layer: WatermarkLayer | undefined) {
  if (!layer) return '未选择'
  if (layer.type === 'image') return '图片水印'
  if (layer.type === 'shape') return '矢量形状'
  return '文字水印'
}

function getTextPreviewStyle(layer: Extract<WatermarkLayer, { type: 'text' }>) {
  const strokeWidth = layer.strokeWidth ?? 0
  return {
    color: layer.color,
    fontFamily: layer.fontFamily ?? 'sans-serif',
    fontSize: `${Math.max(10, layer.fontSize / 2)}px`,
    fontStyle: layer.italic ? 'italic' : 'normal',
    fontWeight: layer.fontWeight ?? 700,
    justifyContent: layer.align === 'left' ? 'flex-start' : layer.align === 'right' ? 'flex-end' : 'center',
    WebkitTextStroke: strokeWidth > 0 ? `${Math.max(1, strokeWidth / 2)}px ${layer.strokeColor ?? '#ffffff'}` : undefined,
  }
}

export default function PostprocessWorkspace() {
  const tasks = useStore((s) => s.tasks)
  const showToast = useStore((s) => s.showToast)
  const [images, setImages] = useState<WatermarkImageInput[]>([])
  const [logos, setLogos] = useState<WatermarkLogoSource[]>([
    { id: 'app-logo', name: '豆包图标', dataUrl: DEFAULT_LOGO },
  ])
  const [presets, setPresets] = useState<WatermarkPreset[]>(initialPresets)
  const [activePresetId, setActivePresetId] = useState(initialPresets[0].id)
  const [selectedLayerId, setSelectedLayerId] = useState('logo')
  const [exportedImages, setExportedImages] = useState<ExportedImage[]>([])
  const [routes, setRoutes] = useState<DistributionRoute[]>(initialRoutes)
  const [isExporting, setIsExporting] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? presets[0]
  const activeImage = images[0] ?? null
  const exportJobs = useMemo(() => buildWatermarkExportJobs(images, presets), [images, presets])
  const selectedLayer = activePreset.layers.find((layer) => layer.id === selectedLayerId) ?? activePreset.layers[0]

  const updateActivePreset = useCallback((updater: (preset: WatermarkPreset) => WatermarkPreset) => {
    setPresets((current) => current.map((preset) => preset.id === activePreset.id ? updater(preset) : preset))
  }, [activePreset.id])

  const updateLayer = useCallback((layerId: string, patch: Partial<WatermarkLayer>) => {
    updateActivePreset((preset) => ({
      ...preset,
      layers: preset.layers.map((layer) => layer.id === layerId ? { ...layer, ...patch } as WatermarkLayer : layer),
    }))
  }, [updateActivePreset])

  const handleImagesSelected = async (files: FileList | null) => {
    if (!files?.length) return
    const nextImages = await Promise.all(Array.from(files).map(async (file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      dataUrl: await readFileAsDataUrl(file),
    })))
    setImages((current) => [...current, ...nextImages])
    showToast(`已添加 ${nextImages.length} 张图片`, 'success')
  }

  const handleLogosSelected = async (files: FileList | null) => {
    if (!files?.length) return
    const nextLogos = await Promise.all(Array.from(files).map(async (file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name.replace(/\.[^.]+$/, ''),
      dataUrl: await readFileAsDataUrl(file),
    })))
    setLogos((current) => [...current, ...nextLogos])
    showToast(`已添加 ${nextLogos.length} 个 LOGO`, 'success')
  }

  const loadRecentGalleryImages = async () => {
    const ids = tasks.flatMap((task) => task.outputImages).slice(-12).reverse()
    if (!ids.length) {
      showToast('画廊里还没有可载入的输出图', 'info')
      return
    }

    const loaded: WatermarkImageInput[] = []
    for (const id of ids) {
      const image = await getImage(id)
      if (image?.dataUrl) {
        loaded.push({ id, name: `${id.slice(0, 8)}.png`, dataUrl: image.dataUrl })
      }
    }
    setImages(loaded)
    showToast(`已载入 ${loaded.length} 张画廊图片`, 'success')
  }

  const replaceLogo = (logo: WatermarkLogoSource) => {
    updateActivePreset((preset) => ({
      ...preset,
      layers: preset.layers.map((layer) => layer.id === selectedLayerId ? replaceLogoLayer(layer, logo) : layer),
    }))
  }

  const savePreset = () => {
    const copy: WatermarkPreset = {
      ...activePreset,
      id: `preset-${Date.now()}`,
      name: `${activePreset.name} 副本`,
      layers: activePreset.layers.map((layer) => ({ ...layer })),
      selected: true,
    }
    setPresets((current) => [...current, copy])
    setActivePresetId(copy.id)
    showToast('水印预设已保存', 'success')
  }

  const addTextLayer = () => {
    const layer = {
      ...createWatermarkTextLayer(`text-${Date.now()}`, '新文字'),
      x: 30,
      y: 42,
      width: 40,
      height: 10,
    }
    updateActivePreset((preset) => ({ ...preset, layers: [...preset.layers, layer] }))
    setSelectedLayerId(layer.id)
  }

  const addShapeLayer = (shape: 'rect' | 'ellipse' | 'line') => {
    const layer = {
      ...createWatermarkShapeLayer(`shape-${Date.now()}`, shape),
      x: 28,
      y: 38,
      width: 44,
      height: shape === 'line' ? 4 : 18,
      opacity: shape === 'line' ? 1 : 0.35,
    }
    updateActivePreset((preset) => ({ ...preset, layers: [...preset.layers, layer] }))
    setSelectedLayerId(layer.id)
  }

  const moveSelectedLayer = (direction: -1 | 1) => {
    updateActivePreset((preset) => {
      const index = preset.layers.findIndex((layer) => layer.id === selectedLayerId)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= preset.layers.length) return preset
      const layers = [...preset.layers]
      const [layer] = layers.splice(index, 1)
      layers.splice(nextIndex, 0, layer)
      return { ...preset, layers }
    })
  }

  const handlePointerDown = (event: React.PointerEvent, layer: WatermarkLayer) => {
    event.preventDefault()
    setSelectedLayerId(layer.id)
    setDrag({
      layerId: layer.id,
      startX: event.clientX,
      startY: event.clientY,
      layerX: layer.x,
      layerY: layer.y,
    })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!drag || !stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const dx = ((event.clientX - drag.startX) / rect.width) * 100
    const dy = ((event.clientY - drag.startY) / rect.height) * 100
    updateLayer(drag.layerId, {
      x: Math.min(100, Math.max(0, drag.layerX + dx)),
      y: Math.min(100, Math.max(0, drag.layerY + dy)),
    })
  }

  const exportSelected = async () => {
    if (!exportJobs.length) {
      showToast('请先添加图片并勾选水印预设', 'info')
      return
    }

    setIsExporting(true)
    try {
      const now = new Date()
      const results: ExportedImage[] = []
      for (const job of exportJobs) {
        const dataUrl = await renderWatermarkedImage(job.image, job.preset)
        const fileName = createDistributedFileName({
          pattern: '{date}-{image}-{preset}',
          imageName: job.image.name,
          presetName: job.preset.name,
          date: now,
          extension: 'webp',
        })
        results.push({
          id: `${job.image.id}-${job.preset.id}`,
          imageName: job.image.name,
          presetName: job.preset.name,
          dataUrl,
          fileName,
        })
      }
      setExportedImages(results)
      setRoutes((current) => current.map((route) => route.enabled ? { ...route, status: 'done' } : route))
      results.forEach((result, index) => {
        window.setTimeout(() => {
          const a = document.createElement('a')
          a.href = result.dataUrl
          a.download = result.fileName
          a.click()
        }, index * 120)
      })
      showToast(`已导出 ${results.length} 张图片`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <main className="h-[calc(100vh-var(--app-header-offset))] overflow-y-auto px-3 pb-4 pt-3 sm:px-4">
      <div className="min-h-full w-full space-y-4">
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-gray-950">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-4 dark:border-white/[0.08]">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">图片后期处理</h2>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">批量贴水印、保存预设，并把导出结果分配到下游路径。</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900">
                <PlusIcon className="h-4 w-4" />
                添加图片
                <input className="hidden" type="file" accept="image/*" multiple onChange={(event) => void handleImagesSelected(event.target.files)} />
              </label>
              <button type="button" onClick={() => void loadRecentGalleryImages()} className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900">
                <FolderOpenIcon className="h-4 w-4" />
                载入画廊最近图片
              </button>
              <button type="button" onClick={savePreset} className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
                保存水印预设
              </button>
              <button type="button" disabled={isExporting} onClick={() => void exportSelected()} className="inline-flex items-center gap-2 rounded-md bg-gray-950 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-950">
                <DownloadIcon className="h-4 w-4" />
                {isExporting ? '导出中...' : `导出 ${exportJobs.length} 张`}
              </button>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(300px,0.95fr)_minmax(520px,1.45fr)_minmax(280px,0.8fr)]">
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50/30 p-3 dark:border-white/[0.08] dark:bg-gray-900/30">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">待处理图片</h3>
                  <button type="button" onClick={() => setImages([])} className="text-[11px] text-gray-400 hover:text-red-500">清空</button>
                </div>
                <div className="space-y-1">
                  {images.length ? images.map((image, index) => (
                    <div key={image.id} className="flex items-center gap-3 rounded-md bg-white p-2 text-sm dark:bg-gray-950">
                      <img src={image.dataUrl} alt="" className="h-10 w-14 rounded-md object-cover" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-gray-700 dark:text-gray-200">{image.name}</div>
                        <div className="text-[11px] text-gray-400">图片 {index + 1}</div>
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-md border border-dashed border-gray-300 p-6 text-center text-[11px] text-gray-400 dark:border-white/[0.12]">添加图片后会显示批量列表</div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50/30 p-3 dark:border-white/[0.08] dark:bg-gray-900/30">
                <h3 className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-100">水印预设</h3>
                <div className="space-y-1">
                  {presets.map((preset) => (
                    <div key={preset.id} className={`rounded-md border p-2 ${preset.id === activePresetId ? 'border-blue-300 bg-blue-50 dark:border-blue-500/40 dark:bg-blue-500/10' : 'border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-950'}`}>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={preset.selected}
                          onChange={(event) => setPresets((current) => current.map((item) => item.id === preset.id ? { ...item, selected: event.target.checked } : item))}
                        />
                        <button type="button" onClick={() => setActivePresetId(preset.id)} className="min-w-0 flex-1 truncate text-left text-sm font-medium text-gray-700 dark:text-gray-200">
                          {preset.name}
                        </button>
                        {presets.length > 1 && (
                          <button type="button" onClick={() => setPresets((current) => current.filter((item) => item.id !== preset.id))} className="text-gray-400 hover:text-red-500">
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">输出预览</div>
                <div className="flex items-center gap-2 text-[11px] text-gray-500">
                  <span>选中图层：{selectedLayer?.type === 'image' ? '图片水印' : '文字水印'}</span>
                  <button type="button" onClick={() => updateActivePreset((preset) => ({ ...preset, layers: createEditorDefaultLayers() }))} className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 hover:bg-gray-50 dark:border-white/[0.08] dark:hover:bg-gray-900">
                    <RefreshIcon className="h-3.5 w-3.5" />
                    重置
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2 dark:border-white/[0.08] dark:bg-gray-950">
                <button type="button" onClick={addTextLayer} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-950">
                  T 文字
                </button>
                <button type="button" onClick={() => addShapeLayer('rect')} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-gray-900">
                  矩形
                </button>
                <button type="button" onClick={() => addShapeLayer('ellipse')} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-gray-900">
                  椭圆
                </button>
                <button type="button" onClick={() => addShapeLayer('line')} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-gray-900">
                  线条
                </button>
                <div className="mx-1 h-6 w-px bg-gray-200 dark:bg-white/[0.08]" />
                <button type="button" onClick={() => moveSelectedLayer(1)} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-gray-900">
                  上移一层
                </button>
                <button type="button" onClick={() => moveSelectedLayer(-1)} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-gray-900">
                  下移一层
                </button>
              </div>

              <div className="rounded-lg border border-gray-200 bg-slate-100 p-5 shadow-inner dark:border-white/[0.08] dark:bg-gray-900/30">
                <div
                  ref={stageRef}
                  onPointerMove={handlePointerMove}
                  onPointerUp={() => setDrag(null)}
                  onPointerCancel={() => setDrag(null)}
                  className="relative mx-auto aspect-video w-full max-w-4xl overflow-hidden rounded-lg border border-dashed border-rose-300 bg-white shadow-sm"
                >
                  {activeImage ? (
                    <img src={activeImage.dataUrl} alt="" className="absolute inset-0 h-full w-full object-contain" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-white text-sm text-gray-400">添加图片后在这里编辑水印位置</div>
                  )}
                  {activePreset.layers.map((layer) => (
                    <button
                      key={layer.id}
                      type="button"
                      onPointerDown={(event) => handlePointerDown(event, layer)}
                      className={`absolute cursor-move border text-center transition ${selectedLayerId === layer.id ? 'border-blue-500 bg-blue-500/5' : 'border-transparent hover:border-blue-300'}`}
                      style={getLayerStyle(layer)}
                      title="拖拽移动水印"
                    >
                      {layer.type === 'image' ? (
                        <img src={layer.sourceDataUrl} alt={layer.sourceName} className="h-full w-full object-contain" />
                      ) : layer.type === 'shape' ? (
                        <span
                          className="block h-full w-full"
                          style={{
                            background: layer.shape === 'line' ? 'transparent' : layer.fill,
                            border: layer.strokeWidth > 0 ? `${Math.max(1, layer.strokeWidth)}px solid ${layer.strokeColor}` : undefined,
                            borderRadius: layer.shape === 'ellipse' ? '9999px' : `${layer.radius}px`,
                            borderTop: layer.shape === 'line' ? `${Math.max(1, layer.strokeWidth || 2)}px solid ${layer.strokeColor}` : undefined,
                            marginTop: layer.shape === 'line' ? '50%' : undefined,
                          }}
                        />
                      ) : (
                        <span className="flex h-full w-full truncate px-1" style={getTextPreviewStyle(layer)}>
                          {layer.text}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {activePreset.layers.map((layer) => (
                  <button
                    key={layer.id}
                    type="button"
                    onClick={() => setSelectedLayerId(layer.id)}
                    className={`rounded-md border p-3 text-left text-sm ${selectedLayerId === layer.id ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-200' : 'border-gray-200 bg-white text-gray-600 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-300'}`}
                  >
                    <div className="truncate font-semibold">{getLayerName(layer)}</div>
                    <div className="mt-1 text-[11px] text-gray-400">X {Math.round(layer.x)} · Y {Math.round(layer.y)}</div>
                  </button>
                ))}
              </div>

              {selectedLayer?.type === 'text' && (
                <div className="hidden gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-white/[0.08] dark:bg-gray-950 md:grid-cols-[1fr_120px_120px]">
                  <label className="text-[11px] font-medium text-gray-500">
                    文字
                    <input value={selectedLayer.text} onChange={(event) => updateLayer(selectedLayer.id, { text: event.target.value })} className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-300 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100" />
                  </label>
                  <label className="text-[11px] font-medium text-gray-500">
                    字号
                    <input type="number" min={8} max={96} value={selectedLayer.fontSize} onChange={(event) => updateLayer(selectedLayer.id, { fontSize: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-300 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100" />
                  </label>
                  <label className="text-[11px] font-medium text-gray-500">
                    颜色
                    <input type="color" value={selectedLayer.color} onChange={(event) => updateLayer(selectedLayer.id, { color: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-gray-200 bg-white px-2 dark:border-white/[0.08] dark:bg-gray-950" />
                  </label>
                </div>
              )}
            </div>

              {selectedLayer?.type === 'text' && (
                <div className="xl:col-span-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-white/[0.08] dark:bg-gray-950">
                  <div className="mb-3 text-[11px] font-semibold text-gray-700 dark:text-gray-200">文字属性</div>
                  <div className="grid gap-3 md:grid-cols-[1.5fr_0.9fr_90px_90px_90px_90px]">
                    <label className="text-[11px] font-medium text-gray-500">内容<input value={selectedLayer.text} onChange={(event) => updateLayer(selectedLayer.id, { text: event.target.value })} className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-300 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100" /></label>
                    <label className="text-[11px] font-medium text-gray-500">字体<select value={selectedLayer.fontFamily ?? 'sans-serif'} onChange={(event) => updateLayer(selectedLayer.id, { fontFamily: event.target.value })} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-300 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-100"><option value="sans-serif">Sans</option><option value="serif">Serif</option><option value="monospace">Mono</option></select></label>
                    <label className="text-[11px] font-medium text-gray-500">字号<input type="number" min={8} max={160} value={selectedLayer.fontSize} onChange={(event) => updateLayer(selectedLayer.id, { fontSize: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-300 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100" /></label>
                    <label className="text-[11px] font-medium text-gray-500">字色<input type="color" value={selectedLayer.color} onChange={(event) => updateLayer(selectedLayer.id, { color: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-gray-200 bg-white px-2 dark:border-white/[0.08] dark:bg-gray-950" /></label>
                    <label className="text-[11px] font-medium text-gray-500">描边<input type="color" value={selectedLayer.strokeColor ?? '#ffffff'} onChange={(event) => updateLayer(selectedLayer.id, { strokeColor: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-gray-200 bg-white px-2 dark:border-white/[0.08] dark:bg-gray-950" /></label>
                    <label className="text-[11px] font-medium text-gray-500">描边宽<input type="number" min={0} max={20} value={selectedLayer.strokeWidth ?? 0} onChange={(event) => updateLayer(selectedLayer.id, { strokeWidth: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-300 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100" /></label>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {[400, 500, 600, 700, 800].map((weight) => <button key={weight} type="button" onClick={() => updateLayer(selectedLayer.id, { fontWeight: weight as 400 | 500 | 600 | 700 | 800 })} className={`rounded-md border px-3 py-1.5 text-sm ${selectedLayer.fontWeight === weight ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-200' : 'border-gray-200 text-gray-600 dark:border-white/[0.08] dark:text-gray-300'}`}>{weight}</button>)}
                    <button type="button" onClick={() => updateLayer(selectedLayer.id, { italic: !selectedLayer.italic })} className={`rounded-md border px-3 py-1.5 text-sm italic ${selectedLayer.italic ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-200' : 'border-gray-200 text-gray-600 dark:border-white/[0.08] dark:text-gray-300'}`}>I</button>
                    {(['left', 'center', 'right'] as const).map((align) => <button key={align} type="button" onClick={() => updateLayer(selectedLayer.id, { align })} className={`rounded-md border px-3 py-1.5 text-sm ${selectedLayer.align === align ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-200' : 'border-gray-200 text-gray-600 dark:border-white/[0.08] dark:text-gray-300'}`}>{align === 'left' ? '左对齐' : align === 'right' ? '右对齐' : '居中'}</button>)}
                  </div>
                </div>
              )}

              {selectedLayer?.type === 'shape' && (
                <div className="xl:col-span-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-white/[0.08] dark:bg-gray-950">
                  <div className="mb-3 text-[11px] font-semibold text-gray-700 dark:text-gray-200">形状属性</div>
                  <div className="grid gap-3 md:grid-cols-5">
                    <label className="text-[11px] font-medium text-gray-500">类型<select value={selectedLayer.shape} onChange={(event) => updateLayer(selectedLayer.id, { shape: event.target.value as 'rect' | 'ellipse' | 'line' })} className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-300 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-100"><option value="rect">矩形</option><option value="ellipse">椭圆</option><option value="line">线条</option></select></label>
                    <label className="text-[11px] font-medium text-gray-500">填充<input type="color" value={selectedLayer.fill} onChange={(event) => updateLayer(selectedLayer.id, { fill: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-gray-200 bg-white px-2 dark:border-white/[0.08] dark:bg-gray-950" /></label>
                    <label className="text-[11px] font-medium text-gray-500">描边<input type="color" value={selectedLayer.strokeColor} onChange={(event) => updateLayer(selectedLayer.id, { strokeColor: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-gray-200 bg-white px-2 dark:border-white/[0.08] dark:bg-gray-950" /></label>
                    <label className="text-[11px] font-medium text-gray-500">描边宽<input type="number" min={0} max={20} value={selectedLayer.strokeWidth} onChange={(event) => updateLayer(selectedLayer.id, { strokeWidth: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-300 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100" /></label>
                    <label className="text-[11px] font-medium text-gray-500">圆角<input type="number" min={0} max={80} value={selectedLayer.radius} onChange={(event) => updateLayer(selectedLayer.id, { radius: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 outline-none focus:border-blue-300 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100" /></label>
                  </div>
                </div>
              )}
            <div className="rounded-lg border border-gray-200 bg-gray-50/30 p-3 dark:border-white/[0.08] dark:bg-gray-900/30">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">LOGO 库</h3>
                <label className="cursor-pointer rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-200">
                  添加
                  <input className="hidden" type="file" accept="image/*" multiple onChange={(event) => void handleLogosSelected(event.target.files)} />
                </label>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {logos.map((logo) => (
                  <button key={logo.id} type="button" onClick={() => replaceLogo(logo)} className="rounded-md border border-gray-200 bg-white p-2 text-left hover:border-blue-300 dark:border-white/[0.08] dark:bg-gray-950">
                    <img src={logo.dataUrl} alt="" className="aspect-square w-full rounded-md object-contain bg-gray-50 dark:bg-gray-900" />
                    <div className="mt-1 truncate text-[11px] text-gray-500 dark:text-gray-400">{logo.name}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_0.7fr]">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-gray-950">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-gray-200 pb-3 dark:border-white/[0.08]">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">扫描与分配配置</h3>
                <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">第一版先模拟分配状态，真实目录写入和监控留给 Electron 接入。</p>
              </div>
              <button
                type="button"
                onClick={() => setRoutes((current) => [...current, {
                  id: `route-${Date.now()}`,
                  enabled: true,
                  name: `路径 ${current.length + 1}`,
                  path: 'F:\\保险\\待分配',
                  pattern: '{date}-{image}-{preset}',
                  status: 'ready',
                }])}
                className="rounded-md border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-200 dark:hover:bg-gray-900"
              >
                添加分配路径
              </button>
            </div>

            <div className="space-y-2">
              {routes.map((route) => (
                <div key={route.id} className="grid gap-3 rounded-md bg-gray-50 p-3 dark:bg-gray-900/30 md:grid-cols-[72px_0.8fr_1.4fr_1fr_80px]">
                  <label className="flex items-center gap-2 text-[11px] font-medium text-gray-500">
                    <input type="checkbox" checked={route.enabled} onChange={(event) => setRoutes((current) => current.map((item) => item.id === route.id ? { ...item, enabled: event.target.checked } : item))} />
                    启用
                  </label>
                  <input value={route.name} onChange={(event) => setRoutes((current) => current.map((item) => item.id === route.id ? { ...item, name: event.target.value } : item))} className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100" />
                  <input value={route.path} onChange={(event) => setRoutes((current) => current.map((item) => item.id === route.id ? { ...item, path: event.target.value } : item))} className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100" />
                  <input value={route.pattern} onChange={(event) => setRoutes((current) => current.map((item) => item.id === route.id ? { ...item, pattern: event.target.value } : item))} className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100" />
                  <span className={`inline-flex items-center justify-center rounded-md px-2 py-2 text-sm ${route.status === 'done' ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300' : route.enabled ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300' : 'bg-gray-100 text-gray-400 dark:bg-gray-900/30 dark:text-gray-300'}`}>
                    {route.status === 'done' ? '已分配' : route.enabled ? '待分配' : '关闭'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-gray-950">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">导出结果</h3>
            <div className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
              {exportedImages.length ? exportedImages.map((image) => (
                <a key={image.id} href={image.dataUrl} download={image.fileName} className="flex items-center gap-3 rounded-md border border-gray-200 p-2 hover:bg-gray-50 dark:border-white/[0.08] dark:hover:bg-gray-900">
                  <img src={image.dataUrl} alt="" className="h-12 w-16 rounded-md object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-gray-700 dark:text-gray-200">{image.fileName}</div>
                    <div className="text-[11px] text-gray-400">{image.presetName}</div>
                  </div>
                  <DownloadIcon className="h-4 w-4 text-gray-400" />
                </a>
              )) : (
                <div className="rounded-md border border-dashed border-gray-300 p-8 text-center text-[11px] text-gray-400 dark:border-white/[0.12]">导出后会显示结果和二次下载入口</div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
