import { useEffect, useMemo, useRef, useState } from 'react'
import { mapLayerPositionToCanvas } from '../lib/compositeRenderPlan'
import { renderCompositeV2ToCanvas } from '../lib/compositeRendererV2'
import type { CompositeV2Layer, CompositeV2Preset } from '../lib/compositeV2Types'
import type { CompositeFsImage } from '../lib/compositeTypes'
import { FloatingLayerToolbar } from './FloatingLayerToolbar'
import { FloatingLogoLibrary } from './FloatingLogoLibrary'

type Props = {
  preset: CompositeV2Preset | null
  logoLibraryPath: string
  logoAssets: CompositeFsImage[]
  logoStatusText: string
  isRefreshingLogos?: boolean
  selectedLayerId?: string
  onSelectLayer?: (layerId: string) => void
  onLogoLibraryPathChange: (path: string) => void
  onAddText: () => void
  onAddImage: () => void
  onSelectLogoFolder: () => void
  onRefreshLogoFolder: () => void
  onPickLogo: (asset: CompositeFsImage) => void
  onUpdatePreset?: (patch: Partial<CompositeV2Preset>) => void
}

function getLayerStyle(layer: CompositeV2Layer, preset: CompositeV2Preset) {
  const rect = mapLayerPositionToCanvas(layer.position, preset.baseCanvas, preset.baseCanvas)
  return {
    left: `${rect.x / preset.baseCanvas.width * 100}%`,
    top: `${rect.y / preset.baseCanvas.height * 100}%`,
    width: `${rect.width / preset.baseCanvas.width * 100}%`,
    height: `${rect.height / preset.baseCanvas.height * 100}%`,
    transform: `rotate(${layer.rotation}deg)`,
  }
}

export function PresetCanvasEditor(props: Props) {
  const { preset } = props
  const [internalSelectedLayerId, setInternalSelectedLayerId] = useState('')
  const [backgroundDataUrl, setBackgroundDataUrl] = useState('')
  const selectedLayerId = props.selectedLayerId ?? internalSelectedLayerId
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ id: string; x: number; y: number } | null>(null)
  const visibleLayers = useMemo(() => preset?.layers.filter((layer) => layer.visible) ?? [], [preset])

  function selectLayer(layerId: string) {
    setInternalSelectedLayerId(layerId)
    props.onSelectLayer?.(layerId)
  }

  useEffect(() => {
    let active = true
    if (!preset?.sampleBackgroundPath) {
      setBackgroundDataUrl('')
      return
    }
    void window.electronAPI?.readImageFile?.(preset.sampleBackgroundPath).then((payload) => {
      if (active) setBackgroundDataUrl(payload?.dataUrl ?? '')
    })
    return () => { active = false }
  }, [preset?.sampleBackgroundPath])

  useEffect(() => {
    if (!preset || !backgroundDataUrl || !canvasRef.current) return
    void renderCompositeV2ToCanvas({
      backgroundDataUrl,
      preset,
      targetSize: preset.baseCanvas,
      fitMode: 'crop-fill',
    }, canvasRef.current)
  }, [backgroundDataUrl, preset])

  function updateLayer(layerId: string, patch: Partial<CompositeV2Layer>) {
    if (!preset || !props.onUpdatePreset) return
    props.onUpdatePreset({
      layers: preset.layers.map((layer) => layer.id === layerId ? { ...layer, ...patch } as CompositeV2Layer : layer),
    })
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (!preset || !dragRef.current) return
    const layer = preset.layers.find((item) => item.id === dragRef.current?.id)
    const host = event.currentTarget.getBoundingClientRect()
    if (!layer || layer.locked || host.width <= 0 || host.height <= 0) return
    const dx = (event.clientX - dragRef.current.x) / host.width * preset.baseCanvas.width
    const dy = (event.clientY - dragRef.current.y) / host.height * preset.baseCanvas.height
    dragRef.current = { id: layer.id, x: event.clientX, y: event.clientY }
    if (layer.position.mode === 'free') {
      updateLayer(layer.id, { position: { ...layer.position, x: layer.position.x + dx, y: layer.position.y + dy } })
    } else {
      updateLayer(layer.id, { position: { ...layer.position, offsetX: layer.position.offsetX + dx, offsetY: layer.position.offsetY + dy } })
    }
  }

  return (
    <div className="relative h-[560px] min-h-[500px] overflow-hidden rounded-md border border-gray-200 bg-gray-100 dark:border-white/[0.08] dark:bg-gray-950">
      <FloatingLayerToolbar onAddText={props.onAddText} onAddImage={props.onAddImage} disabled={!preset} />

      <div className="flex h-full items-center justify-center px-20 py-8">
        <div
          className="relative w-full max-w-4xl overflow-hidden rounded-md border border-gray-300 bg-white shadow-inner dark:border-white/[0.08] dark:bg-gray-900"
          style={{ aspectRatio: preset ? `${preset.baseCanvas.width}/${preset.baseCanvas.height}` : '16/9' }}
          onPointerMove={handlePointerMove}
          onPointerUp={() => { dragRef.current = null }}
        >
          {preset && <div className="absolute left-3 top-2 z-10 rounded bg-white/85 px-2 py-1 text-xs font-medium dark:bg-gray-950/85">{preset.name}</div>}
          {backgroundDataUrl && <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />}
          {!backgroundDataUrl && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
              {preset ? '设置示例背景后显示真实合成效果' : '请选择预设'}
            </div>
          )}
          {preset && visibleLayers.map((layer) => (
            <button
              key={layer.id}
              type="button"
              title={layer.name}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                selectLayer(layer.id)
                dragRef.current = { id: layer.id, x: event.clientX, y: event.clientY }
              }}
              className={`absolute border ${selectedLayerId === layer.id ? 'border-blue-500 bg-blue-500/10' : 'border-transparent hover:border-blue-300'}`}
              style={getLayerStyle(layer, preset)}
            />
          ))}
        </div>
      </div>

      <FloatingLogoLibrary
        path={props.logoLibraryPath}
        assets={props.logoAssets}
        statusText={props.logoStatusText}
        isRefreshing={props.isRefreshingLogos}
        assetsDisabled={!preset}
        assetDisabledReason="Select a preset first to insert this logo"
        onPathChange={props.onLogoLibraryPathChange}
        onSelectFolder={props.onSelectLogoFolder}
        onRefresh={props.onRefreshLogoFolder}
        onPickAsset={props.onPickLogo}
      />
    </div>
  )
}
