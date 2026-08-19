// 收藏夹与工作区标签页工具

import {
  createFavoriteCollection,
  deleteFavoriteCollection,
  getTaskFavoriteCollectionIds,
  renameFavoriteCollection,
  updateTasksFavoriteCollections,
  useStore,
} from '../../store'
import { errorResult, textResult, type McpToolDefinition } from '../types'

export const favoritesTools: McpToolDefinition[] = [
  {
    name: 'favorites_list',
    description: '列出全部收藏夹（id、名称、创建时间）以及每个收藏夹包含的任务数。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const state = useStore.getState()
      const collections = state.favoriteCollections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        createdAt: collection.createdAt,
        updatedAt: collection.updatedAt,
        taskCount: state.tasks.filter((task) => getTaskFavoriteCollectionIds(task).includes(collection.id)).length,
      }))
      return textResult({
        totalFavorites: state.tasks.filter((task) => task.isFavorite).length,
        collections,
      })
    },
  },
  {
    name: 'favorites_create',
    description: '新建收藏夹。同名收藏夹已存在时直接返回已有的。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: '收藏夹名称（最长 60 字符）' } },
      required: ['name'],
      additionalProperties: false,
    },
    handler: (args) => {
      const collection = createFavoriteCollection(args.name as string)
      if (!collection) return errorResult('创建失败：名称为空或超过 60 个字符')
      return textResult(collection)
    },
  },
  {
    name: 'favorites_rename',
    description: '重命名收藏夹。',
    inputSchema: {
      type: 'object',
      properties: {
        collectionId: { type: 'string', description: '收藏夹 id' },
        name: { type: 'string', description: '新名称' },
      },
      required: ['collectionId', 'name'],
      additionalProperties: false,
    },
    handler: (args) => {
      const collection = useStore.getState().favoriteCollections.find((item) => item.id === args.collectionId)
      if (!collection) return errorResult(`收藏夹 ${args.collectionId} 不存在`)
      renameFavoriteCollection(collection.id, args.name as string)
      return textResult(`收藏夹已重命名为「${(args.name as string).trim()}」`)
    },
  },
  {
    name: 'favorites_delete',
    description: '删除收藏夹。deleteTasks=true 时会连同夹内任务一起删除（不可恢复）；默认仅删除收藏夹、任务保留为未分组收藏。',
    inputSchema: {
      type: 'object',
      properties: {
        collectionId: { type: 'string', description: '收藏夹 id' },
        deleteTasks: { type: 'boolean', description: '是否连同夹内任务一起删除，默认 false' },
      },
      required: ['collectionId'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const collection = useStore.getState().favoriteCollections.find((item) => item.id === args.collectionId)
      if (!collection) return errorResult(`收藏夹 ${args.collectionId} 不存在`)
      await deleteFavoriteCollection(collection.id, args.deleteTasks === true)
      return textResult(`收藏夹「${collection.name}」已删除${args.deleteTasks === true ? '（含夹内任务）' : ''}`)
    },
  },
  {
    name: 'favorites_assign',
    description: '把一批任务设置到指定收藏夹（覆盖式；传空数组表示移出所有收藏夹并取消收藏）。',
    inputSchema: {
      type: 'object',
      properties: {
        taskIds: { type: 'array', items: { type: 'string' }, description: '任务 id 列表' },
        collectionIds: { type: 'array', items: { type: 'string' }, description: '目标收藏夹 id 列表' },
      },
      required: ['taskIds', 'collectionIds'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const taskIds = (args.taskIds as unknown[]).filter((id): id is string => typeof id === 'string' && !!id)
      const collectionIds = (args.collectionIds as unknown[]).filter((id): id is string => typeof id === 'string' && !!id)
      const existingTasks = new Set(useStore.getState().tasks.map((task) => task.id))
      const validTaskIds = taskIds.filter((id) => existingTasks.has(id))
      if (validTaskIds.length === 0) return errorResult('没有有效的任务 id')
      await updateTasksFavoriteCollections(validTaskIds, collectionIds)
      return textResult(`已将 ${validTaskIds.length} 个任务设置到 ${collectionIds.length} 个收藏夹`)
    },
  },
]

export const workspaceTabTools: McpToolDefinition[] = [
  {
    name: 'tabs_list',
    description: '列出画廊的工作区标签页（id、名称、分组、任务数、提示词摘要、是否当前激活）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const state = useStore.getState()
      return textResult({
        activeTabId: state.activeWorkspaceTabId,
        groups: state.workspaceTabGroups.map((group) => ({ id: group.id, name: group.name })),
        tabs: state.workspaceTabs.map((tab) => ({
          id: tab.id,
          name: tab.name,
          groupId: tab.groupId,
          taskCount: tab.tasks.length,
          prompt: tab.prompt.length > 80 ? `${tab.prompt.slice(0, 80)}…` : tab.prompt,
          isActive: tab.id === state.activeWorkspaceTabId,
          updatedAt: tab.updatedAt,
        })),
      })
    },
  },
  {
    name: 'tabs_create',
    description: '新建画廊工作区标签页并返回其 id（不会自动切换）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const id = useStore.getState().createWorkspaceTab()
      return textResult({ id, message: '标签页已创建' })
    },
  },
  {
    name: 'tabs_rename',
    description: '重命名工作区标签页。',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'string', description: '标签页 id' },
        name: { type: 'string', description: '新名称' },
      },
      required: ['tabId', 'name'],
      additionalProperties: false,
    },
    handler: (args) => {
      const tab = useStore.getState().workspaceTabs.find((item) => item.id === args.tabId)
      if (!tab) return errorResult(`标签页 ${args.tabId} 不存在`)
      useStore.getState().renameWorkspaceTab(tab.id, args.name as string)
      return textResult(`标签页已重命名为「${(args.name as string).trim()}」`)
    },
  },
  {
    name: 'tabs_close',
    description: '关闭工作区标签页（其任务仍保留在画廊中）。',
    inputSchema: {
      type: 'object',
      properties: { tabId: { type: 'string', description: '标签页 id' } },
      required: ['tabId'],
      additionalProperties: false,
    },
    handler: (args) => {
      const tab = useStore.getState().workspaceTabs.find((item) => item.id === args.tabId)
      if (!tab) return errorResult(`标签页 ${args.tabId} 不存在`)
      useStore.getState().closeWorkspaceTab(tab.id)
      return textResult(`标签页「${tab.name}」已关闭`)
    },
  },
  {
    name: 'tabs_switch',
    description: '切换到指定工作区标签页（会把当前输入区状态存入原标签页，并载入目标标签页的提示词/参数）。',
    inputSchema: {
      type: 'object',
      properties: { tabId: { type: 'string', description: '标签页 id' } },
      required: ['tabId'],
      additionalProperties: false,
    },
    handler: (args) => {
      const tab = useStore.getState().workspaceTabs.find((item) => item.id === args.tabId)
      if (!tab) return errorResult(`标签页 ${args.tabId} 不存在`)
      useStore.getState().setActiveWorkspaceTabId(tab.id)
      return textResult(`已切换到标签页「${tab.name}」`)
    },
  },
]
