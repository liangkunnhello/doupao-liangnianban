// 日程板块工具

import { useStore } from '../../store'
import { errorResult, textResult, type McpToolDefinition } from '../types'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

function serializeScheduleItem(item: ReturnType<typeof getItems>[number]) {
  return {
    id: item.id,
    rowId: item.rowId,
    taskId: item.taskId,
    collectionId: item.collectionId,
    date: item.date,
    time: item.time,
    count: item.count,
    status: item.status ?? 'idle',
    lastTaskIds: item.lastTaskIds ?? [],
    lastError: item.lastError ?? null,
  }
}

function getItems() {
  return useStore.getState().schedule.items
}

export const scheduleTools: McpToolDefinition[] = [
  {
    name: 'schedule_list',
    description: '查看日程编排：行（分组）、全部日程项（关联的收藏任务/收藏夹、日期、时间、张数、状态、最近生成的任务 id）、当前周与运行中的周。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const schedule = useStore.getState().schedule
      return textResult({
        activeWeekStart: schedule.activeWeekStart,
        runningWeekStarts: schedule.runningWeekStarts,
        rows: schedule.rows,
        items: schedule.items.map(serializeScheduleItem),
      })
    },
  },
  {
    name: 'schedule_add_item',
    description:
      '新增日程项：在指定日期按某个收藏任务（或收藏夹）自动生图。taskId 必须是已收藏任务（gallery_list_tasks favorite=true 可查）；date 格式 YYYY-MM-DD；time 可选（HH:MM，不传则按行内顺序执行）；count 为生成张数。',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '已收藏的画廊任务 id' },
        collectionId: { type: 'string', description: '收藏夹 id（可选，与 taskId 配合）' },
        date: { type: 'string', description: '运行日期 YYYY-MM-DD' },
        rowId: { type: 'string', description: '日程行 id；不传则用第一行' },
        count: { type: 'integer', description: '生成张数，默认 1' },
        time: { type: 'string', description: '触发时间 HH:MM（可选）' },
      },
      required: ['taskId', 'date'],
      additionalProperties: false,
    },
    handler: (args) => {
      const state = useStore.getState()
      const task = state.tasks.find((item) => item.id === args.taskId)
      if (!task) return errorResult(`任务 ${args.taskId} 不存在`)
      if (!task.isFavorite) return errorResult('日程项必须关联已收藏的任务（先用 favorites_assign 收藏）')
      const date = args.date as string
      if (!DATE_PATTERN.test(date)) return errorResult('date 格式必须是 YYYY-MM-DD')
      const time = args.time as string | undefined
      if (time !== undefined && !TIME_PATTERN.test(time)) return errorResult('time 格式必须是 HH:MM（24 小时制）')
      const rows = state.schedule.rows
      if (rows.length === 0) return errorResult('当前没有日程行')
      const rowId = (args.rowId as string | undefined) ?? rows[0].id
      if (!rows.some((row) => row.id === rowId)) return errorResult(`日程行 ${rowId} 不存在`)
      const count = typeof args.count === 'number' && Number.isInteger(args.count) && args.count > 0 ? args.count : 1
      const collectionId = typeof args.collectionId === 'string' && args.collectionId ? args.collectionId : null
      if (collectionId && !state.favoriteCollections.some((item) => item.id === collectionId)) {
        return errorResult(`收藏夹 ${collectionId} 不存在`)
      }

      const id = state.addScheduleItem({
        taskId: task.id,
        collectionId,
        date,
        rowId,
        count,
        time: time ?? null,
        status: 'idle',
      })
      return textResult({ id, message: `日程项已创建：${date}${time ? ` ${time}` : ''} 按任务「${task.prompt.slice(0, 30)}」生成 ${count} 张` })
    },
  },
  {
    name: 'schedule_update_item',
    description: '更新日程项（日期/时间/张数/行/关联任务或收藏夹，只覆盖提供的字段）。',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: { type: 'string', description: '日程项 id' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        time: { type: ['string', 'null'], description: 'HH:MM 或 null（改为不定时）' },
        count: { type: 'integer', description: '生成张数' },
        rowId: { type: 'string', description: '日程行 id' },
        taskId: { type: 'string', description: '关联的收藏任务 id' },
        collectionId: { type: ['string', 'null'], description: '收藏夹 id 或 null' },
      },
      required: ['itemId'],
      additionalProperties: false,
    },
    handler: (args) => {
      const state = useStore.getState()
      const item = state.schedule.items.find((entry) => entry.id === args.itemId)
      if (!item) return errorResult(`日程项 ${args.itemId} 不存在`)
      const patch: Record<string, unknown> = {}
      if (typeof args.date === 'string') {
        if (!DATE_PATTERN.test(args.date)) return errorResult('date 格式必须是 YYYY-MM-DD')
        patch.date = args.date
      }
      if (args.time === null) patch.time = null
      else if (typeof args.time === 'string') {
        if (!TIME_PATTERN.test(args.time)) return errorResult('time 格式必须是 HH:MM（24 小时制）')
        patch.time = args.time
      }
      if (typeof args.count === 'number') {
        if (!Number.isInteger(args.count) || args.count <= 0) return errorResult('count 必须是正整数')
        patch.count = args.count
      }
      if (typeof args.rowId === 'string') {
        if (!state.schedule.rows.some((row) => row.id === args.rowId)) return errorResult(`日程行 ${args.rowId} 不存在`)
        patch.rowId = args.rowId
      }
      if (typeof args.taskId === 'string') {
        const task = state.tasks.find((entry) => entry.id === args.taskId)
        if (!task) return errorResult(`任务 ${args.taskId} 不存在`)
        if (!task.isFavorite) return errorResult('日程项必须关联已收藏的任务')
        patch.taskId = args.taskId
      }
      if (args.collectionId === null) patch.collectionId = null
      else if (typeof args.collectionId === 'string') {
        if (!state.favoriteCollections.some((entry) => entry.id === args.collectionId)) return errorResult(`收藏夹 ${args.collectionId} 不存在`)
        patch.collectionId = args.collectionId
      }
      if (Object.keys(patch).length === 0) return errorResult('没有提供要修改的字段')
      state.updateScheduleItem(item.id, patch)
      return textResult(`日程项 ${item.id} 已更新`)
    },
  },
  {
    name: 'schedule_remove_item',
    description: '删除日程项（不可恢复；不影响已生成的任务）。',
    inputSchema: {
      type: 'object',
      properties: { itemId: { type: 'string', description: '日程项 id' } },
      required: ['itemId'],
      additionalProperties: false,
    },
    handler: (args) => {
      const state = useStore.getState()
      const item = state.schedule.items.find((entry) => entry.id === args.itemId)
      if (!item) return errorResult(`日程项 ${args.itemId} 不存在`)
      state.removeScheduleItem(item.id)
      return textResult(`日程项 ${item.id} 已删除`)
    },
  },
  {
    name: 'schedule_run_now',
    description: '立即执行一个日程项（真实调用图像 API 生图并消耗额度），返回新任务 id。',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: { type: 'string', description: '日程项 id' },
        count: { type: 'integer', description: '覆盖生成张数（可选）' },
      },
      required: ['itemId'],
      additionalProperties: false,
    },
    timeoutSeconds: 180,
    handler: async (args) => {
      const state = useStore.getState()
      const item = state.schedule.items.find((entry) => entry.id === args.itemId)
      if (!item) return errorResult(`日程项 ${args.itemId} 不存在`)
      const countOverride = typeof args.count === 'number' && Number.isInteger(args.count) && args.count > 0 ? args.count : undefined
      const taskId = await state.runScheduleItem(item.id, new Date(), countOverride)
      if (!taskId) return errorResult('执行失败：请检查任务/API 配置（应用内有详细提示）')
      return textResult({ taskId, message: '日程项已触发，任务已提交' })
    },
  },
  {
    name: 'schedule_start_week',
    description: '启动指定周的日程自动执行（不传则当前激活周）。启动后应用到点自动触发日程项。',
    inputSchema: {
      type: 'object',
      properties: { weekStart: { type: 'string', description: '周一日期 YYYY-MM-DD；不传则当前激活周' } },
      additionalProperties: false,
    },
    handler: (args) => {
      const state = useStore.getState()
      const weekStart = (args.weekStart as string | undefined) ?? state.schedule.activeWeekStart
      if (!DATE_PATTERN.test(weekStart)) return errorResult('weekStart 格式必须是 YYYY-MM-DD')
      state.startScheduleWeek(weekStart)
      return textResult(`日程周 ${weekStart} 已启动`)
    },
  },
  {
    name: 'schedule_stop_week',
    description: '停止指定周的日程自动执行（不传则当前激活周）。',
    inputSchema: {
      type: 'object',
      properties: { weekStart: { type: 'string', description: '周一日期 YYYY-MM-DD；不传则当前激活周' } },
      additionalProperties: false,
    },
    handler: (args) => {
      const state = useStore.getState()
      const weekStart = (args.weekStart as string | undefined) ?? state.schedule.activeWeekStart
      if (!DATE_PATTERN.test(weekStart)) return errorResult('weekStart 格式必须是 YYYY-MM-DD')
      state.stopScheduleWeek(weekStart)
      return textResult(`日程周 ${weekStart} 已停止`)
    },
  },
]
