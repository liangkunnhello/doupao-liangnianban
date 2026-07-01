import { Circle, Diamond, Image as ImageIcon, Type } from 'lucide-react'
import type { ReactNode } from 'react'
import ViewportTooltip from '../../../components/ViewportTooltip'
import { useTooltip } from '../../../hooks/useTooltip'

type Props = { 
  onAddText: () => void; 
  onAddImage: () => void; 
  onAddLogo: () => void; 
  disabled?: boolean 
}
type ButtonProps = { 
  tooltip: string; 
  ariaLabel: string; 
  disabled?: boolean; 
  onClick?: () => void; 
  icon: ReactNode; 
  label: string 
}

function ToolButton({ tooltip, ariaLabel, disabled = false, onClick, icon, label }: ButtonProps) {
  const tooltipState = useTooltip()
  return (
    <span className="relative inline-flex" {...tooltipState.handlers}>
      <button type="button" aria-label={ariaLabel} title={tooltip} disabled={disabled} onClick={() => { tooltipState.dismiss(); onClick?.() }} className={`flex h-10 w-full items-center gap-2 px-3 border-b border-gray-200 text-sm font-medium transition last:border-b-0 dark:border-white/[0.08] ${disabled ? 'cursor-not-allowed text-gray-300 dark:text-gray-600' : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700 dark:text-gray-200'}`}>
        {icon}
        <span>{label}</span>
      </button>
      <ViewportTooltip visible={tooltipState.visible} className="whitespace-nowrap">{tooltip}</ViewportTooltip>
    </span>
  )
}

export function FloatingLayerToolbar({ onAddText, onAddImage, onAddLogo, disabled = false }: Props) {
  return (
    <div className="absolute left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col overflow-hidden rounded-md border border-gray-200 bg-white/95 shadow-lg backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/90">
      <ToolButton tooltip={disabled ? '请先选择预设以添加文字图层' : '添加文字图层'} ariaLabel={disabled ? '未选择预设时无法添加文字图层' : '添加文字图层'} disabled={disabled} onClick={onAddText} icon={<Type className="h-4 w-4" />} label="文字" />
      <ToolButton tooltip={disabled ? '请先选择预设以添加图片图层' : '添加图片图层'} ariaLabel={disabled ? '未选择预设时无法添加图片图层' : '添加图片图层'} disabled={disabled} onClick={onAddImage} icon={<ImageIcon className="h-4 w-4" />} label="图片" />
      <ToolButton tooltip={disabled ? '请先选择预设以添加LOGO图层' : '添加LOGO图层'} ariaLabel={disabled ? '未选择预设时无法添加LOGO图层' : '添加LOGO图层'} disabled={disabled} onClick={onAddLogo} icon={<ImageIcon className="h-4 w-4" />} label="LOGO" />
      <ToolButton tooltip="形状图层后续支持" ariaLabel="形状图层后续支持" disabled onClick={() => {}} icon={<Diamond className="h-4 w-4" />} label="形状" />
    </div>
  )
}
