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
  primaryOutput: 'finalPrompt' | 'variablePrompt' | 'analysis' | 'candidate'
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
  priority: number
  trigger?: AssistantSkillTrigger
  enabled?: boolean
  when: {
    text?: 'required' | 'optional' | 'none'
    image?: 'required' | 'optional' | 'none'
  }
  outputMode: 'replace-input' | 'append-input' | 'show-candidates' | 'create-word-tags'
  contract?: AssistantSkillContract
}

export interface AssistantCustomSkill extends AssistantAction {
  id: string
  instruction: string
  steps: string[]
  isCustom: true
  /** 是否广告投放技能：决定是否需要套用渠道/卖点/测试计划包装。 */
  requiresAdContext?: boolean
  /** 是否允许生成变量词条。 */
  allowWordEntries?: boolean
  /** 是否允许扩展（探索）新卖点；false 时强制锁定用户输入卖点。 */
  allowExploreSellingPoint?: boolean
}

export interface AssistantActionPreferences {
  enabled: boolean
  pinnedActionIds: AssistantActionId[]
  hiddenActionIds: AssistantActionId[]
  actionOrder: AssistantActionId[]
  actionSettings: AssistantActionSettings
  customSkills: AssistantCustomSkill[]
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
