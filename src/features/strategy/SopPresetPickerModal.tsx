import { useMemo, useState, type DragEvent } from 'react'
import {
  BookOpenCheckIcon as BookOpenCheck,
  ChevronDownIcon as ChevronDown,
  CloseIcon as X,
  CopyIcon as Copy,
  GripVerticalIcon as GripVertical,
  PencilIcon as Pencil,
  SaveIcon as Save,
} from '../../design-system/icons'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import type { SopGroup, SopLibraryItem } from './types'

const UNGROUPED_GROUP_ID = 'ungrouped'

export default function SopPresetPickerModal({
  items,
  groups,
  selectedSopId,
  onSelect,
  onClear,
  onManage,
  onSaveItem,
  onDuplicateItem,
  onClose,
}: {
  items: SopLibraryItem[]
  groups: SopGroup[]
  selectedSopId?: string
  onSelect: (item: SopLibraryItem) => void
  onClear?: () => void
  onManage?: () => void
  onSaveItem?: (item: SopLibraryItem) => void
  onDuplicateItem?: (itemId: string) => string | null
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([])
  const [expandedSopId, setExpandedSopId] = useState('')
  const [editingSopId, setEditingSopId] = useState('')
  const [editDraft, setEditDraft] = useState<SopLibraryItem | null>(null)
  const [movingSopId, setMovingSopId] = useState('')
  const [draggedSopId, setDraggedSopId] = useState('')
  const [dropGroupId, setDropGroupId] = useState('')
  const [feedback, setFeedback] = useState('')
  useCloseOnEscape(true, onClose)

  const visibleGroups = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    const matches = (item: SopLibraryItem) => !query || `${item.name} ${item.description} ${item.content}`.toLocaleLowerCase().includes(query)
    const showEmptyGroups = !query || Boolean(draggedSopId)
    const grouped = groups
      .map((group) => ({ id: group.id, name: group.name, items: items.filter((item) => item.groupId === group.id && matches(item)) }))
      .filter((group) => showEmptyGroups || group.items.length)
    const ungrouped = items.filter((item) => !item.groupId && matches(item))
    return (showEmptyGroups || ungrouped.length)
      ? [...grouped, { id: UNGROUPED_GROUP_ID, name: '未分组', items: ungrouped }]
      : grouped
  }, [draggedSopId, groups, items, search])
  const hasVisibleItems = visibleGroups.some((group) => group.items.length > 0)

  const getGroupName = (groupId: string) => groupId === UNGROUPED_GROUP_ID
    ? '未分组'
    : groups.find((group) => group.id === groupId)?.name ?? '未分组'

  const moveItem = (itemId: string, targetGroupId: string) => {
    const item = items.find((candidate) => candidate.id === itemId)
    if (!item || !onSaveItem) return
    const nextGroupId = targetGroupId === UNGROUPED_GROUP_ID ? undefined : targetGroupId
    if (item.groupId === nextGroupId) {
      setMovingSopId('')
      return
    }
    onSaveItem({ ...item, groupId: nextGroupId, updatedAt: Date.now() })
    setFeedback(`已移动到「${getGroupName(targetGroupId)}」`)
    setMovingSopId('')
    setDraggedSopId('')
    setDropGroupId('')
  }

  const handleDragStart = (event: DragEvent<HTMLElement>, item: SopLibraryItem) => {
    if (!onSaveItem) return
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.id)
    setDraggedSopId(item.id)
  }

  const handleDrop = (event: DragEvent<HTMLElement>, targetGroupId: string) => {
    event.preventDefault()
    const itemId = event.dataTransfer.getData('text/plain') || draggedSopId
    if (itemId) moveItem(itemId, targetGroupId)
  }

  const startEditing = (item: SopLibraryItem) => {
    setEditingSopId(item.id)
    setEditDraft(item)
    setExpandedSopId(item.id)
    setMovingSopId('')
  }

  const saveEditing = () => {
    if (!editDraft || !onSaveItem || !editDraft.name.trim() || !editDraft.content.trim()) return
    onSaveItem({
      ...editDraft,
      name: editDraft.name.trim(),
      description: editDraft.description.trim(),
      content: editDraft.content.trim(),
      updatedAt: Date.now(),
    })
    setFeedback('已保存')
    setEditingSopId('')
    setEditDraft(null)
  }

  const duplicateItem = (item: SopLibraryItem) => {
    const copiedId = onDuplicateItem?.(item.id)
    if (!copiedId) return
    setExpandedSopId(copiedId)
    setFeedback('已复制')
  }

  return (
    <div className="fixed inset-0 z-[var(--ds-z-modal)] flex items-center justify-center bg-black/40 p-4 animate-overlay-in motion-reduce:animate-none" role="dialog" aria-modal="true" aria-labelledby="sop-preset-dialog-title">
      <div className="flex h-[min(82vh,760px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl animate-modal-in motion-reduce:animate-none dark:border-white/[0.1] dark:bg-gray-900">
        <header className="flex items-start justify-between gap-4 border-b border-gray-200/80 p-5 dark:border-white/[0.08]">
          <div>
            <h3 id="sop-preset-dialog-title" className="text-lg font-semibold">选择 SOP 预设</h3>
            <p className="mt-1 text-sm text-gray-500">选择后应用 SOP 内容。</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onManage && <button type="button" onClick={onManage} aria-label="打开 SOP 库" className="flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium text-violet-700 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-300 dark:hover:bg-violet-500/10"><BookOpenCheck size={16} />SOP 库</button>}
            <button type="button" onClick={onClose} aria-label="关闭 SOP 预设弹窗" className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-gray-300 dark:hover:bg-white/[0.06]"><X size={18} /></button>
          </div>
        </header>

        <div className="flex flex-col gap-3 border-b border-gray-200/80 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-white/[0.08]">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">共 {items.length} 个 SOP 预设</p>
          <label className="w-full sm:max-w-sm">
            <span className="sr-only">搜索 SOP 预设</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 SOP 名称或说明" className="h-10 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 dark:border-gray-700 dark:bg-gray-950 dark:focus:ring-violet-950" />
          </label>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {feedback && <p role="status" className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs text-violet-700 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-200">{feedback}</p>}
          {onClear && <button type="button" onClick={onClear} aria-pressed={!selectedSopId} className={`flex min-h-10 w-full items-center rounded-xl border px-3 text-left text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${!selectedSopId ? 'border-violet-400 bg-violet-50 text-violet-800 dark:border-violet-400/50 dark:bg-violet-500/10 dark:text-violet-200' : 'border-gray-200/80 text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.05]'}`}>不使用 SOP</button>}

          {visibleGroups.map((group) => {
            const collapsed = collapsedGroups.includes(group.id)
            const isDropTarget = dropGroupId === group.id
            return <section
              key={group.id}
              data-sop-drop-group={group.id}
              onDragEnter={(event) => { if (draggedSopId) { event.preventDefault(); setDropGroupId(group.id) } }}
              onDragOver={(event) => { if (draggedSopId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropGroupId(group.id) } }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropGroupId((current) => current === group.id ? '' : current) }}
              onDrop={(event) => handleDrop(event, group.id)}
              className={`overflow-hidden rounded-xl border transition ${isDropTarget ? 'border-violet-500 bg-violet-50/70 ring-2 ring-violet-300/50 dark:border-violet-400 dark:bg-violet-500/10 dark:ring-violet-500/20' : 'border-gray-200/80 dark:border-white/[0.08]'}`}
            >
              <button type="button" onClick={() => setCollapsedGroups((current) => collapsed ? current.filter((id) => id !== group.id) : [...current, group.id])} aria-expanded={!collapsed} className="flex min-h-10 w-full items-center gap-2 bg-gray-50 px-3 text-left text-sm font-semibold transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 dark:bg-white/[0.05] dark:hover:bg-white/[0.08]">
                <ChevronDown size={15} className={`shrink-0 text-gray-400 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <span className="text-xs font-medium text-gray-400">{group.items.length}</span>
              </button>

              {!collapsed && <div className="space-y-1.5 p-2">
                {group.items.map((item) => {
                  const selected = selectedSopId === item.id
                  const expanded = expandedSopId === item.id
                  const editing = editingSopId === item.id
                  const moving = movingSopId === item.id
                  return <article key={item.id} draggable={Boolean(onSaveItem)} onDragStart={(event) => handleDragStart(event, item)} onDragEnd={() => { setDraggedSopId(''); setDropGroupId('') }} aria-grabbed={draggedSopId === item.id} className={`rounded-lg border transition ${draggedSopId === item.id ? 'opacity-50' : ''} ${selected ? 'border-violet-400 bg-violet-50/60 dark:border-violet-400/50 dark:bg-violet-500/10' : 'border-gray-200/80 bg-white dark:border-white/[0.08] dark:bg-white/[0.02]'}`}>
                    <div className="flex min-w-0 items-center gap-2.5 px-2.5 py-2">
                      {onSaveItem && <span aria-hidden="true" className="shrink-0 cursor-grab text-gray-300 active:cursor-grabbing dark:text-gray-600"><GripVertical size={14} /></span>}
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs font-semibold text-gray-600 dark:bg-white/[0.06] dark:text-gray-200">{item.name.trim().slice(0, 1) || 'S'}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{item.name}</p>
                        <p className="truncate text-[11px] leading-4 text-gray-500">{item.description || item.content || '未填写说明'}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                        <button type="button" onClick={() => setExpandedSopId(expanded ? '' : item.id)} aria-expanded={expanded} className="h-8 rounded-md px-2 text-xs font-medium text-gray-600 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-gray-300 dark:hover:bg-white/[0.08]">{expanded ? '收起' : '预览'}</button>
                        {onSaveItem && <button type="button" onClick={() => startEditing(item)} aria-label={`编辑 ${item.name}`} title="编辑" className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-gray-300 dark:hover:bg-white/[0.08] dark:hover:text-violet-300"><Pencil size={14} /></button>}
                        {onDuplicateItem && <button type="button" onClick={() => duplicateItem(item)} aria-label={`复制 ${item.name}`} title="复制" className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-gray-300 dark:hover:bg-white/[0.08] dark:hover:text-violet-300"><Copy size={14} /></button>}
                        {onSaveItem && <button type="button" onClick={() => { setMovingSopId(moving ? '' : item.id); setEditingSopId('') }} aria-expanded={moving} className="h-8 rounded-md px-2 text-xs font-medium text-gray-600 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-gray-300 dark:hover:bg-white/[0.08]">移动</button>}
                        <button type="button" onClick={() => onSelect(item)} className={`h-8 rounded-md px-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${selected ? 'bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:hover:bg-violet-500/25' : 'bg-violet-600 text-white hover:bg-violet-700'}`}>{selected ? '已选' : '选择'}</button>
                      </div>
                    </div>

                    {moving && <div className="border-t border-gray-200/80 px-2.5 py-2 dark:border-white/[0.08]">
                      <select aria-label={`移动 ${item.name} 到分组`} value={item.groupId ?? UNGROUPED_GROUP_ID} onChange={(event) => moveItem(item.id, event.target.value)} className="h-8 min-w-36 rounded-md border border-gray-300 bg-white px-2 text-xs outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 dark:border-gray-700 dark:bg-gray-950 dark:focus:ring-violet-950">
                        <option value={UNGROUPED_GROUP_ID}>未分组</option>
                        {groups.map((targetGroup) => <option key={targetGroup.id} value={targetGroup.id}>{targetGroup.name}</option>)}
                      </select>
                    </div>}

                    {editing && editDraft && <form onSubmit={(event) => { event.preventDefault(); saveEditing() }} className="space-y-2 border-t border-gray-200/80 p-2.5 dark:border-white/[0.08]">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-300">名称<input value={editDraft.name} onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })} className="mt-1 h-8 w-full rounded-md border border-gray-300 bg-white px-2 text-xs outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 dark:border-gray-700 dark:bg-gray-950 dark:focus:ring-violet-950" /></label>
                        <label className="text-xs font-medium text-gray-600 dark:text-gray-300">分组<select value={editDraft.groupId ?? UNGROUPED_GROUP_ID} onChange={(event) => setEditDraft({ ...editDraft, groupId: event.target.value === UNGROUPED_GROUP_ID ? undefined : event.target.value })} className="mt-1 h-8 w-full rounded-md border border-gray-300 bg-white px-2 text-xs outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 dark:border-gray-700 dark:bg-gray-950 dark:focus:ring-violet-950"><option value={UNGROUPED_GROUP_ID}>未分组</option>{groups.map((targetGroup) => <option key={targetGroup.id} value={targetGroup.id}>{targetGroup.name}</option>)}</select></label>
                      </div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">说明<textarea value={editDraft.description} onChange={(event) => setEditDraft({ ...editDraft, description: event.target.value })} className="mt-1 min-h-16 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs leading-5 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 dark:border-gray-700 dark:bg-gray-950 dark:focus:ring-violet-950" /></label>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-300">SOP 正文<textarea value={editDraft.content} onChange={(event) => setEditDraft({ ...editDraft, content: event.target.value })} className="mt-1 min-h-32 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-xs leading-5 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 dark:border-gray-700 dark:bg-gray-950 dark:focus:ring-violet-950" /></label>
                      <div className="flex justify-end gap-2"><button type="button" onClick={() => { setEditingSopId(''); setEditDraft(null) }} className="h-8 rounded-md px-2.5 text-xs font-medium text-gray-600 transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-gray-300 dark:hover:bg-white/[0.08]">取消</button><button type="submit" disabled={!editDraft.name.trim() || !editDraft.content.trim()} className="flex h-8 items-center gap-1.5 rounded-md bg-violet-600 px-2.5 text-xs font-medium text-white transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50"><Save size={14} />保存</button></div>
                    </form>}

                    {expanded && !editing && <div className="border-t border-gray-200/80 px-2.5 py-2 text-xs leading-5 text-gray-600 dark:border-white/[0.08] dark:text-gray-300">{item.content || '该预设未填写 SOP 内容。'}</div>}
                  </article>
                })}
                {draggedSopId && group.items.length === 0 && <div className="rounded-md border border-dashed border-violet-300 px-3 py-3 text-center text-xs text-violet-700 dark:border-violet-400/40 dark:text-violet-300">释放即可移至“{group.name}”</div>}
              </div>}
            </section>
          })}
          {!hasVisibleItems && <p className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-white/[0.12]">{search ? '没有匹配的 SOP 预设' : '暂无可用 SOP 预设'}</p>}
        </div>
      </div>
    </div>
  )
}
