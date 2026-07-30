import { useDeferredValue, useMemo, useRef, useState, useEffect } from 'react'
import { ALL_FAVORITES_COLLECTION_ID, getTaskFavoriteCollectionIds, useStore, reuseConfig, editOutputs, removeMultipleTasks, removeTask, rerunSopBatchTasks } from '../store'
import { getTaskGridColumnCount, getTaskGridVirtualWindow } from '../lib/taskGridVirtualWindow'
import { groupSopBatchTasks, type TaskGridItem } from '../lib/sopBatchTaskGrouping'
import type { TaskRecord } from '../types'
import { ImageIcon, SearchXIcon as SearchX } from '../design-system/icons'
import { EmptyState } from '../design-system'
import TaskCard from './TaskCard'
import SopBatchTaskCard from './SopBatchTaskCard'
import SopBatchDetailModal from './SopBatchDetailModal'

export default function TaskGrid() {
  const activeTabId = useStore((s) => s.activeWorkspaceTabId)
  const allTasks = useStore((s) => s.tasks)
  const workspaceTabs = useStore((s) => s.workspaceTabs)
  const tabTasks = useMemo(() => {
    const tab = activeTabId ? workspaceTabs.find((t) => t.id === activeTabId) : null
    return tab?.tasks ?? []
  }, [activeTabId, workspaceTabs])
  const filterFavorite = useStore((s) => s.filterFavorite)
  const tasks = filterFavorite ? allTasks : activeTabId ? tabTasks : allTasks
  const searchQuery = useStore((s) => s.searchQuery)
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const selectedTaskIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds])
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const clearSelection = useStore((s) => s.clearSelection)
  const rootRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(() => ({
    scrollY: typeof window === 'undefined' ? 0 : window.scrollY,
    height: typeof window === 'undefined' ? 800 : window.innerHeight,
    width: typeof window === 'undefined' ? 1_024 : window.innerWidth,
  }))
  const [selectionBox, setSelectionBox] = useState<{ startPageX: number; startPageY: number; currentPageX: number; currentPageY: number } | null>(null)
  const [batchDetail, setBatchDetail] = useState<{ sopName: string; tasks: TaskRecord[] } | null>(null)
  const dragStart = useRef<{ pageX: number; pageY: number } | null>(null)
  const lastClientPoint = useRef<{ x: number; y: number } | null>(null)
  const hasDragged = useRef(false)
  const isDragging = useRef(false)
  const dragScrollIntervalRef = useRef<number | null>(null)
  const dragScrollDirectionRef = useRef<-1 | 1 | null>(null)
  const lastToastTimeRef = useRef(0)
  const suppressClickUntil = useRef(0)
  const startedOnCard = useRef(false)
  const startedWithCtrl = useRef(false)
  const initialSelection = useRef<string[]>([])
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform)

  const filteredTasks = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => b.createdAt - a.createdAt)
    const q = deferredSearchQuery.trim().toLowerCase()
    
    return sorted.filter((t) => {
      if (filterFavorite) {
        if (!t.isFavorite) return false
        if (activeFavoriteCollectionId && activeFavoriteCollectionId !== ALL_FAVORITES_COLLECTION_ID && !getTaskFavoriteCollectionIds(t).includes(activeFavoriteCollectionId)) return false
      } else {
        // 在普通生图界面（非收藏夹模式下），不显示已收藏的专用收藏卡片
        if (t.isFavorite) return false
      }
      
      if (filterStatus !== 'all') {
        if (filterStatus === 'error') {
          if (t.status !== 'error' && !(t.status === 'done' && t.batchItemStatuses?.some((s) => s === 'error'))) return false
        } else {
          if (t.status !== filterStatus) return false
        }
      }
      
      if (!q) return true
      const prompt = (t.prompt || '').toLowerCase()
      const paramStr = JSON.stringify(t.params).toLowerCase()
      const errorStr = t.error ? t.error.toLowerCase() : ''
      const batchErrorStr = t.batchItemErrors?.map((e) => e.error.toLowerCase()).join(' ') ?? ''
      return prompt.includes(q) || paramStr.includes(q) || errorStr.includes(q) || batchErrorStr.includes(q)
    })
  }, [tasks, deferredSearchQuery, filterStatus, filterFavorite, activeFavoriteCollectionId])
  const gridItems = useMemo<TaskGridItem[]>(() => (
    filterFavorite
      ? filteredTasks.map((task) => ({ kind: 'task' as const, id: task.id, createdAt: task.createdAt, task }))
      : groupSopBatchTasks(filteredTasks)
  ), [filteredTasks, filterFavorite])
  useEffect(() => {
    let frame = 0
    const updateViewport = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        setViewport({
          scrollY: window.scrollY,
          height: window.innerHeight,
          width: window.innerWidth,
        })
      })
    }
    window.addEventListener('scroll', updateViewport, { passive: true })
    window.addEventListener('resize', updateViewport)
    updateViewport()
    return () => {
      window.removeEventListener('scroll', updateViewport)
      window.removeEventListener('resize', updateViewport)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  const columns = getTaskGridColumnCount(viewport.width)
  const gridPageTop = rootRef.current
    ? rootRef.current.getBoundingClientRect().top + viewport.scrollY
    : viewport.scrollY
  const virtualWindow = getTaskGridVirtualWindow({
    itemCount: gridItems.length,
    columns,
    rowHeight: 192,
    scrollTop: Math.max(0, viewport.scrollY - gridPageTop),
    viewportHeight: viewport.height,
    overscanRows: 3,
  })
  const visibleItems = gridItems.slice(virtualWindow.start, virtualWindow.end)

  const handleDelete = (task: typeof tasks[0]) => {
    setConfirmDialog({
      title: '删除任务',
      message: '确定要删除这个任务吗？关联的图片资源也会被清理（如果没有其他任务引用）。',
      action: () => removeTask(task),
    })
  }

  const handleDeleteBatch = (batchTasks: TaskRecord[]) => {
    setConfirmDialog({
      title: '删除 SOP 批量任务',
      message: `确定要删除这 ${batchTasks.length} 个 SOP 子任务吗？关联的图片资源也会一并清理。`,
      action: () => removeMultipleTasks(batchTasks.map((task) => task.id)),
    })
  }

  const getCardTaskIds = (card: Element) => {
    const taskIds = card.getAttribute('data-task-ids')
    if (taskIds) return taskIds.split(',').filter(Boolean)
    const taskId = card.getAttribute('data-task-id')
    return taskId ? [taskId] : []
  }

  const toggleBatchSelection = (batchTasks: TaskRecord[]) => {
    const batchTaskIds = batchTasks.map((task) => task.id)
    setSelectedTaskIds((current) => {
      const selected = new Set(current)
      const shouldSelect = !batchTaskIds.every((taskId) => selected.has(taskId))
      batchTaskIds.forEach((taskId) => shouldSelect ? selected.add(taskId) : selected.delete(taskId))
      return Array.from(selected)
    })
  }

  const getPagePoint = (clientX: number, clientY: number) => ({
    pageX: clientX + window.scrollX,
    pageY: clientY + window.scrollY,
  })

  const beginSelection = (target: HTMLElement, clientX: number, clientY: number, isCtrl: boolean) => {
    const point = getPagePoint(clientX, clientY)

    startedOnCard.current = Boolean(target.closest('.task-card-wrapper'))
    startedWithCtrl.current = isCtrl
    initialSelection.current = [...useStore.getState().selectedTaskIds]

    isDragging.current = true
    hasDragged.current = false
    dragStart.current = point
    lastClientPoint.current = { x: clientX, y: clientY }
    document.body.classList.add('select-none')
    document.body.classList.add('drag-selecting')
    setSelectionBox({
      startPageX: point.pageX,
      startPageY: point.pageY,
      currentPageX: point.pageX,
      currentPageY: point.pageY,
    })
  }

  const updateSelectionFromPoint = (pageX: number, pageY: number) => {
    const start = dragStart.current
    if (!start || !gridRef.current) return

    const minX = Math.min(start.pageX, pageX)
    const maxX = Math.max(start.pageX, pageX)
    const minY = Math.min(start.pageY, pageY)
    const maxY = Math.max(start.pageY, pageY)

    const cards = gridRef.current.querySelectorAll('.task-card-wrapper')
    const newSelected = new Set(initialSelection.current)
    const initialSelected = new Set(initialSelection.current)

    cards.forEach((card) => {
      const rect = card.getBoundingClientRect()
      const taskIds = getCardTaskIds(card)
      if (!taskIds.length) return

      const cardLeft = rect.left + window.scrollX
      const cardRight = rect.right + window.scrollX
      const cardTop = rect.top + window.scrollY
      const cardBottom = rect.bottom + window.scrollY

      const isIntersecting =
        minX < cardRight && maxX > cardLeft && minY < cardBottom && maxY > cardTop

      if (isIntersecting) {
        const cardWasSelected = taskIds.every((taskId) => initialSelected.has(taskId))
        taskIds.forEach((taskId) => cardWasSelected ? newSelected.delete(taskId) : newSelected.add(taskId))
      } else {
        taskIds.filter((taskId) => !initialSelected.has(taskId)).forEach((taskId) => newSelected.delete(taskId))
      }
    })

    setSelectedTaskIds(Array.from(newSelected))
  }

  useEffect(() => {
    const stopDragScroll = () => {
      if (dragScrollIntervalRef.current) {
        clearInterval(dragScrollIntervalRef.current)
        dragScrollIntervalRef.current = null
      }
      dragScrollDirectionRef.current = null
    }

    const startDragScroll = (direction: -1 | 1) => {
      if (dragScrollIntervalRef.current && dragScrollDirectionRef.current === direction) return
      stopDragScroll()
      dragScrollDirectionRef.current = direction
      dragScrollIntervalRef.current = window.setInterval(() => {
        window.scrollBy({ top: direction * 15, behavior: 'instant' })
      }, 16)
    }

    const endSelection = (clearEmptySurfaceClick = false, suppressClick = false) => {
      if (isDragging.current) {
        document.body.classList.remove('select-none')
        document.body.classList.remove('drag-selecting')
      }
      if (isDragging.current && clearEmptySurfaceClick && !hasDragged.current && !startedOnCard.current && !startedWithCtrl.current) {
        clearSelection()
      }
      if (isDragging.current && suppressClick && hasDragged.current) {
        suppressClickUntil.current = Date.now() + 250
      }
      stopDragScroll()
      isDragging.current = false
      dragStart.current = null
      lastClientPoint.current = null
      setSelectionBox(null)
    }

    const getEventElement = (e: MouseEvent) => {
      if (e.target instanceof Element) return e.target
      return document.elementFromPoint(e.clientX, e.clientY)
    }

    const handleDocumentMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const target = getEventElement(e)
      if (!target) return
      if (!target.closest('[data-drag-select-surface]')) return
      if (target.closest('[data-input-bar]')) return
      if (target.closest('[data-no-drag-select], [data-lightbox-root]')) return
      if (target.closest('button, a, input, textarea, select')) return

      const isCtrl = isMac ? e.metaKey : e.ctrlKey
      beginSelection(target as HTMLElement, e.clientX, e.clientY, isCtrl)
      e.preventDefault()
    }

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !dragStart.current) return

      const start = dragStart.current
      const point = getPagePoint(e.clientX, e.clientY)
      lastClientPoint.current = { x: e.clientX, y: e.clientY }
      const distance = Math.hypot(point.pageX - start.pageX, point.pageY - start.pageY)
      if (distance < 6 && !hasDragged.current) return

      hasDragged.current = true
      setSelectionBox({
        startPageX: start.pageX,
        startPageY: start.pageY,
        currentPageX: point.pageX,
        currentPageY: point.pageY,
      })
      updateSelectionFromPoint(point.pageX, point.pageY)
      e.preventDefault()

      const scrollThreshold = 40
      if (e.clientY < scrollThreshold) {
        startDragScroll(-1)
      } else if (e.clientY > window.innerHeight - scrollThreshold) {
        startDragScroll(1)
      } else {
        stopDragScroll()
      }
    }

    const handleDocumentScroll = () => {
      if (!isDragging.current || !dragStart.current || !lastClientPoint.current || !hasDragged.current) return

      const point = getPagePoint(lastClientPoint.current.x, lastClientPoint.current.y)
      const start = dragStart.current
      setSelectionBox({
        startPageX: start.pageX,
        startPageY: start.pageY,
        currentPageX: point.pageX,
        currentPageY: point.pageY,
      })
      updateSelectionFromPoint(point.pageX, point.pageY)
    }

    const handleDocumentWheel = (e: WheelEvent) => {
      if (!isDragging.current) return
      if ((e.buttons & 1) === 0) {
        endSelection()
        return
      }
      if (!hasDragged.current) return
      if (!e.ctrlKey && !e.metaKey) return

      e.preventDefault()
      const now = Date.now()
      if (now - lastToastTimeRef.current > 3000) {
        lastToastTimeRef.current = now
        const keyName = isMac ? '⌘' : 'Ctrl'
        useStore.getState().showToast(`松开 ${keyName} 键使用滚轮，或拖至边缘自动滚动`, 'info')
      }
    }

    const handleDocumentMouseUp = () => {
      endSelection(true, true)
    }

    document.addEventListener('mousedown', handleDocumentMouseDown, true)
    document.addEventListener('mousemove', handleDocumentMouseMove, true)
    document.addEventListener('mouseup', handleDocumentMouseUp, true)
    document.addEventListener('wheel', handleDocumentWheel, { capture: true, passive: false })
    window.addEventListener('scroll', handleDocumentScroll, true)
    return () => {
      stopDragScroll()
      document.removeEventListener('mousedown', handleDocumentMouseDown, true)
      document.removeEventListener('mousemove', handleDocumentMouseMove, true)
      document.removeEventListener('mouseup', handleDocumentMouseUp, true)
      document.removeEventListener('wheel', handleDocumentWheel, true)
      window.removeEventListener('scroll', handleDocumentScroll, true)
    }
  }, [clearSelection, isMac])

  if (!gridItems.length) {
    return (
      <EmptyState
        icon={searchQuery || filterFavorite ? <SearchX size={22} /> : <ImageIcon size={22} />}
        title={searchQuery || filterFavorite ? '没有找到匹配的任务' : '从第一张图片开始'}
        description={
          searchQuery || filterFavorite
            ? '尝试调整搜索词或筛选条件。'
            : '在下方输入提示词，配置尺寸与质量后生成图片。'
        }
      />
    )
  }

  return (
    <div 
      ref={rootRef}
      data-task-grid-root
      className="gallery-grid-shell relative min-h-[50vh]"
    >
      <div style={{ height: virtualWindow.totalHeight + 40 }}>
        <div
          ref={gridRef}
          className="gallery-grid absolute left-0 right-0 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          style={{ top: virtualWindow.offsetTop }}
        >
          {visibleItems.map((item) => item.kind === 'task' ? (
            <div key={item.id} className="gallery-card-wrapper task-card-wrapper" data-task-id={item.task.id}>
              <TaskCard
                task={item.task}
                onClick={(e) => {
                  if (Date.now() < suppressClickUntil.current) {
                    e.preventDefault()
                    return
                  }
                  suppressClickUntil.current = 0
                  const isCtrl = isMac ? e.metaKey : e.ctrlKey
                  if (isCtrl) {
                    useStore.getState().toggleTaskSelection(item.task.id)
                    return
                  }

                  setDetailTaskId(item.task.id)
                }}
                onReuse={() => reuseConfig(item.task)}
                onEditOutputs={() => editOutputs(item.task)}
                onDelete={() => handleDelete(item.task)}
                isSelected={selectedTaskIdSet.has(item.task.id)}
              />
            </div>
          ) : (
            <div key={item.id} className="gallery-card-wrapper task-card-wrapper" data-task-id={item.tasks[0]?.id} data-task-ids={item.tasks.map((task) => task.id).join(',')}>
              <SopBatchTaskCard
                sopName={item.sopName}
                tasks={item.tasks}
                summary={item.summary}
                isSelected={item.tasks.length > 0 && item.tasks.every((task) => selectedTaskIdSet.has(task.id))}
                onClick={(event) => {
                  if (Date.now() < suppressClickUntil.current) {
                    event.preventDefault()
                    return
                  }
                  suppressClickUntil.current = 0
                  const isCtrl = isMac ? event.metaKey : event.ctrlKey
                  if (isCtrl) {
                    toggleBatchSelection(item.tasks)
                    return
                  }
                  setBatchDetail({ sopName: item.sopName, tasks: item.tasks })
                }}
                onOpenBatch={() => setBatchDetail({ sopName: item.sopName, tasks: item.tasks })}
                onOpenImage={(imageId) => setLightboxImageId(imageId, item.tasks.flatMap((task) => task.outputImages))}
                onRerun={() => void rerunSopBatchTasks(item.tasks)}
                onDelete={() => handleDeleteBatch(item.tasks)}
              />
            </div>
          ))}
        </div>
      </div>
      {selectionBox && (
        <div
          className="fixed bg-blue-500/20 border border-blue-500/50 pointer-events-none z-[var(--ds-z-dropdown)]"
          style={{
            left: Math.min(selectionBox.startPageX, selectionBox.currentPageX) - window.scrollX,
            top: Math.min(selectionBox.startPageY, selectionBox.currentPageY) - window.scrollY,
            width: Math.abs(selectionBox.currentPageX - selectionBox.startPageX),
            height: Math.abs(selectionBox.currentPageY - selectionBox.startPageY),
          }}
        />
      )}
      {batchDetail && <SopBatchDetailModal
        sopName={batchDetail.sopName}
        tasks={batchDetail.tasks}
        onClose={() => setBatchDetail(null)}
        onOpenImage={(imageId) => setLightboxImageId(imageId, batchDetail.tasks.flatMap((task) => task.outputImages))}
      />}
    </div>
  )
}
