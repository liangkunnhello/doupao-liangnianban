import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useStore } from '../store'
import { CloseIcon, FavoriteIcon, DragHandleIcon, HistoryIcon, ChevronDownIcon } from './icons'
import { Checkbox } from './Checkbox'
import { createVariableMention, parseVariableMention, VAR_MENTION_RE, VAR_START, VAR_END } from '../lib/promptImageMentions'
import { replaceVariableNameInPrompt } from '../lib/promptVariableEditor'
import { getAgentApiProfile, validateApiProfile } from '../lib/apiProfiles'
import { generateDerivedWordEntries } from '../lib/agentApi'
import type { WordLibraryDerivativeRule, WordLibrarySortType } from '../types'

const COLOR_CLASSES = [
  'bg-emerald-500', 'bg-orange-500', 'bg-blue-500',
  'bg-purple-500', 'bg-pink-500', 'bg-cyan-500',
]
function getColorClass(index: number) {
  return COLOR_CLASSES[index % COLOR_CLASSES.length]
}

function parseEntryLines(text: string): string[] {
  return text.split('\n').map((s) => s.trim()).filter(Boolean)
}

function mergeEntryLines(currentText: string, generated: string[]): string {
  const lines = parseEntryLines(currentText)
  const seen = new Set(lines)
  for (const item of generated) {
    const value = item.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    lines.push(value)
  }
  return lines.join('\n')
}

const MIN_W = 280
const MIN_H = 420
const MAX_W = 600
const MAX_H = 860
const DEFAULT_W = 320
const DEFAULT_H = MAX_H

const SHARED_WIDTH_KEY = 'floating_panel_width_v1'
const POS_STORAGE_KEY = 'wordLibrarySidebar_pos_v2'
const DOCK_STORAGE_KEY = 'wordLibrarySidebar_dock_v1'
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
  return 'right'
}

export default function WordLibrarySidebar() {
  const groups = useStore((s) => s.wordLibraryGroups)
  const entries = useStore((s) => s.wordLibraryEntries)
  const createEntry = useStore((s) => s.createWordLibraryEntry)
  const updateEntry = useStore((s) => s.updateWordLibraryEntry)
  const deleteEntry = useStore((s) => s.deleteWordLibraryEntry)
  const createGroup = useStore((s) => s.createWordLibraryGroup)
  const setManagerOpen = useStore((s) => s.setWordLibraryManagerOpen)
  const setPrompt = useStore((s) => s.setPrompt)
  const toast = useStore((s) => s.showToast)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const batchDeleteEntries = useStore((s) => s.batchDeleteWordLibraryEntries)
  const batchMoveEntries = useStore((s) => s.batchMoveWordLibraryEntries)
  const reorderEntries = useStore((s) => s.reorderWordLibraryEntries)
  const togglePinned = useStore((s) => s.toggleWordLibraryEntryPinned)
  const toggleFavorite = useStore((s) => s.toggleWordLibraryEntryFavorite)
  const batchAddTags = useStore((s) => s.batchAddTagsToWordLibraryEntries)
  const restoreEntries = useStore((s) => s.restoreWordLibraryEntries)
  const destroyEntries = useStore((s) => s.destroyWordLibraryEntries)
  const emptyTrash = useStore((s) => s.emptyWordLibraryTrash)
  const exportLibrary = useStore((s) => s.exportWordLibrary)
  const importLibrary = useStore((s) => s.importWordLibrary)
  const duplicateEntries = useStore((s) => s.duplicateWordLibraryEntries)
  const batchPinEntries = useStore((s) => s.batchPinWordLibraryEntries)
  const reorderGroups = useStore((s) => s.reorderWordLibraryGroups)
  const cleanupTrash = useStore((s) => s.cleanupExpiredWordLibraryTrash)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const promptSelectedEntryId = useStore((s) => s.wordLibraryEditEntryId)
  const setPromptSelectedEntryId = useStore((s) => s.setWordLibraryEditEntryId)
  const promptSelectedVarName = useStore((s) => s.wordLibraryPromptSelectedVarName)
  const setPromptSelectedVarName = useStore((s) => s.setWordLibraryPromptSelectedVarName)

  const [search, setSearch] = useState('')
  const [selGroup, setSelGroup] = useState<string>('__all__')
  const [activeId, setActiveId] = useState<string | null>(null)

  const [editKey, setEditKey] = useState('')
  const [editGroupId, setEditGroupId] = useState('')
  const [editDraw, setEditDraw] = useState(1)
  const [editText, setEditText] = useState('')
  const [deriveSimilarity, setDeriveSimilarity] = useState(85)
  const [deriveCount, setDeriveCount] = useState(6)
  const [deriveLoading, setDeriveLoading] = useState(false)
  const [derivedEntries, setDerivedEntries] = useState<string[]>([])
  const [derivedClosing, setDerivedClosing] = useState(false)
  const [ruleModalOpen, setRuleModalOpen] = useState(false)
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)

  // ===== 管理 / 批量 =====
  const [mode, setMode] = useState<'browse' | 'manage'>('browse')
  const [view, setView] = useState<'list' | 'trash'>('list')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [trashSelectedIds, setTrashSelectedIds] = useState<string[]>([])
  const [sortType, setSortType] = useState<WordLibrarySortType>('manual')
  const [lastClickedIndex, setLastClickedIndex] = useState<number | null>(null)
  const [moveMenuOpen, setMoveMenuOpen] = useState(false)
  const [tagMenuOpen, setTagMenuOpen] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const moveMenuRef = useRef<HTMLDivElement>(null)
  const tagMenuRef = useRef<HTMLDivElement>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  // ===== 分组拖拽排序 =====
  const [dragGroupId, setDragGroupId] = useState<string | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [groupOpen, setGroupOpen] = useState(false)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const groupRef = useRef<HTMLDivElement>(null)

  const [pos, setPos] = useState(() => loadSavedPos() ?? { x: 0, y: 0 })
  const [sz, setSz] = useState(() => loadSavedSize() ?? { w: DEFAULT_W, h: DEFAULT_H })
  const [docked, setDocked] = useState<'left' | 'right' | null>('right')
  const dragRef = useRef(false)
  const resizeRef = useRef(false)
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 })
  const dragOff = useRef({ x: 0, y: 0 })
  const panelRef = useRef<HTMLDivElement>(null)
  const derivedCloseTimerRef = useRef<number | null>(null)

  const lastPrompt = useRef('')
  const autoCreated = useRef<Set<string>>(new Set())
  const lastAdded = useRef<string | null>(null)
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // persist size, position and dock state (debounced: only save on mouseup / close)
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

  useEffect(() => () => {
    if (derivedCloseTimerRef.current != null) window.clearTimeout(derivedCloseTimerRef.current)
  }, [])

  // drag & resize handlers
  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest('[data-drag]')) return
    dragRef.current = true
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

  const sortedEntries = useMemo(() => {
    let list = entries.filter((e) => (view === 'trash' ? e.deletedAt != null : e.deletedAt == null))
    if (view !== 'trash' && selGroup !== '__all__') list = list.filter((e) => e.groupId === selGroup)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((e) =>
        e.key.toLowerCase().includes(q) ||
        e.label.toLowerCase().includes(q) ||
        e.entries.some((it) => it.toLowerCase().includes(q)) ||
        e.tags.some((t) => t.toLowerCase().includes(q)),
      )
    }
    if (view === 'trash') {
      list.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
      return list
    }
    const sorted = [...list]
    if (sortType === 'title') sorted.sort((a, b) => a.key.localeCompare(b.key, 'zh-CN'))
    else if (sortType === 'createdAt') sorted.sort((a, b) => b.createdAt - a.createdAt)
    else if (sortType === 'updatedAt') sorted.sort((a, b) => b.updatedAt - a.updatedAt)
    else if (sortType === 'usage') sorted.sort((a, b) => b.usageCount - a.usageCount)
    else sorted.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
      return a.sortOrder - b.sortOrder
    })
    return sorted
  }, [entries, view, selGroup, search, sortType])

  const isManage = mode === 'manage' && view === 'list'
  const isTrash = view === 'trash'
  const activeSelectedIds = isTrash ? trashSelectedIds : selectedIds
  const setActiveSelectedIds = isTrash ? setTrashSelectedIds : setSelectedIds
  const allSelected = sortedEntries.length > 0 && sortedEntries.every((e) => activeSelectedIds.includes(e.id))
  const someSelected = activeSelectedIds.length > 0 && !allSelected

  const toggleSelect = useCallback((id: string, index: number, shiftKey: boolean) => {
    setActiveSelectedIds((prev) => {
      if (shiftKey && lastClickedIndex != null && lastClickedIndex !== index) {
        const [a, b] = [lastClickedIndex, index].sort((x, y) => x - y)
        const rangeIds = sortedEntries.slice(a, b + 1).map((e) => e.id)
        const everyInRange = rangeIds.every((rid) => prev.includes(rid))
        const next = new Set(prev)
        if (everyInRange) rangeIds.forEach((rid) => next.delete(rid))
        else rangeIds.forEach((rid) => next.add(rid))
        return [...next]
      }
      setLastClickedIndex(index)
      return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    })
  }, [lastClickedIndex, sortedEntries, setActiveSelectedIds])

  const toggleSelectAll = useCallback(() => {
    setActiveSelectedIds(allSelected ? [] : sortedEntries.map((e) => e.id))
  }, [allSelected, sortedEntries, setActiveSelectedIds])

  const canDragReorder = isManage && sortType === 'manual' && selGroup === '__all__'
  const onRowDragStart = useCallback((id: string) => (e: React.DragEvent) => {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
  }, [])
  const onRowDragOver = useCallback((id: string) => (e: React.DragEvent) => {
    e.preventDefault()
    if (id !== dragOverId) setDragOverId(id)
  }, [dragOverId])
  const onRowDrop = useCallback((id: string) => (e: React.DragEvent) => {
    e.preventDefault()
    if (!dragId || dragId === id) { setDragId(null); setDragOverId(null); return }
    const ids = sortedEntries.map((x) => x.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(id)
    if (from < 0 || to < 0) { setDragId(null); setDragOverId(null); return }
    ids.splice(to, 0, ids.splice(from, 1)[0])
    reorderEntries(ids)
    setDragId(null); setDragOverId(null)
  }, [dragId, dragOverId, sortedEntries, reorderEntries])

  // close move / tag menus on outside click
  useEffect(() => {
    if (!moveMenuOpen && !tagMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (moveMenuRef.current && !moveMenuRef.current.contains(e.target as Node)) setMoveMenuOpen(false)
      if (tagMenuRef.current && !tagMenuRef.current.contains(e.target as Node)) setTagMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [moveMenuOpen, tagMenuOpen])

  const confirmBatchDelete = useCallback(() => {
    const ids = selectedIds
    if (ids.length === 0) return
    setConfirmDialog({
      title: `确认删除选中的 ${ids.length} 个词条？`,
      message: '删除后可在「回收站」中恢复。',
      confirmText: '删除',
      tone: 'danger',
      action: () => {
        batchDeleteEntries(ids)
        setSelectedIds([])
        toast(`已删除 ${ids.length} 个词条`, 'success')
      },
    })
  }, [selectedIds, batchDeleteEntries, setConfirmDialog, toast])

  const confirmEmptyTrash = useCallback(() => {
    const count = entries.filter((e) => e.deletedAt != null).length
    if (count === 0) return
    setConfirmDialog({
      title: `确认清空回收站？`,
      message: `将永久删除 ${count} 个词条，此操作不可恢复。`,
      confirmText: '永久删除',
      tone: 'danger',
      action: () => {
        emptyTrash()
        setTrashSelectedIds([])
        toast('回收站已清空', 'success')
      },
    })
  }, [entries, emptyTrash, setConfirmDialog, toast])

  const applyMove = useCallback((groupId: string) => {
    const g = groups.find((x) => x.id === groupId)
    const ids = selectedIds
    batchMoveEntries(ids, groupId)
    setMoveMenuOpen(false)
    setSelectedIds([])
    setSelGroup('__all__')
    toast(`已移动 ${ids.length} 个词条到「${g?.name ?? '分组'}」`, 'success')
  }, [selectedIds, batchMoveEntries, groups, setSelGroup, toast])

  const applyTags = useCallback(() => {
    const tags = tagInput.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean)
    if (tags.length === 0) { setTagMenuOpen(false); return }
    batchAddTags(selectedIds, tags)
    toast(`已为 ${selectedIds.length} 个词条添加标签`, 'success')
    setTagInput('')
    setTagMenuOpen(false)
    setSelectedIds([])
  }, [tagInput, batchAddTags, selectedIds, toast])

  // ===== 导入 / 导出 =====
  const onExport = useCallback(() => {
    const data = exportLibrary()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    a.href = url
    a.download = `word-library-${ts}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast('已导出词条库', 'success')
  }, [exportLibrary, toast])

  const onImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        setConfirmDialog({
          title: '导入词条库',
          message: '选择「合并导入」按 id 合并（保留现有数据），或「整体替换」覆盖当前词条库。',
          buttons: [
            {
              label: '合并导入',
              tone: 'primary',
              action: () => {
                const r = importLibrary(parsed, 'merge')
                toast(`已合并导入：新增 ${r.added} 条、更新 ${r.updated} 条、新增 ${r.groupsAdded} 个分组`, 'success')
              },
            },
            {
              label: '整体替换',
              tone: 'warning',
              action: () => {
                const r = importLibrary(parsed, 'replace')
                toast(`已替换词条库：${r.added} 条词条、${r.groupsAdded} 个分组`, 'success')
              },
            },
            { label: '取消', tone: 'secondary', action: () => {} },
          ],
        })
      } catch {
        toast('文件解析失败：不是有效的词条库 JSON', 'error')
      }
    }
    reader.readAsText(file)
  }, [importLibrary, setConfirmDialog, toast])

  // ===== 批量复制 / 批量置顶 =====
  const applyDuplicate = useCallback(() => {
    const ids = selectedIds
    if (ids.length === 0) return
    const n = duplicateEntries(ids)
    setSelectedIds([])
    toast(`已复制 ${n} 个词条`, 'success')
  }, [selectedIds, duplicateEntries, toast])

  const applyBatchPin = useCallback(() => {
    const ids = selectedIds
    if (ids.length === 0) return
    batchPinEntries(ids)
    toast(`已置顶 ${ids.length} 个词条`, 'success')
  }, [selectedIds, batchPinEntries, toast])

  // ===== 分组拖拽排序 =====
  const onGroupDragStart = useCallback((id: string) => (e: React.DragEvent) => {
    setDragGroupId(id)
    e.dataTransfer.effectAllowed = 'move'
  }, [])
  const onGroupDragOver = useCallback((id: string) => (e: React.DragEvent) => {
    e.preventDefault()
    if (id !== dragOverGroupId) setDragOverGroupId(id)
  }, [dragOverGroupId])
  const onGroupDrop = useCallback((id: string) => (e: React.DragEvent) => {
    e.preventDefault()
    if (!dragGroupId || dragGroupId === id) { setDragGroupId(null); setDragOverGroupId(null); return }
    const ids = groups.map((g) => g.id)
    const from = ids.indexOf(dragGroupId)
    const to = ids.indexOf(id)
    if (from < 0 || to < 0) { setDragGroupId(null); setDragOverGroupId(null); return }
    ids.splice(to, 0, ids.splice(from, 1)[0])
    reorderGroups(ids)
    setDragGroupId(null)
    setDragOverGroupId(null)
  }, [dragGroupId, dragOverGroupId, groups, reorderGroups])

  // ===== 启动时清理过期回收站词条（保留 30 天） =====
  useEffect(() => {
    const cleaned = cleanupTrash()
    if (cleaned > 0) toast(`已自动清理 ${cleaned} 个过期回收站词条`, 'success')
  }, [cleanupTrash, toast])

  const enabledDerivativeRules = useMemo(
    () => settings.wordLibraryDerivativeRules.filter((rule) => rule.enabled),
    [settings.wordLibraryDerivativeRules],
  )
  const derivativeRuleSummary = enabledDerivativeRules.length === 0
    ? '未启用规则'
    : enabledDerivativeRules.length === 1
    ? enabledDerivativeRules[0].name
    : `已启用 ${enabledDerivativeRules.length} 条规则`

  const groupCounts = useMemo(() => {
    const c: Record<string, number> = {}
    groups.forEach((g) => { c[g.id] = entries.filter((e) => e.groupId === g.id && e.deletedAt == null).length })
    return c
  }, [groups, entries])

  const activeEntry = useMemo(() =>
    activeId ? entries.find((e) => e.id === activeId) ?? null : null,
  [activeId, entries])

  // sync edit form when active changes
  useEffect(() => {
    if (activeEntry) {
      setEditKey(activeEntry.key)
      setEditGroupId(activeEntry.groupId)
      setEditDraw(activeEntry.draw_count)
      setEditText(activeEntry.entries.join('\n'))
    } else {
      setEditKey('')
      setEditGroupId(groups[0]?.id ?? '')
      setEditDraw(1)
      setEditText('')
    }
  }, [activeEntry, groups])

  const onSave = useCallback(() => {
    if (!activeId) return
    const lines = parseEntryLines(editText)
    const oldEntry = entries.find((e) => e.id === activeId)
    updateEntry(activeId, {
      key: editKey, groupId: editGroupId,
      draw_count: Math.max(1, Math.min(999, editDraw)), entries: lines,
    })
    // 如果改名了，同步更新 prompt 中的变量标记
    if (oldEntry && oldEntry.key !== editKey) {
      const currentPrompt = useStore.getState().prompt
      setPrompt(replaceVariableNameInPrompt(currentPrompt, oldEntry.key, editKey))
    }
    toast('词条已保存', 'success')
  }, [activeId, editKey, editGroupId, editDraw, editText, entries, updateEntry, setPrompt, toast])

  const onGenerateDerivedEntries = useCallback(async () => {
    if (!activeEntry) return
    const seedEntry = parseEntryLines(editText)[0]
    if (!seedEntry) {
      toast('请先输入至少一条词条', 'error')
      return
    }

    const profile = getAgentApiProfile(settings)
    const validationError = validateApiProfile(profile)
    if (validationError) {
      toast(`请先完善 Agent 配置：${validationError}`, 'error')
      return
    }
    if (profile.apiMode !== 'responses') {
      toast('AI 衍生需要 Agent 使用 Responses API', 'error')
      return
    }

    const count = Math.max(1, Math.min(100, Math.trunc(Number(deriveCount) || 1)))
    setDeriveCount(count)
    setDeriveLoading(true)
    setDerivedClosing(false)
    setDerivedEntries([])
    try {
      // 获取当前词库中所有的词条作为上下文
      const contextEntries = activeEntry ? activeEntry.entries : []
      
      const generated = await generateDerivedWordEntries({
        settings,
        profile,
        seedEntry,
        contextEntries,
        similarity: deriveSimilarity,
        count,
      })
      if (generated.length === 0) {
        toast('未生成可用词条，请调整相似度后重试', 'error')
        return
      }
      setDerivedEntries(generated)
      toast(`已生成 ${generated.length} 条词条`, 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI 衍生失败'
      toast(message, 'error')
    } finally {
      setDeriveLoading(false)
    }
  }, [activeEntry, editText, settings, deriveCount, deriveSimilarity, toast])

  const closeDerivedPopover = useCallback(() => {
    setDerivedClosing(true)
    if (derivedCloseTimerRef.current != null) window.clearTimeout(derivedCloseTimerRef.current)
    derivedCloseTimerRef.current = window.setTimeout(() => {
      setDerivedEntries([])
      setDerivedClosing(false)
      derivedCloseTimerRef.current = null
    }, 180)
  }, [])

  const appendDerivedEntries = useCallback(() => {
    if (derivedEntries.length === 0) return
    setEditText((current) => mergeEntryLines(current, derivedEntries))
    closeDerivedPopover()
    toast('已追加到编辑区，请保存词条', 'success')
  }, [closeDerivedPopover, derivedEntries, toast])

  const replaceWithDerivedEntries = useCallback(() => {
    if (derivedEntries.length === 0) return
    setEditText(derivedEntries.join('\n'))
    closeDerivedPopover()
    toast('已替换编辑区，请保存词条', 'success')
  }, [closeDerivedPopover, derivedEntries, toast])

  const updateDerivativeRules = useCallback((rules: WordLibraryDerivativeRule[]) => {
    setSettings({ wordLibraryDerivativeRules: rules })
  }, [setSettings])

  const setDerivativeRuleMode = useCallback((mode: 'single' | 'multiple') => {
    const rules = settings.wordLibraryDerivativeRules
    if (mode === 'multiple') {
      setSettings({ wordLibraryDerivativeRuleMode: mode })
      return
    }

    let enabledSeen = false
    const normalizedRules = rules.map((rule) => {
      const enabled = rule.enabled && !enabledSeen
      if (enabled) enabledSeen = true
      return { ...rule, enabled }
    })
    if (!enabledSeen && normalizedRules[0]) normalizedRules[0] = { ...normalizedRules[0], enabled: true }
    setSettings({ wordLibraryDerivativeRuleMode: mode, wordLibraryDerivativeRules: normalizedRules })
  }, [settings.wordLibraryDerivativeRules, setSettings])

  const toggleDerivativeRule = useCallback((ruleId: string) => {
    const rules = settings.wordLibraryDerivativeRules
    const nextRules = settings.wordLibraryDerivativeRuleMode === 'single'
      ? rules.map((rule) => ({ ...rule, enabled: rule.id === ruleId }))
      : rules.map((rule) => rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule)
    updateDerivativeRules(nextRules)
  }, [settings.wordLibraryDerivativeRuleMode, settings.wordLibraryDerivativeRules, updateDerivativeRules])

  const addDerivativeRule = useCallback(() => {
    const id = `rule-${Date.now().toString(36)}`
    const rule: WordLibraryDerivativeRule = {
      id,
      name: '新规则',
      content: '描述这条规则如何衍生词条，例如：保留主体名词，只替换颜色、风格或材质形容词。',
      enabled: false,
    }
    updateDerivativeRules([...settings.wordLibraryDerivativeRules, rule])
    setEditingRuleId(id)
  }, [settings.wordLibraryDerivativeRules, updateDerivativeRules])

  const copyDerivativeRule = useCallback((rule: WordLibraryDerivativeRule) => {
    const id = `rule-${Date.now().toString(36)}`
    const copied: WordLibraryDerivativeRule = {
      id,
      name: `${rule.name} 副本`,
      content: rule.content,
      enabled: false,
    }
    updateDerivativeRules([...settings.wordLibraryDerivativeRules, copied])
    setEditingRuleId(id)
  }, [settings.wordLibraryDerivativeRules, updateDerivativeRules])

  const deleteDerivativeRule = useCallback((ruleId: string) => {
    const current = settings.wordLibraryDerivativeRules
    const target = current.find((rule) => rule.id === ruleId)
    if (!target || target.builtIn) return
    let nextRules = current.filter((rule) => rule.id !== ruleId)
    if (!nextRules.some((rule) => rule.enabled) && nextRules[0]) nextRules = nextRules.map((rule, index) => ({ ...rule, enabled: index === 0 }))
    updateDerivativeRules(nextRules)
    if (editingRuleId === ruleId) setEditingRuleId(null)
  }, [editingRuleId, settings.wordLibraryDerivativeRules, updateDerivativeRules])

  const patchDerivativeRule = useCallback((ruleId: string, patch: Partial<WordLibraryDerivativeRule>) => {
    updateDerivativeRules(settings.wordLibraryDerivativeRules.map((rule) => {
      if (rule.id !== ruleId) return rule
      if (rule.builtIn) return rule
      return { ...rule, ...patch }
    }))
  }, [settings.wordLibraryDerivativeRules, updateDerivativeRules])

  const onReset = useCallback(() => {
    if (!activeEntry) return
    setEditKey(activeEntry.key)
    setEditGroupId(activeEntry.groupId)
    setEditDraw(activeEntry.draw_count)
    setEditText(activeEntry.entries.join('\n'))
  }, [activeEntry])

  const onDelete = useCallback(() => {
    if (!activeId) return
    const oldEntry = entries.find((e) => e.id === activeId)
    deleteEntry(activeId)
    setActiveId(null)
    // 从 prompt 中移除该变量标记
    if (oldEntry) {
      const currentPrompt = useStore.getState().prompt
      setPrompt(currentPrompt.replace(new RegExp(`${VAR_START}${oldEntry.key}(?:\\u2062${oldEntry.id})?${VAR_END}`, 'g'), oldEntry.key))
    }
    toast('词条已删除', 'success')
  }, [activeId, entries, deleteEntry, setPrompt, toast])

  const onNew = useCallback(() => {
    const g = groups[0]?.id ?? ''
    const e = createEntry(g, '新词条')
    setActiveId(e.id)
  }, [createEntry, groups])

  const onCreateGroup = useCallback(() => {
    const name = newGroupName.trim()
    if (!name) { setCreatingGroup(false); setNewGroupName(''); return }
    const g = createGroup(name)
    setEditGroupId(g.id)
    setCreatingGroup(false)
    setNewGroupName('')
    setGroupOpen(false)
  }, [newGroupName, createGroup])

  const selGroupName = useMemo(() =>
    groups.find((g) => g.id === editGroupId)?.name ?? '选择分类',
  [groups, editGroupId])

  // insert / replace with precise cursor
  const getInputBar = useCallback((): HTMLElement | null =>
    document.querySelector<HTMLElement>('[data-input-bar] [contenteditable]'),
  [])

  const insertAtCursor = useCallback((text: string) => {
    const el = getInputBar()
    if (!el) return false
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
      el.focus()
      const r = document.createRange()
      r.selectNodeContents(el); r.collapse(false)
      sel?.removeAllRanges(); sel?.addRange(r)
    }
    const r = sel!.getRangeAt(0)
    r.deleteContents()
    const node = document.createTextNode(text)
    r.insertNode(node)
    r.setStartAfter(node); r.collapse(true)
    sel!.removeAllRanges(); sel!.addRange(r)
    // sync prompt
    let plain = ''
    const walk = (n: Node) => {
      if (n.nodeType === Node.TEXT_NODE) { plain += n.textContent ?? ''; return }
      const h = n as HTMLElement
      if (h.classList?.contains('mention-tag')) { plain += h.dataset.mentionText ?? h.textContent ?? ''; return }
      if (h.classList?.contains('wildcard-var')) { plain += createVariableMention(h.dataset.varName ?? h.textContent ?? '', h.dataset.entryId); return }
      n.childNodes.forEach(walk)
    }
    el.childNodes.forEach(walk)
    setPrompt(plain.replace(/\r\n?/g, '\n'))
    return true
  }, [getInputBar, setPrompt])

  const handleInsert = useCallback((entry: { key: string; id?: string }) => {
    const marker = createVariableMention(entry.key, entry.id)
    if (!insertAtCursor(marker)) {
      const current = useStore.getState().prompt
      setPrompt(current + marker)
    }
    toast('已插入词条', 'success')
  }, [insertAtCursor, setPrompt, toast])

  const handleReplace = useCallback((entry: { key: string; id?: string }) => {
    const marker = createVariableMention(entry.key, entry.id)
    const el = getInputBar()
    if (el) {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
        const r = sel.getRangeAt(0)
        if (!r.collapsed) {
          r.deleteContents()
          const node = document.createTextNode(marker)
          r.insertNode(node)
          r.setStartAfter(node); r.collapse(true)
          sel.removeAllRanges(); sel.addRange(r)
          let plain = ''
          const walk = (n: Node) => {
            if (n.nodeType === Node.TEXT_NODE) { plain += n.textContent ?? ''; return }
            const h = n as HTMLElement
            if (h.classList?.contains('mention-tag')) { plain += h.dataset.mentionText ?? h.textContent ?? ''; return }
            if (h.classList?.contains('wildcard-var')) { plain += createVariableMention(h.dataset.varName ?? h.textContent ?? '', h.dataset.entryId); return }
            n.childNodes.forEach(walk)
          }
          el.childNodes.forEach(walk)
          setPrompt(plain.replace(/\r\n?/g, '\n'))
          toast('已替换为词条', 'success')
          return
        }
      }
    }
    // fallback to insert
    handleInsert(entry)
  }, [getInputBar, setPrompt, toast, handleInsert])

  // auto-create from prompt
  useEffect(() => {
    const unsub = useStore.subscribe((state, prev) => {
      if (state.prompt === prev.prompt) return
      const p = state.prompt
      if (p === lastPrompt.current) return
      lastPrompt.current = p
      const names: Array<{ name: string; entryId?: string }> = []
      let m
      while ((m = VAR_MENTION_RE.exec(p)) !== null) {
        const mention = parseVariableMention(m[1])
        names.push({ name: mention.varName, entryId: mention.entryId })
      }
      for (const { name, entryId } of names) {
        if (entryId || state.wordLibraryEntries.some((e) => e.key === name) || autoCreated.current.has(name)) continue
        autoCreated.current.add(name)
        const ne = state.createWordLibraryEntry('default', name)
        state.updateWordLibraryEntry(ne.id, { entries: [name] })
        lastAdded.current = name
      }
    })
    return unsub
  }, [])

  // auto-select new entry
  useEffect(() => {
    const unsub = useStore.subscribe((state) => {
      const v = lastAdded.current
      if (!v) return
      lastAdded.current = null
      const e = state.wordLibraryEntries.find((it) => it.key === v && it.deletedAt == null)
      if (!e) return
      setActiveId(e.id)
      setSelGroup(e.groupId)
      requestAnimationFrame(() => {
        cardRefs.current[e.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    })
    return unsub
  }, [])

  // auto-highlight group pill
  useEffect(() => {
    if (!activeId) return
    const e = entries.find((it) => it.id === activeId)
    if (e) setSelGroup(e.groupId)
  }, [activeId])

  // close group dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (groupRef.current && !groupRef.current.contains(e.target as Node)) {
        setGroupOpen(false); setCreatingGroup(false); setNewGroupName('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // watch promptSelectedVarName: select the corresponding entry
  useEffect(() => {
    if (!promptSelectedEntryId) return
    const entry = entries.find((e) => e.id === promptSelectedEntryId)
    if (entry) {
      setActiveId(entry.id)
      setSelGroup(entry.groupId)
      requestAnimationFrame(() => {
        cardRefs.current[entry.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    }
    setPromptSelectedEntryId(null)
  }, [promptSelectedEntryId, entries, setPromptSelectedEntryId])

  useEffect(() => {
    if (!promptSelectedVarName) return
    const entry = entries.find((e) => e.key === promptSelectedVarName)
    if (entry) {
      setActiveId(entry.id)
      setSelGroup(entry.groupId)
      requestAnimationFrame(() => {
        cardRefs.current[entry.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    }
    setPromptSelectedVarName(null) // 消费后清空，避免重复触发
  }, [promptSelectedVarName, entries, setPromptSelectedVarName])

  useEffect(() => {
    const root = document.documentElement
    const leftVar = '--word-library-left-width'
    const rightVar = '--word-library-right-width'
    root.style.setProperty(leftVar, '0px')
    root.style.setProperty(rightVar, `${sz.w}px`)
    return () => {
      root.style.setProperty(leftVar, '0px')
      root.style.setProperty(rightVar, '0px')
    }
  }, [sz.w])

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
      className="fixed z-40 flex flex-col text-foreground overflow-visible bg-background border border-border"
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
        className="shrink-0 px-4 pt-4 pb-3 border-b select-none border-border"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/15 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-foreground">词条库</h3>
              <p className="text-[11px] text-muted-foreground leading-tight">{entries.filter((e) => e.deletedAt == null).length} 个词条 · {groups.length} 个分组</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {view === 'list' && (
              <button
                type="button"
                onClick={() => setManagerOpen(true)}
                onMouseDown={(e) => e.stopPropagation()}
                className="h-9 px-4 rounded-lg text-sm font-semibold text-white transition hover:opacity-90 shadow-sm"
                style={{ background: '#2563eb' }}
                title="打开词条管理弹窗"
              >
                管理
              </button>
            )}
            {view === 'trash' && (
              <button
                onClick={() => { setView('list'); setTrashSelectedIds([]) }}
                onMouseDown={(e) => e.stopPropagation()}
                className="h-9 px-4 rounded-lg text-sm font-semibold text-white transition hover:opacity-90 shadow-sm bg-blue-600"
                title="返回词条列表"
              >
                返回
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onImportFile}
          />
        </div>

        <div className="grid grid-cols-3 gap-1.5 mb-3">
          <button
            onClick={onExport}
            onMouseDown={(e) => e.stopPropagation()}
            className="min-w-0 h-8 px-2 rounded-lg text-xs font-medium transition border border-border flex items-center justify-center gap-1 hover:bg-muted/60"
            title="导出词条库为 JSON"
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
            <span className="truncate">导出</span>
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            onMouseDown={(e) => e.stopPropagation()}
            className="min-w-0 h-8 px-2 rounded-lg text-xs font-medium transition border border-border flex items-center justify-center gap-1 hover:bg-muted/60"
            title="从 JSON 导入词条库"
          >
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 14l5-5 5 5M12 9v12" />
            </svg>
            <span className="truncate">导入</span>
          </button>
          <button
            onClick={() => { setView((v) => (v === 'trash' ? 'list' : 'trash')); setSelectedIds([]); setTrashSelectedIds([]) }}
            onMouseDown={(e) => e.stopPropagation()}
            className="min-w-0 h-8 px-2 rounded-lg text-xs font-medium transition border border-border flex items-center justify-center gap-1 hover:bg-muted/60"
            style={{ background: isTrash ? '#2563eb' : undefined, color: isTrash ? '#fff' : undefined }}
            title="回收站"
          >
            <HistoryIcon className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">回收站</span>
          </button>
        </div>

        {isManage && (
          <div className="mb-3 rounded-lg border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-xs leading-5 text-blue-500">
            管理模式：勾选词条后可批量移动、加标签、复制或删除；手动排序下可拖拽调整顺序。
          </div>
        )}

        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={view === 'trash' ? '在回收站中搜索...' : '搜索词条名称/内容/标签...'}
            className="w-full pl-9 pr-3 py-2 rounded-xl text-sm placeholder-muted-foreground transition focus:outline-none focus:ring-2 focus:ring-blue-500/25 bg-sidebar border border-border text-foreground"
          />
        </div>

        {view === 'list' && mode === 'browse' && (
          <div className="mt-2.5">
            <select
              value={sortType}
              onChange={(e) => setSortType(e.target.value as WordLibrarySortType)}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs transition focus:outline-none focus:ring-2 focus:ring-blue-500/25 bg-sidebar border border-border text-foreground"
            >
              <option value="manual">手动排序（置顶优先）</option>
              <option value="updatedAt">最近更新</option>
              <option value="createdAt">最近创建</option>
              <option value="usage">使用频率</option>
              <option value="title">标题 A-Z</option>
            </select>
          </div>
        )}
      </div>

      {/* ===== Group pills ===== */}
      <div className="shrink-0 px-4 py-2.5 border-b overflow-x-auto custom-scrollbar border-border">
        <div className="flex gap-1.5">
          <button
            onClick={() => setSelGroup('__all__')}
            className="shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition hover:opacity-80 border border-border"
            style={{
              background: selGroup === '__all__' ? '#2563eb' : undefined,
              color: selGroup === '__all__' ? '#fff' : undefined,
            }}
          >
            全部 {entries.filter((e) => e.deletedAt == null).length}
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              draggable
              onDragStart={onGroupDragStart(g.id)}
              onDragOver={onGroupDragOver(g.id)}
              onDrop={onGroupDrop(g.id)}
              onClick={() => setSelGroup(g.id)}
              className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition hover:opacity-80 border border-border ${dragOverGroupId === g.id ? 'ring-2 ring-blue-500/60' : ''}`}
              style={{
                background: selGroup === g.id ? '#2563eb' : undefined,
                color: selGroup === g.id ? '#fff' : undefined,
                cursor: dragGroupId ? 'grabbing' : 'grab',
              }}
              title="拖拽可调整分组顺序"
            >
              {g.name} {groupCounts[g.id] ?? 0}
            </button>
          ))}
        </div>
      </div>

      {/* ===== Selection summary (manage / trash) ===== */}
      {(isManage || isTrash) && sortedEntries.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
          <Checkbox checked={allSelected} onChange={toggleSelectAll} tone="primary" className="select-none" />
          <span className="text-xs text-muted-foreground">
            {activeSelectedIds.length > 0 ? `已选择 ${activeSelectedIds.length} 条` : '全选当前列表'}
          </span>
          {someSelected && (
            <button onClick={() => setActiveSelectedIds([])} className="ml-auto text-xs text-muted-foreground hover:text-foreground">取消选择</button>
          )}
        </div>
      )}

      {/* ===== Entry list ===== */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-2.5 min-h-0">
        {sortedEntries.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <svg className="w-8 h-8 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span className="text-xs">{view === 'trash' ? '回收站为空' : (search.trim() ? '没有匹配的词条' : '暂无词条')}</span>
          </div>
        )}
        {sortedEntries.map((entry, i) => {
          const g = groups.find((gr) => gr.id === entry.groupId)
          const isActive = activeId === entry.id
          const checked = activeSelectedIds.includes(entry.id)
          const showCheckbox = isManage || isTrash
          const showDrag = canDragReorder
          const showActions = view === 'list' && mode === 'browse'
          return (
            <div
              key={entry.id}
              ref={(el) => { cardRefs.current[entry.id] = el }}
              draggable={showDrag}
              onDragStart={showDrag ? onRowDragStart(entry.id) : undefined}
              onDragOver={showDrag ? onRowDragOver(entry.id) : undefined}
              onDrop={showDrag ? onRowDrop(entry.id) : undefined}
              onClick={(e) => {
                if (isManage || isTrash) toggleSelect(entry.id, i, e.shiftKey)
                else setActiveId(entry.id)
              }}
              className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition mb-1.5 group cursor-pointer ${isActive && !isManage && !isTrash ? 'bg-blue-500/10 border-blue-500/35' : checked ? 'bg-blue-500/[0.08] border-blue-500/30' : 'border-transparent hover:bg-muted/50'} ${showDrag && dragOverId === entry.id ? 'border-blue-500/60' : ''}`}
            >
              {showDrag && (
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 cursor-grab text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
                  title="拖拽排序"
                >
                  <DragHandleIcon className="w-4 h-4" />
                </button>
              )}
              {showCheckbox && (
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={checked} onChange={() => toggleSelect(entry.id, i, false)} tone="primary" />
                </div>
              )}
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-sm ${getColorClass(i)}`}>
                {entry.key ? entry.key[0] : '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium truncate text-sidebar-foreground">{entry.key || '未命名'}</span>
                  {entry.isPinned && <span className="shrink-0 text-[10px] px-1 rounded bg-amber-500/15 text-amber-500">置顶</span>}
                  {entry.isFavorite && <FavoriteIcon className="shrink-0 w-3 h-3 text-pink-500" filled />}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                  {g?.name ?? '未知'} · {entry.entries.length}条 · 抽{entry.draw_count}
                  {view === 'trash' && entry.deletedAt ? ` · 删除于 ${new Date(entry.deletedAt).toLocaleDateString()}` : ''}
                </div>
                {entry.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {entry.tags.slice(0, 3).map((t) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{t}</span>
                    ))}
                  </div>
                )}
              </div>
              {showActions && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(entry.id) }}
                    className={`p-1.5 rounded-md transition hover:bg-muted ${entry.isFavorite ? 'text-pink-500' : 'text-muted-foreground'}`}
                    title={entry.isFavorite ? '取消收藏' : '收藏'}
                  >
                    <FavoriteIcon className="w-4 h-4" filled={entry.isFavorite} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); togglePinned(entry.id) }}
                    className={`p-1.5 rounded-md transition hover:bg-muted ${entry.isPinned ? 'text-amber-500' : 'text-muted-foreground'}`}
                    title={entry.isPinned ? '取消置顶' : '置顶'}
                  >
                    <svg className="w-4 h-4" fill={entry.isPinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleInsert(entry) }}
                    className="px-2 py-1 rounded-md text-xs transition hover:text-foreground hover:bg-muted bg-muted text-muted-foreground"
                    title="插入到光标处"
                  >
                    插入
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleReplace(entry) }}
                    className="px-2 py-1 rounded-md text-xs transition hover:text-foreground hover:bg-muted bg-muted text-muted-foreground"
                    title="替换选中文本"
                  >
                    替换
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* ===== Batch action bar (manage) ===== */}
      {isManage && selectedIds.length > 0 && (
        <div className="shrink-0 border-t border-border bg-sidebar px-4 py-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">已选择 {selectedIds.length} 条</span>
          <div className="relative ml-auto" ref={moveMenuRef}>
            <button
              onClick={() => { setMoveMenuOpen((o) => !o); setTagMenuOpen(false) }}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition bg-muted text-muted-foreground hover:bg-muted/80 flex items-center gap-1"
            >
              移动到 <ChevronDownIcon className="w-3 h-3" />
            </button>
            {moveMenuOpen && (
              <div className="absolute bottom-full right-0 mb-2 z-30 w-44 rounded-lg shadow-xl overflow-hidden bg-sidebar border border-border max-h-60 overflow-y-auto custom-scrollbar">
                {groups.map((grp) => (
                  <div key={grp.id} onClick={() => applyMove(grp.id)} className="px-3 py-2 text-sm cursor-pointer transition hover:bg-muted">{grp.name}</div>
                ))}
              </div>
            )}
          </div>
          <div className="relative" ref={tagMenuRef}>
            <button
              onClick={() => { setTagMenuOpen((o) => !o); setMoveMenuOpen(false) }}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition bg-muted text-muted-foreground hover:bg-muted/80 flex items-center gap-1"
            >
              添加标签 <ChevronDownIcon className="w-3 h-3" />
            </button>
            {tagMenuOpen && (
              <div className="absolute bottom-full right-0 mb-2 z-30 w-52 rounded-lg shadow-xl bg-sidebar border border-border p-2.5">
                <input
                  autoFocus
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyTags() } }}
                  placeholder="多个标签用空格分隔"
                  className="w-full px-2 py-1.5 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/25 bg-background border border-border text-foreground"
                />
                <div className="flex items-center justify-end gap-2 mt-2">
                  <button onClick={() => { setTagMenuOpen(false); setTagInput('') }} className="px-2.5 py-1 rounded text-xs bg-muted text-muted-foreground">取消</button>
                  <button onClick={applyTags} className="px-2.5 py-1 rounded text-xs bg-blue-600 text-white">确认</button>
                </div>
              </div>
            )}
          </div>
          <button onClick={applyBatchPin} className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition bg-muted text-muted-foreground hover:bg-muted/80">置顶</button>
          <button onClick={applyDuplicate} className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition bg-muted text-muted-foreground hover:bg-muted/80">复制</button>
          <button onClick={confirmBatchDelete} className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition bg-red-500/10 text-red-500 hover:bg-red-500/20">删除</button>
          <button onClick={() => setSelectedIds([])} className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition bg-muted text-muted-foreground hover:bg-muted/80">取消选择</button>
        </div>
      )}

      {/* ===== Trash action bar ===== */}
      {isTrash && trashSelectedIds.length > 0 && (
        <div className="shrink-0 border-t border-border bg-sidebar px-4 py-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">已选择 {trashSelectedIds.length} 条</span>
          <button
            onClick={() => { restoreEntries(trashSelectedIds); const n = trashSelectedIds.length; setTrashSelectedIds([]); toast(`已恢复 ${n} 个词条`, 'success') }}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition bg-blue-600 text-white ml-auto"
          >
            恢复
          </button>
          <button
            onClick={() => setConfirmDialog({
              title: `确认永久删除选中的 ${trashSelectedIds.length} 个词条？`,
              message: '永久删除后无法恢复。',
              confirmText: '永久删除',
              tone: 'danger',
              action: () => { destroyEntries(trashSelectedIds); setTrashSelectedIds([]); toast('已永久删除', 'success') },
            })}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition bg-red-500/10 text-red-500 hover:bg-red-500/20"
          >
            永久删除
          </button>
        </div>
      )}
      {isTrash && (
        <div className="shrink-0 px-4 pb-3 flex justify-end">
          <button onClick={confirmEmptyTrash} className="text-xs text-muted-foreground hover:text-red-500 transition">清空回收站</button>
        </div>
      )}


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

      {/* ===== Detail panel (fixed bottom) ===== */}
      {!isTrash && (
      <div className="shrink-0 border-t flex flex-col border-border" style={{ minHeight: 200 }}>
        {/* Detail header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
          <div className="min-w-0 flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-blue-500/15 flex items-center justify-center">
              <svg className="w-3 h-3 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h4 className="text-sm font-bold text-sidebar-foreground">词条详情</h4>
              {activeEntry && <div className="text-xs text-muted-foreground mt-0.5 truncate">ID: {activeEntry.key}</div>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setRuleModalOpen(true)}
              title={derivativeRuleSummary}
              className="rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted/80"
            >
              规则
            </button>
            <button
              onClick={onNew}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition hover:opacity-90 flex items-center gap-1"
              style={{ background: '#2563eb' }}
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              新建
            </button>
          </div>
        </div>

        {/* Form row */}
        <div className="grid grid-cols-3 gap-2 px-4 pb-2 shrink-0">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">属性名称</label>
            <input
              value={editKey}
              onChange={(e) => setEditKey(e.target.value)}
              disabled={!activeEntry}
              className="w-full px-2.5 py-1.5 rounded-lg text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500/25 disabled:opacity-40 bg-sidebar border border-border text-foreground"
            />
          </div>
          <div className="relative" ref={groupRef}>
            <label className="block text-xs text-muted-foreground mb-1">所属分类</label>
            <button
              type="button"
              disabled={!activeEntry}
              onClick={() => activeEntry && setGroupOpen((o) => !o)}
              className="w-full px-2.5 py-1.5 rounded-lg text-sm text-left transition focus:outline-none focus:ring-2 focus:ring-blue-500/25 flex items-center justify-between disabled:opacity-40 bg-sidebar border border-border text-foreground"
            >
              <span className="truncate">{selGroupName}</span>
              <svg className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${groupOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {groupOpen && activeEntry && (
              <div className="absolute z-20 mt-1 w-full rounded-lg shadow-xl overflow-hidden bg-sidebar border border-border">
                {groups.map((g) => (
                  <div
                    key={g.id}
                    onClick={() => { setEditGroupId(g.id); setGroupOpen(false) }}
                    className="px-3 py-2 text-sm cursor-pointer transition hover:bg-muted"
                    style={{ color: g.id === editGroupId ? '#60a5fa' : undefined }}
                  >
                    {g.name}
                  </div>
                ))}
                {creatingGroup ? (
                  <div className="px-3 py-2 border-t border-border">
                    <input
                      autoFocus
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); onCreateGroup() }
                        else if (e.key === 'Escape') { setCreatingGroup(false); setNewGroupName('') }
                      }}
                      placeholder="分组名称"
                      className="w-full px-2 py-1 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/25 bg-background border border-border text-foreground"
                    />
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={onCreateGroup} className="px-2.5 py-1 rounded text-xs text-white bg-blue-600">确认</button>
                      <button onClick={() => { setCreatingGroup(false); setNewGroupName('') }} className="px-2.5 py-1 rounded text-xs bg-muted text-muted-foreground">取消</button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => setCreatingGroup(true)}
                    className="px-3 py-2 text-sm cursor-pointer transition hover:bg-muted border-t border-border text-blue-400"
                  >
                    + 新建分组
                  </div>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">每次抽取</label>
            <input
              type="number"
              min={1} max={999}
              value={editDraw}
              onChange={(e) => setEditDraw(Number(e.target.value))}
              disabled={!activeEntry}
              className="w-full px-2.5 py-1.5 rounded-lg text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500/25 disabled:opacity-40 bg-sidebar border border-border text-foreground"
            />
          </div>
        </div>

        {/* Textarea */}
        <div className="px-4 pb-3">
          <label className="block text-xs text-muted-foreground mb-1">候选词库</label>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            disabled={!activeEntry}
            placeholder={activeEntry ? '每行一个词条' : '请先选择或创建词条'}
            className="w-full px-3 py-2 rounded-lg text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500/25 resize-y disabled:opacity-40 bg-sidebar border border-border text-foreground"
            style={{ minHeight: 72, maxHeight: 250, height: 250, resize: 'none' }}
          />
        </div>

        <div className="relative mx-4 mb-3 rounded-lg border border-border bg-muted/30 p-2.5 overflow-visible">
          <div className="grid grid-cols-[1fr_64px_64px] items-end gap-2">
            <label className="min-w-0">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>相似度</span>
                <span>{deriveSimilarity}%</span>
              </div>
              <div className="flex h-9 items-center rounded-lg border border-border bg-sidebar px-2.5">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={deriveSimilarity}
                  disabled={!activeEntry || deriveLoading}
                  onChange={(e) => setDeriveSimilarity(Number(e.target.value))}
                  className="w-full accent-blue-600 disabled:opacity-40"
                />
              </div>
            </label>
            <label>
              <div className="mb-1 text-xs text-muted-foreground">数量</div>
              <input
                type="number"
                min={1}
                max={100}
                value={deriveCount}
                disabled={!activeEntry || deriveLoading}
                onChange={(e) => setDeriveCount(Number(e.target.value))}
                onBlur={() => setDeriveCount((value) => Math.max(1, Math.min(100, Math.trunc(Number(value) || 1))))}
                className="h-9 w-full rounded-lg border border-border bg-sidebar px-2.5 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-blue-500/25 disabled:opacity-40"
              />
            </label>
            <div>
              <div className="mb-1 text-xs text-muted-foreground opacity-0">操作</div>
              <button
                type="button"
                onClick={onGenerateDerivedEntries}
                disabled={!activeEntry || deriveLoading}
                className="h-9 w-full rounded-lg bg-blue-600 px-3 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-30"
              >
                {deriveLoading ? '生成中' : '生成'}
              </button>
            </div>
          </div>
          {derivedEntries.length > 0 && (
            <div
              className={`absolute right-full bottom-0 z-30 mr-2 w-64 rounded-xl border border-border bg-sidebar p-3 shadow-2xl transition-all duration-200 ${
                derivedClosing ? 'translate-x-8 scale-95 opacity-0' : 'translate-x-0 scale-100 opacity-100'
              }`}
            >
              <div className="mb-2 max-h-28 overflow-y-auto rounded-lg border border-border bg-background/40 p-2 text-xs leading-5 text-sidebar-foreground">
                {derivedEntries.join('、')}
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={appendDerivedEntries}
                  className="rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted/80"
                >
                  追加
                </button>
                <button
                  type="button"
                  onClick={replaceWithDerivedEntries}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
                >
                  替换
                </button>
              </div>
            </div>
          )}
        </div>

        {ruleModalOpen && (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                setRuleModalOpen(false)
                setEditingRuleId(null)
              }
            }}
          >
            <div className="flex max-h-[82vh] w-full max-w-lg flex-col rounded-xl border border-border bg-sidebar shadow-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-sidebar-foreground">衍生规则</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRuleModalOpen(false)
                    setEditingRuleId(null)
                  }}
                  className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted"
                  aria-label="关闭"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="inline-flex rounded-lg bg-muted p-1">
                  <button
                    type="button"
                    onClick={() => setDerivativeRuleMode('single')}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                      settings.wordLibraryDerivativeRuleMode === 'single'
                        ? 'bg-sidebar text-sidebar-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-sidebar-foreground'
                    }`}
                  >
                    单选
                  </button>
                  <button
                    type="button"
                    onClick={() => setDerivativeRuleMode('multiple')}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                      settings.wordLibraryDerivativeRuleMode === 'multiple'
                        ? 'bg-sidebar text-sidebar-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-sidebar-foreground'
                    }`}
                  >
                    多选
                  </button>
                </div>
                <button
                  type="button"
                  onClick={addDerivativeRule}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
                >
                  添加规则
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                {settings.wordLibraryDerivativeRules.map((rule) => {
                  const editing = editingRuleId === rule.id && !rule.builtIn
                  return (
                    <div
                      key={rule.id}
                      onDoubleClick={() => {
                        if (!rule.builtIn) setEditingRuleId(rule.id)
                      }}
                      className={`rounded-lg border p-3 transition ${
                        rule.enabled
                          ? 'border-blue-500/50 bg-blue-500/10'
                          : 'border-border bg-muted/30'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type={settings.wordLibraryDerivativeRuleMode === 'single' ? 'radio' : 'checkbox'}
                          checked={rule.enabled}
                          onChange={() => toggleDerivativeRule(rule.id)}
                          className="mt-1 accent-blue-600"
                          name="word-library-derivative-rule"
                          aria-label={`启用 ${rule.name}`}
                        />
                        <div className="min-w-0 flex-1">
                          {editing ? (
                            <div className="space-y-2">
                              <input
                                value={rule.name}
                                onChange={(e) => patchDerivativeRule(rule.id, { name: e.target.value })}
                                className="w-full rounded-lg border border-border bg-sidebar px-2 py-1.5 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-blue-500/25"
                              />
                              <textarea
                                value={rule.content}
                                onChange={(e) => patchDerivativeRule(rule.id, { content: e.target.value })}
                                className="w-full rounded-lg border border-border bg-sidebar px-2 py-1.5 text-xs leading-5 text-foreground outline-none transition focus:ring-2 focus:ring-blue-500/25"
                                style={{ minHeight: 110, resize: 'vertical' }}
                              />
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <div className="truncate text-sm font-semibold text-sidebar-foreground">{rule.name}</div>
                                {rule.builtIn && <span className="shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-500">默认</span>}
                              </div>
                              <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{rule.content}</div>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-end gap-2">
                        {editing ? (
                          <button
                            type="button"
                            onClick={() => setEditingRuleId(null)}
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
                          >
                            完成
                          </button>
                        ) : (
                          <>
                            {!rule.builtIn && (
                              <button
                                type="button"
                                onClick={() => setEditingRuleId(rule.id)}
                                className="rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted/80"
                              >
                                重命名
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => copyDerivativeRule(rule)}
                              className="rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted/80"
                            >
                              复制
                            </button>
                            {!rule.builtIn && (
                              <button
                                type="button"
                                onClick={() => deleteDerivativeRule(rule.id)}
                                className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-500 transition hover:bg-red-500/20"
                              >
                                删除
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Bottom actions - protected from overlap */}
        <div className="flex items-center justify-between px-4 py-3 border-t shrink-0 border-border">
          <button
            onClick={onDelete}
            disabled={!activeEntry}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-30 hover:bg-red-500/20 flex items-center gap-1 bg-red-500/10 text-red-500"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            删除
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onReset}
              disabled={!activeEntry}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition hover:bg-muted disabled:opacity-30 flex items-center gap-1 bg-muted text-muted-foreground"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              还原
            </button>
            <button
              onClick={onSave}
              disabled={!activeEntry}
              className="px-4 py-1.5 rounded-lg text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-30 flex items-center gap-1 bg-blue-600"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              保存
            </button>
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
