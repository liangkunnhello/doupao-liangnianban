import type { ReactNode } from 'react'
import {
  ChevronRightIcon as ChevronRight,
  CloseIcon as X,
  FolderOpenIcon as FolderOpen,
  RefreshIcon as RefreshCw,
} from '../../design-system/icons'
import type { OrderingCatalog, OrderingOrder, OrderingTask } from './types'

const statusLabel: Record<OrderingOrder['status'], string> = {
  queued: '排队中',
  running: '生成中',
  completed: '已完成',
  partially_failed: '部分失败',
  failed: '失败',
  cancelled: '已取消',
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 ${className}`}>{children}</section>
}

export interface OrderingHistoryProps {
  catalog: OrderingCatalog
  currentUserId: string
  canViewAll: boolean
  orders: OrderingOrder[]
  tasks: OrderingTask[]
  selectedOrderId?: string | null
  onSelectOrder: (orderId: string) => void
  onCancelOrder: (orderId: string) => void
  onRetryUnit: (orderId: string, unitId: string) => void
  onOpenTaskFolder?: (task: OrderingTask) => void
}

function OrderDetail({
  order,
  catalog,
  tasks,
  onCancelOrder,
  onRetryUnit,
  onOpenTaskFolder,
}: Pick<OrderingHistoryProps, 'catalog' | 'tasks' | 'onCancelOrder' | 'onRetryUnit' | 'onOpenTaskFolder'> & { order: OrderingOrder }) {
  const productById = new Map(catalog.products.map((item) => [item.id, item.name]))
  const channelById = new Map(catalog.channels.map((item) => [item.id, item.name]))
  const typeById = new Map(catalog.materialTypes.map((item) => [item.id, item.name]))
  const percent = order.totalImages ? Math.round(((order.completedImages + order.failedImages) / order.totalImages) * 100) : 0

  const openUnitFolder = (taskId?: string) => {
    const task = tasks.find((item) => item.id === taskId)
    if (task) onOpenTaskFolder?.(task)
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 p-5 dark:border-gray-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{order.number}</h2>
            {order.urgentRequested && <span className={`rounded-full px-2 py-0.5 text-xs ${order.urgentApproved ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>{order.urgentApproved ? '紧急已批准' : '紧急待审批'}</span>}
          </div>
          <p className="mt-1 text-sm text-gray-500">{order.createdByName} · {formatDate(order.createdAt)}</p>
        </div>
        {(order.status === 'queued' || order.status === 'running') && (
          <button type="button" onClick={() => onCancelOrder(order.id)} className="flex min-h-11 items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/30"><X size={15} />取消未完成任务</button>
        )}
      </div>
      <div className="p-5">
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ['状态', statusLabel[order.status]],
            ['总量', `${order.totalImages} 张`],
            ['已完成', `${order.completedImages} 张`],
            ['预计完成', order.estimatedFinishedAt ? formatDate(order.estimatedFinishedAt) : '计算中'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-gray-50 p-3 dark:bg-gray-950">
              <span className="block text-xs text-gray-500">{label}</span>
              <strong className="mt-1 block text-sm">{value}</strong>
            </div>
          ))}
        </div>
        <div className="mt-5">
          <div className="mb-2 flex justify-between text-xs text-gray-500"><span>整体进度</span><span>{percent}%</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"><div className="h-full rounded-full bg-blue-600 transition" style={{ width: `${percent}%` }} /></div>
        </div>
        <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
          {order.units.map((unit, index) => (
            <div key={unit.id} className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-0 dark:border-gray-800">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-500 dark:bg-gray-800">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{productById.get(unit.productId)} · {channelById.get(unit.channelId)} · {unit.ratio} · {typeById.get(unit.materialTypeId)}</p>
                <p className="mt-0.5 text-xs text-gray-500">{unit.quantity} 张{unit.error ? ` · ${unit.error}` : ''}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs ${
                unit.status === 'done' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                  : unit.status === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
                    : unit.status === 'running' ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
              }`}>{unit.status === 'done' ? '完成' : unit.status === 'error' ? '失败' : unit.status === 'running' ? '生成中' : unit.status === 'cancelled' ? '已取消' : '排队中'}</span>
              {unit.taskId && onOpenTaskFolder && <button type="button" onClick={() => openUnitFolder(unit.taskId)} className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" title="打开结果目录" aria-label="打开结果目录"><FolderOpen size={16} /></button>}
              {unit.status === 'error' && <button type="button" onClick={() => onRetryUnit(order.id, unit.id)} className="flex min-h-11 items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"><RefreshCw size={13} />重试</button>}
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

export default function OrderingHistory({
  catalog,
  currentUserId,
  canViewAll,
  orders,
  tasks,
  selectedOrderId,
  onSelectOrder,
  onCancelOrder,
  onRetryUnit,
  onOpenTaskFolder,
}: OrderingHistoryProps) {
  const visible = canViewAll ? orders : orders.filter((item) => item.createdBy === currentUserId)
  const selected = visible.find((item) => item.id === selectedOrderId) ?? visible[0]

  return (
    <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Card className="self-start overflow-hidden">
        <div className="border-b border-gray-100 p-4 dark:border-gray-800">
          <h2 className="font-semibold">需求任务</h2>
          <p className="mt-1 text-xs text-gray-500">共 {visible.length} 个订单</p>
        </div>
        <div className="max-h-[70vh] overflow-y-auto overscroll-contain">
          {visible.length === 0 && <div className="p-8 text-center text-sm text-gray-500">暂无任务</div>}
          {visible.map((order) => (
            <button key={order.id} type="button" onClick={() => onSelectOrder(order.id)} className={`flex min-h-16 w-full items-center gap-3 border-b border-gray-100 p-4 text-left dark:border-gray-800 ${selected?.id === order.id ? 'bg-blue-50 dark:bg-blue-950/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${order.status === 'completed' ? 'bg-emerald-500' : order.status === 'failed' ? 'bg-red-500' : order.status === 'running' ? 'bg-blue-500' : 'bg-gray-400'}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{order.number}</span>
                <span className="mt-1 block text-xs text-gray-500">{statusLabel[order.status]} · {order.totalImages} 张</span>
              </span>
              <ChevronRight size={15} className="text-gray-400" />
            </button>
          ))}
        </div>
      </Card>
      {selected ? (
        <OrderDetail
          order={selected}
          catalog={catalog}
          tasks={tasks}
          onCancelOrder={onCancelOrder}
          onRetryUnit={onRetryUnit}
          onOpenTaskFolder={onOpenTaskFolder}
        />
      ) : (
        <Card className="flex min-h-80 items-center justify-center text-sm text-gray-500">选择一个任务查看详情</Card>
      )}
    </div>
  )
}
