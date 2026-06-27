import type { ReactNode } from 'react'
import { FolderOpenIcon, RefreshIcon } from '../../../components/icons'
import { useTooltip } from '../../../hooks/useTooltip'
import ViewportTooltip from '../../../components/ViewportTooltip'
import type { CompositeFsImage } from '../lib/compositeTypes'

type FloatingLogoLibraryProps = {
  path: string
  assets: CompositeFsImage[]
  statusText: string
  isRefreshing?: boolean
  onPathChange: (path: string) => void
  onSelectFolder: () => void
  onRefresh: () => void
  onPickAsset: (asset: CompositeFsImage) => void
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
  onPathChange,
  onSelectFolder,
  onRefresh,
  onPickAsset,
}: FloatingLogoLibraryProps) {
  return (
    <aside className="absolute inset-y-4 right-4 z-20 flex w-72 flex-col overflow-hidden rounded-md border border-gray-200 bg-white/95 shadow-xl backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/90">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-white/[0.08]">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">LOGO 库</h3>
          <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">{statusText}</p>
        </div>
        <div className="ml-3 flex shrink-0 items-center gap-1.5">
          <IconActionButton tooltip="选择 LOGO 目录" ariaLabel="Select logo folder" onClick={onSelectFolder}>
            <FolderOpenIcon className="h-4 w-4" />
          </IconActionButton>
          <IconActionButton tooltip={isRefreshing ? '刷新中' : '刷新 LOGO 列表'} ariaLabel="Refresh logo library" onClick={onRefresh}>
            <RefreshIcon className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </IconActionButton>
        </div>
      </div>

      <div className="border-b border-gray-200 px-3 py-2 dark:border-white/[0.08]">
        <input
          value={path}
          onChange={(event) => onPathChange(event.target.value)}
          placeholder="输入或选择目录"
          aria-label="Logo library path"
          className="w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs text-gray-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200"
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-3 content-start gap-2 overflow-y-auto p-3">
        {assets.length > 0 ? assets.map((asset) => (
          <button
            key={asset.path}
            type="button"
            onClick={() => onPickAsset(asset)}
            className="min-w-0 rounded-md border border-gray-200 bg-gray-50 p-1.5 text-left transition hover:border-blue-300 hover:bg-blue-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:bg-blue-500/10"
            title={asset.path}
          >
            {asset.dataUrl ? (
              <img src={asset.dataUrl} alt={asset.name} className="aspect-square w-full rounded-md object-contain" />
            ) : (
              <div className="aspect-square rounded-md bg-gray-200 dark:bg-gray-800" />
            )}
            <div className="mt-1 truncate text-[10px] text-gray-600 dark:text-gray-300">{asset.name}</div>
          </button>
        )) : (
          <div className="col-span-3 flex min-h-24 items-center justify-center rounded-md border border-dashed border-gray-200 px-3 text-center text-[11px] text-gray-400 dark:border-white/[0.08] dark:text-gray-500">
            选择目录后，这里会显示 LOGO 缩略图。
          </div>
        )}
      </div>
    </aside>
  )
}
