import { Circle, Diamond, Image as ImageIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import ViewportTooltip from '../../../components/ViewportTooltip'
import { useTooltip } from '../../../hooks/useTooltip'

type Props = { onAddText: () => void; onAddImage: () => void; disabled?: boolean }
type ButtonProps = { tooltip: string; ariaLabel: string; disabled?: boolean; onClick?: () => void; children: ReactNode }

function ToolButton({ tooltip, ariaLabel, disabled = false, onClick, children }: ButtonProps) {
  const tooltipState = useTooltip()
  return (
    <span className="relative inline-flex" {...tooltipState.handlers}>
      <button type="button" aria-label={ariaLabel} title={tooltip} disabled={disabled} onClick={() => { tooltipState.dismiss(); onClick?.() }} className={`flex h-10 w-10 items-center justify-center border-b border-gray-200 text-sm font-semibold transition last:border-b-0 dark:border-white/[0.08] ${disabled ? 'cursor-not-allowed text-gray-300 dark:text-gray-600' : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700 dark:text-gray-200'}`}>
        {children}
      </button>
      <ViewportTooltip visible={tooltipState.visible} className="whitespace-nowrap">{tooltip}</ViewportTooltip>
    </span>
  )
}

export function FloatingLayerToolbar({ onAddText, onAddImage, disabled = false }: Props) {
  return (
    <div className="absolute left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col overflow-hidden rounded-md border border-gray-200 bg-white/95 shadow-lg backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/90">
      <ToolButton tooltip={disabled ? 'Select a preset first to add text layers' : '添加文字图层'} ariaLabel={disabled ? 'Add text layer unavailable until a preset is selected' : 'Add text layer'} disabled={disabled} onClick={onAddText}><span className="text-base leading-none">T</span></ToolButton>
      <ToolButton tooltip={disabled ? 'Select a preset first to add image layers' : '添加图片图层'} ariaLabel={disabled ? 'Add image layer unavailable until a preset is selected' : 'Add image layer'} disabled={disabled} onClick={onAddImage}><ImageIcon className="h-4 w-4" /></ToolButton>
      <ToolButton tooltip="形状图层后续支持" ariaLabel="Diamond layer coming soon" disabled><Diamond className="h-4 w-4" /></ToolButton>
      <ToolButton tooltip="形状图层后续支持" ariaLabel="Circle layer coming soon" disabled><Circle className="h-4 w-4" /></ToolButton>
    </div>
  )
}
