import { useEffect, useState } from 'react'
import {
  ChevronDownIcon as ChevronDown,
  ChevronRightIcon as ChevronRight,
  FileTextIcon as FileText,
  FolderIcon as Folder,
  FolderOpenIcon as FolderOpen,
  Layers3Icon as Layers3,
  PlusIcon as Plus,
  SearchIcon as Search,
} from '../../design-system/icons'
import type { StrategyCatalog as RequirementCatalog } from './contracts'
import type { StrategyAsset } from './types'

export type StrategyTreeSelection =
  | { kind: 'all' }
  | { kind: 'product'; productId: string }
  | { kind: 'type'; productId: string; materialTypeId: string }
  | { kind: 'strategy'; productId: string; materialTypeId: string; strategyId: string }

function isSelected(selection: StrategyTreeSelection, kind: StrategyTreeSelection['kind'], id?: string) {
  if (selection.kind !== kind) return false
  if (kind === 'all') return true
  if (kind === 'product') return selection.kind === 'product' && selection.productId === id
  if (kind === 'type') return selection.kind === 'type' && selection.materialTypeId === id
  return selection.kind === 'strategy' && selection.strategyId === id
}

function InlineName({
  value,
  editing,
  onBegin,
  onCommit,
}: {
  value: string
  editing: boolean
  onBegin: () => void
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  if (!editing) {
    return <span onDoubleClick={(event) => { event.stopPropagation(); onBegin() }} className="min-w-0 flex-1 truncate">{value}</span>
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(draft)
        if (event.key === 'Escape') onCommit(value)
      }}
      className="h-8 min-w-0 flex-1 rounded-lg border border-blue-500 bg-white px-2 text-sm outline-none ring-2 ring-blue-100 dark:bg-gray-900 dark:ring-blue-950"
    />
  )
}

export default function StrategyTree({
  catalog,
  strategies,
  selection,
  onSelect,
  onRenameProduct,
  onRenameType,
  onRenameStrategy,
  onCreateStrategy,
  onMoveStrategy,
}: {
  catalog: RequirementCatalog
  strategies: StrategyAsset[]
  selection: StrategyTreeSelection
  onSelect: (selection: StrategyTreeSelection) => void
  onRenameProduct: (id: string, name: string) => void
  onRenameType: (id: string, name: string) => void
  onRenameStrategy: (id: string, name: string) => void
  onCreateStrategy: (productId: string, materialTypeId: string) => void
  onMoveStrategy: (strategyId: string, productId: string, materialTypeId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [expandedProducts, setExpandedProducts] = useState(() => new Set(catalog.products.map((item) => item.id)))
  const [expandedTypes, setExpandedTypes] = useState(() => new Set(
    catalog.products.flatMap((product) => catalog.materialTypes.map((item) => `${product.id}:${item.id}`)),
  ))
  const [editingKey, setEditingKey] = useState('')
  const [dropTarget, setDropTarget] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setter((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-gray-200/80 bg-white/70 backdrop-blur dark:border-white/[0.08] dark:bg-gray-950/70">
      <div className="border-b border-gray-200/80 p-4 dark:border-white/[0.08]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">策略库</h2>
            <p className="mt-1 text-xs text-gray-500">按 SKU 与素材类型管理</p>
          </div>
          <span className="rounded-md bg-gray-200 px-2 py-1 text-xs tabular-nums text-gray-600 dark:bg-gray-800 dark:text-gray-300">{strategies.length}</span>
        </div>
        <label className="mt-3 flex h-10 items-center gap-2 rounded-xl border border-gray-200/80 bg-gray-50/80 px-3 transition focus-within:border-blue-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100 dark:border-white/[0.08] dark:bg-white/[0.04] dark:focus-within:border-blue-500/60 dark:focus-within:bg-white/[0.06] dark:focus-within:ring-blue-950">
          <Search size={14} className="text-gray-400" aria-hidden="true" />
          <span className="sr-only">搜索策略库</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 SKU、类型或策略" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-gray-400" />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5" role="tree" aria-label="策略库层级">
        <button
          onClick={() => onSelect({ kind: 'all' })}
          className={`mb-1 flex h-10 w-full cursor-pointer items-center gap-2 rounded-xl px-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${isSelected(selection, 'all') ? 'bg-blue-50 font-medium text-blue-700 shadow-sm ring-1 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/[0.06]'}`}
          role="treeitem"
        >
          <Layers3 size={15} aria-hidden="true" />
          全部策略
        </button>
        {catalog.products.filter((product) => !product.archived).map((product) => {
          const productStrategies = strategies.filter((item) => item.productId === product.id)
          const productMatches = !normalizedQuery
            || product.name.toLocaleLowerCase().includes(normalizedQuery)
            || productStrategies.some((item) => item.name.toLocaleLowerCase().includes(normalizedQuery))
          if (!productMatches) return null
          const productExpanded = expandedProducts.has(product.id)
          return (
            <div key={product.id} role="treeitem" aria-expanded={productExpanded}>
              <div className={`group flex h-10 items-center rounded-xl pr-1 transition ${isSelected(selection, 'product', product.id) ? 'bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/[0.06]'}`}>
                <button onClick={() => toggleSet(setExpandedProducts, product.id)} aria-label={`${productExpanded ? '折叠' : '展开'}${product.name}`} className="flex h-9 w-8 cursor-pointer items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                  {productExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <button onClick={() => onSelect({ kind: 'product', productId: product.id })} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-sm focus-visible:outline-none">
                  {productExpanded ? <FolderOpen size={15} className="text-amber-500" /> : <Folder size={15} className="text-amber-500" />}
                  <InlineName
                    value={product.name}
                    editing={editingKey === `product:${product.id}`}
                    onBegin={() => setEditingKey(`product:${product.id}`)}
                    onCommit={(name) => { setEditingKey(''); if (name.trim()) onRenameProduct(product.id, name.trim()) }}
                  />
                  <span className="text-xs tabular-nums text-gray-400">{productStrategies.length}</span>
                </button>
              </div>
              {productExpanded && (
                <div className="ml-4 border-l border-gray-200 pl-2 dark:border-gray-800" role="group">
                  {catalog.materialTypes.filter((type) => !type.archived).map((materialType) => {
                    const typeStrategies = productStrategies.filter((item) => item.materialTypeId === materialType.id)
                    const typeMatches = !normalizedQuery
                      || product.name.toLocaleLowerCase().includes(normalizedQuery)
                      || materialType.name.toLocaleLowerCase().includes(normalizedQuery)
                      || typeStrategies.some((item) => item.name.toLocaleLowerCase().includes(normalizedQuery))
                    if (!typeMatches) return null
                    const typeExpanded = expandedTypes.has(`${product.id}:${materialType.id}`)
                    const targetKey = `${product.id}:${materialType.id}`
                    return (
                      <div key={targetKey} role="treeitem" aria-expanded={typeExpanded}>
                        <div
                          onDragOver={(event) => { event.preventDefault(); setDropTarget(targetKey) }}
                          onDragLeave={() => setDropTarget('')}
                          onDrop={(event) => {
                            event.preventDefault()
                            setDropTarget('')
                            const strategyId = event.dataTransfer.getData('application/x-strategy-id')
                            if (strategyId) onMoveStrategy(strategyId, product.id, materialType.id)
                          }}
                          className={`group flex min-h-9 items-center rounded-lg pr-1 transition ${dropTarget === targetKey ? 'bg-blue-100 ring-2 ring-blue-400 dark:bg-blue-500/20' : isSelected(selection, 'type', materialType.id) && selection.kind === 'type' && selection.productId === product.id ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]'}`}
                        >
                          <button onClick={() => toggleSet(setExpandedTypes, targetKey)} aria-label={`${typeExpanded ? '折叠' : '展开'}${materialType.name}`} className="flex h-8 w-7 cursor-pointer items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                            {typeExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </button>
                          <button onClick={() => onSelect({ kind: 'type', productId: product.id, materialTypeId: materialType.id })} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-xs focus-visible:outline-none">
                            <Folder size={14} className="text-blue-500" />
                            <InlineName
                              value={materialType.name}
                              editing={editingKey === `type:${materialType.id}`}
                              onBegin={() => setEditingKey(`type:${materialType.id}`)}
                              onCommit={(name) => { setEditingKey(''); if (name.trim()) onRenameType(materialType.id, name.trim()) }}
                            />
                            <span className="text-xs tabular-nums text-gray-400">{typeStrategies.length}</span>
                          </button>
                          <button onClick={() => onCreateStrategy(product.id, materialType.id)} aria-label={`在${materialType.name}中新建策略`} title="新建策略" className="flex h-7 w-7 cursor-pointer items-center justify-center rounded opacity-0 transition hover:bg-white group-hover:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-gray-700">
                            <Plus size={13} />
                          </button>
                        </div>
                        {typeExpanded && (
                          <div className="ml-4 border-l border-gray-200 pl-2 dark:border-gray-800" role="group">
                            {typeStrategies.map((strategy) => (
                              <button
                                key={strategy.id}
                                draggable
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = 'move'
                                  event.dataTransfer.setData('application/x-strategy-id', strategy.id)
                                }}
                                onClick={() => onSelect({ kind: 'strategy', productId: product.id, materialTypeId: materialType.id, strategyId: strategy.id })}
                                className={`flex min-h-9 w-full cursor-grab items-center gap-2 rounded-lg px-2.5 text-left text-xs transition active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${isSelected(selection, 'strategy', strategy.id) ? 'bg-blue-600 font-medium text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]'}`}
                                role="treeitem"
                              >
                                <FileText size={13} aria-hidden="true" />
                                <InlineName
                                  value={strategy.name}
                                  editing={editingKey === `strategy:${strategy.id}`}
                                  onBegin={() => setEditingKey(`strategy:${strategy.id}`)}
                                  onCommit={(name) => { setEditingKey(''); if (name.trim()) onRenameStrategy(strategy.id, name.trim()) }}
                                />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="border-t border-gray-200/80 px-4 py-2.5 text-xs leading-4 text-gray-400 dark:border-white/[0.08]">
        双击重命名 · 拖到素材类型可移动
      </div>
    </aside>
  )
}
