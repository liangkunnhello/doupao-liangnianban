import { BUILT_IN_ASSISTANT_ACTIONS } from './builtInActions'
import type { AssistantAction, AssistantActionId, AssistantActionPreferences, AssistantActionSettings, AssistantCustomSkill, AssistantInputContext, AssistantSkillTrigger, WordDeriveActionSettings } from './types'

export const DEFAULT_WORD_DERIVE_SETTINGS: WordDeriveActionSettings = {
  targetGroupMode: 'auto-numbered',
  targetGroupId: null,
  variableCount: 20,
  categories: ['产品主体', '目标人群', '痛点场景', '核心卖点', '视觉钩子', '情绪氛围', '人物状态', '使用场景', '信任背书', '优惠机制', 'CTA', '平台版式'],
  promptMode: 'replace',
  autoSaveWordEntries: true,
}

export const DEFAULT_SUPER_DERIVE_SETTINGS = DEFAULT_WORD_DERIVE_SETTINGS

export const DEFAULT_ASSISTANT_ACTION_SETTINGS: AssistantActionSettings = {
  channel: 'general',
  sellingPointPolicy: 'lock',
  outputCount: 6,
  superDerive: DEFAULT_SUPER_DERIVE_SETTINGS,
  wordDerive: DEFAULT_WORD_DERIVE_SETTINGS,
}

export const DEFAULT_ASSISTANT_ACTION_PREFERENCES: AssistantActionPreferences = {
  enabled: true,
  pinnedActionIds: [],
  hiddenActionIds: [],
  actionOrder: [],
  actionSettings: DEFAULT_ASSISTANT_ACTION_SETTINGS,
  customSkills: [],
}

const CORE_VISIBLE_ACTION_IDS = new Set<AssistantActionId>(['image-derive', 'prompt-optimize'])

export function normalizeAssistantActionPreferences(value: Partial<AssistantActionPreferences> | undefined): AssistantActionPreferences {
  return {
    enabled: value?.enabled ?? true,
    pinnedActionIds: normalizeActionIds(value?.pinnedActionIds),
    hiddenActionIds: normalizeHiddenActionIds(value?.hiddenActionIds),
    actionOrder: normalizeActionIds(value?.actionOrder),
    actionSettings: normalizeAssistantActionSettings(value?.actionSettings),
    customSkills: normalizeCustomSkills(value?.customSkills),
  }
}

export function normalizeAssistantActionSettings(value: Partial<AssistantActionSettings> | undefined): AssistantActionSettings {
  const wordDerive = normalizeWordDeriveSettings(value?.wordDerive ?? value?.superDerive)
  const channelOptions = new Set<AssistantActionSettings['channel']>(['general', 'toutiao', 'gdt', 'baidu', 'multi'])
  const policyOptions = new Set<AssistantActionSettings['sellingPointPolicy']>(['lock', 'polish', 'explore'])
  const channel = channelOptions.has(value?.channel as AssistantActionSettings['channel']) ? (value?.channel as AssistantActionSettings['channel']) : 'general'
  const sellingPointPolicy = policyOptions.has(value?.sellingPointPolicy as AssistantActionSettings['sellingPointPolicy']) ? (value?.sellingPointPolicy as AssistantActionSettings['sellingPointPolicy']) : 'lock'
  const outputCount = typeof value?.outputCount === 'number' && Number.isFinite(value.outputCount)
    ? Math.max(3, Math.min(20, Math.round(value.outputCount)))
    : DEFAULT_ASSISTANT_ACTION_SETTINGS.outputCount
  return {
    channel,
    sellingPointPolicy,
    outputCount,
    superDerive: wordDerive,
    wordDerive,
  }
}

function normalizeWordDeriveSettings(value: Partial<WordDeriveActionSettings> | undefined): WordDeriveActionSettings {
  const variableCount = typeof value?.variableCount === 'number' && Number.isFinite(value.variableCount)
    ? Math.max(1, Math.min(50, Math.round(value.variableCount)))
    : DEFAULT_WORD_DERIVE_SETTINGS.variableCount
  const categories = Array.isArray(value?.categories)
    ? value.categories.map((item) => String(item).trim()).filter(Boolean).slice(0, 12)
    : DEFAULT_WORD_DERIVE_SETTINGS.categories
  const targetGroupMode = value?.targetGroupMode === 'selected' || value?.targetGroupMode === 'skill-name'
    ? value.targetGroupMode
    : 'auto-numbered'

  return {
    targetGroupMode,
    targetGroupId: typeof value?.targetGroupId === 'string' && value.targetGroupId ? value.targetGroupId : null,
    variableCount,
    categories: categories.length ? categories : DEFAULT_WORD_DERIVE_SETTINGS.categories,
    promptMode: value?.promptMode === 'append' ? 'append' : 'replace',
    autoSaveWordEntries: typeof value?.autoSaveWordEntries === 'boolean' ? value.autoSaveWordEntries : true,
  }
}

function normalizeActionIds(value: unknown): AssistantActionId[] {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is AssistantActionId => typeof id === 'string' && id.length > 0)
}

function normalizeHiddenActionIds(value: unknown): AssistantActionId[] {
  return normalizeActionIds(value).filter((id) => !CORE_VISIBLE_ACTION_IDS.has(id))
}

function normalizeCustomSkills(value: unknown): AssistantCustomSkill[] {
  if (!Array.isArray(value)) return []
  const icons = new Set(['image', 'wand', 'sparkles', 'palette', 'tags', 'thumbs-up'])
  const triggers = new Set<AssistantSkillTrigger>(['always', 'image', 'text', 'image_text'])
  return value.flatMap((item): AssistantCustomSkill[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const instruction = typeof record.instruction === 'string' ? record.instruction.trim() : ''
    if (!id || !name || !instruction) return []
    const steps = Array.isArray(record.steps) ? record.steps.map(String).map((step) => step.trim()).filter(Boolean).slice(0, 8) : []
    const icon = typeof record.icon === 'string' && icons.has(record.icon) ? record.icon as AssistantCustomSkill['icon'] : 'sparkles'
    const trigger = typeof record.trigger === 'string' && triggers.has(record.trigger as AssistantSkillTrigger) ? record.trigger as AssistantSkillTrigger : 'always'
    const enabled = typeof record.enabled === 'boolean' ? record.enabled : true
    return [{ id, name, instruction, steps, icon, trigger, enabled, priority: 65, when: getWhenByTrigger(trigger), outputMode: 'show-candidates', isCustom: true }]
  })
}

export function getWhenByTrigger(trigger: AssistantSkillTrigger): AssistantAction['when'] {
  switch (trigger) {
    case 'image':
      return { image: 'required', text: 'optional' }
    case 'text':
      return { text: 'required', image: 'none' }
    case 'image_text':
      return { text: 'required', image: 'required' }
    case 'always':
    default:
      return { text: 'optional', image: 'optional' }
  }
}

function getAllActions(preferences: AssistantActionPreferences): AssistantAction[] {
  return [...BUILT_IN_ASSISTANT_ACTIONS, ...preferences.customSkills]
}

const NO_INPUT_VISIBLE_IDS = new Set<AssistantActionId>(['angle-matrix'])

/** 仅允许程序调用的内部技能，不在横向技能条里出现 */
const INTERNAL_ACTION_IDS = new Set<AssistantActionId>(['channel-rewrite'])

function isCustomAction(action: AssistantAction) {
  return 'isCustom' in action && action.isCustom === true
}

function actionMatchesContext(action: AssistantAction, context: AssistantInputContext) {
  if (INTERNAL_ACTION_IDS.has(action.id)) return false
  if (action.enabled === false) return false
  if (!context.hasImage && !context.hasText && !isCustomAction(action)) {
    return NO_INPUT_VISIBLE_IDS.has(action.id)
  }
  if (action.trigger) {
    if (action.trigger === 'image' && !context.hasImage) return false
    if (action.trigger === 'text' && (!context.hasText || context.hasImage)) return false
    if (action.trigger === 'image_text' && (!context.hasText || !context.hasImage)) return false
  }
  if (action.when.text === 'required' && !context.hasText) return false
  if (action.when.text === 'none' && context.hasText) return false
  if (action.when.image === 'required' && !context.hasImage) return false
  if (action.when.image === 'none' && context.hasImage) return false
  return true
}

function getContextPriority(action: AssistantAction, context: AssistantInputContext): number {
  let order: AssistantActionId[]
  if (context.hasImage && context.hasText) {
    order = ['image-derive', 'prompt-optimize', 'angle-matrix', 'batch-variants', 'ad-review']
  } else if (context.hasImage && !context.hasText) {
    order = ['image-derive', 'angle-matrix', 'batch-variants']
  } else if (!context.hasImage && context.hasText) {
    order = ['prompt-optimize', 'angle-matrix', 'batch-variants', 'ad-review']
  } else {
    order = ['angle-matrix']
  }
  const index = order.indexOf(action.id)
  return index >= 0 ? (order.length - index) * 10 : 0
}

export function getRecommendedAssistantActions(
  context: AssistantInputContext,
  preferences: AssistantActionPreferences = DEFAULT_ASSISTANT_ACTION_PREFERENCES,
  limit = 5,
) {
  if (!preferences.enabled) return []

  const hidden = new Set(preferences.hiddenActionIds)
  const pinned = new Set(preferences.pinnedActionIds)
  const manualOrder = new Map(preferences.actionOrder.map((id, index) => [id, index]))

  return getAllActions(preferences)
    .filter((action) => !hidden.has(action.id) && actionMatchesContext(action, context))
    .sort((a, b) => {
      const pinnedDelta = Number(pinned.has(b.id)) - Number(pinned.has(a.id))
      if (pinnedDelta) return pinnedDelta

      const aManual = manualOrder.get(a.id)
      const bManual = manualOrder.get(b.id)
      if (aManual != null && bManual != null && aManual !== bManual) return aManual - bManual
      if (aManual != null) return -1
      if (bManual != null) return 1

      return (getContextPriority(b, context) + b.priority) - (getContextPriority(a, context) + a.priority)
    })
    .slice(0, limit)
}

export function getMoreAssistantActions(context: AssistantInputContext, preferences: AssistantActionPreferences) {
  const recommendedIds = new Set(getRecommendedAssistantActions(context, preferences).map((action) => action.id))
  const hidden = new Set(preferences.hiddenActionIds)
  return getAllActions(preferences).filter((action) => !hidden.has(action.id) && actionMatchesContext(action, context) && !recommendedIds.has(action.id))
}
