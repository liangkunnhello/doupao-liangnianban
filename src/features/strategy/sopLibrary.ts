import {
  IMAGE_PROMPT_SOP_GENERATOR_INSTRUCTION,
  SOP_GENERATOR_META_PRESET,
} from './sopGeneration'
import type { SopGroup, SopLibraryItem, SopMetaInstruction, StrategyPreset } from './types'

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
  ]
}

export function sopLibraryId(prefix: 'group' | 'sop' | 'meta') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
