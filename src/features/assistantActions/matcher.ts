import { BUILT_IN_ASSISTANT_ACTIONS, BUILT_IN_SKILL_STEPS, cloneBuiltInSkillSteps } from './builtInActions'
import type { AssistantAction, AssistantActionIcon, AssistantActionId, AssistantActionPreferences, AssistantActionSettings, AssistantCustomSkill, AssistantInputContext, AssistantSkillContract, AssistantSkillOverride, AssistantSkillStep, AssistantSkillTaskType, AssistantSkillTrigger, AssistantStepOutput, AssistantStepRole, AssistantVariationLevel, WordDeriveActionSettings } from './types'

export const DEFAULT_WORD_DERIVE_SETTINGS: WordDeriveActionSettings = {
  targetGroupMode: 'skill-name',
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
  skillOverrides: [],
}

const STEP_ROLES = new Set<AssistantStepRole>(['observe', 'lock', 'extract', 'finalPrompt', 'variablePrompt', 'wordEntries', 'risk'])
const STEP_OUTPUTS = new Set<AssistantStepOutput>(['sections', 'finalPrompt', 'variablePrompt', 'wordEntries'])
const SKILL_ICONS = new Set<AssistantActionIcon>(['image', 'wand', 'sparkles', 'palette', 'tags', 'thumbs-up'])

const CORE_VISIBLE_ACTION_IDS = new Set<AssistantActionId>(['image-derive', 'prompt-optimize'])

export function normalizeAssistantActionPreferences(value: Partial<AssistantActionPreferences> | undefined): AssistantActionPreferences {
  return {
    enabled: value?.enabled ?? true,
    pinnedActionIds: normalizeActionIds(value?.pinnedActionIds),
    hiddenActionIds: normalizeHiddenActionIds(value?.hiddenActionIds),
    actionOrder: normalizeActionIds(value?.actionOrder),
    actionSettings: normalizeAssistantActionSettings(value?.actionSettings),
    customSkills: normalizeCustomSkills(value?.customSkills),
    skillOverrides: normalizeSkillOverrides(value?.skillOverrides),
  }
}

let stepIdCounter = 0
function generateStepId(prefix = 'step'): string {
  stepIdCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${stepIdCounter.toString(36)}`
}

/** Normalize an unknown value into a list of structured skill steps.
 *  Accepts both the new structured objects and legacy string[] step hints. */
export function normalizeSkillSteps(value: unknown, opts: { allowWordEntries?: boolean } = {}): AssistantSkillStep[] {
  if (!Array.isArray(value)) return []
  const steps = value.flatMap((item, index): AssistantSkillStep[] => {
    // Legacy custom skills stored steps as plain strings.
    if (typeof item === 'string') {
      const text = item.trim()
      if (!text) return []
      const isLast = index === value.length - 1
      const role: AssistantStepRole = isLast ? (opts.allowWordEntries ? 'variablePrompt' : 'finalPrompt') : 'observe'
      const outputTo: AssistantStepOutput = isLast ? (opts.allowWordEntries ? 'variablePrompt' : 'finalPrompt') : 'sections'
      return [{ id: generateStepId(), title: `第${index + 1}步`, role, outputTo, instruction: text, enabled: true, required: isLast }]
    }
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const instruction = typeof record.instruction === 'string' ? record.instruction.trim() : ''
    const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : `第${index + 1}步`
    if (!instruction && !title) return []
    const role = STEP_ROLES.has(record.role as AssistantStepRole) ? (record.role as AssistantStepRole) : 'observe'
    const outputTo = STEP_OUTPUTS.has(record.outputTo as AssistantStepOutput) ? (record.outputTo as AssistantStepOutput) : 'sections'
    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : generateStepId()
    return [{
      id,
      title,
      role,
      outputTo,
      instruction,
      enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
      required: typeof record.required === 'boolean' ? record.required : false,
    }]
  })
  return steps.slice(0, 12)
}

export function normalizeSkillOverrides(value: unknown): AssistantSkillOverride[] {
  if (!Array.isArray(value)) return []
  const triggers = new Set<AssistantSkillTrigger>(['always', 'image', 'text', 'image_text'])
  return value.flatMap((item): AssistantSkillOverride[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const skillId = typeof record.skillId === 'string' ? record.skillId.trim() : ''
    if (!skillId) return []
    const override: AssistantSkillOverride = { skillId }
    if (typeof record.name === 'string' && record.name.trim()) override.name = record.name.trim().slice(0, 16)
    if (typeof record.icon === 'string' && SKILL_ICONS.has(record.icon as AssistantActionIcon)) override.icon = record.icon as AssistantActionIcon
    if (typeof record.enabled === 'boolean') override.enabled = record.enabled
    if (typeof record.priority === 'number' && Number.isFinite(record.priority)) override.priority = record.priority
    if (typeof record.trigger === 'string' && triggers.has(record.trigger as AssistantSkillTrigger)) override.trigger = record.trigger as AssistantSkillTrigger
    if (typeof record.description === 'string' && record.description.trim()) override.description = record.description.trim().slice(0, 120)
    if (Array.isArray(record.steps)) {
      const steps = normalizeSkillSteps(record.steps)
      if (steps.length) override.steps = steps
    }
    if (record.contract && typeof record.contract === 'object') {
      const contractRecord = record.contract as Record<string, unknown>
      const contract: NonNullable<AssistantSkillOverride['contract']> = {}
      if (contractRecord.primaryOutput === 'finalPrompt' || contractRecord.primaryOutput === 'variablePrompt') {
        contract.primaryOutput = contractRecord.primaryOutput
      }
      if (contractRecord.output && typeof contractRecord.output === 'object') {
        const out = contractRecord.output as Record<string, unknown>
        const outputPatch: NonNullable<NonNullable<AssistantSkillOverride['contract']>['output']> = {}
        // Migration guard: old / hand-written overrides may contain
        // output.finalPrompt = false. The product rule is now that every skill
        // always has one main prompt, so we no longer persist that switch.
        if (typeof out.analysis === 'boolean') outputPatch.analysis = out.analysis
        if (typeof out.wordEntries === 'boolean') outputPatch.wordEntries = out.wordEntries
        if (Object.keys(outputPatch).length) contract.output = outputPatch
      }
      if (Object.keys(contract).length) override.contract = contract
    }
    // Drop empty overrides (nothing actually changed) to keep storage minimal.
    return Object.keys(override).length > 1 ? [override] : []
  })
}

/** Apply a user override layer on top of a built-in skill so that
 *  `builtin + override = actualSkill`. Returns a new action object. */
export function applySkillOverride(base: AssistantAction, override?: AssistantSkillOverride): AssistantAction {
  if (!override) return base
  const merged: AssistantAction = { ...base }
  if (override.name) merged.name = override.name
  if (override.icon) merged.icon = override.icon
  if (override.description) merged.description = override.description
  if (typeof override.enabled === 'boolean') merged.enabled = override.enabled
  if (typeof override.priority === 'number') merged.priority = override.priority
  if (override.trigger) {
    merged.trigger = override.trigger
    merged.when = getWhenByTrigger(override.trigger)
  }
  if (override.steps?.length) merged.steps = override.steps.map((step) => ({ ...step }))
  if (override.contract && base.contract) {
    merged.contract = {
      ...base.contract,
      primaryOutput: override.contract.primaryOutput ?? base.contract.primaryOutput,
      output: {
        ...base.contract.output,
        // Candidates are permanently disabled and never exposed to the user.
        candidates: false,
        // finalPrompt is always on, including when applying legacy overrides.
        finalPrompt: true,
        ...(override.contract.output?.analysis != null ? { analysis: override.contract.output.analysis } : {}),
        ...(override.contract.output?.wordEntries != null ? { wordEntries: override.contract.output.wordEntries } : {}),
      },
    }
  }
  return merged
}

/** Built-in skills with their user overrides applied. */
export function getResolvedBuiltInActions(preferences: AssistantActionPreferences): AssistantAction[] {
  const overrides = new Map(preferences.skillOverrides.map((override) => [override.skillId, override]))
  return BUILT_IN_ASSISTANT_ACTIONS.map((action) => applySkillOverride(action, overrides.get(action.id)))
}

/** Ordered skills for the management page. Built-ins are resolved (builtin +
 *  override) so the manage list matches the skill bar and real execution. */
export function getOrderedManageActions(preferences: AssistantActionPreferences): AssistantAction[] {
  const manualOrder = new Map(preferences.actionOrder.map((id, index) => [id, index]))
  return [...getResolvedBuiltInActions(preferences), ...preferences.customSkills].sort((a, b) => {
    const aManual = manualOrder.get(a.id)
    const bManual = manualOrder.get(b.id)
    if (aManual != null && bManual != null && aManual !== bManual) return aManual - bManual
    if (aManual != null) return -1
    if (bManual != null) return 1
    return b.priority - a.priority
  })
}

/** The editor's output-rule contract. Enforces the product rule that every skill
 *  emits exactly one main prompt: finalPrompt is always on, and a variablePrompt
 *  primary output requires word entries (otherwise it falls back to finalPrompt). */
export interface EditorOutputRule {
  primaryOutput: 'finalPrompt' | 'variablePrompt'
  allowFinalPrompt: boolean
  allowWordEntries: boolean
  allowAnalysis: boolean
}

export function normalizeEditorOutputRule(rule: {
  primaryOutput: 'finalPrompt' | 'variablePrompt'
  allowWordEntries: boolean
  allowAnalysis?: boolean
}): EditorOutputRule {
  const allowAnalysis = rule.allowAnalysis ?? true
  // finalPrompt is never disabled: every skill outputs one main prompt.
  const allowFinalPrompt = true
  // variablePrompt only makes sense together with word entries.
  if (rule.primaryOutput === 'variablePrompt' && !rule.allowWordEntries) {
    return { primaryOutput: 'finalPrompt', allowFinalPrompt, allowWordEntries: false, allowAnalysis }
  }
  return { primaryOutput: rule.primaryOutput, allowFinalPrompt, allowWordEntries: rule.allowWordEntries, allowAnalysis }
}

export function getSkillOverride(preferences: AssistantActionPreferences, skillId: AssistantActionId): AssistantSkillOverride | undefined {
  return preferences.skillOverrides.find((override) => override.skillId === skillId)
}

/** Whether a built-in skill currently differs from its shipped default. */
export function hasSkillOverride(preferences: AssistantActionPreferences, skillId: AssistantActionId): boolean {
  const override = getSkillOverride(preferences, skillId)
  return Boolean(override && Object.keys(override).length > 1)
}

/** Remove a built-in skill's override, restoring the shipped default. */
export function restoreSkillDefault(preferences: AssistantActionPreferences, skillId: AssistantActionId): AssistantActionPreferences {
  return { ...preferences, skillOverrides: preferences.skillOverrides.filter((override) => override.skillId !== skillId) }
}

/** Insert or replace a built-in skill's override. */
export function upsertSkillOverride(preferences: AssistantActionPreferences, override: AssistantSkillOverride): AssistantActionPreferences {
  const rest = preferences.skillOverrides.filter((item) => item.skillId !== override.skillId)
  const isEmpty = Object.keys(override).length <= 1
  return { ...preferences, skillOverrides: isEmpty ? rest : [...rest, override] }
}

/** Copy a built-in (or any) skill into a new editable custom skill. */
export function duplicateSkillAsCustom(source: AssistantAction): AssistantCustomSkill {
  const contract = source.contract
  return {
    id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: `${source.name} 副本`.slice(0, 16),
    icon: source.icon,
    instruction: '',
    steps: (source.steps ?? cloneBuiltInSkillSteps(source.id)).map((step) => ({ ...step, id: generateStepId() })),
    trigger: source.trigger ?? 'always',
    enabled: true,
    priority: 65,
    when: getWhenByTrigger(source.trigger ?? 'always'),
    outputMode: source.outputMode === 'create-word-tags' ? 'create-word-tags' : 'show-candidates',
    isCustom: true,
    source: 'custom',
    requiresAdContext: contract?.requiresAdContext === true,
    allowWordEntries: contract?.output.wordEntries === true,
    allowExploreSellingPoint: contract?.allowExploreSellingPoint === true,
    contract: contract ? { ...contract } : undefined,
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
  const targetGroupId = typeof value?.targetGroupId === 'string' && value.targetGroupId ? value.targetGroupId : null
  const targetGroupMode = value?.targetGroupMode === 'selected' && targetGroupId ? 'selected' : 'skill-name'

  return {
    targetGroupMode,
    targetGroupId,
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

export function normalizeCustomSkills(value: unknown): AssistantCustomSkill[] {
  if (!Array.isArray(value)) return []
  const triggers = new Set<AssistantSkillTrigger>(['always', 'image', 'text', 'image_text'])
  return value.flatMap((item): AssistantCustomSkill[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const instruction = typeof record.instruction === 'string' ? record.instruction.trim() : ''
    // A custom skill is valid if it has either a legacy instruction or structured steps.
    const rawSteps = normalizeSkillSteps(record.steps, { allowWordEntries: typeof record.allowWordEntries === 'boolean' ? record.allowWordEntries : false })
    if (!id || !name || (!instruction && rawSteps.length === 0)) return []
    const icon = typeof record.icon === 'string' && SKILL_ICONS.has(record.icon as AssistantActionIcon) ? record.icon as AssistantActionIcon : 'sparkles'
    const trigger = typeof record.trigger === 'string' && triggers.has(record.trigger as AssistantSkillTrigger) ? record.trigger as AssistantSkillTrigger : 'always'
    const enabled = typeof record.enabled === 'boolean' ? record.enabled : true
    // P3: 三个显式开关是契约的单一事实来源；contract 由它们推导或保留。
    const requiresAdContext = typeof record.requiresAdContext === 'boolean' ? record.requiresAdContext : false
    const allowWordEntries = typeof record.allowWordEntries === 'boolean' ? record.allowWordEntries : false
    const allowExploreSellingPoint = typeof record.allowExploreSellingPoint === 'boolean' ? record.allowExploreSellingPoint : false
    const contract = buildCustomSkillContract(record.contract, instruction, requiresAdContext, allowWordEntries, allowExploreSellingPoint)
    return [{
      id, name, instruction, steps: rawSteps, icon, trigger, enabled, priority: 65,
      when: getWhenByTrigger(trigger), outputMode: allowWordEntries ? 'create-word-tags' : 'show-candidates', isCustom: true,
      source: 'custom', requiresAdContext, allowWordEntries, allowExploreSellingPoint, contract,
    }]
  })
}

/** Build the stable contract for a custom skill.
 *  When the model returned a contract, keep its objective / preserve / editable /
 *  forbidden / taskType / variationLevel / primaryOutput but force the three
 *  toggle-driven fields to the explicit switch values. Old skills without a
 *  contract get a conservative default that never assumes ad context or explores
 *  new selling points. */
export function buildCustomSkillContract(
  raw: unknown,
  instruction: string,
  requiresAdContext: boolean,
  allowWordEntries: boolean,
  allowExploreSellingPoint: boolean,
): AssistantSkillContract {
  const base: AssistantSkillContract = {
    taskType: 'prompt-optimize',
    objective: instruction.slice(0, 60) || '执行自定义技能',
    preserve: ['参考图片和用户原始文字中的可观察事实', '原始意图'],
    editable: ['技能明确允许的处理'],
    forbidden: ['套用行业通用模板替换参考输入', '把推断内容当作输入事实'],
    variationLevel: 'low',
    requiresAdContext,
    allowExploreSellingPoint,
    primaryOutput: allowWordEntries ? 'variablePrompt' : 'finalPrompt',
    output: { finalPrompt: true, candidates: false, analysis: true, wordEntries: allowWordEntries },
  }
  if (!raw || typeof raw !== 'object') return base
  const record = raw as Record<string, unknown>
  const taskTypeOptions = new Set<AssistantSkillTaskType>(['analyze', 'prompt-optimize', 'image-variation', 'layout-variation', 'creative-expansion', 'extract-variables', 'review-data'])
  const variationLevels = new Set<AssistantVariationLevel>(['none', 'low', 'medium', 'high'])
  const primaryOutputs = new Set<AssistantSkillContract['primaryOutput']>(['finalPrompt', 'variablePrompt'])
  const output = (record.output && typeof record.output === 'object') ? record.output as Record<string, unknown> : null
  const stringArray = (value: unknown) => Array.isArray(value) ? value.map(String).filter((item) => Boolean(item)) : []
  return {
    taskType: taskTypeOptions.has(record.taskType as AssistantSkillTaskType) ? (record.taskType as AssistantSkillTaskType) : base.taskType,
    objective: typeof record.objective === 'string' && record.objective.trim() ? record.objective.trim() : base.objective,
    preserve: stringArray(record.preserve).length ? stringArray(record.preserve) : base.preserve,
    editable: stringArray(record.editable).length ? stringArray(record.editable) : base.editable,
    forbidden: stringArray(record.forbidden).length ? stringArray(record.forbidden) : base.forbidden,
    variationLevel: variationLevels.has(record.variationLevel as AssistantVariationLevel) ? (record.variationLevel as AssistantVariationLevel) : base.variationLevel,
    requiresAdContext,
    allowExploreSellingPoint,
    primaryOutput: primaryOutputs.has(record.primaryOutput as AssistantSkillContract['primaryOutput']) ? (record.primaryOutput as AssistantSkillContract['primaryOutput']) : base.primaryOutput,
    output: {
      finalPrompt: true,
      candidates: false,
      analysis: output ? Boolean(output.analysis) : base.output.analysis,
      wordEntries: allowWordEntries,
    },
  }
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
  return [...getResolvedBuiltInActions(preferences), ...preferences.customSkills]
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
