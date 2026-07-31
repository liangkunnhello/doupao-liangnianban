import { ExpandIcon as Expand } from '../design-system/icons'

export default function LargeModalToggle({
  largeView,
  dialogName,
  onToggle,
  className = '',
}: {
  largeView: boolean
  dialogName: string
  onToggle: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={largeView ? `退出 ${dialogName}大弹窗模式` : `进入 ${dialogName}大弹窗模式`}
      aria-pressed={largeView}
      title={largeView ? '恢复默认弹窗大小' : '使用当前程序窗口 80% 的宽度和高度'}
      className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${largeView ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200' : 'border border-[hsl(var(--ds-color-border))] bg-[hsl(var(--ds-color-surface-raised))] text-[hsl(var(--ds-color-text-muted))] hover:border-violet-300 hover:text-violet-700 dark:hover:text-violet-200'} ${className}`}
    >
      <Expand size={15} />
      {largeView ? '恢复大小' : '80% 大弹窗'}
    </button>
  )
}
