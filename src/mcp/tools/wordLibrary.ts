// 词库板块工具

import { useStore } from '../../store'
import type { WordLibraryEntry } from '../../types'
import { errorResult, textResult, type McpToolDefinition } from '../types'
import { clampLimit } from './helpers'

function serializeEntry(entry: WordLibraryEntry) {
  return {
    id: entry.id,
    groupId: entry.groupId,
    key: entry.key,
    label: entry.label,
    entries: entry.entries,
    drawCount: entry.draw_count,
    isPinned: !!entry.isPinned,
    isFavorite: !!entry.isFavorite,
    tags: entry.tags ?? [],
    usageCount: entry.usageCount ?? 0,
    deletedAt: entry.deletedAt ?? null,
  }
}

export const wordLibraryTools: McpToolDefinition[] = [
  {
    name: 'wordlib_list_groups',
    description: '列出词库分组（树形：id、名称、父分组、词条数、是否归档）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const state = useStore.getState()
      return textResult({
        groups: state.wordLibraryGroups.map((group) => ({
          id: group.id,
          name: group.name,
          parentId: group.parentId ?? null,
          archived: !!group.archivedAt,
          entryCount: state.wordLibraryEntries.filter((entry) => entry.groupId === group.id && !entry.deletedAt).length,
        })),
      })
    },
  },
  {
    name: 'wordlib_list_entries',
    description: '列出词库词条（key、label、候选词数组、标签、使用次数等）。支持按分组、关键词（匹配 key/label/候选词）过滤；includeDeleted=true 含回收站。',
    inputSchema: {
      type: 'object',
      properties: {
        groupId: { type: 'string', description: '按分组过滤' },
        search: { type: 'string', description: '关键词过滤（匹配 key / label / 候选词）' },
        includeDeleted: { type: 'boolean', description: '是否包含回收站词条，默认 false' },
        limit: { type: 'integer', description: '返回条数，默认 100，最大 500' },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      let entries = useStore.getState().wordLibraryEntries
      if (args.includeDeleted !== true) entries = entries.filter((entry) => !entry.deletedAt)
      const groupId = args.groupId as string | undefined
      if (groupId) entries = entries.filter((entry) => entry.groupId === groupId)
      const search = (args.search as string | undefined)?.trim().toLowerCase()
      if (search) {
        entries = entries.filter((entry) =>
          entry.key.toLowerCase().includes(search)
          || (entry.label ?? '').toLowerCase().includes(search)
          || entry.entries.some((value) => value.toLowerCase().includes(search)),
        )
      }
      const limit = clampLimit(args.limit, 100, 500)
      return textResult({ total: entries.length, entries: entries.slice(0, limit).map(serializeEntry) })
    },
  },
  {
    name: 'wordlib_create_entry',
    description: '新建词库词条。groupId 必填（先用 wordlib_list_groups 查询）；key 为变量名（如「场景」），entries 为候选词数组。',
    inputSchema: {
      type: 'object',
      properties: {
        groupId: { type: 'string', description: '分组 id' },
        key: { type: 'string', description: '变量名' },
        label: { type: 'string', description: '显示名（可选）' },
        entries: { type: 'array', items: { type: 'string' }, description: '候选词数组' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签' },
      },
      required: ['groupId', 'key', 'entries'],
      additionalProperties: false,
    },
    handler: (args) => {
      const state = useStore.getState()
      const group = state.wordLibraryGroups.find((item) => item.id === args.groupId)
      if (!group) return errorResult(`分组 ${args.groupId} 不存在`)
      const key = (args.key as string).trim()
      if (!key) return errorResult('变量名 key 不能为空')
      const values = (args.entries as unknown[]).map((value) => String(value).trim()).filter(Boolean)
      if (values.length === 0) return errorResult('候选词 entries 不能为空')

      const entry = state.createWordLibraryEntry(group.id, key)
      useStore.getState().updateWordLibraryEntry(entry.id, {
        label: typeof args.label === 'string' ? args.label : entry.label,
        entries: values,
        ...(Array.isArray(args.tags) ? { tags: (args.tags as unknown[]).map(String) } : {}),
      })
      const created = useStore.getState().wordLibraryEntries.find((item) => item.id === entry.id)
      return textResult({ message: `词条「${key}」已创建`, entry: created ? serializeEntry(created) : { id: entry.id } })
    },
  },
  {
    name: 'wordlib_update_entry',
    description: '更新词库词条（只覆盖提供的字段：key/label/候选词/标签/置顶/收藏/分组）。',
    inputSchema: {
      type: 'object',
      properties: {
        entryId: { type: 'string', description: '词条 id' },
        key: { type: 'string', description: '变量名' },
        label: { type: 'string', description: '显示名' },
        entries: { type: 'array', items: { type: 'string' }, description: '候选词数组（覆盖式）' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签（覆盖式）' },
        isPinned: { type: 'boolean', description: '是否置顶' },
        isFavorite: { type: 'boolean', description: '是否收藏' },
        groupId: { type: 'string', description: '移动到目标分组 id' },
      },
      required: ['entryId'],
      additionalProperties: false,
    },
    handler: (args) => {
      const state = useStore.getState()
      const entry = state.wordLibraryEntries.find((item) => item.id === args.entryId)
      if (!entry) return errorResult(`词条 ${args.entryId} 不存在`)
      const patch: Partial<WordLibraryEntry> = {}
      if (typeof args.key === 'string' && args.key.trim()) patch.key = args.key.trim()
      if (typeof args.label === 'string') patch.label = args.label
      if (Array.isArray(args.entries)) {
        const values = (args.entries as unknown[]).map((value) => String(value).trim()).filter(Boolean)
        if (values.length === 0) return errorResult('候选词 entries 不能为空')
        patch.entries = values
      }
      if (Array.isArray(args.tags)) patch.tags = (args.tags as unknown[]).map(String)
      if (typeof args.isPinned === 'boolean') patch.isPinned = args.isPinned
      if (typeof args.isFavorite === 'boolean') patch.isFavorite = args.isFavorite
      if (typeof args.groupId === 'string' && args.groupId) {
        if (!state.wordLibraryGroups.some((group) => group.id === args.groupId)) return errorResult(`分组 ${args.groupId} 不存在`)
        patch.groupId = args.groupId
      }
      if (Object.keys(patch).length === 0) return errorResult('没有提供要修改的字段')
      state.updateWordLibraryEntry(entry.id, patch)
      return textResult(`词条「${patch.key ?? entry.key}」已更新`)
    },
  },
  {
    name: 'wordlib_delete_entries',
    description: '删除词库词条。permanent=false（默认）移入回收站（可恢复）；permanent=true 永久删除（不可恢复）。',
    inputSchema: {
      type: 'object',
      properties: {
        entryIds: { type: 'array', items: { type: 'string' }, description: '词条 id 列表' },
        permanent: { type: 'boolean', description: '是否永久删除，默认 false' },
      },
      required: ['entryIds'],
      additionalProperties: false,
    },
    handler: (args) => {
      const ids = (args.entryIds as unknown[]).filter((id): id is string => typeof id === 'string' && !!id)
      if (ids.length === 0) return errorResult('entryIds 不能为空')
      const state = useStore.getState()
      const existing = new Set(state.wordLibraryEntries.map((entry) => entry.id))
      const validIds = ids.filter((id) => existing.has(id))
      if (validIds.length === 0) return errorResult('所有词条 id 都不存在')
      if (args.permanent === true) {
        state.destroyWordLibraryEntries(validIds)
        return textResult(`已永久删除 ${validIds.length} 个词条`)
      }
      state.batchDeleteWordLibraryEntries(validIds)
      return textResult(`已将 ${validIds.length} 个词条移入回收站`)
    },
  },
  {
    name: 'wordlib_restore_entries',
    description: '从回收站恢复词库词条。',
    inputSchema: {
      type: 'object',
      properties: { entryIds: { type: 'array', items: { type: 'string' }, description: '词条 id 列表' } },
      required: ['entryIds'],
      additionalProperties: false,
    },
    handler: (args) => {
      const ids = (args.entryIds as unknown[]).filter((id): id is string => typeof id === 'string' && !!id)
      if (ids.length === 0) return errorResult('entryIds 不能为空')
      useStore.getState().restoreWordLibraryEntries(ids)
      return textResult(`已恢复 ${ids.length} 个词条`)
    },
  },
]
