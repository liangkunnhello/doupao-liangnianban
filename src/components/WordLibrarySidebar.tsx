import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { useStore } from '../store'
import {
  Button,
  CloseIcon,
  IconButton,
  LibraryIcon,
  ListChecksIcon,
  StarIcon,
} from '../design-system'
import {
  createVariableMention,
  parseVariableMention,
  resolveVariableMentionEntry,
  VAR_MENTION_RE,
} from '../lib/promptImageMentions'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { filterGalleryTasks } from '../lib/galleryTaskFilter'
import {
  filterWordLibraryEntries,
  WordLibraryQuickPanel,
  type WordLibraryQuickView,
} from './WordLibraryQuickPanel'
import type { WordLibraryEntry } from '../types'
import GalleryTaskNavigator from './GalleryTaskNavigator'

const MIN_W = 300
const MIN_H = 520
const MAX_W = 600
const MAX_H = 860
const DEFAULT_W = 340
const DEFAULT_H = 760
const SNAP_THRESHOLD = 10
const SHARED_WIDTH_KEY = 'floating_panel_width_v1'
const POS_STORAGE_KEY = 'wordLibrarySidebar_pos_v2'
const DOCK_STORAGE_KEY = 'wordLibrarySidebar_dock_v1'

function loadSavedWidth(): number {
  try {
    const raw = localStorage.getItem(SHARED_WIDTH_KEY)
    const value = raw ? JSON.parse(raw) : null
    if (typeof value === 'number') return Math.max(MIN_W, Math.min(MAX_W, value))
  } catch {
    // Ignore invalid local preferences and use the safe default.
  }
  return DEFAULT_W
}

function loadSavedPosition() {
  try {
    const raw = localStorage.getItem(POS_STORAGE_KEY)
    const value = raw ? JSON.parse(raw) : null
    if (typeof value?.x === 'number' && typeof value?.y === 'number') {
      return {
        x: Math.max(0, Math.min(window.innerWidth - DEFAULT_W, value.x)),
        y: Math.max(0, Math.min(window.innerHeight - DEFAULT_H, value.y)),
      }
    }
  } catch {
    // Ignore invalid local preferences and use the safe default.
  }
  return { x: Math.max(0, window.innerWidth - DEFAULT_W - 24), y: 72 }
}

function loadSavedDock(): 'left' | 'right' | null {
  try {
    const value = localStorage.getItem(DOCK_STORAGE_KEY)
    if (value === 'left' || value === 'right') return value
    if (value === null) return 'right'
  } catch {
    // Ignore invalid local preferences and use the safe default.
  }
  return null
}

function getPromptEditor(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-input-bar] [contenteditable]')
}

function promptEditorHasSelection() {
  const editor = getPromptEditor()
  const selection = window.getSelection()
  return Boolean(
    editor
    && selection
    && selection.rangeCount > 0
    && !selection.getRangeAt(0).collapsed
    && editor.contains(selection.anchorNode),
  )
}

function readPromptEditor(editor: HTMLElement) {
  let plain = ''
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      plain += node.textContent ?? ''
      return
    }
    const element = node as HTMLElement
    if (element.classList?.contains('mention-tag')) {
      plain += element.dataset.mentionText ?? element.textContent ?? ''
      return
    }
    if (element.classList?.contains('wildcard-var')) {
      plain += createVariableMention(element.dataset.varName ?? element.textContent ?? '', element.dataset.entryId)
      return
    }
    node.childNodes.forEach(walk)
  }
  editor.childNodes.forEach(walk)
  return plain.replace(/\r\n?/g, '\n')
}

export default function WordLibrarySidebar() {
  const compactViewport = useMediaQuery('(max-width: 1023px)')
  const appMode = useStore((state) => state.appMode)
  const galleryViewMode = useStore((state) => state.galleryViewMode)
  const galleryActiveTaskId = useStore((state) => state.galleryActiveTaskId)
  const setGalleryNavigateTaskId = useStore((state) => state.setGalleryNavigateTaskId)
  const activeWorkspaceTabId = useStore((state) => state.activeWorkspaceTabId)
  const workspaceTabs = useStore((state) => state.workspaceTabs)
  const allTasks = useStore((state) => state.tasks)
  const searchQuery = useStore((state) => state.searchQuery)
  const filterStatus = useStore((state) => state.filterStatus)
  const filterFavorite = useStore((state) => state.filterFavorite)
  const activeFavoriteCollectionId = useStore((state) => state.activeFavoriteCollectionId)
  const groups = useStore((state) => state.wordLibraryGroups)
  const entries = useStore((state) => state.wordLibraryEntries)
  const managerOpen = useStore((state) => state.wordLibraryManagerOpen)
  const setManagerOpen = useStore((state) => state.setWordLibraryManagerOpen)
  const setManagerEntryId = useStore((state) => state.setWordLibraryEditEntryId)
  const setPrompt = useStore((state) => state.setPrompt)
  const toast = useStore((state) => state.showToast)
  const toggleFavorite = useStore((state) => state.toggleWordLibraryEntryFavorite)
  const updateEntry = useStore((state) => state.updateWordLibraryEntry)
  const touchUsage = useStore((state) => state.touchWordLibraryEntryUsage)
  const promptSelectedEntryId = useStore((state) => state.wordLibraryEditEntryId)
  const promptSelectedVarName = useStore((state) => state.wordLibraryPromptSelectedVarName)
  const setPromptSelectedVarName = useStore((state) => state.setWordLibraryPromptSelectedVarName)

  const [compactOpen, setCompactOpen] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<'tasks' | 'words'>('words')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<WordLibraryQuickView>('recent')
  const [groupId, setGroupId] = useState('__all__')
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [hasPromptSelection, setHasPromptSelection] = useState(false)
  const [position, setPosition] = useState(loadSavedPosition)
  const [size, setSize] = useState(() => ({ width: loadSavedWidth(), height: DEFAULT_H }))
  const [docked, setDocked] = useState<'left' | 'right' | null>(loadSavedDock)

  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef(false)
  const resizeRef = useRef(false)
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const resizeStartRef = useRef({ x: 0, y: 0, width: DEFAULT_W, height: DEFAULT_H })
  const lastPromptRef = useRef('')
  const lastAddedEntryNameRef = useRef<string | null>(null)

  const visibleEntries = useMemo(
    () => filterWordLibraryEntries({ entries, query, view, groupId }),
    [entries, groupId, query, view],
  )
  const activeEntries = useMemo(
    () => entries.filter((entry) => entry.deletedAt == null),
    [entries],
  )
  const activeGroups = useMemo(
    () => groups.filter((group) => !group.archivedAt),
    [groups],
  )
  const tabTasks = useMemo(
    () => workspaceTabs.find((tab) => tab.id === activeWorkspaceTabId)?.tasks ?? [],
    [activeWorkspaceTabId, workspaceTabs],
  )
  const taskSource = filterFavorite ? allTasks : activeWorkspaceTabId ? tabTasks : allTasks
  const navigatorTasks = useMemo(() => filterGalleryTasks({
    tasks: taskSource,
    query: searchQuery,
    filterStatus,
    filterFavorite,
    activeFavoriteCollectionId,
  }), [activeFavoriteCollectionId, filterFavorite, filterStatus, searchQuery, taskSource])
  const navigatorTasksWithImages = useMemo(
    () => navigatorTasks.filter((task) => task.outputImages.length > 0),
    [navigatorTasks],
  )
  const navigatorImageCount = useMemo(
    () => navigatorTasksWithImages.reduce((count, task) => count + task.outputImages.length, 0),
    [navigatorTasksWithImages],
  )
  const showGalleryTaskTab = appMode === 'gallery' && galleryViewMode === 'images'

  useEffect(() => {
    setSidebarTab(showGalleryTaskTab ? 'tasks' : 'words')
  }, [showGalleryTaskTab])

  useEffect(() => {
    if (visibleEntries.some((entry) => entry.id === activeEntryId)) return
    setActiveEntryId(visibleEntries[0]?.id ?? null)
  }, [activeEntryId, visibleEntries])

  useEffect(() => {
    const updateSelectionState = () => setHasPromptSelection(promptEditorHasSelection())
    document.addEventListener('selectionchange', updateSelectionState)
    return () => document.removeEventListener('selectionchange', updateSelectionState)
  }, [])

  useEffect(() => {
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (state.prompt === previous.prompt || state.prompt === lastPromptRef.current) return
      lastPromptRef.current = state.prompt
      for (const match of state.prompt.matchAll(VAR_MENTION_RE)) {
        const mention = parseVariableMention(match[1])
        if (mention.entryId || state.wordLibraryEntries.some((entry) => entry.key === mention.varName)) continue
        const entry = state.createWordLibraryEntry('default', mention.varName)
        state.updateWordLibraryEntry(entry.id, { entries: [mention.varName] })
        lastAddedEntryNameRef.current = mention.varName
      }
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribe = useStore.subscribe((state) => {
      const entryName = lastAddedEntryNameRef.current
      if (!entryName) return
      const entry = state.wordLibraryEntries.find((item) => item.key === entryName && item.deletedAt == null)
      if (!entry) return
      lastAddedEntryNameRef.current = null
      setView('all')
      setGroupId('__all__')
      setQuery('')
      setActiveEntryId(entry.id)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (managerOpen || !promptSelectedEntryId) return
    const entry = activeEntries.find((item) => item.id === promptSelectedEntryId)
    if (entry) {
      setView('all')
      setGroupId('__all__')
      setQuery('')
      setActiveEntryId(entry.id)
    }
    setManagerEntryId(null)
  }, [activeEntries, managerOpen, promptSelectedEntryId, setManagerEntryId])

  useEffect(() => {
    if (!promptSelectedVarName) return
    const entry = resolveVariableMentionEntry(promptSelectedVarName, undefined, activeEntries)
    if (entry) {
      setView('all')
      setGroupId('__all__')
      setQuery('')
      setActiveEntryId(entry.id)
    }
    setPromptSelectedVarName(null)
  }, [activeEntries, promptSelectedVarName, setPromptSelectedVarName])

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--word-library-left-width', !compactViewport && docked === 'left' ? `${size.width}px` : '0px')
    root.style.setProperty('--word-library-right-width', !compactViewport && docked === 'right' ? `${size.width}px` : '0px')
    return () => {
      root.style.setProperty('--word-library-left-width', '0px')
      root.style.setProperty('--word-library-right-width', '0px')
    }
  }, [compactViewport, docked, size.width])

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (dragRef.current) {
        setPosition({
          x: Math.max(0, Math.min(event.clientX - dragOffsetRef.current.x, window.innerWidth - size.width)),
          y: Math.max(0, Math.min(event.clientY - dragOffsetRef.current.y, window.innerHeight - size.height)),
        })
      }
      if (resizeRef.current) {
        setSize({
          width: Math.max(MIN_W, Math.min(MAX_W, resizeStartRef.current.width + event.clientX - resizeStartRef.current.x)),
          height: Math.max(MIN_H, Math.min(MAX_H, resizeStartRef.current.height + event.clientY - resizeStartRef.current.y)),
        })
      }
    }
    const stop = () => {
      if (dragRef.current) {
        setPosition((current) => {
          const rightDistance = window.innerWidth - current.x - size.width
          if (current.x <= SNAP_THRESHOLD) setDocked('left')
          else if (rightDistance <= SNAP_THRESHOLD) setDocked('right')
          localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(current))
          return current
        })
      }
      if (resizeRef.current) localStorage.setItem(SHARED_WIDTH_KEY, JSON.stringify(size.width))
      dragRef.current = false
      resizeRef.current = false
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
    }
  }, [size.height, size.width])

  useEffect(() => {
    if (docked) localStorage.setItem(DOCK_STORAGE_KEY, docked)
    else localStorage.removeItem(DOCK_STORAGE_KEY)
  }, [docked])

  const beginDrag = (event: ReactMouseEvent) => {
    if ((event.target as HTMLElement).closest('button, input, select')) return
    const panel = panelRef.current?.getBoundingClientRect()
    if (!panel) return
    dragRef.current = true
    dragOffsetRef.current = { x: event.clientX - panel.left, y: event.clientY - panel.top }
    setPosition({ x: panel.left, y: panel.top })
    if (docked) setDocked(null)
    event.preventDefault()
  }

  const writeMarkerAtSelection = useCallback((marker: string, replaceSelection: boolean) => {
    const editor = getPromptEditor()
    if (!editor) return false
    const selection = window.getSelection()
    const selectionInsideEditor = Boolean(selection?.rangeCount && editor.contains(selection.anchorNode))
    if (!selectionInsideEditor) {
      editor.focus()
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
    const range = selection!.getRangeAt(0)
    if (replaceSelection && !range.collapsed) range.deleteContents()
    else if (!range.collapsed) range.collapse(false)
    const node = document.createTextNode(marker)
    range.insertNode(node)
    range.setStartAfter(node)
    range.collapse(true)
    selection!.removeAllRanges()
    selection!.addRange(range)
    setPrompt(readPromptEditor(editor))
    return true
  }, [setPrompt])

  const invokeEntry = useCallback((entry: WordLibraryEntry) => {
    const marker = createVariableMention(entry.key, entry.id)
    const replaceSelection = promptEditorHasSelection()
    if (!writeMarkerAtSelection(marker, replaceSelection)) {
      setPrompt(`${useStore.getState().prompt}${marker}`)
    }
    touchUsage(entry.id)
    setHasPromptSelection(false)
    toast(replaceSelection ? '已替换为词条' : '已插入词条', 'success')
  }, [setPrompt, toast, touchUsage, writeMarkerAtSelection])

  const openManager = (entryId?: string) => {
    setManagerEntryId(entryId ?? null)
    setManagerOpen(true)
  }

  if (compactViewport && !compactOpen) {
    return (
      <IconButton
        aria-label={showGalleryTaskTab ? '打开任务导航' : '打开词条库'}
        icon={showGalleryTaskTab ? <ListChecksIcon className="h-4 w-4" /> : <StarIcon className="h-4 w-4" />}
        onClick={() => setCompactOpen(true)}
        className="fixed right-2 top-[calc(var(--app-header-offset)+var(--ds-space-2))] z-[var(--ds-z-overlay)] border border-[hsl(var(--ds-color-border))] bg-[hsl(var(--ds-color-surface-raised))] shadow-[var(--ds-shadow-md)]"
      />
    )
  }

  const isDocked = Boolean(docked)
  const taskTabActive = showGalleryTaskTab && sidebarTab === 'tasks'
  const panelStyle: CSSProperties = compactViewport
    ? {
        right: 'var(--ds-space-2)',
        top: 'calc(var(--app-header-offset) + var(--ds-space-2))',
        width: 'min(420px, calc(100% - var(--ds-space-4)))',
        height: 'calc(100dvh - var(--app-header-offset) - var(--ds-space-4))',
        borderRadius: 'var(--ds-radius-xl)',
        boxShadow: 'var(--ds-shadow-lg)',
      }
    : isDocked
      ? {
          left: docked === 'left' ? 0 : undefined,
          right: docked === 'right' ? 0 : undefined,
          top: 'var(--app-header-offset)',
          width: size.width,
          height: 'calc(100vh - var(--app-header-offset))',
          borderRadius: 0,
        }
      : {
          left: position.x,
          top: position.y,
          width: size.width,
          height: size.height,
          borderRadius: 'var(--ds-radius-xl)',
          boxShadow: 'var(--ds-shadow-lg)',
        }

  return (
    <div
      ref={panelRef}
      className="doupao-side-panel fixed z-40 flex flex-col overflow-hidden"
      data-docked={docked ?? undefined}
      style={panelStyle}
    >
      <header className="doupao-side-panel__header shrink-0 select-none" onMouseDown={beginDrag}>
        <div className="flex items-center gap-3">
          <div className="doupao-side-panel__icon">
            {taskTabActive ? <ListChecksIcon className="h-4 w-4" /> : <LibraryIcon className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="doupao-side-panel__title">{taskTabActive ? '任务导航' : '词条库'}</h3>
            <p className="doupao-side-panel__meta">
              {taskTabActive
                ? `${navigatorTasksWithImages.length} 个任务 · ${navigatorImageCount} 张图片`
                : `${activeEntries.length} 个词条 · ${activeGroups.length} 个分组`}
            </p>
          </div>
          {!taskTabActive && <Button size="sm" variant="secondary" onClick={() => openManager()}>管理</Button>}
          {compactViewport && (
            <IconButton
              aria-label="关闭右侧边栏"
              icon={<CloseIcon className="h-4 w-4" />}
              size="sm"
              onClick={() => setCompactOpen(false)}
            />
          )}
        </div>
      </header>

      {showGalleryTaskTab && (
        <div
          role="tablist"
          aria-label="右侧边栏内容"
          className="relative grid h-10 shrink-0 grid-cols-2 border-b border-ds-border px-2"
        >
          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === 'tasks'}
            className="relative z-10 text-xs font-medium text-ds-muted transition-colors aria-selected:text-ds-text"
            onClick={() => setSidebarTab('tasks')}
          >任务</button>
          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === 'words'}
            className="relative z-10 text-xs font-medium text-ds-muted transition-colors aria-selected:text-ds-text"
            onClick={() => setSidebarTab('words')}
          >词条</button>
          <span
            aria-hidden="true"
            className="absolute bottom-0 left-2 h-0.5 w-[calc(50%-0.5rem)] bg-ds-primary transition-transform duration-150 ease-out motion-reduce:transition-none"
            style={{ transform: sidebarTab === 'tasks' ? 'translateX(0)' : 'translateX(100%)' }}
          />
        </div>
      )}

      {taskTabActive ? (
        <GalleryTaskNavigator
          tasks={navigatorTasks}
          activeTaskId={galleryActiveTaskId}
          onNavigate={setGalleryNavigateTaskId}
        />
      ) : (
        <WordLibraryQuickPanel
          entries={entries}
          groups={groups}
          query={query}
          view={view}
          groupId={groupId}
          activeEntryId={activeEntryId}
          hasPromptSelection={hasPromptSelection}
          onQueryChange={setQuery}
          onViewChange={setView}
          onGroupChange={setGroupId}
          onSelect={setActiveEntryId}
          onInvoke={invokeEntry}
          onSaveEntries={(entryId, nextEntries) => {
            updateEntry(entryId, { entries: [...new Set(nextEntries)] })
            toast('词条候选值已保存', 'success')
          }}
          onToggleFavorite={toggleFavorite}
          onManage={openManager}
        />
      )}

      {!isDocked && !compactViewport && (
        <div
          aria-hidden="true"
          className="absolute bottom-0 right-0 z-10 h-6 w-6 cursor-se-resize opacity-60"
          style={{
            background: 'linear-gradient(135deg, transparent 55%, hsl(var(--ds-color-text-muted) / 0.55) 55%)',
            borderBottomRightRadius: 'var(--ds-radius-xl)',
          }}
          onMouseDown={(event) => {
            resizeRef.current = true
            resizeStartRef.current = {
              x: event.clientX,
              y: event.clientY,
              width: size.width,
              height: size.height,
            }
            event.preventDefault()
            event.stopPropagation()
          }}
        />
      )}
    </div>
  )
}
