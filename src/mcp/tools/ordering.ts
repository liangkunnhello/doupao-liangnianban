// 下单（需求单）板块工具

import { useRequirementPrototype } from '../../features/requirementPrototype/store'
import { planOrderingOrder } from '../../features/ordering/planner'
import type { OrderingDraft, OrderingOrder } from '../../features/ordering/types'
import { errorResult, textResult, type McpToolDefinition } from '../types'
import { clampLimit } from './helpers'

function serializeOrderSummary(order: OrderingOrder) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    totalImages: order.totalImages,
    completedImages: order.completedImages,
    failedImages: order.failedImages,
    unitCount: order.units.length,
    urgentRequested: order.urgentRequested,
    isTest: !!order.isTest,
    createdBy: order.createdByName,
    createdAt: order.createdAt,
  }
}

function buildDraft(args: Record<string, unknown>): OrderingDraft | string {
  const productIds = Array.isArray(args.productIds) ? (args.productIds as unknown[]).filter((id): id is string => typeof id === 'string' && !!id) : []
  const materialTypeIds = Array.isArray(args.materialTypeIds) ? (args.materialTypeIds as unknown[]).filter((id): id is string => typeof id === 'string' && !!id) : []
  const channels = Array.isArray(args.channels)
    ? (args.channels as unknown[])
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const raw = item as Record<string, unknown>
          if (typeof raw.channelId !== 'string' || !raw.channelId) return null
          const ratios = Array.isArray(raw.ratios)
            ? (raw.ratios as unknown[]).filter((ratio): ratio is '16:9' | '9:16' => ratio === '16:9' || ratio === '9:16')
            : []
          return { channelId: raw.channelId, ratios }
        })
        .filter((item): item is OrderingDraft['channels'][number] => item !== null)
    : []
  const quantity = typeof args.quantity === 'number' && Number.isInteger(args.quantity) ? args.quantity : 0
  if (productIds.length === 0) return 'productIds 不能为空'
  if (channels.length === 0 || channels.every((item) => item.ratios.length === 0)) return 'channels 不能为空，且每个渠道至少一个比例（16:9 / 9:16）'
  if (materialTypeIds.length === 0) return 'materialTypeIds 不能为空'
  if (quantity <= 0) return 'quantity 必须是正整数'
  return {
    productIds,
    channels,
    materialTypeIds,
    quantity,
    urgentRequested: args.urgentRequested === true,
    ...(typeof args.urgentReason === 'string' && args.urgentReason ? { urgentReason: args.urgentReason } : {}),
  }
}

const draftSchema = {
  productIds: { type: 'array', items: { type: 'string' }, description: '产品 id 列表（见 ordering_list_catalog）' },
  channels: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        channelId: { type: 'string' },
        ratios: { type: 'array', items: { type: 'string', enum: ['16:9', '9:16'] } },
      },
      required: ['channelId', 'ratios'],
    },
    description: '渠道与画面比例组合',
  },
  materialTypeIds: { type: 'array', items: { type: 'string' }, description: '素材类型 id 列表' },
  quantity: { type: 'integer', description: '每个组合生成的图片张数' },
  urgentRequested: { type: 'boolean', description: '是否申请加急，默认 false' },
  urgentReason: { type: 'string', description: '加急原因' },
} as const

export const orderingTools: McpToolDefinition[] = [
  {
    name: 'ordering_list_catalog',
    description: '列出下单中心的目录：产品、渠道、素材类型（含兼容性、发布状态），以及当前配额设置。创建需求单前先调用本工具获取可用 id。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const state = useRequirementPrototype.getState()
      return textResult({
        products: state.catalog.products.map((item) => ({
          id: item.id, name: item.name, category: item.category, published: item.published, archived: !!item.archived, summary: item.summary,
        })),
        channels: state.catalog.channels.map((item) => ({
          id: item.id, name: item.name, ratios: item.ratios, published: item.published, archived: !!item.archived, summary: item.summary,
        })),
        materialTypes: state.catalog.materialTypes.map((item) => ({
          id: item.id, name: item.name, mode: item.mode, published: item.published, archived: !!item.archived,
          compatibleProductIds: item.compatibleProductIds ?? null,
          compatibleChannelIds: item.compatibleChannelIds ?? null,
          supportedRatios: item.supportedRatios ?? null,
        })),
        settings: state.settings,
      })
    },
  },
  {
    name: 'ordering_preview',
    description: '预演一个需求单：按 产品 × 渠道比例 × 素材类型 展开所有组合，返回将生成的单元数、总图片数、被排除的组合及原因、校验错误。不产生任何任务、不消耗额度。',
    inputSchema: {
      type: 'object',
      properties: { ...draftSchema },
      required: ['productIds', 'channels', 'materialTypeIds', 'quantity'],
      additionalProperties: false,
    },
    handler: (args) => {
      const draft = buildDraft(args)
      if (typeof draft === 'string') return errorResult(draft)
      const state = useRequirementPrototype.getState()
      const preview = planOrderingOrder(draft, state.catalog, {
        maxImagesPerOrder: state.settings.maxImagesPerOrder,
        remainingDailyQuota: state.sessionUserId ? state.remainingQuota(state.sessionUserId) : state.settings.defaultDailyQuota,
      })
      return textResult({
        valid: preview.valid,
        errors: preview.errors,
        totalImages: preview.totalImages,
        unitCount: preview.units.length,
        units: preview.units.map((unit) => ({
          id: unit.id, productId: unit.productId, channelId: unit.channelId, ratio: unit.ratio,
          materialTypeId: unit.materialTypeId, quantity: unit.quantity, prompt: unit.prompt,
        })),
        excluded: preview.excluded,
      })
    },
  },
  {
    name: 'ordering_create',
    description: '创建需求单（真实排队生图、消耗图像 API 额度）。创建后由应用内队列按并发设置自动执行。建议先用 ordering_preview 预演。',
    inputSchema: {
      type: 'object',
      properties: { ...draftSchema },
      required: ['productIds', 'channels', 'materialTypeIds', 'quantity'],
      additionalProperties: false,
    },
    handler: (args) => {
      const draft = buildDraft(args)
      if (typeof draft === 'string') return errorResult(draft)
      const { order, error } = useRequirementPrototype.getState().createOrder(draft)
      if (error || !order) return errorResult(error ?? '需求单创建失败')
      return textResult({ ...serializeOrderSummary(order), message: `需求单 ${order.number} 已创建，将由队列自动执行` })
    },
  },
  {
    name: 'ordering_list',
    description: '列出需求单（编号、状态、图片进度、单元数等），按创建时间倒序。',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['queued', 'running', 'completed', 'partially_failed', 'failed', 'cancelled'], description: '按状态过滤' },
        limit: { type: 'integer', description: '返回条数，默认 20，最大 100' },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      const state = useRequirementPrototype.getState()
      const status = args.status as string | undefined
      const orders = status ? state.orders.filter((order) => order.status === status) : state.orders
      const sorted = [...orders].sort((a, b) => b.createdAt - a.createdAt)
      const limit = clampLimit(args.limit, 20, 100)
      return textResult({ total: sorted.length, orders: sorted.slice(0, limit).map(serializeOrderSummary) })
    },
  },
  {
    name: 'ordering_get',
    description: '获取需求单详情：全部单元（产品/渠道/比例/素材类型/提示词/状态/关联任务 id）与排除组合。',
    inputSchema: {
      type: 'object',
      properties: { orderId: { type: 'string', description: '需求单 id' } },
      required: ['orderId'],
      additionalProperties: false,
    },
    handler: (args) => {
      const order = useRequirementPrototype.getState().orders.find((item) => item.id === args.orderId)
      if (!order) return errorResult(`需求单 ${args.orderId} 不存在`)
      return textResult(order)
    },
  },
  {
    name: 'ordering_cancel',
    description: '取消一个需求单（排队中的单元将不再执行；进行中的任务不受影响）。',
    inputSchema: {
      type: 'object',
      properties: { orderId: { type: 'string', description: '需求单 id' } },
      required: ['orderId'],
      additionalProperties: false,
    },
    handler: (args) => {
      const store = useRequirementPrototype.getState()
      const order = store.orders.find((item) => item.id === args.orderId)
      if (!order) return errorResult(`需求单 ${args.orderId} 不存在`)
      store.cancelOrder(order.id)
      return textResult(`需求单 ${order.number} 已取消`)
    },
  },
  {
    name: 'ordering_retry_unit',
    description: '重试需求单中一个失败的单元（重新排队生图，消耗 API 额度）。',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: '需求单 id' },
        unitId: { type: 'string', description: '单元 id' },
      },
      required: ['orderId', 'unitId'],
      additionalProperties: false,
    },
    handler: (args) => {
      const store = useRequirementPrototype.getState()
      const order = store.orders.find((item) => item.id === args.orderId)
      if (!order) return errorResult(`需求单 ${args.orderId} 不存在`)
      const unit = order.units.find((item) => item.id === args.unitId)
      if (!unit) return errorResult(`单元 ${args.unitId} 不存在于需求单 ${args.orderId}`)
      store.retryUnit(order.id, unit.id)
      return textResult(`单元 ${unit.id} 已重新排队`)
    },
  },
]
