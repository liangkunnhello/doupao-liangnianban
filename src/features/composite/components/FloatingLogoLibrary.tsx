import React, { type ReactNode, useState, useMemo } from 'react'
import { RefreshIcon } from '../../../components/icons'
import { Trash2, Plus, Edit2 } from 'lucide-react'
import { useTooltip } from '../../../hooks/useTooltip'
import ViewportTooltip from '../../../components/ViewportTooltip'
import type { CompositeFsImage } from '../lib/compositeTypes'

type FloatingLogoLibraryProps = {
  path: string
  assets: CompositeFsImage[]
  statusText: string
  isRefreshing?: boolean
  assetsDisabled?: boolean
  assetDisabledReason?: string
  variant?: 'floating' | 'sidebar'
  onSelectFolder: () => void
  onRefresh: () => void
  onPickAsset: (asset: CompositeFsImage) => void
  onDeleteAsset?: (asset: CompositeFsImage) => void
  onRenameAsset?: (asset: CompositeFsImage, newName: string) => void
  onReorderAssets?: (assets: CompositeFsImage[]) => void
  onImportFiles?: (files: FileList) => void
}

type IconActionButtonProps = {
  tooltip: string
  ariaLabel: string
  onClick: () => void
  children: ReactNode
}

function IconActionButton({ tooltip, ariaLabel, onClick, children }: IconActionButtonProps) {
  const tooltipState = useTooltip()

  return (
    <span className="relative inline-flex" {...tooltipState.handlers}>
      <button
        type="button"
        aria-label={ariaLabel}
        title={tooltip}
        onClick={() => {
          tooltipState.dismiss()
          onClick()
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-600 transition hover:bg-blue-50 hover:text-blue-700 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-blue-500/10 dark:hover:text-blue-200"
      >
        {children}
      </button>
      <ViewportTooltip visible={tooltipState.visible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

export function FloatingLogoLibrary({
  path,
  assets,
  statusText,
  isRefreshing = false,
  assetsDisabled = false,
  assetDisabledReason = '请先选择预设以插入该 LOGO',
  variant = 'floating',
  onSelectFolder,
  onRefresh,
  onPickAsset,
  onDeleteAsset,
  onRenameAsset,
  onReorderAssets,
  onImportFiles,
}: FloatingLogoLibraryProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [draggingAssetId, setDraggingAssetId] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const [editingAssetId, setEditingAssetId] = useState('')
  const [editingName, setEditingName] = useState('')

  const filteredAssets = useMemo(() => {
    if (!searchQuery.trim()) return assets
    const lowerQuery = searchQuery.toLowerCase()
    return assets.filter((asset) => asset.name.toLowerCase().includes(lowerQuery))
  }, [assets, searchQuery])
  return (
    <aside
      data-layout={variant === 'sidebar' ? 'logo-sidebar' : 'floating-logo-library'}
      className={variant === 'sidebar'
        ? 'flex h-full min-h-0 w-full flex-col overflow-hidden bg-white dark:bg-gray-950'
        : 'absolute inset-y-4 right-4 z-20 flex w-72 flex-col overflow-hidden rounded-md border border-gray-200 bg-white/95 shadow-xl backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/90'}
    >
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-white/[0.08]">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">LOGO 库</h3>
          <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">{statusText}</p>
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-1.5">
          <IconActionButton tooltip="添加 LOGO 到项目" ariaLabel="Add logos to project" onClick={onSelectFolder}>
            <Plus className="h-4 w-4" />
          </IconActionButton>
        </div>
      </div>

      <div className="border-b border-gray-200 px-3 py-2 dark:border-white/[0.08]">
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="搜索 LOGO 名称..."
          aria-label="搜索 LOGO"
          className="w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200"
        />
      </div>

      <div
        className={`grid min-h-0 flex-1 grid-cols-3 content-start gap-2 overflow-y-auto p-3 transition-colors ${isDragOver ? 'bg-blue-50/50 dark:bg-blue-500/10' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragOver(false)
          
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onImportFiles?.(e.dataTransfer.files)
            return
          }
          
          const draggedPath = e.dataTransfer.getData('application/x-doupao-logo-asset')
          if (!draggedPath || !onReorderAssets) return
          
          const targetElement = (e.target as HTMLElement).closest('[data-asset-path]')
          if (!targetElement) return
          
          const targetPath = targetElement.getAttribute('data-asset-path')
          if (!targetPath || targetPath === draggedPath) return
          
          const newAssets = [...assets]
          const sourceIndex = newAssets.findIndex((a) => a.path === draggedPath)
          const targetIndex = newAssets.findIndex((a) => a.path === targetPath)
          
          if (sourceIndex >= 0 && targetIndex >= 0) {
            const [item] = newAssets.splice(sourceIndex, 1)
            newAssets.splice(targetIndex, 0, item!)
            onReorderAssets(newAssets)
          }
        }}
      >
        {filteredAssets.length > 0 ? filteredAssets.map((asset) => (
          <div
            key={asset.path}
            data-asset-path={asset.path}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-doupao-logo-asset', asset.path)
              e.dataTransfer.effectAllowed = 'move'
              setDraggingAssetId(asset.path)
            }}
            onDragEnd={() => setDraggingAssetId('')}
            className={`group relative min-w-0 rounded-md border border-gray-200 bg-gray-50 p-1.5 transition dark:border-white/[0.08] dark:bg-white/[0.03] ${draggingAssetId === asset.path ? 'opacity-50' : ''} ${
              assetsDisabled
                ? 'cursor-not-allowed opacity-60'
                : 'hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/10 cursor-pointer'
            }`}
            title={assetsDisabled ? assetDisabledReason : asset.path}
          >
            <button
              type="button"
              disabled={assetsDisabled}
              onClick={() => {
                if (!editingAssetId) onPickAsset(asset)
              }}
              onContextMenu={(e) => e.preventDefault()}
              aria-label={assetsDisabled ? `${asset.name} unavailable until a preset is selected` : asset.name}
              className="block w-full text-left outline-none"
            >
              {asset.dataUrl ? (
                <img src={asset.dataUrl} alt={asset.name} className="aspect-square w-full rounded-md object-contain" draggable={false} onContextMenu={(e) => e.preventDefault()} />
              ) : (
                <div className="aspect-square rounded-md bg-gray-200 dark:bg-gray-800" onContextMenu={(e) => e.preventDefault()} />
              )}
              {editingAssetId === asset.path ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => {
                    if (onRenameAsset && editingName.trim() && editingName !== asset.name) {
                      onRenameAsset(asset, editingName.trim())
                    }
                    setEditingAssetId('')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (onRenameAsset && editingName.trim() && editingName !== asset.name) {
                        onRenameAsset(asset, editingName.trim())
                      }
                      setEditingAssetId('')
                    } else if (e.key === 'Escape') {
                      setEditingAssetId('')
                    }
                  }}
                  className="mt-1 w-full rounded border border-blue-300 bg-white px-1 py-0.5 text-[10px] text-gray-900 outline-none dark:bg-gray-900 dark:text-gray-100"
                />
              ) : (
                <div className="mt-1 truncate text-[10px] text-gray-600 dark:text-gray-300" onDoubleClick={(e) => {
                  e.stopPropagation()
                  setEditingAssetId(asset.path)
                  setEditingName(asset.name)
                }}>{asset.name}</div>
              )}
            </button>
            
            {onRenameAsset && (
              <button
                type="button"
                title="修改名称"
                onClick={(e) => {
                  e.stopPropagation()
                  setEditingAssetId(asset.path)
                  setEditingName(asset.name)
                }}
                className="absolute right-6 -top-2 hidden h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm hover:bg-gray-50 hover:text-blue-500 group-hover:flex dark:border-white/[0.08] dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-blue-400"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
            )}

            {onDeleteAsset && (
              <button
                type="button"
                title="删除 LOGO"
                onClick={(e) => {
                  e.stopPropagation()
                  if (window.confirm(`确定要删除 LOGO "${asset.name}" 吗？`)) {
                    onDeleteAsset(asset)
                  }
                }}
                className="absolute -right-2 -top-2 hidden h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-red-500 shadow-sm hover:bg-red-50 group-hover:flex dark:border-white/[0.08] dark:bg-gray-800 dark:text-red-400 dark:hover:bg-gray-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )) : (
          <div className="col-span-3 flex min-h-24 items-center justify-center rounded-md border border-dashed border-gray-200 px-3 text-center text-[11px] text-gray-400 dark:border-white/[0.08] dark:text-gray-500">
            {searchQuery ? '没有找到匹配的 LOGO' : '点击右上角 + 或拖拽图片到此处添加 LOGO'}
          </div>
        )}
      </div>
    </aside>
  )
}
