import {
  CheckIcon as Check,
  CloseIcon as X,
  Edit2Icon as Edit2,
  PlusIcon as Plus,
  TrashIcon as Trash2,
} from '../../../design-system/icons'
import { useState } from 'react'
import { useCompositeV2Store } from '../storeV2'
import type { CompositeV2OutputRuleGroup, CompositeV2OutputSizeRule } from '../lib/compositeV2Types'

export function GlobalOutputRulesPanel() {
  const outputRuleGroups = useCompositeV2Store((state) => state.outputRuleGroups)
  const globalFitMode = useCompositeV2Store((state) => state.globalFitMode)
  const setGlobalFitMode = useCompositeV2Store((state) => state.setGlobalFitMode)
  const setOutputRuleGroupEnabled = useCompositeV2Store((state) => state.setOutputRuleGroupEnabled)
  const updateOutputRule = useCompositeV2Store((state) => state.updateOutputRule)
  const addOutputRuleGroup = useCompositeV2Store((state) => state.addOutputRuleGroup)
  const updateOutputRuleGroup = useCompositeV2Store((state) => state.updateOutputRuleGroup)
  const deleteOutputRuleGroup = useCompositeV2Store((state) => state.deleteOutputRuleGroup)
  const addOutputRule = useCompositeV2Store((state) => state.addOutputRule)
  const deleteOutputRule = useCompositeV2Store((state) => state.deleteOutputRule)

  const builtinGroups = ['gdt-toutiao', 'baidu', 'vendor']

  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')

  function handleAddGroup() {
    const id = `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    addOutputRuleGroup('新分类', id)
    setEditingGroupId(id)
    setEditingGroupName('新分类')
  }

  function handleRenameGroup(group: CompositeV2OutputRuleGroup) {
    setEditingGroupId(group.id)
    setEditingGroupName(group.name)
  }

  function saveRenameGroup() {
    if (editingGroupId && editingGroupName.trim()) {
      updateOutputRuleGroup(editingGroupId, { name: editingGroupName.trim() })
    }
    setEditingGroupId(null)
  }

  function handleDeleteGroup(groupId: string) {
    if (confirm('确定要删除这个分类吗？')) {
      deleteOutputRuleGroup(groupId)
    }
  }

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [editingRuleData, setEditingRuleData] = useState<{ width: number; height: number; kb: number }>({ width: 0, height: 0, kb: 0 })

  function handleEditRule(rule: CompositeV2OutputSizeRule) {
    setEditingRuleId(rule.id)
    setEditingRuleData({ width: rule.width, height: rule.height, kb: rule.maxSizeKb })
  }

  function saveEditRule() {
    if (editingRuleId) {
      updateOutputRule(editingRuleId, {
        width: editingRuleData.width,
        height: editingRuleData.height,
        maxSizeKb: editingRuleData.kb,
        name: `${editingRuleData.width}x${editingRuleData.height}`,
        enabled: true
      })
    }
    setEditingRuleId(null)
  }

  function handleAddRule(groupId: string) {
    const id = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    addOutputRule(groupId, {
      id,
      name: `1080x1920`,
      enabled: true,
      width: 1080,
      height: 1920,
      maxSizeKb: 399,
      format: 'jpg',
      subfolderTemplate: '{channel}/{size}',
      filenameTemplate: '{preset}-{source}-{index}',
    } as any) // ignore type error for 'id' omit
    
    // Auto-enter edit mode for the newly added rule
    setEditingRuleId(id)
    setEditingRuleData({ width: 1080, height: 1920, kb: 399 })
  }

  return (
    <section className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">全局输出尺寸 / 最大 KB</h2>
          <p className="mt-1 text-[11px] text-gray-500">预设默认共用这些规则；已启用规则决定每张背景的输出数量。</p>
        </div>
        <label className="text-xs text-gray-500">
          非等比适配
          <select
            value={globalFitMode}
            onChange={(event) => setGlobalFitMode(event.target.value as any)}
            className="ml-2 rounded-md border border-gray-200 px-2 py-1 dark:border-white/[0.08] dark:bg-gray-900"
          >
            <option value="crop-fill">裁切填满</option>
            <option value="contain-blur">完整留边（模糊背景）</option>
            <option value="stretch">拉伸变形</option>
          </select>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-4">
        {outputRuleGroups.map((group) => {
          const isBuiltin = builtinGroups.includes(group.id)
          const isEditing = editingGroupId === group.id
          const allEnabled = group.rules.length > 0 && group.rules.every((r) => r.enabled)

          return (
            <div
              key={group.id}
              className="flex shrink-0 flex-col rounded-xl border border-gray-200 bg-gray-50/50 shadow-sm dark:border-white/[0.08] dark:bg-gray-900/30 transition-[width]"
              style={{ width: group.rules.length > 4 ? `${Math.ceil(group.rules.length / 4) * 198 + 32}px` : '230px' }}
            >
              <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5 dark:border-white/[0.06]">
                <div className="flex flex-1 items-center gap-2 min-w-0">
                  <input
                    type="checkbox"
                    checked={allEnabled}
                    onChange={(e) => setOutputRuleGroupEnabled(group.id, e.target.checked)}
                    className="shrink-0"
                    aria-label={`全选 ${group.name} 尺寸`}
                  />
                  {isEditing ? (
                    <div className="flex flex-1 items-center gap-1 min-w-0">
                      <input
                        autoFocus
                        value={editingGroupName}
                        onChange={(e) => setEditingGroupName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && saveRenameGroup()}
                        className="min-w-0 flex-1 rounded border border-blue-300 px-1 text-sm outline-none dark:border-blue-500/50 dark:bg-gray-800"
                      />
                      <button type="button" onClick={saveRenameGroup} className="shrink-0 rounded p-1 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/20">
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <span className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">
                      {group.name}
                    </span>
                  )}
                </div>

                {!isEditing && (
                  <div className="flex shrink-0 items-center gap-1 pl-2">
                    <button
                      type="button"
                      onClick={() => handleRenameGroup(group)}
                      className="text-gray-400 hover:text-blue-500 dark:hover:text-blue-400"
                      title="重命名分类"
                      aria-label={`重命名分类 ${group.name}`}
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddRule(group.id)}
                      className="text-gray-400 hover:text-green-500 dark:hover:text-green-400"
                      title="添加尺寸"
                      aria-label={`在 ${group.name} 中添加尺寸`}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    {!isBuiltin && (
                      <button
                        type="button"
                        onClick={() => handleDeleteGroup(group.id)}
                        className="text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                        title="删除分类"
                        aria-label={`删除分类 ${group.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-col p-1.5">
                <div className="grid grid-flow-col grid-rows-4 gap-1.5 h-[130px]" style={{ gridAutoColumns: 'minmax(190px, 1fr)' }}>
                  {group.rules.map((rule) => {
                    const isRuleEditing = editingRuleId === rule.id
                    return (
                      <div
                        key={rule.id}
                        className={`group relative flex items-center justify-between rounded-lg border px-1.5 py-0.5 transition-colors ${
                          rule.enabled && !isRuleEditing
                            ? 'border-blue-400 bg-white dark:border-blue-500/80 dark:bg-gray-950'
                            : 'border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-950'
                        }`}
                      >
                        
                        <div className="relative z-10 flex items-center gap-1 text-xs w-full">
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            onChange={(e) => updateOutputRule(rule.id, { enabled: e.target.checked })}
                            aria-label={`启用规则 ${rule.name}`}
                            className="shrink-0 mr-1 cursor-pointer"
                          />
                          <input 
                              type="number" 
                              value={isRuleEditing ? editingRuleData.width : rule.width} 
                              onChange={(e) => {
                                if (!rule.enabled) updateOutputRule(rule.id, { enabled: true })
                                if (!isRuleEditing) {
                                  setEditingRuleId(rule.id)
                                  setEditingRuleData({ width: Number(e.target.value), height: rule.height, kb: rule.maxSizeKb })
                                } else {
                                  setEditingRuleData(d => ({ ...d, width: Number(e.target.value) }))
                                }
                              }} 
                              onBlur={() => isRuleEditing && saveEditRule()}
                              className="w-[46px] rounded border border-gray-200 bg-white px-0.5 py-0.5 text-[13px] outline-none text-center dark:border-white/[0.08] dark:bg-gray-800" 
                            />
                            <span className="text-gray-400">×</span>
                            <input 
                              type="number" 
                              value={isRuleEditing ? editingRuleData.height : rule.height} 
                              onChange={(e) => {
                                if (!rule.enabled) updateOutputRule(rule.id, { enabled: true })
                                if (!isRuleEditing) {
                                  setEditingRuleId(rule.id)
                                  setEditingRuleData({ width: rule.width, height: Number(e.target.value), kb: rule.maxSizeKb })
                                } else {
                                  setEditingRuleData(d => ({ ...d, height: Number(e.target.value) }))
                                }
                              }} 
                              onBlur={() => isRuleEditing && saveEditRule()}
                              className="w-[46px] rounded border border-gray-200 bg-white px-0.5 py-0.5 text-[13px] outline-none text-center dark:border-white/[0.08] dark:bg-gray-800" 
                            />
                            <input 
                              type="number" 
                              value={isRuleEditing ? editingRuleData.kb : rule.maxSizeKb} 
                              onChange={(e) => {
                                if (!rule.enabled) updateOutputRule(rule.id, { enabled: true })
                                if (!isRuleEditing) {
                                  setEditingRuleId(rule.id)
                                  setEditingRuleData({ width: rule.width, height: rule.height, kb: Number(e.target.value) })
                                } else {
                                  setEditingRuleData(d => ({ ...d, kb: Number(e.target.value) }))
                                }
                              }} 
                              onBlur={() => isRuleEditing && saveEditRule()}
                              className="w-[42px] rounded border border-gray-200 bg-white px-0.5 py-0.5 text-[13px] outline-none text-center dark:border-white/[0.08] dark:bg-gray-800 ml-1" 
                            />
                          <span className="text-gray-400 text-xs">kb</span>
                        </div>

                      <div className="relative z-10 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteOutputRule(group.id, rule.id)
                          }}
                          className="rounded-full p-1 text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-500/20 dark:hover:text-red-400 transition-opacity"
                          title="删除尺寸"
                          aria-label={`删除尺寸 ${rule.name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}

        <button
          type="button"
          onClick={handleAddGroup}
          className="flex w-[160px] shrink-0 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/30 text-gray-500 transition-colors hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-600 dark:border-white/[0.08] dark:bg-gray-900/10 dark:hover:border-blue-500/50 dark:hover:bg-blue-500/10 dark:hover:text-blue-400"
        >
          <Plus className="h-6 w-6" />
          <span className="text-sm font-medium">新建分类</span>
        </button>
      </div>
    </section>
  )
}
