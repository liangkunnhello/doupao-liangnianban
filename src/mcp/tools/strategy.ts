// 策略 / SOP 板块工具

import { submitTaskWithData, useStore } from '../../store'
import { useRequirementPrototype } from '../../features/requirementPrototype/store'
import { generatePromptsFromSopStore, generateSopFromStore } from '../../features/strategy/adapters/storeSopGeneration'
import { requestGallerySopPromptRun } from '../../features/strategy/adapters/gallerySopPromptRunRequest'
import { sopLibraryId } from '../../features/strategy/sopLibrary'
import type { SopGeneratorKind } from '../../features/strategy/sopGeneration'
import type { SopLibraryItem, StrategyAsset } from '../../features/strategy/types'
import { getAllSopBatchSnapshots, getSopBatchSnapshot, putSopBatchSnapshot } from '../../lib/db'
import type { SopBatchSnapshot } from '../../types'
import { errorResult, textResult, type McpToolDefinition } from '../types'
import { clampLimit } from './helpers'

const SOP_KINDS: SopGeneratorKind[] = ['general', 'image-prompt', 'variable-prompt-skill']

function serializeSopSummary(item: SopLibraryItem) {
  return {
    id: item.id,
    groupId: item.groupId ?? null,
    name: item.name,
    description: item.description,
    executionMode: item.executionMode ?? 'prompt-generator',
    source: item.source,
    favorite: !!item.favorite,
    contentLength: item.content.length,
    metaInstructionId: item.metaInstructionId ?? null,
    lastUsedAt: item.lastUsedAt ?? null,
    updatedAt: item.updatedAt,
  }
}

function serializeStrategySummary(asset: StrategyAsset) {
  return {
    id: asset.id,
    name: asset.name,
    productId: asset.productId,
    materialTypeId: asset.materialTypeId,
    description: asset.description,
    generationMode: asset.generationMode,
    quantity: asset.quantity,
    status: asset.status,
    version: asset.version,
    archived: !!asset.archived,
    updatedAt: asset.updatedAt,
  }
}

function serializeBatchSummary(snapshot: SopBatchSnapshot) {
  return {
    id: snapshot.id,
    title: snapshot.title ?? snapshot.sop.name,
    status: snapshot.status ?? 'ready',
    sopId: snapshot.sop.id,
    sopName: snapshot.sop.name,
    promptCount: snapshot.promptCount,
    activePromptCount: snapshot.prompts.filter((prompt) => !prompt.deleted).length,
    imagesPerPrompt: snapshot.imagesPerPrompt,
    brief: snapshot.brief,
    taskIds: snapshot.taskIds ?? [],
    createdAt: snapshot.createdAt,
  }
}

export const strategyTools: McpToolDefinition[] = [
  {
    name: 'sop_list',
    description: '列出 SOP 库：全部分组与 SOP 条目概要（名称、描述、执行模式、内容长度等，不含正文；正文用 sop_get 读取）。可按分组过滤。',
    inputSchema: {
      type: 'object',
      properties: { groupId: { type: 'string', description: '只看某个分组的 SOP' } },
      additionalProperties: false,
    },
    handler: (args) => {
      const state = useRequirementPrototype.getState()
      const groupId = args.groupId as string | undefined
      const items = groupId ? state.sopLibrary.filter((item) => item.groupId === groupId) : state.sopLibrary
      return textResult({
        groups: state.sopGroups.map((group) => ({ id: group.id, name: group.name })),
        metaInstructions: state.sopMetaInstructions.map((meta) => ({ id: meta.id, name: meta.name, description: meta.description })),
        items: items.map(serializeSopSummary),
      })
    },
  },
  {
    name: 'sop_get',
    description: '读取一个 SOP 的完整内容（正文、执行模式、排除文字设置等）。',
    inputSchema: {
      type: 'object',
      properties: { sopId: { type: 'string', description: 'SOP id' } },
      required: ['sopId'],
      additionalProperties: false,
    },
    handler: (args) => {
      const item = useRequirementPrototype.getState().sopLibrary.find((entry) => entry.id === args.sopId)
      if (!item) return errorResult(`SOP ${args.sopId} 不存在`)
      return textResult({ ...serializeSopSummary(item), content: item.content })
    },
  },
  {
    name: 'sop_save',
    description:
      '新建或更新 SOP。传 id 为更新（只覆盖提供的字段）；不传 id 为新建（name 和 content 必填）。executionMode：prompt-generator（交给文本模型二次生成提示词）或 variable-prompt（变量提示词，直接填入生图输入）。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '要更新的 SOP id；不传则新建' },
        groupId: { type: 'string', description: '分组 id' },
        name: { type: 'string', description: '名称' },
        description: { type: 'string', description: '描述' },
        content: { type: 'string', description: 'SOP 正文 / 变量提示词模板' },
        executionMode: { type: 'string', enum: ['prompt-generator', 'variable-prompt'], description: '执行模式' },
        excludeText: { type: 'boolean', description: '变量提示词模式：忽略参考图中的文字与排版' },
        favorite: { type: 'boolean', description: '是否收藏' },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      const store = useRequirementPrototype.getState()
      const now = Date.now()
      if (args.id) {
        const existing = store.sopLibrary.find((entry) => entry.id === args.id)
        if (!existing) return errorResult(`SOP ${args.id} 不存在`)
        const next: SopLibraryItem = {
          ...existing,
          ...(typeof args.groupId === 'string' ? { groupId: args.groupId } : {}),
          ...(typeof args.name === 'string' && args.name.trim() ? { name: args.name.trim() } : {}),
          ...(typeof args.description === 'string' ? { description: args.description } : {}),
          ...(typeof args.content === 'string' && args.content.trim() ? { content: args.content } : {}),
          ...(typeof args.executionMode === 'string' ? { executionMode: args.executionMode as SopLibraryItem['executionMode'] } : {}),
          ...(typeof args.excludeText === 'boolean' ? { excludeText: args.excludeText } : {}),
          ...(typeof args.favorite === 'boolean' ? { favorite: args.favorite } : {}),
          updatedAt: now,
        }
        store.saveSopItem(next)
        return textResult({ id: next.id, message: `SOP「${next.name}」已更新` })
      }

      const name = (args.name as string | undefined)?.trim()
      const content = (args.content as string | undefined)?.trim()
      if (!name || !content) return errorResult('新建 SOP 必须提供 name 和 content')
      if (typeof args.groupId === 'string' && args.groupId && !store.sopGroups.some((group) => group.id === args.groupId)) {
        return errorResult(`分组 ${args.groupId} 不存在`)
      }
      const item: SopLibraryItem = {
        id: sopLibraryId('sop'),
        groupId: typeof args.groupId === 'string' && args.groupId ? args.groupId : undefined,
        name,
        description: typeof args.description === 'string' ? args.description : '',
        content,
        executionMode: (args.executionMode as SopLibraryItem['executionMode']) ?? 'prompt-generator',
        ...(typeof args.excludeText === 'boolean' ? { excludeText: args.excludeText } : {}),
        source: 'manual',
        createdBy: 'mcp',
        createdAt: now,
        updatedAt: now,
        ...(args.favorite === true ? { favorite: true } : {}),
      }
      store.saveSopItem(item)
      return textResult({ id: item.id, message: `SOP「${item.name}」已创建` })
    },
  },
  {
    name: 'sop_delete',
    description: '删除一个 SOP（不可恢复；不影响已生成的提示词批次与画廊任务）。',
    inputSchema: {
      type: 'object',
      properties: { sopId: { type: 'string', description: 'SOP id' } },
      required: ['sopId'],
      additionalProperties: false,
    },
    handler: (args) => {
      const store = useRequirementPrototype.getState()
      const item = store.sopLibrary.find((entry) => entry.id === args.sopId)
      if (!item) return errorResult(`SOP ${args.sopId} 不存在`)
      store.deleteSopItem(item.id)
      return textResult(`SOP「${item.name}」已删除`)
    },
  },
  {
    name: 'sop_generate',
    description:
      '用 AI 根据一段需求描述生成一个 SOP（会调用已配置的文本模型并消耗额度）。kind：general 通用 / image-prompt 生图提示词 SOP / variable-prompt-skill 变量提示词技能。saveToLibrary=true（默认）直接存入 SOP 库。',
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: '需求描述（越具体越好）' },
        kind: { type: 'string', enum: SOP_KINDS, description: '生成类型，默认 general' },
        metaInstructionId: { type: 'string', description: '使用某个元指令（编译器）的自定义指令' },
        product: { type: 'string', description: '相关产品名称（上下文）' },
        materialType: { type: 'string', description: '相关素材类型（上下文）' },
        saveToLibrary: { type: 'boolean', description: '是否保存到 SOP 库，默认 true' },
        groupId: { type: 'string', description: '保存到的分组 id' },
      },
      required: ['description'],
      additionalProperties: false,
    },
    timeoutSeconds: 300,
    handler: async (args) => {
      const description = (args.description as string).trim()
      if (!description) return errorResult('需求描述不能为空')
      const store = useRequirementPrototype.getState()
      let metaInstruction: string | undefined
      if (typeof args.metaInstructionId === 'string' && args.metaInstructionId) {
        const meta = store.sopMetaInstructions.find((item) => item.id === args.metaInstructionId)
        if (!meta) return errorResult(`元指令 ${args.metaInstructionId} 不存在`)
        metaInstruction = meta.instruction
      }
      const generated = await generateSopFromStore(
        description,
        {
          product: typeof args.product === 'string' ? args.product : undefined,
          materialType: typeof args.materialType === 'string' ? args.materialType : undefined,
        },
        [],
        (args.kind as SopGeneratorKind | undefined) ?? 'general',
        metaInstruction,
      )

      const shouldSave = args.saveToLibrary !== false
      if (!shouldSave) return textResult({ saved: false, ...generated })

      const now = Date.now()
      const item: SopLibraryItem = {
        id: sopLibraryId('sop'),
        groupId: typeof args.groupId === 'string' && args.groupId ? args.groupId : undefined,
        name: generated.name,
        description: generated.description,
        content: generated.content,
        executionMode: generated.executionMode,
        source: 'generated',
        createdBy: 'mcp',
        createdAt: now,
        updatedAt: now,
      }
      store.saveSopItem(item)
      return textResult({ saved: true, id: item.id, ...generated })
    },
  },
  {
    name: 'sop_generate_prompts',
    description: '用 AI 按某个 SOP 批量生成具体生图提示词（会调用文本模型并消耗额度）。返回提示词数组；需要落成任务请再调用 sop_submit_prompts 或 generate_image。',
    inputSchema: {
      type: 'object',
      properties: {
        sopId: { type: 'string', description: 'SOP id' },
        quantity: { type: 'integer', description: '生成条数，1-50' },
        brief: { type: 'string', description: '本次生成的补充要求（可选）' },
      },
      required: ['sopId', 'quantity'],
      additionalProperties: false,
    },
    timeoutSeconds: 600,
    handler: async (args) => {
      const sop = useRequirementPrototype.getState().sopLibrary.find((entry) => entry.id === args.sopId)
      if (!sop) return errorResult(`SOP ${args.sopId} 不存在`)
      const quantity = clampLimit(args.quantity, 1, 50)
      const prompts = await generatePromptsFromSopStore(sop, quantity, typeof args.brief === 'string' ? args.brief : '')
      return textResult({ sopId: sop.id, sopName: sop.name, quantity: prompts.length, prompts })
    },
  },
  {
    name: 'sop_start_prompt_batch',
    description: '在豆泡提示词管理界面启动一个真实 SOP 提示词批次（会调用文本模型并消耗额度，但不会自动提交生图）。用于前台流程验证或让用户继续检查、编辑提示词。',
    inputSchema: {
      type: 'object',
      properties: {
        sopId: { type: 'string', description: '生成型 SOP id' },
        quantity: { type: 'integer', description: '生成条数，1-50' },
        imagesPerPrompt: { type: 'integer', description: '每条提示词计划生成的图片数；不传则沿用界面当前设置' },
      },
      required: ['sopId', 'quantity'],
      additionalProperties: false,
    },
    handler: (args) => {
      const sop = useRequirementPrototype.getState().sopLibrary.find((entry) => entry.id === args.sopId)
      if (!sop) return errorResult(`SOP ${args.sopId} 不存在`)
      if ((sop.executionMode ?? 'prompt-generator') !== 'prompt-generator') {
        return errorResult(`SOP ${sop.name} 不是生成型 SOP`)
      }
      const quantity = clampLimit(args.quantity, 1, 50)
      const imagesPerPrompt = args.imagesPerPrompt == null
        ? undefined
        : clampLimit(args.imagesPerPrompt, 1, 20)
      requestGallerySopPromptRun({ sopId: sop.id, quantity, imagesPerPrompt })
      return textResult({ started: true, sopId: sop.id, sopName: sop.name, quantity, imagesPerPrompt })
    },
  },
  {
    name: 'sop_list_batches',
    description: '列出已生成的 SOP 提示词批次（快照）：标题、状态、提示词数、已提交的任务 id 等。',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['generating', 'ready', 'submitted', 'failed'], description: '按状态过滤' },
        limit: { type: 'integer', description: '返回条数，默认 20，最大 100' },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const snapshots = await getAllSopBatchSnapshots().catch(() => [] as SopBatchSnapshot[])
      const status = args.status as string | undefined
      const filtered = status ? snapshots.filter((snapshot) => (snapshot.status ?? 'ready') === status) : snapshots
      const sorted = [...filtered].sort((a, b) => b.createdAt - a.createdAt)
      const limit = clampLimit(args.limit, 20, 100)
      return textResult({ total: sorted.length, batches: sorted.slice(0, limit).map(serializeBatchSummary) })
    },
  },
  {
    name: 'sop_submit_batch',
    description:
      '把一个 SOP 提示词批次提交为画廊生图任务（每条未删除的提示词一个任务，真实消耗图像 API 额度）。imagesPerPrompt 默认沿用批次设置。',
    inputSchema: {
      type: 'object',
      properties: {
        batchId: { type: 'string', description: '批次（快照）id' },
        imagesPerPrompt: { type: 'integer', description: '每条提示词生成张数，默认沿用批次设置' },
      },
      required: ['batchId'],
      additionalProperties: false,
    },
    timeoutSeconds: 300,
    handler: async (args) => {
      const snapshot = await getSopBatchSnapshot(args.batchId as string).catch(() => undefined)
      if (!snapshot) return errorResult(`批次 ${args.batchId} 不存在`)
      const activePrompts = snapshot.prompts.filter((prompt) => !prompt.deleted && prompt.text.trim())
      if (activePrompts.length === 0) return errorResult('该批次没有可提交的提示词')
      const imagesPerPrompt = clampLimit(args.imagesPerPrompt, snapshot.imagesPerPrompt || 1, 16)

      const taskIds: string[] = []
      const failures: string[] = []
      for (const [index, prompt] of activePrompts.entries()) {
        const taskId = await submitTaskWithData(
          {
            prompt: prompt.text.trim(),
            inputImages: [],
            inputImageFolder: null,
            params: { ...snapshot.params, n: imagesPerPrompt },
            maskDraft: null,
            sopBatch: {
              batchId: snapshot.batchId,
              snapshotId: snapshot.id,
              sopId: snapshot.sop.id,
              sopName: snapshot.sop.name,
              promptId: prompt.id,
              promptIndex: index,
              promptCount: activePrompts.length,
              imagesPerPrompt,
            },
          },
          { silentSuccess: true, useCurrentApiProfileWhenReusedMissing: true },
        )
        if (taskId) taskIds.push(taskId)
        else failures.push(prompt.id)
      }

      await putSopBatchSnapshot({ ...snapshot, status: 'submitted', taskIds, updatedAt: Date.now() }).catch(() => undefined)
      return textResult({
        batchId: snapshot.id,
        submitted: taskIds.length,
        taskIds,
        failedPromptIds: failures,
        message: failures.length > 0 ? `已提交 ${taskIds.length} 条，${failures.length} 条提交失败` : `已提交全部 ${taskIds.length} 条提示词`,
      })
    },
  },
  {
    name: 'strategy_list',
    description: '列出策略资产（产品 × 素材类型的生图策略）：名称、状态、版本、数量等。includeArchived=true 含已归档。',
    inputSchema: {
      type: 'object',
      properties: { includeArchived: { type: 'boolean', description: '是否包含已归档策略，默认 false' } },
      additionalProperties: false,
    },
    handler: (args) => {
      const state = useRequirementPrototype.getState()
      const assets = args.includeArchived === true ? state.strategyAssets : state.strategyAssets.filter((asset) => !asset.archived)
      return textResult({
        catalog: {
          products: state.catalog.products.map((product) => ({ id: product.id, name: product.name })),
          materialTypes: state.catalog.materialTypes.map((type) => ({ id: type.id, name: type.name })),
        },
        strategies: assets.map(serializeStrategySummary),
      })
    },
  },
  {
    name: 'strategy_get',
    description: '获取一个策略资产的完整配置（工作流、参考图、输出渠道与尺寸、数量等）。',
    inputSchema: {
      type: 'object',
      properties: { strategyId: { type: 'string', description: '策略 id' } },
      required: ['strategyId'],
      additionalProperties: false,
    },
    handler: (args) => {
      const asset = useRequirementPrototype.getState().strategyAssets.find((item) => item.id === args.strategyId)
      if (!asset) return errorResult(`策略 ${args.strategyId} 不存在`)
      return textResult(asset)
    },
  },
  {
    name: 'strategy_test',
    description: '对一个策略资产发起工作流测试单（按策略配置生成提示词并排队生图，会消耗图像 API 额度）。',
    inputSchema: {
      type: 'object',
      properties: {
        strategyId: { type: 'string', description: '策略 id' },
        quantity: { type: 'integer', description: '生成数量，默认沿用策略配置' },
      },
      required: ['strategyId'],
      additionalProperties: false,
    },
    handler: (args) => {
      const store = useRequirementPrototype.getState()
      const asset = store.strategyAssets.find((item) => item.id === args.strategyId)
      if (!asset) return errorResult(`策略 ${args.strategyId} 不存在`)
      const quantity = clampLimit(args.quantity, asset.quantity || 1, 100)
      const { order, error } = store.createStrategyWorkflowTest(asset.id, quantity)
      if (error || !order) return errorResult(error ?? '测试单创建失败')
      return textResult({ orderId: order.id, message: `策略「${asset.name}」测试单已创建，将由队列自动执行`, order })
    },
  },
]
