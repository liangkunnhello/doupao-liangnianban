import {
  IMAGE_PROMPT_SOP_GENERATOR_INSTRUCTION,
  SOP_GENERATOR_META_PRESET,
} from './sopGeneration'
import type { SopGroup, SopLibraryItem, SopMetaInstruction, StrategyPreset } from './types'
import { parseVariablePrompt } from '../../lib/variablePrompt'
import {
  APP_COPY_STRATEGY_SKILL_META_INSTRUCTION,
  IMAGE_GENERATION_STRATEGY_SKILL_META_INSTRUCTION,
} from './skillMetaInstructions'

export function seedSopGroups(): SopGroup[] {
  const now = Date.now()
  return [
    { id: 'sop-group-general', name: '通用 SOP', createdAt: now, updatedAt: now },
    { id: 'sop-group-image', name: '图片提示词 SOP', createdAt: now, updatedAt: now },
  ]
}

export function seedSopLibrary(presets: StrategyPreset[]): SopLibraryItem[] {
  const now = Date.now()
  return presets
    .filter((preset) => preset.type === 'sop' && !preset.archived)
    .map((preset) => ({
      id: preset.id,
      groupId: 'sop-group-general',
      name: preset.name,
      description: preset.description,
      content: preset.value,
      executionMode: 'prompt-generator' as const,
      source: 'legacy-preset' as const,
      createdBy: preset.createdBy,
      createdAt: preset.createdAt,
      updatedAt: now,
    }))
}

export function seedSopMetaInstructions(): SopMetaInstruction[] {
  const now = Date.now()
  return [
    {
      id: 'sop-meta-general',
      name: SOP_GENERATOR_META_PRESET.name,
      description: SOP_GENERATOR_META_PRESET.description,
      instruction: SOP_GENERATOR_META_PRESET.instruction,
      kind: 'general',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sop-meta-image-prompt',
      name: '图片画风多变体 SOP 编译器',
      description: '根据画风参考图生成多变体中文绘图提示词直出型 SOP。',
      instruction: IMAGE_PROMPT_SOP_GENERATOR_INSTRUCTION,
      kind: 'image-prompt',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sop-meta-skill-image-generation-strategies',
      name: '技能：提取生图策略',
      description: '从一组参考图片提炼可迁移的视觉机制、通用提示词与严格变量池。',
      instruction: IMAGE_GENERATION_STRATEGY_SKILL_META_INSTRUCTION,
      kind: 'variable-prompt-skill',
      excludeTextByDefault: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'sop-meta-skill-app-copy-strategies',
      name: '技能：APP 带文案策略提取',
      description: '提炼带文案营销素材的视觉、文案绑定、版式槽位和 OCR 质检策略。',
      instruction: APP_COPY_STRATEGY_SKILL_META_INSTRUCTION,
      kind: 'variable-prompt-skill',
      excludeTextByDefault: false,
      createdAt: now,
      updatedAt: now,
    },
  ]
}

export function mergeBuiltInSopMetaInstructions(items: SopMetaInstruction[] | undefined) {
  const existing = items ?? []
  const builtIns = seedSopMetaInstructions()
  const builtInById = new Map(builtIns.map((item) => [item.id, item]))
  const correctedSkillIds = new Set([
    'sop-meta-skill-image-generation-strategies',
    'sop-meta-skill-app-copy-strategies',
  ])
  const merged = existing.map((item) => {
    const corrected = correctedSkillIds.has(item.id) ? builtInById.get(item.id) : undefined
    return corrected
      ? {
          ...corrected,
          createdAt: item.createdAt,
          excludeTextByDefault: item.excludeTextByDefault ?? corrected.excludeTextByDefault,
        }
      : item
  })
  const existingIds = new Set(merged.map((item) => item.id))
  return [...merged, ...builtIns.filter((item) => !existingIds.has(item.id))]
}

export function getMetaInstructionExcludeText(meta: Pick<SopMetaInstruction, 'kind' | 'excludeTextByDefault'> | undefined) {
  if (!meta || meta.kind !== 'variable-prompt-skill') return false
  return meta.excludeTextByDefault ?? true
}

/**
 * Resolve the variable-prompt skill for a gallery workspace tab.
 *
 * Existing libraries associate a generated SOP with its source meta instruction
 * (`SopLibraryItem.metaInstructionId`) rather than associating the meta itself
 * with a group.  The resolver supports both shapes, so imported libraries and
 * newly-created explicitly grouped meta instructions behave the same way.
 */
export function resolveMetaInstructionForWorkspaceTab(
  tabName: string | undefined,
  groups: SopGroup[],
  items: SopLibraryItem[],
  metaInstructions: SopMetaInstruction[],
) {
  const normalize = (value: string | undefined) => (value ?? '').trim().toLocaleLowerCase()
  const normalizedTabName = normalize(tabName)
  const variableMetas = metaInstructions.filter((item) => item.kind === 'variable-prompt-skill')
  const appCopy = metaInstructions.find((item) => item.id === APP_COPY_SKILL_META_ID)
  const visual = metaInstructions.find((item) => item.id === 'sop-meta-skill-image-generation-strategies')

  if (!normalizedTabName) return appCopy ?? visual ?? variableMetas[0] ?? metaInstructions[0]

  const namedMeta = variableMetas.find((item) => normalize(item.name) === normalizedTabName)
  if (namedMeta) return namedMeta

  const group = groups.find((item) => normalize(item.name) === normalizedTabName)
  if (group) {
    const groupedMetaIds = new Set(
      items
        .filter((item) => item.groupId === group.id && item.metaInstructionId)
        .map((item) => item.metaInstructionId as string),
    )
    const groupedMeta = variableMetas.find((item) => item.groupId === group.id)
      ?? variableMetas.find((item) => groupedMetaIds.has(item.id))
    if (groupedMeta) return groupedMeta
  }

  // A tab name may include a product/category suffix, e.g. "保险 / 图标".
  const fuzzyGroup = groups.find((item) => {
    const groupName = normalize(item.name)
    return groupName && (normalizedTabName.includes(groupName) || groupName.includes(normalizedTabName))
  })
  if (fuzzyGroup) {
    const groupedMetaIds = new Set(
      items
        .filter((item) => item.groupId === fuzzyGroup.id && item.metaInstructionId)
        .map((item) => item.metaInstructionId as string),
    )
    const groupedMeta = variableMetas.find((item) => item.groupId === fuzzyGroup.id)
      ?? variableMetas.find((item) => groupedMetaIds.has(item.id))
    if (groupedMeta) return groupedMeta
  }

  return appCopy ?? visual ?? variableMetas[0] ?? metaInstructions[0]
}

const VARIABLE_PROMPT_SKILL_META_IDS = new Set([
  'sop-meta-skill-image-generation-strategies',
  'sop-meta-skill-app-copy-strategies',
])
const APP_COPY_SKILL_META_ID = 'sop-meta-skill-app-copy-strategies'
const COPY_VARIABLE_MARKER = /\{\{[^{}]*(?:文案|文字|标题|副标题|卖点|价格|价签|配料|参数|信息列表|标签|品牌|logo|二维码|ocr|文字区|文案区)[^{}]*\}\}/iu

export function migrateSopLibraryExecutionModes(items: SopLibraryItem[] | undefined) {
  return (items ?? []).map((item) => {
    const isValidSkillVariablePrompt = Boolean(
      item.metaInstructionId
      && VARIABLE_PROMPT_SKILL_META_IDS.has(item.metaInstructionId)
      && parseVariablePrompt(item.content).enabled,
    )
    const executionMode = item.executionMode
      ?? (isValidSkillVariablePrompt ? 'variable-prompt' as const : 'prompt-generator' as const)
    const excludeText = item.excludeText
      ?? (executionMode === 'variable-prompt'
        ? item.metaInstructionId === APP_COPY_SKILL_META_ID
          ? false
          : !COPY_VARIABLE_MARKER.test(item.content)
        : undefined)
    return {
      ...item,
      executionMode,
      excludeText,
    }
  })
}

export function sopLibraryId(prefix: 'group' | 'sop' | 'meta') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
