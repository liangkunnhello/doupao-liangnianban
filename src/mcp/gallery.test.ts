import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type StoredImage, type StoredImageThumbnail, type TaskRecord } from '../types'

vi.mock('../lib/db', () => {
  const tasks = new Map<string, TaskRecord>()
  const images = new Map<string, StoredImage>()
  const thumbnails = new Map<string, StoredImageThumbnail>()
  return {
    CURRENT_THUMBNAIL_VERSION: 3,
    getMigrationJournal: async () => undefined,
    putMigrationJournal: async () => undefined,
    getAllTasks: async () => [...tasks.values()],
    loadTasksIncrementally: async (migrate: (task: TaskRecord) => TaskRecord) => {
      const loaded: TaskRecord[] = []
      for (const task of tasks.values()) {
        const migrated = migrate(task)
        tasks.set(task.id, migrated)
        loaded.push(migrated)
      }
      return loaded
    },
    putTask: async (task: TaskRecord) => task.id,
    deleteTask: async (id: string) => {
      tasks.delete(id)
    },
    clearTasks: async () => {
      tasks.clear()
    },
    batchPutTasks: async (list: TaskRecord[]) => {
      for (const task of list) tasks.set(task.id, task)
    },
    getSopBatchSnapshot: async () => undefined,
    getAllSopBatchSnapshots: async () => [],
    putSopBatchSnapshot: async () => 'x',
    deleteSopBatchSnapshot: async () => undefined,
    clearSopBatchSnapshots: async () => undefined,
    getAllAgentConversations: async () => [],
    putAgentConversation: async () => 'x',
    deleteAgentConversation: async () => undefined,
    clearAgentConversations: async () => undefined,
    replaceAgentConversations: async () => undefined,
    getWordLibraryState: async () => undefined,
    putWordLibraryState: async () => undefined,
    getCompositeAsset: async () => undefined,
    putCompositeAsset: async () => 'x',
    deleteCompositeAsset: async () => undefined,
    batchGetCompositeAssets: async () => new Map(),
    putCompositeAssets: async () => undefined,
    getImage: async (id: string) => images.get(id),
    getStoredImageThumbnail: async (id: string) => thumbnails.get(id),
    getStoredFreshImageThumbnail: async (id: string) => thumbnails.get(id),
    putImageThumbnail: async (thumbnail: StoredImageThumbnail) => thumbnail.id,
    getImageThumbnail: async (id: string) => thumbnails.get(id),
    getAllImages: async () => [...images.values()],
    getAllImageIds: async () => [...images.keys()],
    getLegacyImageBatch: async () => [],
    putImage: async (image: StoredImage) => image.id,
    deleteImage: async (id: string) => {
      images.delete(id)
      thumbnails.delete(id)
    },
    clearImages: async () => {
      images.clear()
      thumbnails.clear()
    },
    getAllLocalImagePaths: async () => [],
    hashDataUrl: async () => 'hash',
    storeImage: async () => 'stored-image-id',
    batchDeleteImages: async () => undefined,
    batchGetImages: async () => new Map(),
    getStorageRecordCounts: async () => ({ tasks: 0, images: 0, thumbnails: 0, conversations: 0, compositeAssets: 0 }),
    commitImportedRecords: async () => undefined,
    updateImageLocalPaths: async () => undefined,
  }
})

vi.mock('../lib/api', () => ({
  callImageApi: vi.fn(async () => ({ images: [], actualParams: {}, actualParamsList: [], revisedPrompts: [] })),
}))
vi.mock('../lib/agentApi', () => ({
  callAgentConversationTitleApi: vi.fn(async () => '标题'),
  callAgentResponsesApi: vi.fn(() => new Promise(() => {})),
  callBatchImageSingle: vi.fn(),
}))

import { executeMcpTool, registerMcpTools } from './registry'
import { favoritesTools, workspaceTabTools } from './tools/favorites'
import { galleryTools } from './tools/gallery'
import { useStore } from '../store'

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: '一只猫',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}

function resultText(result: Awaited<ReturnType<typeof executeMcpTool>>): string {
  return (result.content[0] as { text: string }).text
}

beforeEach(() => {
  registerMcpTools([...galleryTools, ...favoritesTools, ...workspaceTabTools])
  useStore.setState({
    tasks: [],
    favoriteCollections: [],
    workspaceTabs: [],
    workspaceTabGroups: [],
    activeWorkspaceTabId: null,
    showToast: vi.fn(),
  })
})

describe('gallery MCP 工具', () => {
  it('gallery_list_tasks 支持状态过滤与分页', async () => {
    useStore.setState({
      tasks: [
        task({ id: 't1', prompt: '猫', status: 'done', createdAt: 3 }),
        task({ id: 't2', prompt: '狗', status: 'error', error: '失败', createdAt: 2 }),
        task({ id: 't3', prompt: '猫和狗', status: 'done', createdAt: 1 }),
      ],
    })
    const all = await executeMcpTool('gallery_list_tasks', {})
    expect(resultText(all)).toContain('"total": 3')

    const failed = JSON.parse(resultText(await executeMcpTool('gallery_list_tasks', { status: 'error' })))
    expect(failed.total).toBe(1)
    expect(failed.tasks[0].id).toBe('t2')

    const searched = JSON.parse(resultText(await executeMcpTool('gallery_list_tasks', { search: '猫' })))
    expect(searched.total).toBe(2)
    // 按创建时间倒序
    expect(searched.tasks[0].id).toBe('t1')

    const paged = JSON.parse(resultText(await executeMcpTool('gallery_list_tasks', { limit: 1, offset: 1 })))
    expect(paged.tasks).toHaveLength(1)
    expect(paged.tasks[0].id).toBe('t2')
  })

  it('gallery_list_tasks 按收藏夹过滤', async () => {
    useStore.setState({
      favoriteCollections: [{ id: 'col-1', name: '精选', createdAt: 1, updatedAt: 1 }],
      tasks: [
        task({ id: 't1', isFavorite: true, favoriteCollectionIds: ['col-1'] }),
        task({ id: 't2', isFavorite: false }),
      ],
    })
    const result = JSON.parse(resultText(await executeMcpTool('gallery_list_tasks', { collectionId: 'col-1' })))
    expect(result.total).toBe(1)
    expect(result.tasks[0].id).toBe('t1')
  })

  it('gallery_get_task 返回详情，未知任务报错', async () => {
    useStore.setState({ tasks: [task({ id: 't1', outputImages: ['img-1'] })] })
    const detail = JSON.parse(resultText(await executeMcpTool('gallery_get_task', { taskId: 't1' })))
    expect(detail.id).toBe('t1')
    expect(detail.outputImageIds).toEqual(['img-1'])

    const missing = await executeMcpTool('gallery_get_task', { taskId: 'nope' })
    expect(missing.isError).toBe(true)
  })

  it('task_update 修改提示词与参数', async () => {
    useStore.setState({ tasks: [task({ id: 't1' })] })
    const result = await executeMcpTool('task_update', { taskId: 't1', prompt: '新提示词', params: { size: '1024x1024' } })
    expect(result.isError).toBeUndefined()
    const updated = useStore.getState().tasks.find((item) => item.id === 't1')!
    expect(updated.prompt).toBe('新提示词')
    expect(updated.params.size).toBe('1024x1024')
  })

  it('task_delete 删除存在的任务并跳过不存在的', async () => {
    useStore.setState({ tasks: [task({ id: 't1' }), task({ id: 't2' })] })
    const result = JSON.parse(resultText(await executeMcpTool('task_delete', { taskIds: ['t1', 'ghost'] })))
    expect(result.deleted).toEqual(['t1'])
    expect(result.skipped).toEqual(['ghost'])
    expect(useStore.getState().tasks.map((item) => item.id)).toEqual(['t2'])
  })

  it('gallery_clear_failed 只清失败任务', async () => {
    useStore.setState({ tasks: [task({ id: 't1', status: 'error' }), task({ id: 't2', status: 'done' })] })
    await executeMcpTool('gallery_clear_failed', {})
    expect(useStore.getState().tasks.map((item) => item.id)).toEqual(['t2'])
  })

  it('favorites 全流程：创建 → 指派 → 列表 → 删除', async () => {
    useStore.setState({ tasks: [task({ id: 't1' })] })
    const created = JSON.parse(resultText(await executeMcpTool('favorites_create', { name: '我的收藏' })))
    expect(created.id).toBeTruthy()

    await executeMcpTool('favorites_assign', { taskIds: ['t1'], collectionIds: [created.id] })
    const listed = JSON.parse(resultText(await executeMcpTool('favorites_list', {})))
    const mine = listed.collections.find((item: { id: string }) => item.id === created.id)
    expect(mine.name).toBe('我的收藏')
    expect(mine.taskCount).toBe(1)

    await executeMcpTool('favorites_delete', { collectionId: created.id })
    expect(useStore.getState().favoriteCollections.find((item) => item.id === created.id)).toBeUndefined()
  })

  it('tabs 创建/重命名/切换/关闭', async () => {
    const created = JSON.parse(resultText(await executeMcpTool('tabs_create', {})))
    expect(created.id).toBeTruthy()

    await executeMcpTool('tabs_rename', { tabId: created.id, name: '新标签' })
    await executeMcpTool('tabs_switch', { tabId: created.id })
    const listed = JSON.parse(resultText(await executeMcpTool('tabs_list', {})))
    expect(listed.tabs[0].name).toBe('新标签')
    expect(listed.activeTabId).toBe(created.id)

    await executeMcpTool('tabs_close', { tabId: created.id })
    // 关闭最后一个标签页时应用会自动补一个新标签页，因此断言被关闭的 id 已不存在
    expect(useStore.getState().workspaceTabs.find((item) => item.id === created.id)).toBeUndefined()
  })
})
