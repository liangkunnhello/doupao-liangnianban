import type { ReactNode } from 'react'
import { useTooltip } from '../../../hooks/useTooltip'
import ViewportTooltip from '../../../components/ViewportTooltip'

type FloatingLayerToolbarProps = {
  onAddText: () => void
  onAddImage: () => void
}

type ToolButtonProps = {
  tooltip: string
  ariaLabel: string
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}

function ImageLayerIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4">
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
      <circle cx="7" cy="8" r="1.4" fill="currentColor" stroke="none" />
      <path d="M5 14.5 9.2 10.4a1 1 0 0 1 1.4 0l1.9 1.9a1 1 0 0 0 1.4 0l1.1-1.1" />
    </svg>
  )
}

function ShapeLayerIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4">
      <rect x="3.5" y="3.5" width="13" height="13" rx="2" />
    </svg>
  )
}

function ToolButton({ tooltip, ariaLabel, disabled = false, onClick, children }: ToolButtonProps) {
  const tooltipState = useTooltip()

  return (
    <span className="relative inline-flex" {...tooltipState.handlers}>
      <button
        type="button"
        aria-label={ariaLabel}
        title={tooltip}
        disabled={disabled}
        onClick={() => {
          tooltipState.dismiss()
          onClick?.()
        }}
        className={`flex h-10 w-10 items-center justify-center border-b border-gray-200 text-sm font-semibold transition last:border-b-0 dark:border-white/[0.08] ${
          disabled
            ? 'cursor-not-allowed text-gray-300 dark:text-gray-600'
            : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700 dark:text-gray-200 dark:hover:bg-blue-500/10 dark:hover:text-blue-200'
        }`}
      >
        {children}
      </button>
      <ViewportTooltip visible={tooltipState.visible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

export function FloatingLayerToolbar({ onAddText, onAddImage }: FloatingLayerToolbarProps) {
  return (
    <div className="absolute left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col overflow-hidden rounded-md border border-gray-200 bg-white/95 shadow-lg backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/90">
      <ToolButton tooltip="添加文字图层" ariaLabel="Add text layer" onClick={onAddText}>
        <span className="text-base leading-none">T</span>
      </ToolButton>
      <ToolButton tooltip="添加图片图层" ariaLabel="Add image layer" onClick={onAddImage}>
        <ImageLayerIcon />
      </ToolButton>
      <ToolButton tooltip="形状图层后续支持" ariaLabel="Shape layer coming soon" disabled>
        <ShapeLayerIcon />
      </ToolButton>
    </div>
  )
}
