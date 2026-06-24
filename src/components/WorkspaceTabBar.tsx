import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { CalendarIcon, PlusIcon, CloseIcon, ChevronDownIcon, SettingsIcon, CopyIcon, EditIcon, TrashIcon } from './icons'
import type { WorkspaceTab, WorkspaceTabGroup } from '../types'

const MIN_W = 280
const MIN_H = 400
const MAX_W = 600
const MAX_H = 900
const DEFAULT_W = 320
const DEFAULT_H = 700

const SHARED_WIDTH_KEY = 'floating_panel_width_v1'
const POS_STORAGE_KEY = 'workspaceTabBar_pos_v1'
const DOCK_STORAGE_KEY = 'workspaceTabBar_dock_v1'
const SNAP_THRESHOLD = 10

function loadSavedWidth(): number | null {
  try {
    const raw = localStorage.getItem(SHARED_WIDTH_KEY)
    if (raw) {
      const w = JSON.parse(raw)
      if (typeof w === 'number') return Math.max(MIN_W, Math.min(MAX_W, w))
    }
  } catch { /* ignore */ }
  return null
}

function saveSharedWidth(w: number) {
  localStorage.setItem(SHARED_WIDTH_KEY, JSON.stringify(Math.max(MIN_W, Math.min(MAX_W, w))))
}

function loadSavedSize() {
  const w = loadSavedWidth()
  if (w !== null) return { w, h: DEFAULT_H }
  return null
}

function loadSavedPos() {
  try {
    const raw = localStorage.getItem(POS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
        return {
          x: Math.max(0, Math.min(window.innerWidth - DEFAULT_W, parsed.x)),
          y: Math.max(0, Math.min(window.innerHeight - DEFAULT_H, parsed.y)),
        }
      }
    }
  } catch { /* ignore */ }
  return null
}

function loadSavedDock(): 'left' | 'right' | null {
  try {
    const raw = localStorage.getItem(DOCK_STORAGE_KEY)
    if (raw === 'left' || raw === 'right') return raw
  } catch { /* ignore */ }
  return 'left'
}

export default function WorkspaceTabBar() {
  const appMode = useStore((s) => s.appMode)
  const workspaceTabs = useStore((s) => s.workspaceTabs)
  const activeWorkspaceTabId = useStore((s) => s.activeWorkspaceTabId)
  const workspaceTabGroups = useStore((s) => s.workspaceTabGroups)
  const selectedWorkspaceTabIds = useStore((s) => s.selectedWorkspaceTabIds)

  const setActiveWorkspaceTabId = useStore((s) => s.setActiveWorkspaceTabId)
  const createWorkspaceTab = useStore((s) => s.createWorkspaceTab)
  const closeWorkspaceTab = useStore((s) => s.closeWorkspaceTab)
  const duplicateWorkspaceTab = useStore((s) => s.duplicateWorkspaceTab)
  const renameWorkspaceTab = useStore((s) => s.renameWorkspaceTab)
  const reorderWorkspaceTabs = useStore((s) => s.reorderWorkspaceTabs)
  const moveWorkspaceTabToGroup = useStore((s) => s.moveWorkspaceTabToGroup)
  const createWorkspaceTabGroup = useStore((s) => s.createWorkspaceTabGroup)
  const setWorkspaceTabManagerOpen = useStore((s) => s.setWorkspaceTabManagerOpen)
  const setScheduleModalOpen = useStore((s) => s.setScheduleModalOpen)
  const setPromptInputDialog = useStore((s) => s.setPromptInputDialog)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const toggleWorkspaceTabSelection = useStore((s) => s.toggleWorkspaceTabSelection)
  const clearWorkspaceTabSelection = useStore((s) => s.clearWorkspaceTabSelection)

  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null)
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null)
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingTabName, setEditingTabName] = useState('')

  // floating panel state
  const [pos, setPos] = useState(() => loadSavedPos() ?? { x: 0, y: 0 })
  const [sz, setSz] = useState(() => loadSavedSize() ?? { w: DEFAULT_W, h: DEFAULT_H })
  const [docked, setDocked] = useState<'left' | 'right' | null>(() => loadSavedDock())
  const dragRef = useRef(false)
  const resizeRef = useRef(false)
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 })
  const dragOff = useRef({ x: 0, y: 0 })
  const panelRef = useRef<HTMLDivElement>(null)
  const skipInlineRenameBlurRef = useRef(false)

  // init position (fallback if no saved position)
  useEffect(() => {
    if (pos.x === 0 && pos.y === 0) {
      setPos({
        x: 16,
        y: Math.max(16, (window.innerHeight - sz.h) / 2),
      })
    }
  }, [pos.x, pos.y, sz.w, sz.h])

  // persist size, position and dock state (debounced: only save on mouseup)
  const pendingWidth = useRef<number | null>(null)
  const pendingPos = useRef<{ x: number; y: number } | null>(null)
  const pendingDock = useRef<'left' | 'right' | null>(null)
  useEffect(() => {
    const save = () => {
      if (pendingWidth.current !== null) {
        saveSharedWidth(pendingWidth.current)
        pendingWidth.current = null
      }
      if (pendingPos.current) {
        localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pendingPos.current))
        pendingPos.current = null
      }
      if (pendingDock.current !== undefined) {
        if (pendingDock.current) localStorage.setItem(DOCK_STORAGE_KEY, pendingDock.current)
        else localStorage.removeItem(DOCK_STORAGE_KEY)
        pendingDock.current = undefined as unknown as null
      }
    }
    window.addEventListener('mouseup', save)
    return () => window.removeEventListener('mouseup', save)
  }, [])
  useEffect(() => { pendingWidth.current = sz.w }, [sz.w])
  useEffect(() => { pendingPos.current = pos }, [pos])
  useEffect(() => { pendingDock.current = docked }, [docked])

  // drag & resize handlers
  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest('[data-drag]')) return
    // Ignore interactive elements (buttons, inputs, etc.) to prevent drag from button clicks
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input') || target.closest('a') || target.closest('label') || target.closest('[data-no-drag]')) return
    dragRef.current = true
    // When docked, calculate offset from current visual position
    const startX = docked === 'left' ? 0 : docked === 'right' ? window.innerWidth - sz.w : pos.x
    const startY = docked === 'left' || docked === 'right' ? 0 : pos.y
    dragOff.current = { x: e.clientX - startX, y: e.clientY - startY }
    if (docked) setDocked(null)
    e.preventDefault()
  }, [pos, docked, sz.w])

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (dragRef.current) {
        setPos({
          x: Math.max(0, Math.min(e.clientX - dragOff.current.x, window.innerWidth - sz.w)),
          y: Math.max(0, Math.min(e.clientY - dragOff.current.y, window.innerHeight - sz.h)),
        })
      }
      if (resizeRef.current) {
        setSz({
          w: Math.max(MIN_W, Math.min(MAX_W, resizeStart.current.w + (e.clientX - resizeStart.current.x))),
          h: Math.max(MIN_H, Math.min(MAX_H, resizeStart.current.h + (e.clientY - resizeStart.current.y))),
        })
      }
    }
    const up = () => {
      if (dragRef.current) {
        // Snap detection on drag end
        const finalX = pos.x
        const rightDist = window.innerWidth - (finalX + sz.w)
        if (finalX <= SNAP_THRESHOLD) {
          setDocked('left')
        } else if (rightDist <= SNAP_THRESHOLD) {
          setDocked('right')
        }
      }
      dragRef.current = false
      resizeRef.current = false
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [sz.w, sz.h, pos.x])

  const filteredTabs = useMemo(() => {
    if (!searchQuery.trim()) return workspaceTabs
    const q = searchQuery.trim().toLowerCase()
    return workspaceTabs.filter((t) => t.name.toLowerCase().includes(q))
  }, [workspaceTabs, searchQuery])

  const grouped = useMemo(() => {
    const groupMap = new Map<string | null, WorkspaceTab[]>()
    for (const tab of filteredTabs) {
      const key = tab.groupId ?? null
      if (!groupMap.has(key)) groupMap.set(key, [])
      groupMap.get(key)!.push(tab)
    }
    for (const arr of groupMap.values()) {
      arr.sort((a, b) => a.order - b.order)
    }
    const sortedGroups = [
      { group: null as WorkspaceTabGroup | null, tabs: groupMap.get(null) ?? [] },
      ...workspaceTabGroups
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((g) => ({ group: g, tabs: groupMap.get(g.id) ?? [] })),
    ]
    return sortedGroups.filter((sg) => sg.tabs.length > 0)
  }, [filteredTabs, workspaceTabGroups])

  useEffect(() => {
    const onDocClick = () => setContextMenu(null)
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null)
        clearWorkspaceTabSelection()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [clearWorkspaceTabSelection])

  const handleCreateTab = useCallback(() => {
    const id = createWorkspaceTab()
    showToast('已创建新标签页', 'success')
    return id
  }, [createWorkspaceTab, showToast])

  const handleCloseTab = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    closeWorkspaceTab(id)
  }, [closeWorkspaceTab])

  const handleDuplicate = useCallback((id: string) => {
    const newId = duplicateWorkspaceTab(id)
    if (newId) showToast('已复制标签页', 'success')
  }, [duplicateWorkspaceTab, showToast])

  const startInlineRename = useCallback((id: string) => {
    const tab = workspaceTabs.find((t) => t.id === id)
    if (!tab) return
    setEditingTabId(id)
    setEditingTabName(tab.name)
  }, [workspaceTabs])

  const cancelInlineRename = useCallback(() => {
    skipInlineRenameBlurRef.current = true
    setEditingTabId(null)
    setEditingTabName('')
  }, [])

  const commitInlineRename = useCallback(() => {
    if (!editingTabId) return
    const name = editingTabName.trim()
    if (!name) {
      showToast('名称不能为空', 'error')
      return
    }
    renameWorkspaceTab(editingTabId, name)
    skipInlineRenameBlurRef.current = true
    setEditingTabId(null)
    setEditingTabName('')
    showToast('已重命名', 'success')
  }, [editingTabId, editingTabName, renameWorkspaceTab, showToast])

  const handleRename = useCallback((id: string) => {
    const tab = workspaceTabs.find((t) => t.id === id)
    if (!tab) return
    setPromptInputDialog({
      title: '重命名标签页',
      label: '标签页名称',
      initialValue: tab.name,
      placeholder: '输入新名称',
      confirmText: '保存',
      action: (value) => {
        const name = value.trim()
        if (!name) {
          showToast('名称不能为空', 'error')
          return
        }
        renameWorkspaceTab(id, name)
        showToast('已重命名', 'success')
      },
    })
  }, [workspaceTabs, setPromptInputDialog, renameWorkspaceTab, showToast])

  const handleDelete = useCallback((id: string) => {
    const tab = workspaceTabs.find((t) => t.id === id)
    if (!tab) return
    setConfirmDialog({
      title: '关闭标签页',
      message: `确定要关闭「${tab.name}」吗？`,
      confirmText: '关闭',
      cancelText: '取消',
      tone: 'warning',
      action: () => closeWorkspaceTab(id),
    })
  }, [workspaceTabs, setConfirmDialog, closeWorkspaceTab])

  const handleMoveToGroup = useCallback((tabId: string, groupId: string | null) => {
    moveWorkspaceTabToGroup(tabId, groupId)
    setContextMenu(null)
  }, [moveWorkspaceTabToGroup])

  const handleCreateGroupAndMove = useCallback((tabId: string) => {
    setPromptInputDialog({
      title: '新建分组',
      label: '分组名称',
      placeholder: '输入分组名称',
      confirmText: '创建',
      action: (value) => {
        const name = value.trim()
        if (!name) {
          showToast('名称不能为空', 'error')
          return
        }
        const groupId = createWorkspaceTabGroup(name)
        moveWorkspaceTabToGroup(tabId, groupId)
        showToast('已创建分组并移动', 'success')
      },
    })
  }, [setPromptInputDialog, createWorkspaceTabGroup, moveWorkspaceTabToGroup, showToast])

  const handleTabContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, tabId })
  }, [])

  const onTabDragStart = useCallback((e: React.DragEvent, tabId: string) => {
    setDraggingTabId(tabId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', tabId)
  }, [])

  const onTabDragOver = useCallback((e: React.DragEvent, targetTabId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggingTabId && draggingTabId !== targetTabId) {
      setDragOverTabId(targetTabId)
    }
  }, [draggingTabId])

  const onDropOnTab = useCallback((e: React.DragEvent, targetTabId: string) => {
    e.preventDefault()
    const sourceId = e.dataTransfer.getData('text/plain') || draggingTabId
    setDragOverTabId(null)
    setDraggingTabId(null)
    if (!sourceId || sourceId === targetTabId) return
    const tabs = [...workspaceTabs]
    const sourceIndex = tabs.findIndex((t) => t.id === sourceId)
    const targetIndex = tabs.findIndex((t) => t.id === targetTabId)
    if (sourceIndex === -1 || targetIndex === -1) return
    const [moved] = tabs.splice(sourceIndex, 1)
    tabs.splice(targetIndex, 0, moved)
    reorderWorkspaceTabs(tabs)
  }, [draggingTabId, workspaceTabs, reorderWorkspaceTabs])

  const onDragLeaveTab = useCallback(() => {
    setDragOverTabId(null)
  }, [])

  const onDragEnd = useCallback(() => {
    setDraggingTabId(null)
    setDragOverTabId(null)
    setDragOverGroupId(null)
  }, [])

  const onGroupDragOver = useCallback((e: React.DragEvent, groupId: string | null) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverGroupId(groupId)
  }, [])

  const onGroupDrop = useCallback((e: React.DragEvent, groupId: string | null) => {
    e.preventDefault()
    const sourceId = e.dataTransfer.getData('text/plain') || draggingTabId
    setDragOverGroupId(null)
    setDraggingTabId(null)
    if (!sourceId) return
    moveWorkspaceTabToGroup(sourceId, groupId)
  }, [draggingTabId, moveWorkspaceTabToGroup])

  const handleBatchRun = useCallback(() => {
    if (selectedWorkspaceTabIds.length === 0) {
      showToast('请先选择要运行的标签页', 'info')
      return
    }
    setConfirmDialog({
      title: '批量运行',
      message: `确定要运行选中的 ${selectedWorkspaceTabIds.length} 个标签页吗？`,
      confirmText: '运行',
      cancelText: '取消',
      action: async () => {
        const { submitTaskWithData } = await import('../store')
        for (const tabId of selectedWorkspaceTabIds) {
          const tab = workspaceTabs.find((t) => t.id === tabId)
          if (!tab) continue
          await submitTaskWithData({
            prompt: tab.prompt,
            inputImages: tab.inputImages,
            inputImageFolder: tab.inputImageFolder,
            params: tab.params,
            maskDraft: tab.maskDraft,
            targetTabId: tab.id,
          })
        }
        clearWorkspaceTabSelection()
        showToast('批量运行已启动', 'success')
      },
    })
  }, [selectedWorkspaceTabIds, workspaceTabs, setConfirmDialog, showToast, clearWorkspaceTabSelection])

  useEffect(() => {
    const root = document.documentElement
    const leftVar = '--workspace-tabbar-left-width'
    const rightVar = '--workspace-tabbar-right-width'
    root.style.setProperty(leftVar, appMode === 'gallery' && docked === 'left' ? `${sz.w}px` : '0px')
    root.style.setProperty(rightVar, appMode === 'gallery' && docked === 'right' ? `${sz.w}px` : '0px')
    return () => {
      root.style.setProperty(leftVar, '0px')
      root.style.setProperty(rightVar, '0px')
    }
  }, [appMode, docked, sz.w])

  if (appMode !== 'gallery') return null

  const isDocked = Boolean(docked)
  const dockedStyle = isDocked
    ? {
        left: docked === 'left' ? 0 : undefined,
        right: docked === 'right' ? 0 : undefined,
        top: 'var(--app-header-offset)',
        height: 'calc(100vh - var(--app-header-offset))',
        borderRadius: 0,
        boxShadow: 'none',
        borderTop: 'none',
        borderBottom: 'none',
        borderLeft: docked === 'left' ? 'none' : undefined,
        borderRight: docked === 'right' ? 'none' : undefined,
      } as React.CSSProperties
    : {
        left: pos.x, top: pos.y,
        borderRadius: 16,
        boxShadow: '0 24px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.05), inset 0 1px 0 rgba(255,255,255,0.04)',
      } as React.CSSProperties

  return (
    <div
      ref={panelRef}
      className="fixed z-40 flex flex-col text-foreground overflow-hidden bg-background border border-border"
      style={{
        width: sz.w,
        minWidth: MIN_W,
        maxWidth: MAX_W,
        ...dockedStyle,
      }}
    >
      {/* ===== Header (drag) ===== */}
      <div
        data-drag
        onMouseDown={onDragStart}
        className="shrink-0 px-4 pt-4 pb-3 border-b cursor-move select-none border-border"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/15 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">标签页</h3>
              <p className="text-[11px] text-muted-foreground leading-tight">{workspaceTabs.length} 个标签页 · {workspaceTabGroups.length} 个分组</p>
            </div>
          </div>
        </div>

        {/* Toolbar buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCreateTab}
            title="创建标签页"
            className="flex-1 flex items-center justify-center gap-1 h-8 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors"
          >
            <PlusIcon className="w-3.5 h-3.5" />
            新建
          </button>
          <button
            onClick={() => setWorkspaceTabManagerOpen(true)}
            title="标签管理"
            className="flex-1 flex items-center justify-center gap-1 h-8 rounded-lg bg-muted hover:bg-muted/80 text-sidebar-foreground text-xs font-medium transition-colors border border-border"
          >
            <SettingsIcon className="w-3.5 h-3.5" />
            管理
          </button>
          <button
            onClick={handleBatchRun}
            title="批量运行选中标签页"
            className={`flex-1 flex items-center justify-center gap-1 h-8 rounded-lg text-xs font-medium transition-colors ${selectedWorkspaceTabIds.length > 0 ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-muted hover:bg-muted/80 text-sidebar-foreground border border-border'}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            运行
          </button>
        </div>

        {/* Search */}
        <div className="relative mt-2">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索标签页"
            className="w-full pl-9 pr-3 py-2 rounded-xl text-sm placeholder-muted-foreground transition focus:outline-none focus:ring-2 focus:ring-blue-500/25 bg-sidebar border border-border text-foreground"
          />
        </div>
      </div>

      {/* ===== Tab list ===== */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-2">
        {grouped.map(({ group, tabs }) => (
          <div
            key={group?.id ?? '__ungrouped__'}
            className={`mb-1 ${dragOverGroupId === (group?.id ?? null) ? 'bg-blue-500/10 rounded-md' : ''}`}
            onDragOver={(e) => onGroupDragOver(e, group?.id ?? null)}
            onDrop={(e) => onGroupDrop(e, group?.id ?? null)}
            onDragLeave={() => setDragOverGroupId(null)}
          >
            {group && (
              <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider truncate">
                {group.name}
              </div>
            )}
            {tabs.map((tab) => {
              const isActive = tab.id === activeWorkspaceTabId
              const isSelected = selectedWorkspaceTabIds.includes(tab.id)
              const isDragOver = dragOverTabId === tab.id
              const isEditing = editingTabId === tab.id
              return (
                <div
                  key={tab.id}
                  draggable={!isEditing}
                  onDragStart={(e) => onTabDragStart(e, tab.id)}
                  onDragOver={(e) => onTabDragOver(e, tab.id)}
                  onDrop={(e) => onDropOnTab(e, tab.id)}
                  onDragLeave={onDragLeaveTab}
                  onDragEnd={onDragEnd}
                  onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    startInlineRename(tab.id)
                  }}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                      toggleWorkspaceTabSelection(tab.id)
                    } else {
                      clearWorkspaceTabSelection()
                      setActiveWorkspaceTabId(tab.id)
                    }
                  }}
                  className={`
                    group relative flex items-center gap-2 mx-1 px-2.5 py-2 rounded-xl cursor-pointer select-none transition-colors border
                    ${isActive ? 'bg-blue-500/15 border-blue-500/35 text-blue-300' : 'border-transparent hover:bg-muted/50 text-sidebar-foreground'}
                    ${isSelected && !isActive ? 'ring-1 ring-blue-500/40' : ''}
                    ${isDragOver ? 'outline outline-1 outline-blue-500' : ''}
                  `}
                  title={tab.name}
                >
                  {isEditing ? (
                    <input
                      value={editingTabName}
                      autoFocus
                      onChange={(e) => setEditingTabName(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={() => {
                        if (skipInlineRenameBlurRef.current) {
                          skipInlineRenameBlurRef.current = false
                          return
                        }
                        commitInlineRename()
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitInlineRename()
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          cancelInlineRename()
                        }
                      }}
                      className="min-w-0 flex-1 rounded-md border border-blue-500/40 bg-background/80 px-1.5 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-blue-500/40"
                    />
                  ) : (
                    <span className="flex-1 text-xs truncate">{tab.name}</span>
                  )}
                  <button
                    onClick={(e) => handleCloseTab(e, tab.id)}
                    className={`opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity ${isActive ? 'text-blue-300' : 'text-muted-foreground'}`}
                    title="关闭"
                  >
                    <CloseIcon className="w-3 h-3" />
                  </button>
                </div>
              )
            })}
          </div>
        ))}
        {filteredTabs.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground text-center">
            {searchQuery ? '无匹配标签页' : '暂无标签页'}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-2">
        <button
          type="button"
          onClick={() => setScheduleModalOpen(true)}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted text-xs font-medium text-sidebar-foreground transition-colors hover:bg-muted/80"
          title="打开日程表"
        >
          <CalendarIcon className="h-4 w-4" />
          日程表
        </button>
      </div>

      {/* ===== Resize handle (hidden when docked) ===== */}
      {!isDocked && (
        <div
          onMouseDown={(e) => {
            resizeRef.current = true
            resizeStart.current = { x: e.clientX, y: e.clientY, w: sz.w, h: sz.h }
            e.preventDefault(); e.stopPropagation()
          }}
          className="absolute bottom-0 right-0 w-6 h-6 cursor-se-resize z-10 transition-opacity hover:opacity-100 opacity-60"
          style={{
            background: 'linear-gradient(135deg, transparent 55%, rgba(120,130,150,0.5) 55%)',
            borderBottomRightRadius: 14,
          }}
          title="拖拽调整大小"
        />
      )}

      {/* ===== Context menu ===== */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-lg border border-border bg-sidebar shadow-xl py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <ContextMenuItem
            icon={<CopyIcon className="w-3.5 h-3.5" />}
            label="复制"
            onClick={() => {
              handleDuplicate(contextMenu.tabId)
              setContextMenu(null)
            }}
          />
          <ContextMenuItem
            icon={<EditIcon className="w-3.5 h-3.5" />}
            label="重命名"
            onClick={() => {
              handleRename(contextMenu.tabId)
              setContextMenu(null)
            }}
          />
          <div className="h-px bg-border my-1" />
          {workspaceTabGroups.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] text-muted-foreground">移动到分组</div>
              <ContextMenuItem
                icon={<span className="w-3.5 h-3.5 rounded-full border border-current" />}
                label="未分组"
                onClick={() => handleMoveToGroup(contextMenu.tabId, null)}
              />
              {workspaceTabGroups.map((g) => (
                <ContextMenuItem
                  key={g.id}
                  icon={<span className="w-3.5 h-3.5 rounded-full border border-current" />}
                  label={g.name}
                  onClick={() => handleMoveToGroup(contextMenu.tabId, g.id)}
                />
              ))}
              <ContextMenuItem
                icon={<PlusIcon className="w-3.5 h-3.5" />}
                label="新建分组..."
                onClick={() => {
                  handleCreateGroupAndMove(contextMenu.tabId)
                  setContextMenu(null)
                }}
              />
              <div className="h-px bg-border my-1" />
            </>
          )}
          <ContextMenuItem
            icon={<TrashIcon className="w-3.5 h-3.5" />}
            label="关闭"
            tone="danger"
            onClick={() => {
              handleDelete(contextMenu.tabId)
              setContextMenu(null)
            }}
          />
        </div>
      )}
    </div>
  )
}

function ContextMenuItem({
  icon,
  label,
  tone,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  tone?: 'danger'
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors ${tone === 'danger' ? 'text-red-400' : 'text-sidebar-foreground'}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
