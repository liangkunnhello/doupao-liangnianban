import { useEffect, useMemo, useRef, useState } from 'react'
import { renderCompositeV2ToCanvas } from '../lib/compositeRendererV2'
import { mapLayerPositionToCanvas } from '../lib/compositeRenderPlan'
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
  onLogoLibraryPathChange: (path: string) => void
  onAddText: () => void
  onAddImage: () => void
  onSelectLogoFolder: () => void
  onRefreshLogoFolder: () => void
  onPickLogo: (asset: CompositeFsImage) => void
  onUpdatePreset?: (patch: Partial<CompositeV2Preset>) => void
}

function rectStyle(layer: CompositeV2Layer, preset: CompositeV2Preset) {
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
  const [selectedLayerId, setSelectedLayerId] = useState('')
  const [backgroundDataUrl, setBackgroundDataUrl] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ id: string; x: number; y: number } | null>(null)
  const selectedLayer = preset?.layers.find((layer) => layer.id === selectedLayerId) ?? null

  useEffect(() => {
    let active = true
    const path = preset?.sampleBackgroundPath
    if (!path) {
      setBackgroundDataUrl('')
      return
    }
    void window.electronAPI?.readImageFile?.(path).then((payload) => {
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

  const visibleLayers = useMemo(() => preset?.layers.filter((layer) => layer.visible) ?? [], [preset])

  function updateLayer(layerId: string, patch: Partial<CompositeV2Layer>) {
    if (!preset || !props.onUpdatePreset) return
    props.onUpdatePreset({
      layers: preset.layers.map((layer) => layer.id === layerId ? { ...layer, ...patch } as CompositeV2Layer : layer),
    })
  }

  function moveLayer(layerId: string, direction: -1 | 1) {
    if (!preset || !props.onUpdatePreset) return
    const index = preset.layers.findIndex((layer) => layer.id === layerId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= preset.layers.length) return
    const layers = [...preset.layers]
    ;[layers[index], layers[target]] = [layers[target]!, layers[index]!]
    props.onUpdatePreset({ layers })
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!preset || !dragRef.current) return
    const layer = preset.layers.find((item) => item.id === dragRef.current?.id)
    const host = event.currentTarget.getBoundingClientRect()
    if (!layer || layer.locked || host.width <= 0 || host.height <= 0) return
    const dx = (event.clientX - dragRef.current.x) / host.width * preset.baseCanvas.width
    const dy = (event.clientY - dragRef.current.y) / host.height * preset.baseCanvas.height
    dragRef.current = { id: layer.id, x: event.clientX, y: event.clientY }
    if (layer.position.mode === 'free') updateLayer(layer.id, { position: { ...layer.position, x: layer.position.x + dx, y: layer.position.y + dy } })
    else updateLayer(layer.id, { position: { ...layer.position, offsetX: layer.position.offsetX + dx, offsetY: layer.position.offsetY + dy } })
  }

  return (
    <div className="relative min-h-[560px] overflow-hidden rounded-md border border-gray-200 bg-gray-100 dark:border-white/[0.08] dark:bg-gray-950">
      <FloatingLayerToolbar onAddText={props.onAddText} onAddImage={props.onAddImage} disabled={!preset} />
      <div className="flex h-full min-h-[560px] items-center justify-center px-20 py-8">
        <div
          className="relative w-full max-w-4xl overflow-hidden rounded-md border border-gray-300 bg-white shadow-inner dark:border-white/[0.08] dark:bg-gray-900"
          style={{ aspectRatio: preset ? `${preset.baseCanvas.width}/${preset.baseCanvas.height}` : '16/9' }}
          onPointerMove={onPointerMove}
          onPointerUp={() => { dragRef.current = null }}
        >
          {preset && <div className="absolute left-3 top-2 z-10 rounded bg-white/85 px-2 py-1 text-xs font-medium dark:bg-gray-950/85">{preset.name}</div>}
          {backgroundDataUrl && <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />}
          {!backgroundDataUrl && <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">{preset ? '设置示例背景后显示真实合成效果' : '请选择预设'}</div>}
          {preset && visibleLayers.map((layer) => (
            <button
              key={layer.id}
              type="button"
              title={layer.name}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                setSelectedLayerId(layer.id)
                dragRef.current = { id: layer.id, x: event.clientX, y: event.clientY }
              }}
              className={`absolute border ${selectedLayerId === layer.id ? 'border-blue-500 bg-blue-500/10' : 'border-transparent hover:border-blue-300'}`}
              style={rectStyle(layer, preset)}
            />
          ))}
        </div>
      </div>

      {preset && selectedLayer && (
        <div className="absolute bottom-3 left-20 right-[19rem] z-20 rounded-md border border-gray-200 bg-white/95 p-3 text-xs shadow-lg backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/95">
          <div className="mb-2 flex items-center gap-1 overflow-x-auto border-b border-gray-100 pb-2 dark:border-white/[0.08]">
            {preset.layers.map((layer, index) => (
              <button key={layer.id} type="button" onClick={() => setSelectedLayerId(layer.id)} className={`shrink-0 rounded px-2 py-1 ${layer.id === selectedLayer.id ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10' : 'bg-gray-50 dark:bg-white/[0.04]'}`}>
                {index + 1}. {layer.name}
              </button>
            ))}
            <button type="button" title="上移图层" onClick={() => moveLayer(selectedLayer.id, -1)} className="ml-auto shrink-0 rounded border px-2 py-1">上移</button>
            <button type="button" title="下移图层" onClick={() => moveLayer(selectedLayer.id, 1)} className="shrink-0 rounded border px-2 py-1">下移</button>
          </div>
          <div className="grid grid-cols-6 gap-2">
            <label>名称<input value={selectedLayer.name} onChange={(event) => updateLayer(selectedLayer.id, { name: event.target.value })} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900" /></label>
            <label>透明度<input type="number" min={0} max={1} step={0.05} value={selectedLayer.opacity} onChange={(event) => updateLayer(selectedLayer.id, { opacity: Number(event.target.value) })} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900" /></label>
            <label>旋转<input type="number" value={selectedLayer.rotation} onChange={(event) => updateLayer(selectedLayer.id, { rotation: Number(event.target.value) })} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900" /></label>
            <label>宽<input type="number" value={selectedLayer.position.width} onChange={(event) => updateLayer(selectedLayer.id, { position: { ...selectedLayer.position, width: Math.max(1, Number(event.target.value)) } })} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900" /></label>
            <label>高<input type="number" value={selectedLayer.position.height} onChange={(event) => updateLayer(selectedLayer.id, { position: { ...selectedLayer.position, height: Math.max(1, Number(event.target.value)) } })} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900" /></label>
            <label>定位<select value={selectedLayer.position.mode} onChange={(event) => {
              const mode = event.target.value
              updateLayer(selectedLayer.id, { position: mode === 'free'
                ? { mode: 'free', x: 100, y: 100, width: selectedLayer.position.width, height: selectedLayer.position.height }
                : { mode: 'anchor', anchor: 'center', marginX: 0, marginY: 0, offsetX: 0, offsetY: 0, width: selectedLayer.position.width, height: selectedLayer.position.height } })
            }} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900"><option value="free">自由坐标</option><option value="anchor">九宫格</option></select></label>
          </div>
          <div className="mt-2 grid grid-cols-6 gap-2">
            <label className="flex items-center gap-1"><input type="checkbox" checked={selectedLayer.shadow.enabled} onChange={(event) => updateLayer(selectedLayer.id, { shadow: { ...selectedLayer.shadow, enabled: event.target.checked } })} />阴影</label>
            <label>阴影色<input type="color" value={selectedLayer.shadow.color} onChange={(event) => updateLayer(selectedLayer.id, { shadow: { ...selectedLayer.shadow, color: event.target.value } })} className="mt-1 h-7 w-full" /></label>
            <label>阴影 X<input type="number" value={selectedLayer.shadow.x} onChange={(event) => updateLayer(selectedLayer.id, { shadow: { ...selectedLayer.shadow, x: Number(event.target.value) } })} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900" /></label>
            <label>阴影 Y<input type="number" value={selectedLayer.shadow.y} onChange={(event) => updateLayer(selectedLayer.id, { shadow: { ...selectedLayer.shadow, y: Number(event.target.value) } })} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900" /></label>
            <label>模糊<input type="number" min={0} value={selectedLayer.shadow.blur} onChange={(event) => updateLayer(selectedLayer.id, { shadow: { ...selectedLayer.shadow, blur: Math.max(0, Number(event.target.value)) } })} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900" /></label>
            <label>阴影透明<input type="number" min={0} max={1} step={0.05} value={selectedLayer.shadow.opacity} onChange={(event) => updateLayer(selectedLayer.id, { shadow: { ...selectedLayer.shadow, opacity: Number(event.target.value) } })} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900" /></label>
          </div>
          {selectedLayer.type === 'text' && (
            <div className="mt-2 grid grid-cols-6 gap-2">
              <label className="col-span-2">文字<textarea value={selectedLayer.text} onChange={(event) => updateLayer(selectedLayer.id, { text: event.target.value })} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900" /></label>
              <label>字体<input value={selectedLayer.fontFamily} onChange={(event) => updateLayer(selectedLayer.id, { fontFamily: event.target.value })} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900" /></label>
              <label>字号<input type="number" value={selectedLayer.fontSize} onChange={(event) => updateLayer(selectedLayer.id, { fontSize: Number(event.target.value) })} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900" /></label>
              <label>字重<input type="number" value={selectedLayer.fontWeight} onChange={(event) => updateLayer(selectedLayer.id, { fontWeight: Number(event.target.value) })} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900" /></label>
              <label>颜色<input type="color" value={selectedLayer.color} onChange={(event) => updateLayer(selectedLayer.id, { color: event.target.value })} className="mt-1 h-7 w-full" /></label>
              <label>行高<input type="number" step={0.1} value={selectedLayer.lineHeight} onChange={(event) => updateLayer(selectedLayer.id, { lineHeight: Number(event.target.value) })} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900" /></label>
              <label>字距<input type="number" value={selectedLayer.letterSpacing} onChange={(event) => updateLayer(selectedLayer.id, { letterSpacing: Number(event.target.value) })} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900" /></label>
              <label>对齐<select value={selectedLayer.align} onChange={(event) => updateLayer(selectedLayer.id, { align: event.target.value as 'left' | 'center' | 'right' })} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900"><option value="left">左</option><option value="center">中</option><option value="right">右</option></select></label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={selectedLayer.stroke.enabled} onChange={(event) => updateLayer(selectedLayer.id, { stroke: { ...selectedLayer.stroke, enabled: event.target.checked } })} />描边</label>
              <label>描边色<input type="color" value={selectedLayer.stroke.color} onChange={(event) => updateLayer(selectedLayer.id, { stroke: { ...selectedLayer.stroke, color: event.target.value } })} className="mt-1 h-7 w-full" /></label>
              <label>描边宽<input type="number" min={0} value={selectedLayer.stroke.width} onChange={(event) => updateLayer(selectedLayer.id, { stroke: { ...selectedLayer.stroke, width: Math.max(0, Number(event.target.value)) } })} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900" /></label>
            </div>
          )}
          {selectedLayer.type === 'image' && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              <label>圆角<input type="number" min={0} value={selectedLayer.radius} onChange={(event) => updateLayer(selectedLayer.id, { radius: Math.max(0, Number(event.target.value)) })} className="mt-1 w-full rounded border px-2 py-1 dark:bg-gray-900" /></label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={selectedLayer.clip} onChange={(event) => updateLayer(selectedLayer.id, { clip: event.target.checked })} />启用裁切</label>
            </div>
          )}
        </div>
      )}

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
