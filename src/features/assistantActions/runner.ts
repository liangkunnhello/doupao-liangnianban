import type { ApiProfile, AppSettings, TaskParams } from '../../types'
import { callAgentResponsesApi } from '../../lib/agentApi'
import { BUILT_IN_ASSISTANT_ACTIONS } from './builtInActions'
import { buildGroundingProfile } from './context'
import type { AdChannel, AssistantActionId, AssistantActionResult, AssistantActionSettings, AssistantCustomSkill, AssistantInputContext, AssistantQualityState, AssistantResultSection, AssistantSkillContract, AssistantWordEntryGroup, GroundingProfile, SellingPointPolicy, VisualIdentity } from './types'
import { AD_CHANNEL_OPTIONS, SELLING_POINT_POLICY_OPTIONS } from './types'
import { buildCustomSkillContract, DEFAULT_ASSISTANT_ACTION_SETTINGS, normalizeAssistantActionSettings } from './matcher'
import { INFORMATION_FLOW_AD_COMPLIANCE_PROMPT, sanitizeInformationFlowAdResult } from './adCompliance'

interface AssistantJsonPayload {
  summary?: string
  sourceAnchors?: string[]
  assumptions?: string[]
  visualIdentity?: VisualIdentity
  finalPrompt?: string
  variablePrompt?: string
  prompts?: string[]
  sections?: AssistantResultSection[]
  wordEntries?: AssistantWordEntryGroup[]
}

export type AssistantRunnerProgressStage =
  | 'prepare-input'
  | 'request-model'
  | 'parse-response'
  | 'validate-result'
  | 'repair-variables'
  | 'organize-result'

export interface AssistantRunnerProgressUpdate {
  stage: AssistantRunnerProgressStage
  detail?: string
}

const ACTION_TITLES: Record<string, string> = {
  'image-derive': '概念抽取',
  'image-describe': '素材拆解',
  'super-derive': '爆款衍生',
  'prompt-optimize': '提示词优化',
  'style-expand': '版式扩展',
  'word-extract': '变量拆解',
  'prompt-examples': '爆款案例',
  'market-breakdown': '大盘拆解',
  'viral-remix': '爆款复刻',
  'angle-matrix': '角度探索',
  'batch-variants': '批量变体',
  'channel-rewrite': '渠道改写',
  'ad-review': '投放复盘',
}

const VARIABLE_OUTPUT_ACTION_IDS = new Set<AssistantActionId>([
  'super-derive',
  'word-extract',
  'market-breakdown',
  'angle-matrix',
])

function getActionContract(actionId: AssistantActionId, customSkill?: AssistantCustomSkill): AssistantSkillContract | undefined {
  if (customSkill) return customSkill.contract
  return BUILT_IN_ASSISTANT_ACTIONS.find((action) => action.id === actionId)?.contract
}

export interface AssistantSkillDraft {
  name: string
  icon: AssistantCustomSkill['icon']
  steps: string[]
  instruction: string
  contract?: AssistantSkillContract
}

export async function runAssistantAction(
  actionId: AssistantActionId,
  context: AssistantInputContext,
  opts: {
    settings: AppSettings
    profile: ApiProfile
    params: TaskParams
    actionSettings?: Partial<AssistantActionSettings>
    customSkill?: AssistantCustomSkill
    onProgress?: (update: AssistantRunnerProgressUpdate) => void
  },
): Promise<AssistantActionResult> {
  if (!opts.profile.apiKey.trim()) {
    throw new Error('请先在设置中配置 Agent 使用的 API Key')
  }

  const actionSettings = normalizeAssistantActionSettings(opts.actionSettings ?? DEFAULT_ASSISTANT_ACTION_SETTINGS)
  const requiresAd = skillRequiresAdContext(actionId, opts.customSkill)
  const grounding = buildGroundingProfile(context)
  const effectiveSellingPointPolicy = getEffectiveSellingPointPolicy(actionId, opts.customSkill, actionSettings)
  if (requiresAd) {
    grounding.adContext = { channel: actionSettings.channel, sellingPointPolicy: effectiveSellingPointPolicy }
  }

  opts.onProgress?.({ stage: 'prepare-input', detail: context.hasImage ? `已建立输入事实卡，读取 ${context.imageCount} 张参考图和当前提示词。` : '已建立输入事实卡，读取当前提示词和技能设置。' })

  const buildInput = () => createAssistantActionInput(actionId, context, actionSettings, opts.customSkill, grounding)

  opts.onProgress?.({ stage: 'request-model', detail: '请求已发送，正在等待模型返回结果。' })
  let rawText = (await callAgentResponsesApi({
    settings: opts.settings,
    profile: opts.profile,
    params: opts.params,
    input: buildInput(),
  })).text.trim()

  if (!rawText) {
    // Retry once before giving up — never silently replace a failed run with a
    // fixed local template that pretends to understand the input.
    opts.onProgress?.({ stage: 'request-model', detail: '首次未返回可用内容，正在自动重试一次。' })
    rawText = (await callAgentResponsesApi({
      settings: opts.settings,
      profile: opts.profile,
      params: opts.params,
      input: buildInput(),
    })).text.trim()
    if (!rawText) {
      throw new Error('模型未返回可用内容，已自动重试一次仍失败。请检查输入或稍后重试。')
    }
  }

  opts.onProgress?.({ stage: 'parse-response', detail: '模型已返回，正在解析结构化结果。' })
  const parsed = parseAssistantJsonPayload(rawText)
  if (!parsed) {
    opts.onProgress?.({ stage: 'organize-result', detail: '结果不是标准 JSON，正在整理为普通候选内容。' })
    const result: AssistantActionResult = {
      actionId,
      title: opts.customSkill?.name ?? ACTION_TITLES[actionId] ?? '自定义技能',
      content: rawText,
      candidates: extractNumberedPrompts(rawText) ?? [extractPrimaryPrompt(rawText) || rawText],
      primaryText: extractPrimaryPrompt(rawText) || rawText,
    }
    return withResultMeta(
      enrichAssistantResult(applyQualityState(result, actionId), actionSettings, opts.customSkill, effectiveSellingPointPolicy),
      grounding,
    )
  }

  opts.onProgress?.({ stage: 'validate-result', detail: '正在校验提示词、候选项和变量词条完整性。' })
  const grounded = attachSourceAnchors(parsed, context)
  // P2: 把模型回报的结构化图片观察回填进输入事实卡，避免本地硬猜图片内容。
  const groundedVisual = parsed.visualIdentity
    ? attachVisualIdentity(grounding, normalizeVisualIdentity(parsed.visualIdentity))
    : grounding
  const normalized = normalizeParsedPayload(actionId, grounded, opts.customSkill?.name, opts.customSkill, actionSettings)
  const repaired = await completeWordEntriesIfNeeded(normalized, actionSettings, context, opts)
  opts.onProgress?.({ stage: 'organize-result', detail: '正在整理主推提示词、候选项和测试计划。' })
  return withResultMeta(
    enrichAssistantResult(applyQualityState(repaired, actionId), actionSettings, opts.customSkill, effectiveSellingPointPolicy),
    groundedVisual,
    parsed.sourceAnchors ? normalizeStringArray(parsed.sourceAnchors) : undefined,
    parsed.assumptions ? normalizeStringArray(parsed.assumptions) : undefined,
  )
}

/** Attach the read-only input fact card and the model's reported anchors /
 *  assumptions so the result page can render the four-layer structure. */
function withResultMeta(
  result: AssistantActionResult,
  grounding?: GroundingProfile,
  sourceAnchors?: string[],
  assumptions?: string[],
): AssistantActionResult {
  return {
    ...result,
    grounding,
    sourceAnchors: sourceAnchors && sourceAnchors.length ? sourceAnchors : result.sourceAnchors,
    assumptions: assumptions && assumptions.length ? assumptions : result.assumptions,
  }
}

function skillRequiresAdContext(actionId: AssistantActionId, customSkill?: AssistantCustomSkill): boolean {
  return getActionContract(actionId, customSkill)?.requiresAdContext === true
}

/** When a skill's contract forbids exploring new selling points, force the
 *  lock policy regardless of the global setting so the model cannot drift. */
function getEffectiveSellingPointPolicy(actionId: AssistantActionId, customSkill: AssistantCustomSkill | undefined, actionSettings: AssistantActionSettings): SellingPointPolicy {
  const contract = getActionContract(actionId, customSkill)
  if (contract?.allowExploreSellingPoint === false) return 'lock'
  return actionSettings.sellingPointPolicy
}

function enrichAssistantResult(
  result: AssistantActionResult,
  actionSettings: AssistantActionSettings,
  customSkill?: AssistantCustomSkill,
  effectiveSellingPointPolicy: SellingPointPolicy = actionSettings.sellingPointPolicy,
): AssistantActionResult {
  // Only ad-creative skills carry channel / selling-point / test-plan packaging.
  // Analysis and plain-optimization skills must not be polluted by ad templates.
  if (result.actionId === 'image-derive') return result
  if (!skillRequiresAdContext(result.actionId, customSkill)) return result
  result = sanitizeInformationFlowAdResult(result)
  const channel = actionSettings.channel
  const sellingPointPolicy = effectiveSellingPointPolicy
  const testPlan = buildTestPlan(result, actionSettings, sellingPointPolicy)
  return { ...result, channel, sellingPointPolicy, testPlan }
}

function applyQualityState(result: AssistantActionResult, actionId: AssistantActionId): AssistantActionResult {
  if (result.qualityState) return result
  const contract = getActionContract(actionId)
  const hasContent = Boolean(result.primaryText || result.content.trim() || (result.candidates ?? []).length)
  if (!hasContent && contract?.taskType === 'review-data') {
    return {
      ...result,
      qualityState: 'insufficient-data',
      qualityNote: '未检测到可用的投放数据，已停止生成通用广告素材；请以真实数据复核。',
    }
  }
  return { ...result, qualityState: hasContent ? 'complete' : 'insufficient-data' }
}

function summarizeGrounding(profile: GroundingProfile): string {
  const parts: string[] = []
  if (profile.observedFacts.length) {
    parts.push('已确认事实：' + profile.observedFacts.map((fact) => `${fact.fact}（来源：${fact.sourceRef ?? fact.source}）`).join('；'))
  }
  if (profile.missingInformation.length) {
    parts.push('缺失信息：' + profile.missingInformation.join('；'))
  }
  return parts.join('\n')
}

function getChannelLabel(channel: AdChannel) {
  return AD_CHANNEL_OPTIONS.find((option) => option.value === channel)?.label ?? channel
}

function getSellingPointPolicyLabel(policy: SellingPointPolicy) {
  return SELLING_POINT_POLICY_OPTIONS.find((option) => option.value === policy)?.label ?? policy
}

function buildTestPlan(result: AssistantActionResult, actionSettings: AssistantActionSettings, sellingPointPolicy: SellingPointPolicy = actionSettings.sellingPointPolicy) {
  const lines: string[] = []
  lines.push('素材测试计划')
  lines.push(`技能：${result.title}`)
  lines.push(`渠道：${getChannelLabel(actionSettings.channel)}`)
  lines.push(`卖点策略：${getSellingPointPolicyLabel(sellingPointPolicy)}`)
  const primary = result.variablePrompt || result.primaryText || result.candidates?.[0] || result.content
  if (primary) lines.push(`主推提示词：${primary}`)
  const candidates = result.candidates ?? []
  if (candidates.length > 1) {
    lines.push('候选方向：')
    candidates.forEach((candidate, index) => lines.push(`${index + 1}. ${candidate}`))
  }
  if (result.wordEntries?.length) {
    lines.push('变量词条：')
    for (const group of result.wordEntries) {
      if (group.entries.length) lines.push(`- ${group.category}：${group.entries.join('、')}`)
    }
  }
  return lines.join('\n')
}

export async function createAssistantSkillDraft(description: string, opts: { settings: AppSettings; profile: ApiProfile; params: TaskParams }): Promise<AssistantSkillDraft> {
  if (!opts.profile.apiKey.trim()) throw new Error('请先在设置中配置 Agent 使用的 API Key')
  const result = await callAgentResponsesApi({
    settings: opts.settings,
    profile: opts.profile,
    params: opts.params,
    input: [{ role: 'user', content: [{ type: 'input_text', text: [
      '你是图片与素材技能设计师。用户用自然语言描述想要的功能，请把它做成一个可执行的小技能。所有技能都必须把参考图片和用户原始文字作为最高事实源，最终输出不得被行业常识或通用模板替代。',
      '只返回严格 JSON，不要 Markdown：',
      '{"name":"不超过8字的技能名称","icon":"image|wand|sparkles|palette|tags|thumbs-up","steps":["步骤1","步骤2"],"instruction":"给执行模型的完整中文指令。必须明确技能目标、必须保留项、仅允许改变项、禁止改变项、变化强度和所需 JSON 输出字段；只写与该技能名称直接相关的要求，不能默认加入跑量角度、首屏钩子、CTA、渠道版式、变量词条或测试命名。","contract":{"taskType":"analyze|prompt-optimize|image-variation|layout-variation|creative-expansion|extract-variables|review-data","objective":"一句话技能目标","preserve":["必须保留项"],"editable":["仅允许改变项"],"forbidden":["禁止改变项"],"variationLevel":"none|low|medium|high","requiresAdContext":false,"allowExploreSellingPoint":false,"primaryOutput":"finalPrompt|variablePrompt|analysis|candidate","output":{"finalPrompt":true,"candidates":true,"analysis":true,"wordEntries":false}}}',
      'contract 必须保守：除非用户明确要求投放/跑量/渠道，requiresAdContext 必须为 false；除非用户明确要求扩展新卖点，allowExploreSellingPoint 必须为 false；除非用户明确要求生成变量词条，output.wordEntries 必须为 false。',
      `用户需求：${description}`,
    ].join('\n') }] }],
  })
  const parsed = parseAssistantJsonPayload(result.text) as Partial<AssistantSkillDraft> | null
  const name = typeof parsed?.name === 'string' ? parsed.name.trim().slice(0, 16) : ''
  const instruction = typeof parsed?.instruction === 'string' ? parsed.instruction.trim() : ''
  if (!name || !instruction) throw new Error('没有生成可保存的技能，请换一种说法再试')
  const validIcons: AssistantCustomSkill['icon'][] = ['image', 'wand', 'sparkles', 'palette', 'tags', 'thumbs-up']
  const icon = validIcons.includes(parsed?.icon as AssistantCustomSkill['icon']) ? parsed?.icon as AssistantCustomSkill['icon'] : 'sparkles'
  const steps = Array.isArray(parsed?.steps) ? parsed.steps.map(String).map((step) => step.trim()).filter(Boolean).slice(0, 8) : []
  const contractRaw = parsed?.contract && typeof parsed.contract === 'object' ? parsed.contract : undefined
  const readBool = (obj: unknown, key: string) => Boolean(obj && typeof obj === 'object' && (obj as Record<string, unknown>)[key])
  const rawRequiresAd = readBool(contractRaw, 'requiresAdContext')
  const rawExplore = readBool(contractRaw, 'allowExploreSellingPoint')
  const rawOutput = contractRaw && typeof contractRaw === 'object' ? (contractRaw as unknown as Record<string, unknown>).output : undefined
  const rawWordEntries = readBool(rawOutput, 'wordEntries')
  const contract = contractRaw
    ? buildCustomSkillContract(contractRaw, instruction, rawRequiresAd, rawWordEntries, rawExplore)
    : undefined
  return { name, icon, steps, instruction, contract }
}

function createAssistantActionInput(actionId: AssistantActionId, context: AssistantInputContext, actionSettings: AssistantActionSettings, customSkill?: AssistantCustomSkill, grounding?: GroundingProfile) {
  if (actionId === 'image-derive' && !customSkill) return createConceptExtractionInput(context)

  const requiresAd = skillRequiresAdContext(actionId, customSkill)
  const allowVariableOutput = canActionOutputVariables(actionId, customSkill)
  const contract = getActionContract(actionId, customSkill)
  const effectiveSellingPointPolicy = getEffectiveSellingPointPolicy(actionId, customSkill, actionSettings)
  const wordSettings = actionSettings.wordDerive
  const content: Array<Record<string, string>> = [
    {
      type: 'input_text',
      text: [
        '你是豆泡的图片与素材提示词助手。根据当前输入严格执行用户点击的技能。',
        '只返回文本，不要调用图片生成工具，不要生成图片。',
        '返回必须是严格 JSON，不要 Markdown，不要代码块，不要解释。',
        '当前技能契约中的“必须保留项”和“禁止项”优先级最高；它们与渠道建议、广告建议或你的创意偏好冲突时，必须以技能契约为准。',
        '',
        '【参考输入优先规则，所有技能强制执行】',
        '参考图片和用户原始文字是最高事实源；技能名称只决定如何处理这些输入，不允许用行业常识、通用广告模板或常见案例替换参考输入。',
        '先观察参考图并提取 3–8 个可验证的 sourceAnchors，包括真实主体、主体位置与占比、构图、背景、颜色、文字与排版、场景、材质、光影和视觉风格；不得把推测的人群、行业、卖点或效果写成图片事实。',
        '同时按字段回填 visualIdentity（subject / composition / color / scene / textLayout / style），每个字段只写图片中可直接观察到的内容，无法观察的字段留空字符串；没有参考图时省略 visualIdentity。',
        '最终提示词必须以 sourceAnchors 和用户原始文字为主干，逐项写出需要保留的参考特征，再执行当前技能允许的改变；不能只在分析中提到参考图，最终提示词却改用通用行业方案。',
        '行业知识只能补足完成任务不可缺少且参考输入没有说明的中性执行细节；不得新增产品、人物、场景、卖点、功效、受众、品牌、价格、活动、CTA 或渠道版式。',
        '每个 finalPrompt、variablePrompt 和 prompts 候选都必须能逐项追溯到参考输入。无法从参考输入确认的内容必须省略，不能用“通常、行业常见、建议”等理由补造。',
        'sourceAnchors 仅用于内部规划和“参考输入依据”分析区，严禁把 sourceAnchors 列表、原始文字全文、分析过程、判断理由、测试策略或“参考输入基准”等说明性前缀拼接到生图提示词。',
        'finalPrompt、variablePrompt 和 prompts 必须直接描述要生成的画面以及必要的保留/修改指令，不写“经过分析”“基于上述分析”“跑量逻辑是”“测试目的是”等解释性内容。',
        '',
        '【卖点保护规则，必须严格遵守】',
        '默认不得改变用户输入中的核心卖点、价格、承诺、适用人群、活动机制和品牌信息。',
        `当前卖点策略为「${getSellingPointPolicyLabel(effectiveSellingPointPolicy)}」：${getSellingPointPolicyRule(effectiveSellingPointPolicy)}`,
        '如果必须推断卖点，必须明确标注为“推断卖点”，不得当作用户已确认卖点。',
        '除非开启“允许探索新卖点”，否则只能改变画面表达、场景、人群切入、视觉钩子、版式、字幕位置和 CTA。',
        '',
        contract ? formatSkillContract(contract) : '',
        grounding && summarizeGrounding(grounding) ? `【输入事实卡，所有技能复用同一份真实内容，不得用通用模板或行业常识替换】\n${summarizeGrounding(grounding)}` : '',
        INFORMATION_FLOW_AD_COMPLIANCE_PROMPT,
        '',
        'JSON 结构：',
        '{',
        '  "summary": "一句话说明这组素材适合测试的方向",',
        '  "sourceAnchors": ["从参考图或原始文字中提取的可验证依据，3–8 条；每条必须能直接追溯到输入，不得写入推断；没有参考输入时为空数组"],',
        '  "assumptions": ["无法从参考输入确认、必须由模型给出的假设或推断，例如推断的人群/卖点/效果；纯分析无假设时为空数组；所有假设必须明确标注为推断，不得当作输入事实"],',
        '  "visualIdentity": {"subject":"图片中可见主体","composition":"主体位置、占比、构图","color":"主色与辅助色","scene":"场景/背景","textLayout":"文字、字幕或 CTA 区域","style":"材质、光影、真实/插画/3D 等"},  仅当有参考图且可观察时填写，无法观察的字段留空字符串；无参考图时省略该字段',
        '  "finalPrompt": "以参考输入和 sourceAnchors 为主干、按当前技能做受控处理的完整生图提示词，可为空",',
        allowVariableOutput
          ? '  "variablePrompt": "仅当该技能需要变量词条时填写，且占位符必须与 wordEntries.category 完全一致，例如 {{产品主体}}；否则为空",'
          : '  "variablePrompt": "",',
        '  "prompts": ["以同一参考输入为基准的候选提示词1", "以同一参考输入为基准的候选提示词2"],',
        '  "sections": [{"title": "参考输入依据/技能处理结果/风险提醒", "items": ["具体内容"]}],',
        allowVariableOutput
          ? '  "wordEntries": [{"category": "必须与 variablePrompt 中的 {{变量名}} 完全一致", "entries": ["可直接替换该变量的短词条"]}]'
          : '  "wordEntries": []',
        '}',
        allowVariableOutput
          ? '变量约束：不得凭空生成“画幅比例、风格、构图、光影、材质、合规禁忌”等工具型变量；只有确实要保存到词条库并能替换进 variablePrompt 的内容，才能进入 wordEntries。'
          : '当前技能不需要变量词条：严禁输出 {{变量}}、variablePrompt 或 wordEntries，只输出优化后的普通提示词和必要说明。',
        allowVariableOutput
          ? [
              '变量生成必须先理解整段提示词和参考图片：先提取当前素材的产品/主体、受众、场景、痛点、卖点、画面风格和渠道语境，再围绕这些分析结果衍生变量。',
              '变量词条必须贴合当前输入，不要输出通用模板词；如果有参考图，词条要来自参考图的主体、场景、构图、情绪和可替换元素。',
              `变量分类只能从这些分类中选择：${wordSettings.categories.join('、')}。`,
              `每个输出的 wordEntries.category 必须至少给 ${wordSettings.variableCount} 个不重复、可直接替换的短词条；不要只给 3-5 个。`,
              'variablePrompt 中的 {{变量名}} 必须和 wordEntries.category 完全一致；没有对应词条的占位符不要写进 variablePrompt。',
            ].join('\n')
          : '',
        '',
        `功能条：${customSkill?.name ?? ACTION_TITLES[actionId] ?? '自定义技能'}`,
        `目标渠道：${getChannelLabel(actionSettings.channel)}`,
        `卖点策略：${getSellingPointPolicyLabel(effectiveSellingPointPolicy)}`,
        `当前文字：${context.text || '（无）'}`,
        `参考图片数量：${context.imageCount}`,
        '',
        customSkill?.instruction ?? getActionInstruction(actionId, actionSettings),
        contract?.taskType === 'creative-expansion' || actionId === 'channel-rewrite'
          ? `【渠道规则】${getChannelRule(actionSettings.channel)}`
          : '',
      ].join('\n'),
    },
  ]

  for (const image of context.images) {
    content.push({ type: 'input_image', image_url: image.dataUrl })
  }

  return [{ role: 'user', content }]
}

function createConceptExtractionInput(context: AssistantInputContext) {
  const content: Array<Record<string, string>> = [
    {
      type: 'input_text',
      text: [
        '你是“概念抽取”提示词助手。静默分析参考图，只返回一段用于单张图生图的中文提示词，不要调用图片生成工具。',
        '只返回严格 JSON，不要 Markdown、解释、分析、标题、列表或代码块：',
        '{"finalPrompt":"一个自然段的最终生图提示词"}',
        '',
        '执行规则：',
        '1. 当前功能用于图生图。只描述当前要生成的一张独立画面，不得出现“一组、系列、多张、每张、各张、批量、组图、套图”等会让模型在同一画布生成多个方案的措辞。',
        '2. finalPrompt 必须明确“生成一张独立画面”，并禁止拼图、九宫格、多联画、分镜和同画布多方案。',
        '3. 参考图是构图、配色、材质、渲染方式、视角、背景、光线、阴影、主体尺度和留白的直接依据。统一概括为“整体视觉风格和画面参数严格沿用参考图”，不要把这些参数重新写死成颜色名、材质名或风格标签。',
        '4. 只有用户明确要求固定某个视觉参数时，才在 finalPrompt 中写出该参数。',
        '5. 静默提炼一个简短的功能概念，只把新的核心主体或功能符号写入 finalPrompt；同一画面只保留一个清晰主体，必要时最多加入一个辅助元素。',
        '6. 禁止把观察过程、思考过程、选择理由、参考图分析、年龄心理、目标人群、营销、跑量、渠道、卖点、CTA、测试策略和变量词条写进 finalPrompt。',
        '7. finalPrompt 控制在 80–160 个汉字，一个自然段，直接从生成指令开始；不要添加“分析如下、概念母题、最终提示词”等前缀。',
        '8. 除“禁止拼图、多联画和同画布多方案”外，不堆叠无关负面词。',
        '',
        `用户补充文字：${context.text || '（无）'}`,
        `参考图片数量：${context.imageCount}`,
      ].join('\n'),
    },
  ]

  for (const image of context.images) {
    content.push({ type: 'input_image', image_url: image.dataUrl })
  }

  return [{ role: 'user', content }]
}

function attachSourceAnchors(
  payload: AssistantJsonPayload,
  context: AssistantInputContext,
): AssistantJsonPayload {
  if (!context.hasText && !context.hasImage) return payload

  const sourceAnchors = normalizeStringArray(payload.sourceAnchors).slice(0, 8)
  const existingSections = Array.isArray(payload.sections) ? payload.sections : []
  const hasSourceSection = existingSections.some((section) => section?.title?.trim() === '参考输入依据')

  return {
    ...payload,
    sourceAnchors,
    sections: sourceAnchors.length > 0 && !hasSourceSection
      ? [{ title: '参考输入依据', items: sourceAnchors }, ...existingSections]
      : payload.sections,
  }
}

/** Merge the model-reported structured image observation into the input fact card. */
function attachVisualIdentity(profile: GroundingProfile, visualIdentity: VisualIdentity): GroundingProfile {
  return { ...profile, visualIdentity }
}

function normalizeVisualIdentity(value: unknown): VisualIdentity {
  const empty: VisualIdentity = { subject: '', composition: '', color: '', scene: '', textLayout: '', style: '' }
  if (!value || typeof value !== 'object') return empty
  const record = value as Record<string, unknown>
  return {
    subject: typeof record.subject === 'string' ? record.subject.trim() : '',
    composition: typeof record.composition === 'string' ? record.composition.trim() : '',
    color: typeof record.color === 'string' ? record.color.trim() : '',
    scene: typeof record.scene === 'string' ? record.scene.trim() : '',
    textLayout: typeof record.textLayout === 'string' ? record.textLayout.trim() : '',
    style: typeof record.style === 'string' ? record.style.trim() : '',
  }
}

function canActionOutputVariables(actionId: AssistantActionId, customSkill?: AssistantCustomSkill) {
  const contract = getActionContract(actionId, customSkill)
  if (contract) return contract.output.wordEntries
  if (customSkill) return customSkill.outputMode === 'create-word-tags'
  return VARIABLE_OUTPUT_ACTION_IDS.has(actionId)
}

function formatSkillContract(contract: AssistantSkillContract) {
  const lines = [
    '【当前技能契约，必须严格遵守】',
    `目标：${contract.objective}`,
    `变化强度：${getVariationLevelLabel(contract.variationLevel)}。`,
    `必须保留：${contract.preserve.length ? contract.preserve.join('、') : '无。'}`,
    `仅允许改变：${contract.editable.length ? contract.editable.join('、') : '无。'}`,
    `禁止改变：${contract.forbidden.length ? contract.forbidden.join('、') : '无。'}`,
  ]
  if (contract.singleVariablePerCandidate) lines.push('每条候选只允许一个主要变化维度，其他内容必须保持基准不变。')
  if (!contract.output.finalPrompt) lines.push('本技能以分析为主，finalPrompt 必须为空字符串。')
  if (!contract.output.candidates) lines.push('本技能不输出 prompts，prompts 必须为空数组。')
  if (!contract.output.wordEntries) lines.push('本技能不输出变量词条，variablePrompt 必须为空字符串且 wordEntries 必须为空数组。')
  return lines.join('\n')
}

function getVariationLevelLabel(level: AssistantSkillContract['variationLevel']) {
  switch (level) {
    case 'none': return '不改变输入内容，只做分析或提取'
    case 'low': return '轻微，仅允许局部或表达层优化'
    case 'medium': return '中等，仅在技能允许的维度内变化'
    case 'high': return '高，可进行明确范围内的创意扩展'
  }
}

function getSellingPointPolicyRule(policy: SellingPointPolicy): string {
  switch (policy) {
    case 'lock':
      return '锁定用户给出的核心卖点：严格保留其承诺、功效、价格、适用对象与品牌信息，不得改写、替换或重新表述。'
    case 'polish':
      return '卖点可轻微润色为更口语化表达，但不得改变承诺、功效、价格、适用对象与品牌信息。'
    case 'explore':
      return '允许探索新卖点，但任何新生成的卖点都必须明确标注为“新假设”，不得与用户已确认卖点混淆。'
    default:
      return '锁定用户给出的核心卖点，不得改写。'
  }
}

function getSellingPointWordEntryRule(policy: SellingPointPolicy): string {
  if (policy === 'explore') {
    return 'wordEntries 可以输出“新卖点假设”分类，但必须单独分类，不得混入“核心卖点”；如果保留“核心卖点”分类，只能包含用户原始卖点或“锁定卖点：xxx”。'
  }
  return 'wordEntries 中可以保留“核心卖点”作为锁定参考，但不得生成多个替换卖点；如果输出该分类，只能包含用户原始卖点或“锁定卖点：xxx”。'
}

function getChannelRule(channel: AdChannel): string {
  switch (channel) {
    case 'toutiao':
      return '目标渠道为头条/巨量：强调竖版信息流、前三秒钩子、真人感、短字幕、UGC 和强场景。'
    case 'gdt':
      return '目标渠道为广点通：强调生活化、社交场景、可信感、不过度刺激点击。'
    case 'baidu':
      return '目标渠道为百度：强调问题解决、搜索意图、可信背书、明确场景和审核风险。'
    case 'multi':
      return '目标渠道为多渠道：同一素材方向需要分别给出不同渠道版本（头条/广点通/百度等），而不是只改尺寸。'
    case 'general':
    default:
      return '目标渠道为通用信息流：默认面向头条/巨量、广点通、百度等中国主流信息流场景，并兼容抖音、快手、Meta；输出要便于多渠道测试。'
  }
}

function getActionInstruction(actionId: AssistantActionId, actionSettings: AssistantActionSettings) {
  switch (actionId) {
    case 'image-derive':
      return [
        '这是“概念抽取”技能，只输出用于单张独立画面的图生图提示词。',
        '整体视觉风格和画面参数严格沿用参考图，不把配色、材质、构图等参数重新写死。',
        '仅更换核心功能符号或主体轮廓；禁止组图、多联画、同画布多方案以及任何分析或思考过程。',
        'finalPrompt 只输出一个 80–160 个汉字的自然段；prompts、variablePrompt、sections 和 wordEntries 必须为空。',
      ].join('\n')
    case 'image-describe':
      return [
        '这是“素材拆解”技能。忠实分析参考图片，不生成衍生、复刻或新素材提示词。',
        'sections 必须包含：画幅和构图、视觉主体、背景与色板、文字层级、光影与风格、广告信息结构、可观察事实、推断项和风险。',
        '图片中无法直接观察到的卖点、受众或效果必须标记为“推断”，不得当作事实。',
        'finalPrompt 为空字符串，prompts 为空数组，variablePrompt 为空字符串，wordEntries 为空数组。',
      ].join('\n')
    case 'super-derive':
      const settings = actionSettings.wordDerive
      return [
        '这是“爆款衍生”技能，是信息流广告跑量素材的核心工作流，请严格按以下要求执行。',
        '1. 如果有参考图片，先拆解它的跑量结构：首屏钩子、人物/产品主体、痛点场景、卖点表达、视觉冲突、情绪氛围、信任背书、CTA、平台原生感。',
        '2. 如果有文字，按产品信息、目标人群、投放目标、卖点、价格/优惠、素材限制进行理解。',
        '3. finalPrompt 必须从参考图与原始文字继续生长：先逐项写明保留的主体、结构、色板、排版、文案语义、场景和视觉风格，再写允许衍生的部分；不能套用通用竖版广告模板覆盖原素材。',
        `3. variablePrompt 必须把 finalPrompt 中可变的核心语义换成占位符，占位符只能从这些分类中选择：${settings.categories.map((item) => `{{${item}}}`).join('、')}。`,
        `4. wordEntries 必须只按这些分类输出：${settings.categories.join('、')}。每个 category 必须给 ${settings.variableCount} 个可替换短变量，必须能直接替换进 variablePrompt。`,
        '5. prompts 给 8 条不同素材方向，但每条必须继承同一组参考锚点，只改变一个有参考依据的测试维度；不要求机械覆盖固定行业角度。',
        '6. sections 必须包含：素材角度、首屏钩子、画面构图、标题文案、字幕文案、CTA、适合平台、测试命名、风险提醒。',
        getSellingPointWordEntryRule(actionSettings.sellingPointPolicy),
        '7. 避免绝对化承诺、医疗/金融夸大、虚假前后对比、平台禁词、侵犯第三方品牌或肖像。',
      ].join('\n')
    case 'prompt-optimize':
      return [
        '这是“提示词优化”技能。用户输入了一段提示词或产品描述，请在不改变原意、事实和承诺的前提下提升其清晰度、完整性与可执行性。',
        '“原始提示词诊断”：只指出画面表达、主体关系、场景、风格、约束或合规上的不足；用户未要求时，不要主动补充钩子、版式、CTA、渠道要求或变量词条。',
        '“锁定内容”：不得改变核心卖点、产品事实、品牌、价格、承诺、适用人群、画幅和用户明确指定的风格或场景。',
        'finalPrompt 只放最终可直接使用的完整生图提示词，不要套用信息流广告模板。',
        `prompts 输出 ${actionSettings.outputCount} 条轻微不同的优化版本，只允许改变表达清晰度和细节组织，不得发散成新创意方向，不要默认改成竖版信息流广告。`,
        'sections 必须包含：原始提示词诊断、锁定内容、优化后主提示词、候选优化版本、合规风险。',
        '不要做变量拆解，不要输出变量词条，不要把画幅比例、风格、构图、光影、材质等做成 {{变量}}。',
        'variablePrompt 必须为空字符串，wordEntries 必须为空数组。',
      ].join('\n')
    case 'style-expand':
      return [
        '这是“版式扩展”技能。保持当前主体、内容、场景、品牌、卖点、色板和视觉风格不变，只探索布局。',
        `prompts 输出 ${actionSettings.outputCount} 条版式候选，每条只改变主体位置、标题位置、图文比例、留白、信息层级或 CTA 区域位置。`,
        '不得改成真人口播、UGC 测评、不同场景或不同视觉风格；这些属于创意衍生，不属于版式扩展。',
        'sections 列出每条的布局变化、锁定内容和测试假设。',
      ].join('\n')
    case 'word-extract':
      return [
        '这是“变量拆解”技能。从当前输入中提取已经出现或可直接归纳的可复用短词条，不进行变量衍生。',
        `wordEntries 必须只按这些分类输出：${actionSettings.wordDerive.categories.join('、')}。`,
        '只输出输入中有明确依据的分类；没有依据的分类不要输出。不要为了凑数量凭空扩写词条。',
        'entries 必须是短词条，不要长句，适合直接复用。',
        'finalPrompt 可为空。',
      ].join('\n')
    case 'prompt-examples':
      return [
        '这是“爆款案例”技能。提供高潜信息流广告结构案例，不得在没有投放数据时声称一定是爆款。',
        `prompts 输出 ${actionSettings.outputCount} 条案例；存在参考图或原始文字时，每条必须继承其中的产品事实、主体关系和视觉锚点，只改变案例结构，不得换成无关行业模板。`,
        '每条都要完整可直接用于生图，并包含标题/字幕位置和 CTA。',
        'sections 列出每个案例的测试假设和适合平台。',
      ].join('\n')
    case 'market-breakdown':
      return [
        '这是“大盘拆解”技能。分析输入素材中的共性结构、机会和风险；只有一张素材时必须称为“单素材分析”，不得称为市场大盘。',
        'sections 必须输出：样本范围、可观察共性、画面结构、信息层级、可能的人群和卖点、差异化机会、风险。',
        'finalPrompt 为空字符串，prompts 为空数组。',
        `wordEntries 只允许使用设置中的变量分类，每个输出分类至少给 ${actionSettings.wordDerive.variableCount} 个市场变量。`,
      ].join('\n')
    case 'viral-remix':
      return [
        '这是“爆款复刻”技能。复刻信息层级、视觉节奏、主体占比和钩子到 CTA 的结构，不复制具体内容。',
        '先拆解输入素材的结构：钩子、冲突或痛点、卖点证明、主体占比、场景、版式和 CTA。',
        `prompts 输出 ${actionSettings.outputCount} 条结构复刻但内容替换后的素材提示词，每条都要有测试命名。`,
        'sections 输出每条的复刻逻辑、变化点、风险提醒。',
      ].join('\n')
    case 'angle-matrix':
      return [
        '这是“角度矩阵”技能。围绕当前产品/素材信息生成可投放测试的素材角度矩阵。',
        'prompts 输出 10 条素材提示词；每条先继承参考输入的主体、产品事实、核心卖点和视觉身份，再仅改变营销切入角度。角度没有参考依据时不得强行套入固定行业模板。',
        'sections 每条包含：角度、首屏钩子、画面、标题、字幕、CTA、适合平台、测试命名。',
        `wordEntries 只允许使用设置中的变量分类，每个输出分类至少给 ${actionSettings.wordDerive.variableCount} 个可测试短变量。`,
      ].join('\n')
    case 'batch-variants': {
      const allowSellingPointChange = actionSettings.sellingPointPolicy === 'explore'
      return [
        '这是“批量变体”技能。围绕当前素材信息生成一组可 A/B 测试的素材提示词。',
        allowSellingPointChange
          ? `prompts 输出 ${actionSettings.outputCount} 条短而完整的生图提示词。每条只改变一个测试维度：钩子、场景、人物、新卖点假设或版式；新增卖点必须标注为“新假设”。`
          : `prompts 输出 ${actionSettings.outputCount} 条短而完整的生图提示词。每条只改变一个测试维度：钩子、场景、人物、卖点呈现方式或版式；不得改变核心卖点本身。`,
        allowSellingPointChange
          ? 'sections 按测试组分组：钩子组、场景组、人群组、新卖点假设组、版式组，并给每组测试假设。'
          : 'sections 按测试组分组：钩子组、场景组、人群组、卖点呈现方式组、版式组，并给每组测试假设。',
        '每条必须包含测试命名，格式示例：hook_pain_scene_home_v01。',
      ].join('\n')
    }
    case 'ad-review':
      return [
        '这是“投放复盘”技能。根据用户输入的投放数据或素材表现判断哪些变量值得继续衍生。',
        '如果输入包含 CTR、CVR、CPA、消耗、转化、留存、评论反馈，请分析胜出变量和失败变量。',
        '数据不足时必须明确说明，不得虚构表现结论；请区分“数据事实”和“分析推断”。',
        'sections 必须包含：表现判断、数据事实、可能原因、保留变量、淘汰变量、下一轮衍生方向、建议测试组、风险提醒。',
        `prompts 最多输出 ${actionSettings.outputCount} 条下一轮素材提示词；数据不足时 prompts 可以为空数组。`,
      ].join('\n')
    case 'channel-rewrite':
      return [
        '这是“渠道改写”技能。用户已经有一条素材提示词，请只做目标渠道适配。',
        '必须保留原提示词中的核心卖点、产品信息、价格、承诺、适用人群和活动机制。',
        '不得重新发散新卖点，不得把素材改成无关方向。',
        '根据目标渠道调整：画面比例、构图、字幕密度、平台原生感、CTA 表达、审核风险。',
        'finalPrompt 输出目标渠道版完整提示词。',
        'prompts 输出 3 条轻微不同的渠道适配版本。',
        'sections 必须包含：保留内容、渠道改写点、目标渠道版提示词、审核风险。',
      ].join('\n')
    default:
      return '严格以参考图片和用户原始文字为基准执行自定义技能；最终结果必须保留可观察事实和原始意图，只在技能明确允许的范围内处理，不得替换成通用行业方案。'
  }
}

function normalizeConceptExtractionPrompt(value: string) {
  let prompt = value.trim()
  const finalPromptMarkers = [...prompt.matchAll(/(?:最终生图提示词|最终提示词|生图提示词)\s*[:：]/g)]
  const lastMarker = finalPromptMarkers.at(-1)
  if (lastMarker?.index != null) {
    prompt = prompt.slice(lastMarker.index + lastMarker[0].length).trim()
  }

  prompt = prompt
    .replace(/^(?:(?:分析结果|分析|思考过程|参考图分析|选择理由|概念母题)\s*[:：][^。；\n]*[。；\n]\s*)+/g, '')
    .replace(/^(?:最终生图提示词|最终提示词|生图提示词)\s*[:：]\s*/g, '')
    .replace(/(^|[。；])\s*生成(?:一组|一系列|多张|若干张)/g, '$1生成一张独立画面，呈现')
    .replace(/(?:同风格)?系列(图片|图像|插画|图标|画面)/g, '单张$1')
    .replace(/(?:每张|各张|每幅|各幅)(?:图片|图像|画面)?/g, '当前画面')
    .replace(/\s+/g, ' ')
    .replace(/^[“”"']+|[“”"']+$/g, '')
    .trim()

  if (prompt && !prompt.includes('一张独立画面')) {
    prompt = `基于参考图生成一张独立画面；${prompt}`
  }
  return prompt
}

function normalizeParsedPayload(actionId: AssistantActionId, payload: AssistantJsonPayload, title?: string, customSkill?: AssistantCustomSkill, actionSettings: AssistantActionSettings = DEFAULT_ASSISTANT_ACTION_SETTINGS): AssistantActionResult {
  const contract = getActionContract(actionId, customSkill)
  const candidates = contract?.output.candidates === false ? [] : normalizeStringArray(payload.prompts)
  const sections = contract?.output.analysis === false ? [] : normalizeSections(payload.sections)
  const allowVariableOutput = canActionOutputVariables(actionId, customSkill)
  const rawWordEntries = allowVariableOutput ? normalizeWordEntries(payload.wordEntries) : []
  const rawFinalPrompt = contract?.output.finalPrompt === false ? '' : typeof payload.finalPrompt === 'string' ? payload.finalPrompt.trim() : ''
  const finalPrompt = actionId === 'image-derive' ? normalizeConceptExtractionPrompt(rawFinalPrompt) : rawFinalPrompt
  const rawVariablePrompt = allowVariableOutput && typeof payload.variablePrompt === 'string' ? payload.variablePrompt.trim() : ''
  const blockedWordEntryValues = new Set((sections ?? []).flatMap((section) => section.items.map((item) => item.trim()).filter(Boolean)))
  const { variablePrompt, wordEntries } = normalizeVariableOutput(rawVariablePrompt, rawWordEntries, actionSettings.wordDerive.categories, blockedWordEntryValues)
  const summary = typeof payload.summary === 'string' ? payload.summary.trim() : ''
  const content = formatPayloadContent({ summary, finalPrompt, variablePrompt, candidates, sections: sections ?? [], wordEntries })
  const primaryText = getPrimaryText(contract?.primaryOutput, { finalPrompt, variablePrompt, candidates, sections: sections ?? [], content })

  return {
    actionId,
    title: title ?? ACTION_TITLES[actionId] ?? '自定义技能',
    content,
    candidates: candidates.length ? candidates : finalPrompt ? [finalPrompt] : [],
    sections: sections.length ? sections : undefined,
    wordEntries: wordEntries.length ? wordEntries : allowVariableOutput ? [] : undefined,
    primaryText,
    variablePrompt: variablePrompt || undefined,
  }
}

function getPrimaryText(
  primaryOutput: AssistantSkillContract['primaryOutput'] | undefined,
  value: {
    finalPrompt: string
    variablePrompt: string
    candidates: string[]
    sections: AssistantResultSection[]
    content: string
  },
) {
  switch (primaryOutput) {
    case 'finalPrompt': return value.finalPrompt || value.candidates[0] || ''
    case 'variablePrompt': return value.variablePrompt || value.finalPrompt || value.candidates[0] || ''
    case 'analysis': return value.content || value.sections[0]?.items.join('\n') || ''
    case 'candidate': return value.candidates[0] || value.finalPrompt || ''
    default: return value.variablePrompt || value.finalPrompt || value.candidates[0] || ''
  }
}

function sanitizeVariableEntryValues(category: string, entries: string[], blockedValues: Set<string> = new Set()) {
  const key = category.trim()
  return uniqueStrings(entries.map((entry) => entry.trim()).filter(Boolean))
    .filter((entry) => entry !== key && entry !== `{{${key}}}` && !blockedValues.has(entry))
}

function normalizeVariableOutput(variablePrompt: string, wordEntries: AssistantWordEntryGroup[], allowedCategories: string[], blockedValues: Set<string> = new Set()) {
  if (wordEntries.length === 0) return { variablePrompt: '', wordEntries: [] }
  const allowedCategorySet = new Set(allowedCategories.map((category) => category.trim()).filter(Boolean))
  const placeholderNames = new Set(
    [...variablePrompt.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
      .map((match) => match[1]?.trim())
      .filter((name): name is string => Boolean(name)),
  )
  const filteredWordEntries = wordEntries
    .map((group) => ({
      category: group.category.trim(),
      entries: sanitizeVariableEntryValues(group.category, group.entries, blockedValues),
    }))
    // Keep every allowed category with entries. Missing placeholders are patched
    // locally afterwards (only when a model-provided variable prompt exists),
    // so we must not drop them here.
    .filter((group) => allowedCategorySet.has(group.category) && group.entries.length > 0)
  const validNames = new Set(filteredWordEntries.map((group) => group.category))
  const normalizedPrompt = variablePrompt.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, name: string) => {
    const normalizedName = String(name).trim()
    return validNames.has(normalizedName) ? `{{${normalizedName}}}` : normalizedName
  })
  return { variablePrompt: validNames.size > 0 ? normalizedPrompt : '', wordEntries: filteredWordEntries }
}

async function completeWordEntriesIfNeeded(
  result: AssistantActionResult,
  actionSettings: AssistantActionSettings,
  _context: AssistantInputContext,
  opts: {
    settings: AppSettings
    profile: ApiProfile
    params: TaskParams
    customSkill?: AssistantCustomSkill
    onProgress?: (update: AssistantRunnerProgressUpdate) => void
  },
): Promise<AssistantActionResult> {
  if (result.actionId === 'word-extract') return result
  const allowedCategorySet = new Set(actionSettings.wordDerive.categories)
  const groups = (result.wordEntries ?? [])
    .filter((group) => allowedCategorySet.has(group.category))
    .map((group) => ({ ...group, entries: sanitizeVariableEntryValues(group.category, group.entries).filter(Boolean) }))
    .filter((group) => group.entries.length > 0)
  if (groups.length === 0) return result

  const existingPrompt = result.variablePrompt ?? ''

  // P1: 模型没有返回变量主提示词时，不本地新建。宁可少生成，
  // 也别生成一条看起来“像完成”的空模板提示词（裸拼 {{分类}} 仍像变量皮肤）。
  if (!existingPrompt.trim()) {
    opts.onProgress?.({ stage: 'repair-variables', detail: '模型返回了变量词条，但没有返回可用的变量主提示词；已保留词条，未自动拼接模板。' })
    return {
      ...result,
      wordEntries: groups,
      qualityState: 'insufficient-data',
      qualityNote: '模型返回了变量词条，但没有返回可替换的变量主提示词；已保留词条，未自动拼接模板。',
    }
  }

  // 模型返回了变量主提示词：只允许局部补缺少的占位符，不重建原文。
  const patchedPrompt = patchVariablePromptPlaceholders(existingPrompt, groups)
  if (patchedPrompt === existingPrompt) {
    return { ...result, wordEntries: groups }
  }
  opts.onProgress?.({ stage: 'repair-variables', detail: '变量主提示词缺少对应占位符，正在局部补位（不重建原文）。' })
  const next: AssistantActionResult = {
    ...result,
    variablePrompt: patchedPrompt,
    wordEntries: groups,
    qualityState: 'repaired',
  }
  return { ...next, primaryText: resolveResultPrimaryText(next) }
}

function extractPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
    .map((match) => match[1]?.trim())
    .filter((name): name is string => Boolean(name))
}

function patchVariablePromptPlaceholders(variablePrompt: string, groups: AssistantWordEntryGroup[]): string {
  const existing = variablePrompt ?? ''
  // P1: 没有现成变量主提示词时，绝不本地裸拼 {{分类}} 当成变量皮肤。
  if (!existing.trim()) return existing
  const placeholderNames = new Set(extractPlaceholders(existing))
  const missing = groups.filter((group) => group.entries.length > 0 && !placeholderNames.has(group.category))
  if (missing.length === 0) return existing
  const additions = missing.map((group) => `{{${group.category}}}`)
  return [existing.trim(), ...additions].filter(Boolean).join('，')
}

function resolveResultPrimaryText(result: AssistantActionResult) {
  return getPrimaryText(getActionContract(result.actionId)?.primaryOutput, {
    finalPrompt: result.candidates?.[0] ?? '',
    variablePrompt: result.variablePrompt ?? '',
    candidates: result.candidates ?? [],
    sections: result.sections ?? [],
    content: result.content,
  })
}

function uniqueStrings(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))]
}

function formatPayloadContent(payload: {
  summary: string
  finalPrompt: string
  variablePrompt: string
  candidates: string[]
  sections: AssistantResultSection[]
  wordEntries: AssistantWordEntryGroup[]
}) {
  const lines: string[] = []
  if (payload.summary) lines.push(payload.summary, '')
  for (const section of payload.sections) {
    lines.push(`${section.title}：`)
    section.items.forEach((item) => lines.push(`- ${item}`))
    lines.push('')
  }
  if (payload.wordEntries.length && payload.sections.length === 0) {
    for (const group of payload.wordEntries) {
      lines.push(`${group.category}：`)
      group.entries.forEach((entry) => lines.push(`- ${entry}`))
      lines.push('')
    }
  }
  if (payload.candidates.length > 1) {
    lines.push('候选提示词：')
    payload.candidates.forEach((prompt, index) => lines.push(`${index + 1}. ${prompt}`))
    lines.push('')
  }
  if (payload.finalPrompt) {
    lines.push(`最终提示词：${payload.finalPrompt}`)
  }
  if (payload.variablePrompt) {
    if (lines.length) lines.push('')
    lines.push(`词条提示词：${payload.variablePrompt}`)
  }
  return lines.join('\n').trim()
}

function parseAssistantJsonPayload(text: string): AssistantJsonPayload | null {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '')
  const jsonText = trimmed.startsWith('{') ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0]
  if (!jsonText) return null
  try {
    const parsed = JSON.parse(jsonText) as AssistantJsonPayload
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
    : []
}

function normalizeSections(value: unknown): AssistantResultSection[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((section): AssistantResultSection[] => {
    if (!section || typeof section !== 'object') return []
    const record = section as Record<string, unknown>
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    const items = normalizeStringArray(record.items)
    return title && items.length ? [{ title, items }] : []
  })
}

function normalizeWordEntries(value: unknown): AssistantWordEntryGroup[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((group): AssistantWordEntryGroup[] => {
    if (!group || typeof group !== 'object') return []
    const record = group as Record<string, unknown>
    const category = typeof record.category === 'string' ? record.category.trim() : ''
    const entries = normalizeStringArray(record.entries)
    return category && entries.length ? [{ category, entries }] : []
  })
}

function extractNumberedPrompts(text: string) {
  const matches = [...text.matchAll(/(?:^|\n)\s*\d+[.、)]\s*([^\n]+(?:\n(?!\s*\d+[.、)]).+)*)/g)]
    .map((match) => match[1]?.trim())
    .filter((item): item is string => Boolean(item))
  return matches.length > 1 ? matches : null
}

function extractPrimaryPrompt(text: string) {
  const finalPromptMatch = text.match(/(?:最终提示词|完整提示词)[:：]\s*([\s\S]+)$/)
  if (finalPromptMatch?.[1]?.trim()) return finalPromptMatch[1].trim()
  const numbered = text.match(/^\s*(?:1[.、)]\s*)(.+)$/m)
  if (numbered?.[1]?.trim()) return numbered[1].trim()
  return text.trim()
}
