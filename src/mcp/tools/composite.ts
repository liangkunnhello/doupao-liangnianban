// 后期处理 / 合成板块工具（首版为只读查询 + 历史记录）

import { useCompositeV2Store } from '../../features/composite/storeV2'
import { errorResult, textResult, type McpToolDefinition } from '../types'
import { clampLimit } from './helpers'

export const compositeTools: McpToolDefinition[] = [
  {
    name: 'composite_list_presets',
    description: '列出后期处理（批量合成）的预设与预设分组：名称、画布尺寸、图层数、输出目录、命名模板等概要。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const state = useCompositeV2Store.getState()
      return textResult({
        presetGroups: state.presetGroups.map((group) => ({ id: group.id, name: group.name, presetIds: group.presetIds })),
        presets: state.presets.map((preset) => ({
          id: preset.id,
          name: preset.name,
          baseCanvas: preset.baseCanvas,
          layerCount: preset.layers.length,
          outputRootPath: preset.outputRootPath,
          distributionPath: preset.distributionPath,
          subfolderTemplate: preset.subfolderTemplate,
          filenameTemplate: preset.filenameTemplate,
          useOutputOverrides: preset.useOutputOverrides,
          updatedAt: preset.updatedAt,
        })),
      })
    },
  },
  {
    name: 'composite_get_preset',
    description: '获取一个合成预设的完整配置（全部图层：图片/文字/logo 层的位置、样式、变量等）。',
    inputSchema: {
      type: 'object',
      properties: { presetId: { type: 'string', description: '预设 id' } },
      required: ['presetId'],
      additionalProperties: false,
    },
    handler: (args) => {
      const preset = useCompositeV2Store.getState().presets.find((item) => item.id === args.presetId)
      if (!preset) return errorResult(`预设 ${args.presetId} 不存在`)
      return textResult(preset)
    },
  },
  {
    name: 'composite_list_output_rules',
    description: '列出后期处理的输出规则分组（渠道/尺寸/导出配置）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const state = useCompositeV2Store.getState()
      return textResult({ outputRuleGroups: state.outputRuleGroups })
    },
  },
  {
    name: 'composite_list_history',
    description: '列出批量合成的导出历史（状态、张数、成功/失败数、分发结果等），按开始时间倒序。明细中的成功/失败文件列表默认截断到前 20 条。',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: '返回条数，默认 10，最大 50' } },
      additionalProperties: false,
    },
    handler: (args) => {
      const state = useCompositeV2Store.getState()
      const limit = clampLimit(args.limit, 10, 50)
      const sorted = [...state.history].sort((a, b) => b.startedAt - a.startedAt)
      return textResult({
        total: sorted.length,
        records: sorted.slice(0, limit).map((record) => ({
          ...record,
          successes: record.successes.slice(0, 20),
          failures: record.failures.slice(0, 20),
          successesTruncated: record.successes.length > 20,
          failuresTruncated: record.failures.length > 20,
        })),
      })
    },
  },
]
