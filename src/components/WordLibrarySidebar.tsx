import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { useStore } from '../store'
import { CloseIcon } from './icons'
import { VAR_MENTION_RE, VAR_START, VAR_END } from '../lib/promptImageMentions'
import { getAgentApiProfile, validateApiProfile } from '../lib/apiProfiles'
import { generateDerivedWordEntries } from '../lib/agentApi'
import type { WordLibraryDerivativeRule } from '../types'

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
  try { localStorage.setItem(SHARED_WIDTH_KEY, JSON.stringify(Math.max(MIN_W, Math.min(MAX_W, w)))) } catch {}
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
  const setPrompt = useStore((s) => s.setPrompt)
  const toast = useStore((s) => s.showToast)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
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
        try { localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pendingPos.current)) } catch {}
        pendingPos.current = null
      }
      if (pendingDock.current !== undefined) {
        try {
          if (pendingDock.current) localStorage.setItem(DOCK_STORAGE_KEY, pendingDock.current)
          else localStorage.removeItem(DOCK_STORAGE_KEY)
        } catch {}
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

  const filtered = useMemo(() => {
    let list = [...entries]
    if (selGroup !== '__all__') list = list.filter((e) => e.groupId === selGroup)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((e) =>
        e.key.toLowerCase().includes(q) ||
        e.label.toLowerCase().includes(q) ||
        e.entries.some((it) => it.toLowerCase().includes(q)),
      )
    }
    list.sort((a, b) => a.key.localeCompare(b.key, 'zh-CN'))
    return list
  }, [entries, selGroup, search])

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
    groups.forEach((g) => { c[g.id] = entries.filter((e) => e.groupId === g.id).length })
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
      const oldMarker = VAR_START + oldEntry.key + VAR_END
      const newMarker = VAR_START + editKey + VAR_END
      if (currentPrompt.includes(oldMarker)) {
        setPrompt(currentPrompt.split(oldMarker).join(newMarker))
      }
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
      const generated = await generateDerivedWordEntries({
        settings,
        profile,
        seedEntry,
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
      const marker = VAR_START + oldEntry.key + VAR_END
      if (currentPrompt.includes(marker)) {
        setPrompt(currentPrompt.split(marker).join(''))
      }
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
      if (h.classList?.contains('wildcard-var')) { plain += VAR_START + (h.dataset.varName ?? h.textContent ?? '') + VAR_END; return }
      n.childNodes.forEach(walk)
    }
    el.childNodes.forEach(walk)
    setPrompt(plain.replace(/\r\n?/g, '\n'))
    return true
  }, [getInputBar, setPrompt])

  const handleInsert = useCallback((entry: { key: string }) => {
    const marker = VAR_START + entry.key + VAR_END
    if (!insertAtCursor(marker)) {
      const current = useStore.getState().prompt
      setPrompt(current + marker)
    }
    toast('已插入词条', 'success')
  }, [insertAtCursor, setPrompt, toast])

  const handleReplace = useCallback((entry: { key: string }) => {
    const marker = VAR_START + entry.key + VAR_END
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
            if (h.classList?.contains('wildcard-var')) { plain += VAR_START + (h.dataset.varName ?? h.textContent ?? '') + VAR_END; return }
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
      const names: string[] = []
      let m
      while ((m = VAR_MENTION_RE.exec(p)) !== null) names.push(m[1])
      for (const v of names) {
        if (!state.wordLibraryEntries.some((e) => e.key === v) && !autoCreated.current.has(v)) {
          autoCreated.current.add(v)
          const ne = state.createWordLibraryEntry('default', v)
          state.updateWordLibraryEntry(ne.id, { entries: [v] })
          lastAdded.current = v
        }
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
      const e = state.wordLibraryEntries.find((it) => it.key === v)
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
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/15 flex items-center justify-center">
              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">词条库</h3>
              <p className="text-[11px] text-muted-foreground leading-tight">{entries.length} 个词条 · {groups.length} 个分组</p>
            </div>
          </div>
        </div>

        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索词条名称或内容..."
            className="w-full pl-9 pr-3 py-2 rounded-xl text-sm placeholder-muted-foreground transition focus:outline-none focus:ring-2 focus:ring-blue-500/25 bg-sidebar border border-border text-foreground"
          />
        </div>
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
            全部 {entries.length}
          </button>
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => setSelGroup(g.id)}
              className="shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition hover:opacity-80 border border-border"
              style={{
                background: selGroup === g.id ? '#2563eb' : undefined,
                color: selGroup === g.id ? '#fff' : undefined,
              }}
            >
              {g.name} {groupCounts[g.id] ?? 0}
            </button>
          ))}
        </div>
      </div>

      {/* ===== Entry list ===== */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-2.5 min-h-0">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <svg className="w-8 h-8 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span className="text-xs">暂无词条</span>
          </div>
        )}
        {filtered.map((entry, i) => {
          const g = groups.find((gr) => gr.id === entry.groupId)
          const isActive = activeId === entry.id
          return (
            <div
              key={entry.id}
              ref={(el) => { cardRefs.current[entry.id] = el }}
              onClick={() => setActiveId(entry.id)}
              className="flex items-center gap-2.5 p-2.5 rounded-xl border transition cursor-pointer mb-1.5 group"
              style={{
                background: isActive ? 'rgba(37,99,235,0.1)' : 'transparent',
                borderColor: isActive ? 'rgba(37,99,235,0.35)' : 'transparent',
              }}
              onMouseEnter={(e) => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = 'hsl(var(--muted) / 0.5)'
              }}
              onMouseLeave={(e) => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-sm ${getColorClass(i)}`}>
                {entry.key ? entry.key[0] : '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate text-sidebar-foreground">{entry.key || '未命名'}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{g?.name ?? '未知'} · {entry.entries.length}条 · 抽{entry.draw_count}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
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
            </div>
          )
        })}
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

      {/* ===== Detail panel (fixed bottom) ===== */}
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
    </div>
  )
}
