import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, LockOpen, Trash2 } from 'lucide-react'
import type { CompositeV2Layer, CompositeV2Preset } from '../lib/compositeV2Types'

type Props = {
  preset: CompositeV2Preset | null
  selectedLayerId: string
  onSelectLayer: (layerId: string) => void
  onUpdatePreset: (patch: Partial<CompositeV2Preset>) => void
}

const fieldClass = 'mt-1 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-white/[0.08] dark:bg-gray-900'
const iconButtonClass = 'inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-white/[0.06]'

export function PresetLayerPanel({ preset, selectedLayerId, onSelectLayer, onUpdatePreset }: Props) {
  const selectedLayer = preset?.layers.find((layer) => layer.id === selectedLayerId) ?? null

  function updateLayer(layerId: string, patch: Partial<CompositeV2Layer>) {
    if (!preset) return
    onUpdatePreset({
      layers: preset.layers.map((layer) => layer.id === layerId ? { ...layer, ...patch } as CompositeV2Layer : layer),
    })
  }

  function moveLayer(layerId: string, direction: -1 | 1) {
    if (!preset) return
    const index = preset.layers.findIndex((layer) => layer.id === layerId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= preset.layers.length) return
    const layers = [...preset.layers]
    ;[layers[index], layers[target]] = [layers[target]!, layers[index]!]
    onUpdatePreset({ layers })
  }

  function removeLayer(layerId: string) {
    if (!preset) return
    onUpdatePreset({ layers: preset.layers.filter((layer) => layer.id !== layerId) })
    if (selectedLayerId === layerId) onSelectLayer('')
  }

  return (
    <section className="flex min-h-[260px] flex-1 flex-col overflow-hidden rounded-md border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-950">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-gray-200 px-4 dark:border-white/[0.08]">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">图层信息</h2>
          <span className="text-xs text-gray-400">{preset?.layers.length ?? 0} 层</span>
        </div>
        <span className="text-xs text-gray-400">列表从上到下对应画面从顶到底</span>
      </header>

      {!preset ? (
        <div className="flex flex-1 items-center justify-center text-sm text-gray-400">选择预设后查看图层信息</div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
          <div className="overflow-y-auto border-r border-gray-200 p-2 dark:border-white/[0.08]">
            {preset.layers.length ? preset.layers.map((layer, index) => (
              <div key={layer.id} className={`mb-1 flex items-center gap-1 rounded-md px-2 py-1.5 ${selectedLayerId === layer.id ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'}`}>
                <button type="button" title={layer.visible ? '隐藏图层' : '显示图层'} onClick={() => updateLayer(layer.id, { visible: !layer.visible })} className={iconButtonClass}>{layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button>
                <button type="button" title={layer.locked ? '解锁图层' : '锁定图层'} onClick={() => updateLayer(layer.id, { locked: !layer.locked })} className={iconButtonClass}>{layer.locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}</button>
                <button type="button" onClick={() => onSelectLayer(layer.id)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-xs font-medium">{index + 1}. {layer.name}</div>
                  <div className="text-[10px] opacity-60">{layer.type === 'text' ? '文字' : '图片'} · {layer.position.mode === 'free' ? '自由坐标' : '九宫格'}</div>
                </button>
                <button type="button" title="上移图层" disabled={index === 0} onClick={() => moveLayer(layer.id, -1)} className={iconButtonClass}><ChevronUp className="h-3.5 w-3.5" /></button>
                <button type="button" title="下移图层" disabled={index === preset.layers.length - 1} onClick={() => moveLayer(layer.id, 1)} className={iconButtonClass}><ChevronDown className="h-3.5 w-3.5" /></button>
                <button type="button" title="删除图层" onClick={() => removeLayer(layer.id)} className={`${iconButtonClass} text-red-500`}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            )) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-xs text-gray-400">使用画布左侧工具栏添加文字或图片图层</div>
            )}
          </div>

          <div className="min-w-0 overflow-y-auto p-4">
            {selectedLayer ? (
              <div className="space-y-4">
                <div className="grid grid-cols-6 gap-3">
                  <label className="text-xs text-gray-500">名称<input value={selectedLayer.name} onChange={(event) => updateLayer(selectedLayer.id, { name: event.target.value })} className={fieldClass} /></label>
                  <label className="text-xs text-gray-500">定位模式<select value={selectedLayer.position.mode} onChange={(event) => updateLayer(selectedLayer.id, { position: event.target.value === 'free'
                    ? { mode: 'free', x: 100, y: 100, width: selectedLayer.position.width, height: selectedLayer.position.height }
                    : { mode: 'anchor', anchor: 'center', marginX: 0, marginY: 0, offsetX: 0, offsetY: 0, width: selectedLayer.position.width, height: selectedLayer.position.height } })} className={fieldClass}><option value="free">自由坐标</option><option value="anchor">九宫格</option></select></label>
                  {selectedLayer.position.mode === 'free' ? (
                    <>
                      <label className="text-xs text-gray-500">X<input type="number" value={selectedLayer.position.x} onChange={(event) => {
                        const position = selectedLayer.position
                        if (position.mode === 'free') updateLayer(selectedLayer.id, { position: { ...position, x: Number(event.target.value) } })
                      }} className={fieldClass} /></label>
                      <label className="text-xs text-gray-500">Y<input type="number" value={selectedLayer.position.y} onChange={(event) => {
                        const position = selectedLayer.position
                        if (position.mode === 'free') updateLayer(selectedLayer.id, { position: { ...position, y: Number(event.target.value) } })
                      }} className={fieldClass} /></label>
                    </>
                  ) : (
                    <>
                      <label className="text-xs text-gray-500">锚点<select value={selectedLayer.position.anchor} onChange={(event) => {
                        const position = selectedLayer.position
                        if (position.mode === 'anchor') updateLayer(selectedLayer.id, { position: { ...position, anchor: event.target.value as typeof position.anchor } })
                      }} className={fieldClass}>
                        <option value="top-left">左上</option><option value="top-center">上中</option><option value="top-right">右上</option><option value="center-left">左中</option><option value="center">居中</option><option value="center-right">右中</option><option value="bottom-left">左下</option><option value="bottom-center">下中</option><option value="bottom-right">右下</option>
                      </select></label>
                      <label className="text-xs text-gray-500">水平偏移<input type="number" value={selectedLayer.position.offsetX} onChange={(event) => {
                        const position = selectedLayer.position
                        if (position.mode === 'anchor') updateLayer(selectedLayer.id, { position: { ...position, offsetX: Number(event.target.value) } })
                      }} className={fieldClass} /></label>
                    </>
                  )}
                  <label className="text-xs text-gray-500">宽度<input type="number" min={1} value={selectedLayer.position.width} onChange={(event) => updateLayer(selectedLayer.id, { position: { ...selectedLayer.position, width: Math.max(1, Number(event.target.value)) } })} className={fieldClass} /></label>
                  <label className="text-xs text-gray-500">高度<input type="number" min={1} value={selectedLayer.position.height} onChange={(event) => updateLayer(selectedLayer.id, { position: { ...selectedLayer.position, height: Math.max(1, Number(event.target.value)) } })} className={fieldClass} /></label>
                </div>

                <div className="grid grid-cols-6 gap-3 border-t border-gray-100 pt-3 dark:border-white/[0.08]">
                  <label className="text-xs text-gray-500">透明度<input type="number" min={0} max={1} step={0.05} value={selectedLayer.opacity} onChange={(event) => updateLayer(selectedLayer.id, { opacity: Number(event.target.value) })} className={fieldClass} /></label>
                  <label className="text-xs text-gray-500">旋转<input type="number" value={selectedLayer.rotation} onChange={(event) => updateLayer(selectedLayer.id, { rotation: Number(event.target.value) })} className={fieldClass} /></label>
                  <label className="flex items-end gap-2 pb-2 text-xs text-gray-500"><input type="checkbox" checked={selectedLayer.visible} onChange={(event) => updateLayer(selectedLayer.id, { visible: event.target.checked })} />显示</label>
                  <label className="flex items-end gap-2 pb-2 text-xs text-gray-500"><input type="checkbox" checked={selectedLayer.locked} onChange={(event) => updateLayer(selectedLayer.id, { locked: event.target.checked })} />锁定</label>
                  <label className="flex items-end gap-2 pb-2 text-xs text-gray-500"><input type="checkbox" checked={selectedLayer.shadow.enabled} onChange={(event) => updateLayer(selectedLayer.id, { shadow: { ...selectedLayer.shadow, enabled: event.target.checked } })} />阴影</label>
                  <label className="text-xs text-gray-500">阴影模糊<input type="number" min={0} value={selectedLayer.shadow.blur} onChange={(event) => updateLayer(selectedLayer.id, { shadow: { ...selectedLayer.shadow, blur: Math.max(0, Number(event.target.value)) } })} className={fieldClass} /></label>
                </div>

                {selectedLayer.type === 'text' ? (
                  <div className="grid grid-cols-6 gap-3 border-t border-gray-100 pt-3 dark:border-white/[0.08]">
                    <label className="col-span-2 text-xs text-gray-500">文字<textarea value={selectedLayer.text} onChange={(event) => updateLayer(selectedLayer.id, { text: event.target.value })} className={fieldClass} /></label>
                    <label className="text-xs text-gray-500">字体<input value={selectedLayer.fontFamily} onChange={(event) => updateLayer(selectedLayer.id, { fontFamily: event.target.value })} className={fieldClass} /></label>
                    <label className="text-xs text-gray-500">字号<input type="number" value={selectedLayer.fontSize} onChange={(event) => updateLayer(selectedLayer.id, { fontSize: Number(event.target.value) })} className={fieldClass} /></label>
                    <label className="text-xs text-gray-500">字重<input type="number" value={selectedLayer.fontWeight} onChange={(event) => updateLayer(selectedLayer.id, { fontWeight: Number(event.target.value) })} className={fieldClass} /></label>
                    <label className="text-xs text-gray-500">颜色<input type="color" value={selectedLayer.color} onChange={(event) => updateLayer(selectedLayer.id, { color: event.target.value })} className="mt-1 h-8 w-full" /></label>
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-3 border-t border-gray-100 pt-3 dark:border-white/[0.08]">
                    <label className="text-xs text-gray-500">圆角<input type="number" min={0} value={selectedLayer.radius} onChange={(event) => updateLayer(selectedLayer.id, { radius: Math.max(0, Number(event.target.value)) })} className={fieldClass} /></label>
                    <label className="flex items-end gap-2 pb-2 text-xs text-gray-500"><input type="checkbox" checked={selectedLayer.clip} onChange={(event) => updateLayer(selectedLayer.id, { clip: event.target.checked })} />启用裁切</label>
                    <div className="col-span-2 self-end truncate pb-2 text-xs text-gray-400">{selectedLayer.asset?.path ?? '尚未选择图片素材'}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">{preset.layers.length ? '从左侧列表选择一个图层进行精调' : '当前预设还没有图层'}</div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
