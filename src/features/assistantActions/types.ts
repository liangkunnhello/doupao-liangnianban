import type { InputImage } from '../../types'

export type BuiltInAssistantActionId =
  | 'image-derive'
  | 'image-describe'
  | 'super-derive'
  | 'prompt-optimize'
  | 'style-expand'
  | 'word-extract'
  | 'prompt-examples'
  | 'market-breakdown'
  | 'viral-remix'
  | 'angle-matrix'
  | 'batch-variants'
  | 'channel-rewrite'
  | 'ad-review'

export type AssistantActionId = BuiltInAssistantActionId | string

export type AssistantActionIcon =
  | 'image'
  | 'wand'
  | 'sparkles'
  | 'palette'
  | 'tags'
  | 'thumbs-up'

export type AssistantSkillTrigger = 'always' | 'image' | 'text' | 'image_text'

export type AssistantSkillTaskType =
  | 'analyze'
  | 'prompt-optimize'
  | 'image-variation'
  | 'layout-variation'
  | 'creative-expansion'
  | 'extract-variables'
  | 'review-data'

export type AssistantVariationLevel = 'none' | 'low' | 'medium' | 'high'

/** Quality status of a generated result, surfaced to the user so a repaired/failed
 *  output is never mistaken for a genuine model understanding. */
export type AssistantQualityState = 'complete' | 'repaired' | 'insufficient-data' | 'failed'

/** The semantic role of a single skill step (its purpose within the flow). */
export type AssistantStepRole =
  | 'observe' // 观察输入：提取图片/文本事实
  | 'lock' // 锁定内容：明确不能改变什么
  | 'extract' // 提炼方向：总结测试方向/风格/卖点
  | 'finalPrompt' // 生成最终主提示词
  | 'variablePrompt' // 生成带 {{变量}} 的提示词
  | 'wordEntries' // 生成可替换短词条
  | 'risk' // 风险检查：合规/同质化/误判提醒

/** Where a step's output should be written. */
export type AssistantStepOutput = 'sections' | 'finalPrompt' | 'variablePrompt' | 'wordEntries'

/** One editable processing step of a skill. A skill is a flow of ordered steps
 *  instead of a single opaque instruction. */
export interface AssistantSkillStep {
  id: string
  title: string
  enabled: boolean
  role: AssistantStepRole
  instruction: string
  outputTo: AssistantStepOutput
  /** Required steps cannot be deleted (only disabled). */
  required?: boolean
}

export const STEP_ROLE_OPTIONS: Array<{ value: AssistantStepRole; label: string; defaultOutput: AssistantStepOutput }> = [
  { value: 'observe', label: '观察输入', defaultOutput: 'sections' },
  { value: 'lock', label: '锁定内容', defaultOutput: 'sections' },
  { value: 'extract', label: '提炼方向', defaultOutput: 'sections' },
  { value: 'finalPrompt', label: '生成最终提示词', defaultOutput: 'finalPrompt' },
  { value: 'variablePrompt', label: '生成变量提示词', defaultOutput: 'variablePrompt' },
  { value: 'wordEntries', label: '生成词条', defaultOutput: 'wordEntries' },
  { value: 'risk', label: '风险检查', defaultOutput: 'sections' },
]

export const STEP_OUTPUT_OPTIONS: Array<{ value: AssistantStepOutput; label: string }> = [
  { value: 'sections', label: '查看更多（分析说明）' },
  { value: 'finalPrompt', label: '主结果（最终提示词）' },
  { value: 'variablePrompt', label: '变量主提示词' },
  { value: 'wordEntries', label: '词条库' },
]

/** Defines the semantic boundary of a built-in skill, not merely its display name. */
export interface AssistantSkillContract {
  taskType: AssistantSkillTaskType
  objective: string
  preserve: string[]
  editable: string[]
  forbidden: string[]
  variationLevel: AssistantVariationLevel
  singleVariablePerCandidate?: boolean
  /** Whether the skill genuinely operates inside an information-flow ad workflow.
   *  When false, channel / selling-point / test-plan packaging must not be attached. */
  requiresAdContext?: boolean
  /** Whether the result should expose a channel label and selling-point policy. */
  channelAware?: boolean
  /** Whether this skill may explore NEW selling points (otherwise it must lock to the input). */
  allowExploreSellingPoint?: boolean
  /** Every skill emits exactly one main prompt. Analysis / candidate are never
   *  primary outputs (analysis lives in sections, candidates are永久关闭). */
  primaryOutput: 'finalPrompt' | 'variablePrompt'
  output: {
    finalPrompt: boolean
    candidates: boolean
    analysis: boolean
    wordEntries: boolean
  }
}

export interface AssistantInputContext {
  text: string
  hasText: boolean
  images: InputImage[]
  hasImage: boolean
  imageCount: number
}

export interface AssistantAction {
  id: AssistantActionId
  name: string
  icon: AssistantActionIcon
  /** Optional human description shown in the editor / hover card. */
  description?: string
  priority: number
  trigger?: AssistantSkillTrigger
  enabled?: boolean
  when: {
    text?: 'required' | 'optional' | 'none'
    image?: 'required' | 'optional' | 'none'
  }
  outputMode: 'replace-input' | 'append-input' | 'show-candidates' | 'create-word-tags'
  contract?: AssistantSkillContract
  /** Whether this skill ships with the app or was created by the user. */
  source?: 'builtin' | 'custom'
  /** Schema version, bumped when built-in step definitions change. */
  version?: number
  /** Ordered, editable processing steps. When present, execution is step-based. */
  steps?: AssistantSkillStep[]
}

export interface AssistantCustomSkill extends AssistantAction {
  id: string
  instruction: string
  steps: AssistantSkillStep[]
  isCustom: true
  /** 是否广告投放技能：决定是否需要套用渠道/卖点/测试计划包装。 */
  requiresAdContext?: boolean
  /** 是否允许生成变量词条。 */
  allowWordEntries?: boolean
  /** 是否允许扩展（探索）新卖点；false 时强制锁定用户输入卖点。 */
  allowExploreSellingPoint?: boolean
}

/** A user-saved override layer applied on top of a built-in skill.
 *  Only changed fields are stored, so `builtin + override = actual`, and the
 *  original built-in definition is never lost (restore = drop the override). */
export interface AssistantSkillOverride {
  skillId: AssistantActionId
  name?: string
  icon?: AssistantActionIcon
  description?: string
  enabled?: boolean
  priority?: number
  trigger?: AssistantSkillTrigger
  /** Full replacement of the step flow once the user edits steps. */
  steps?: AssistantSkillStep[]
  /** Partial patch of the output contract (candidates stay permanently off). */
  contract?: {
    primaryOutput?: 'finalPrompt' | 'variablePrompt'
    output?: {
      finalPrompt?: boolean
      analysis?: boolean
      wordEntries?: boolean
    }
  }
}

export interface AssistantActionPreferences {
  enabled: boolean
  pinnedActionIds: AssistantActionId[]
  hiddenActionIds: AssistantActionId[]
  actionOrder: AssistantActionId[]
  actionSettings: AssistantActionSettings
  customSkills: AssistantCustomSkill[]
  /** Override layers for built-in skills; empty means all built-ins use defaults. */
  skillOverrides: AssistantSkillOverride[]
}

export type AdChannel = 'general' | 'toutiao' | 'gdt' | 'baidu' | 'multi'

export interface AdChannelOption {
  value: AdChannel
  label: string
  hint: string
}

export const AD_CHANNEL_OPTIONS: AdChannelOption[] = [
  { value: 'general', label: '通用信息流', hint: '抖音/快手/Meta 等通用竖版信息流' },
  { value: 'toutiao', label: '头条 / 巨量', hint: '强调竖版、前三秒钩子、真人感、UGC' },
  { value: 'gdt', label: '广点通', hint: '生活化、社交场景、可信感、不过度刺激' },
  { value: 'baidu', label: '百度', hint: '问题解决、搜索意图、可信背书、审核风险' },
  { value: 'multi', label: '多渠道', hint: '同一方向分别给出不同渠道版本' },
]

export type SellingPointPolicy = 'lock' | 'polish' | 'explore'

export interface SellingPointPolicyOption {
  value: SellingPointPolicy
  label: string
  hint: string
}

export const SELLING_POINT_POLICY_OPTIONS: SellingPointPolicyOption[] = [
  { value: 'lock', label: '锁定原卖点', hint: '不改卖点，只变画面、场景、钩子、版式、CTA' },
  { value: 'polish', label: '轻微润色', hint: '允许更口语化，但不得改变承诺、功效、价格、适用对象' },
  { value: 'explore', label: '允许探索新卖点', hint: '允许生成新卖点，但必须标注为“新假设”' },
]

export const OUTPUT_COUNT_OPTIONS = [3, 6, 10, 20] as const

export interface AssistantActionSettings {
  channel: AdChannel
  sellingPointPolicy: SellingPointPolicy
  outputCount: number
  superDerive: SuperDeriveActionSettings
  wordDerive: WordDeriveActionSettings
}

export type WordDeriveTargetGroupMode = 'selected' | 'skill-name'

export interface WordDeriveActionSettings {
  targetGroupMode: WordDeriveTargetGroupMode
  targetGroupId: string | null
  variableCount: number
  categories: string[]
  promptMode: 'replace' | 'append'
  autoSaveWordEntries: boolean
}

export type SuperDeriveActionSettings = WordDeriveActionSettings

export interface AssistantActionResult {
  actionId: AssistantActionId
  title: string
  content: string
  candidates?: string[]
  sections?: AssistantResultSection[]
  wordEntries?: AssistantWordEntryGroup[]
  primaryText?: string
  variablePrompt?: string
  channel?: AdChannel
  sellingPointPolicy?: SellingPointPolicy
  testPlan?: string
  qualityState?: AssistantQualityState
  qualityNote?: string
  /** The read-only input fact card built before generation, returned so the result
   *  page can let the user confirm "this is what I understood" (Layer 1). */
  grounding?: GroundingProfile
  /** Model-reported anchors that trace back to the input (Layer 3 source check). */
  sourceAnchors?: string[]
  /** Model-reported assumptions / inferred facts that are NOT in the input. */
  assumptions?: string[]
}

export interface AssistantResultSection {
  title: string
  items: string[]
}

export interface AssistantWordEntryGroup {
  category: string
  entries: string[]
}

/** The unified "content fact card" every skill consumes before generating.
 *  Facts are observed once and reused, instead of each skill re-guessing the input. */
export type GroundingFactSource = 'text' | 'image' | 'user-setting' | 'inferred'
export type GroundingFactConfidence = 'explicit' | 'high' | 'inferred'
export type GroundingFactLockPolicy = 'must-keep' | 'polish' | 'variable'

export interface GroundingFact {
  fact: string
  source: GroundingFactSource
  confidence: GroundingFactConfidence
  lockPolicy: GroundingFactLockPolicy
  sourceRef?: string
}

export interface VisualIdentity {
  subject: string
  composition: string
  color: string
  scene: string
  textLayout: string
  style: string
}

export interface GroundingProfile {
  observedFacts: GroundingFact[]
  userRequirements: string[]
  inferredFacts: GroundingFact[]
  lockedFacts: GroundingFact[]
  visualIdentity: VisualIdentity
  adContext?: { channel: AdChannel; sellingPointPolicy: SellingPointPolicy }
  missingInformation: string[]
  sourceEvidence: string[]
}
