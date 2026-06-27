import { useMemo, useState } from 'react'
import { mapLayerPositionToCanvas } from '../lib/compositeRenderPlan'
import type { CompositeV2Layer, CompositeV2Preset } from '../lib/compositeV2Types'
import type { CompositeFsImage } from '../lib/compositeTypes'
import { FloatingLayerToolbar } from './FloatingLayerToolbar'
import { FloatingLogoLibrary } from './FloatingLogoLibrary'

type PresetCanvasEditorProps = {
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
}

function getLayerRectStyle(layer: CompositeV2Layer, preset: CompositeV2Preset) {
  const rect = mapLayerPositionToCanvas(layer.position, preset.baseCanvas, preset.baseCanvas)

  return {
    left: `${(rect.x / preset.baseCanvas.width) * 100}%`,
    top: `${(rect.y / preset.baseCanvas.height) * 100}%`,
    width: `${(rect.width / preset.baseCanvas.width) * 100}%`,
    height: `${(rect.height / preset.baseCanvas.height) * 100}%`,
    opacity: layer.opacity,
    transform: `rotate(${layer.rotation}deg)`,
  }
}

function getAssetLabel(layer: Extract<CompositeV2Layer, { type: 'image' }>) {
  if (!layer.asset) return 'Image'
  return layer.asset.path.split(/[\\/]/).pop() ?? layer.asset.path
}

export function PresetCanvasEditor({
  preset,
  logoLibraryPath,
  logoAssets,
  logoStatusText,
  isRefreshingLogos = false,
  onLogoLibraryPathChange,
  onAddText,
  onAddImage,
  onSelectLogoFolder,
  onRefreshLogoFolder,
  onPickLogo,
}: PresetCanvasEditorProps) {
  const [selectedLayerId, setSelectedLayerId] = useState('')
  const visibleLayers = useMemo(
    () => preset?.layers.filter((layer) => layer.visible) ?? [],
    [preset],
  )

  return (
    <div className="relative min-h-[560px] overflow-hidden rounded-md border border-gray-200 bg-gray-100 dark:border-white/[0.08] dark:bg-gray-950">
      <FloatingLayerToolbar onAddText={onAddText} onAddImage={onAddImage} />

      <div className="flex h-full min-h-[560px] items-center justify-center px-20 py-8">
        <div
          className="relative w-full max-w-4xl overflow-hidden rounded-md border border-gray-300 bg-white shadow-inner dark:border-white/[0.08] dark:bg-gray-900"
          style={{
            aspectRatio: preset ? `${preset.baseCanvas.width} / ${preset.baseCanvas.height}` : '16 / 9',
            backgroundImage: 'linear-gradient(45deg, rgba(148,163,184,0.12) 25%, transparent 25%), linear-gradient(-45deg, rgba(148,163,184,0.12) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(148,163,184,0.12) 75%), linear-gradient(-45deg, transparent 75%, rgba(148,163,184,0.12) 75%)',
            backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0',
            backgroundSize: '20px 20px',
          }}
        >
          {preset ? (
            <>
              <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-white/85 px-3 py-2 text-xs text-gray-600 backdrop-blur dark:bg-gray-950/80 dark:text-gray-300">
                <span className="truncate font-medium text-gray-900 dark:text-gray-100">{preset.name}</span>
                <span className="shrink-0">{preset.baseCanvas.width} × {preset.baseCanvas.height}</span>
              </div>

              <div className="absolute inset-0 pt-10">
                {visibleLayers.length > 0 ? visibleLayers.map((layer) => {
                  const isSelected = selectedLayerId === layer.id

                  return (
                    <button
                      key={layer.id}
                      type="button"
                      onClick={() => setSelectedLayerId(layer.id)}
                      className={`absolute overflow-hidden rounded-md border text-left transition ${
                        isSelected
                          ? 'border-blue-500 bg-blue-500/10 shadow-sm'
                          : 'border-blue-200/80 bg-white/60 hover:border-blue-300 dark:border-blue-400/30 dark:bg-white/[0.04]'
                      }`}
                      style={getLayerRectStyle(layer, preset)}
                      title={layer.name}
                    >
                      <div className="flex h-full w-full flex-col justify-between p-2">
                        <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-200">
                          {layer.type}
                        </span>
                        {layer.type === 'text' ? (
                          <span
                            className="line-clamp-3 break-words text-xs text-gray-800 dark:text-gray-100"
                            style={{
                              color: layer.color,
                              fontFamily: layer.fontFamily,
                              fontWeight: layer.fontWeight,
                              fontSize: `${Math.max(11, Math.min(layer.fontSize / 3, 20))}px`,
                              lineHeight: layer.lineHeight,
                            }}
                          >
                            {layer.text}
                          </span>
                        ) : (
                          <span className="truncate text-xs text-gray-700 dark:text-gray-200">
                            {getAssetLabel(layer)}
                          </span>
                        )}
                      </div>
                    </button>
                  )
                }) : (
                  <div className="flex h-full items-center justify-center text-sm text-gray-400 dark:text-gray-500">
                    用左侧工具条开始添加图层。
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-400 dark:text-gray-500">
              请选择预设。
            </div>
          )}
        </div>
      </div>

      <FloatingLogoLibrary
        path={logoLibraryPath}
        assets={logoAssets}
        statusText={logoStatusText}
        isRefreshing={isRefreshingLogos}
        onPathChange={onLogoLibraryPathChange}
        onSelectFolder={onSelectLogoFolder}
        onRefresh={onRefreshLogoFolder}
        onPickAsset={onPickLogo}
      />
    </div>
  )
}
