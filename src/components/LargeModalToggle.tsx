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
      className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ds-color-focus))] ${largeView ? 'bg-[hsl(var(--ds-color-primary-subtle))] text-[hsl(var(--ds-color-primary))] dark:bg-[hsl(var(--ds-color-primary)/0.14)] dark:text-[hsl(var(--ds-color-primary))]' : 'border border-[hsl(var(--ds-color-border))] bg-[hsl(var(--ds-color-surface-raised))] text-[hsl(var(--ds-color-text-muted))] hover:border-[hsl(var(--ds-color-border-strong))] hover:text-[hsl(var(--ds-color-primary))] dark:hover:text-[hsl(var(--ds-color-primary))]'} ${className}`}
    >
      <Expand size={15} />
      {largeView ? '恢复大小' : '80% 大弹窗'}
    </button>
  )
}
