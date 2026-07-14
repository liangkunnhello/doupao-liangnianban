import type { ApiProfile, AppSettings, InputImage, TaskParams } from '../../types'
import { callAgentResponsesApi } from '../../lib/agentApi'
import { BUILT_IN_ASSISTANT_ACTIONS } from './builtInActions'
import { buildGroundingProfile } from './context'
import { resolveEffectiveVisualSkill, normalizeAssistantActionPreferences, getResolvedBuiltInActions, isAssistantActionRunnable } from './matcher'
import type {
  AssistantAction,
  AssistantActionId,
  AssistantActionPreferences,
  AssistantActionResult,
  AssistantCustomSkill,
  AssistantInputContext,
  AssistantQualityState,
  AssistantSkillContract,
  AssistantWordEntryGroup,
  EffectiveVisualSkill,
  VisualIdentity,
  WordEntryConfig,
  WordEntryStrategy,
} from './types'
import { INFORMATION_FLOW_AD_COMPLIANCE_PROMPT, sanitizeInformationFlowAdResult } from './adCompliance'

/** The shared, non-disablable AI visual-semantic conversion base that every
 *  default and custom skill must pass through. See spec §三 (六步底座). */
const SHARED_VISUAL_SEMANTIC_BASE = [
  '【共享 AI 视觉语义转换底座 · 所有技能强制执行，不可关闭】',
  '第一步 · 输入事实识别（优先级：用户明确要求 > 参考图片事实 > 原始提示词事实 > 技能规则 > 通用创意经验）',
  '识别用户明确输入的主体与概念、产品/品牌/人物/物体事实、参考图片中的可观察内容、用户要求保留或改变的部分，以及不能确认、不得擅自补充的内容。',
  '',
  '第二步 · 概念理解（内部分析，不向用户输出思考过程）',
  '理解核心含义、用户需求、用户心理期待、视觉联想、情绪价值与商业传播目标。例如“财富”不能只输出金币，而要先理解它可能表达获得感、机会感、增长感、积累感或惊喜感。',
  '',
  '第三步 · 视觉符号转换',
  '将抽象语义转换为：主视觉主体、象征元素、动态元素、情绪元素、氛围元素、装饰元素、空间关系、镜头关系。',
  '',
  '第四步 · 完整画面包装',
  '补齐 GPT 生图需要的描述：主体形态与占比、动作和状态、材质与细节、场景和背景、光线和色彩、镜头与构图、景深和空间层级、手机端第一眼识别性。',
  '视觉符号转换和商业画面包装只能作用于当前技能明确允许改变的维度内。',
  '',
  '第五步 · 技能边界控制',
  '共享底座负责“如何把概念变成视觉”，当前技能只负责：哪些内容必须保留、哪些允许变化、变化幅度、是否生成词条、词条组织方式。',
  '',
  '第六步 · 结果校验（输出前强制检查）',
  '只能有一条提示词；提示词直接描述要生成的画面；不包含“经过分析”“视觉定位如下”等解释性文字；不包含多个编号方案；不出现没有依据的产品事实或商业承诺；所有 {{变量}} 都存在对应词条分类；所有词条都能直接替换进提示词；没有对应词条的占位符自动转成普通文字。',
].join('\n')

const ACTION_TITLES: Record<string, string> = {
  'prompt-optimize': '提示词优化',
  'image-describe': '图片描述',
  'super-derive': '超级衍生',
  'wild-derive': '赌狗模式',
}

interface AssistantJsonPayload {
  prompt?: string
  finalPrompt?: string
  variablePrompt?: string
  wordEntries?: AssistantWordEntryGroup[]
  sourceAnchors?: string[]
  assumptions?: string[]
  visualIdentity?: VisualIdentity
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

/** Derive the unified compatible result fields from the single prompt. This is
 *  the ONLY place that sets content / primaryText / variablePrompt so they can
 *  never drift from `prompt` (spec §2.3). */
export function deriveAssistantResultFields(
  prompt: string,
  wordEntries?: AssistantWordEntryGroup[],
): Pick<AssistantActionResult, 'prompt' | 'content' | 'primaryText' | 'variablePrompt' | 'wordEntries'> {
  const entries = wordEntries && wordEntries.length ? wordEntries : undefined
  return {
    prompt,
    content: prompt,
    primaryText: prompt,
    variablePrompt: entries ? prompt : undefined,
    wordEntries: entries,
  }
}

export async function runAssistantAction(
  actionId: AssistantActionId,
  context: AssistantInputContext,
  opts: {
    settings: AppSettings
    profile: ApiProfile
    params: TaskParams
    actionSettings?: Partial<AssistantActionPreferences['actionSettings']>
    customSkill?: AssistantCustomSkill
    skill?: AssistantAction
    preferences?: AssistantActionPreferences
    onProgress?: (update: AssistantRunnerProgressUpdate) => void
  },
): Promise<AssistantActionResult> {
  if (!opts.profile.apiKey.trim()) {
    throw new Error('请先在设置中配置 Agent 使用的 API Key')
  }

  const preferences = opts.preferences ?? normalizeAssistantActionPreferences(undefined)
  const skill = opts.skill
    ?? opts.customSkill
    ?? getResolvedBuiltInActions(preferences).find((action) => action.id === actionId)
    ?? BUILT_IN_ASSISTANT_ACTIONS.find((action) => action.id === actionId)
  if (!skill) throw new Error('未找到对应的技能定义')
  if (!isAssistantActionRunnable(skill, context)) {
    throw new Error('当前输入不满足该技能要求，请补充所需的文字或参考图片。')
  }

  const effective = resolveEffectiveVisualSkill(skill, preferences)
  const grounding = buildGroundingProfile(context)

  opts.onProgress?.({ stage: 'prepare-input', detail: context.hasImage ? `已建立输入事实卡，读取 ${context.imageCount} 张参考图和当前提示词。` : '已建立输入事实卡，读取当前提示词和技能设置。' })

  const buildInput = () => createAssistantActionInput(effective, context, grounding)

  opts.onProgress?.({ stage: 'request-model', detail: '请求已发送，正在等待模型返回结果。' })
  let rawText = (await callAgentResponsesApi({
    settings: opts.settings,
    profile: opts.profile,
    params: opts.params,
    input: buildInput(),
  })).text.trim()

  // Retry once on an empty response before giving up.
  if (!rawText) {
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
  let parsed = parseAssistantJsonPayload(rawText)
  let usedRepair = false

  // Single, unified repair pass. Either the JSON is structurally broken, or the
  // variable skill returned an incomplete word-entry / placeholder mapping. We
  // attempt at most ONE repair request for the whole run (spec §五.3).
  const repairIssue = parsed ? variableRepairIssue(effective, parsed) : 'structure'
  if (repairIssue) {
    opts.onProgress?.({ stage: 'repair-variables', detail: repairIssue === 'structure' ? '返回不是标准 JSON，正在请求一次结构修复。' : '变量词条不完整，正在请求一次结构与语义修复。' })
    const repairedText = await repairJsonStructure(opts, rawText, repairIssue)
    const repairedParsed = repairedText != null ? parseAssistantJsonPayload(repairedText) : null
    if (!repairedParsed) {
      // Repair still did not produce valid JSON: degrade to the latest text.
      const { prompt, note } = extractPromptFromText(repairedText ?? rawText)
      const result: AssistantActionResult = {
        actionId,
        title: effective.name,
        ...deriveAssistantResultFields(prompt),
        qualityState: prompt ? 'repaired' : 'insufficient-data',
        qualityNote: prompt ? (note ?? '模型返回不是标准 JSON，已提取可用提示词。') : undefined,
      }
      return withResultMeta(result, grounding)
    }
    // Repair produced JSON. If the variable mapping is STILL broken, we have used
    // our single allowed repair — degrade locally instead of asking again (§五.2).
    if (variableRepairIssue(effective, repairedParsed)) {
      const degraded = degradeToRepaired(actionId, effective, repairedParsed, grounding)
      return withResultMeta(degraded, grounding)
    }
    parsed = repairedParsed
    usedRepair = true
  }

  opts.onProgress?.({ stage: 'validate-result', detail: '正在校验单条提示词与词条映射。' })
  const normalized = normalizeVisualSkillResult(actionId, effective, parsed!, grounding)
  // Compliance cleaning may rewrite prompt/word-entry text, so re-check the
  // placeholder ↔ word-entry mapping afterwards (spec §五.7).
  const sanitized = sanitizeInformationFlowAdResult(normalized)
  const reconciled = reconcileAfterSanitize(sanitized, effective)
  opts.onProgress?.({ stage: 'organize-result', detail: '正在整理最终结果。' })
  const finalResult: AssistantActionResult = {
    ...reconciled,
    ...deriveAssistantResultFields(reconciled.prompt, reconciled.wordEntries),
    ...(usedRepair && reconciled.qualityState === 'complete'
      ? { qualityState: 'repaired' as const, qualityNote: reconciled.qualityNote ?? '模型返回已自动修复。' }
      : {}),
  }
  return withResultMeta(finalResult, grounding)
}

function withResultMeta(
  result: AssistantActionResult,
  grounding?: AssistantActionResult['grounding'],
): AssistantActionResult {
  return {
    ...result,
    grounding: grounding ?? result.grounding,
  }
}

/** Returns 'structure' if the payload is not valid JSON, or 'variable' if a
 *  variable skill returned an incomplete word-entry / placeholder mapping. */
function variableRepairIssue(effective: EffectiveVisualSkill, payload: AssistantJsonPayload): 'structure' | 'variable' | null {
  const config = effective.wordEntries
  if (!config) return null
  const prompt = (payload.prompt ?? payload.finalPrompt ?? payload.variablePrompt ?? '').trim()
  const placeholders = extractPlaceholders(prompt)
  const entries = normalizeWordEntries(payload.wordEntries, config)
  const entriesByCategory = new Map(entries.map((group) => [group.category, group.entries]))
  if (config.strategy === 'direction-pack') {
    const required = config.categories[0]
    return required
      && (placeholders.length !== 1 || placeholders[0] !== required || (entriesByCategory.get(required)?.length ?? 0) < config.count)
      ? 'variable'
      : null
  }
  if (placeholders.length === 0) return 'variable'
  return placeholders.every((name) => config.categories.includes(name) && (entriesByCategory.get(name)?.length ?? 0) >= config.count)
    ? null
    : 'variable'
}

async function repairJsonStructure(
  opts: { settings: AppSettings; profile: ApiProfile; params: TaskParams },
  brokenText: string,
  issue: 'structure' | 'variable',
): Promise<string | null> {
  try {
    const instruction = issue === 'structure'
      ? [
        '下面是模型本应返回的 JSON，但结构可能有缺失的括号、引号或多余文字。',
        '请只修复 JSON 结构，使它可以被正确解析；不得改变 prompt 的内容，不要新增或删减词条，不要输出任何解释，只输出修复后的合法 JSON。',
      ]
      : [
        '下面是模型返回的 JSON，但变量词条与提示词占位符不匹配（缺少 {{变量}} 或 wordEntries 分类与占位符不一致）。',
        '请只修复以下问题：',
        '保持原 prompt 画面内容不变；',
        '把可变位置替换成允许的 {{变量名}}；',
        'wordEntries.category 必须与变量名完全一致；',
        '不新增第二条 prompt；',
        '只返回合法 JSON。',
      ]
    const repaired = await callAgentResponsesApi({
      settings: opts.settings,
      profile: opts.profile,
      params: opts.params,
      input: [{
        role: 'user',
        content: [{
          type: 'input_text',
          text: [...instruction, '原始内容：', brokenText].join('\n'),
        }],
      }],
    })
    return repaired.text.trim() || null
  } catch {
    return null
  }
}

function getIntensityLabel(intensity: string): string {
  switch (intensity) {
    case 'faithful': return '忠实：尽量还原输入，只做必要的视觉包装'
    case 'controlled': return '受控：在保留原意和事实的前提下做局部优化'
    case 'high': return '高：在保留核心概念与产品事实的前提下大幅创意扩展'
    case 'maximum': return '最大：只锁定语义核心与真实事实，最大范围探索不同方向'
    default: return '受控'
  }
}

function createAssistantActionInput(
  effective: EffectiveVisualSkill,
  context: AssistantInputContext,
  grounding: ReturnType<typeof buildGroundingProfile>,
) {
  const lines: string[] = [
    '你是图片与素材提示词助手。根据当前输入严格执行用户点击的技能。',
    '只返回文本，不要调用图片生成工具，不要生成图片。',
    '返回必须是严格 JSON，不要 Markdown，不要代码块，不要解释。',
    '',
    SHARED_VISUAL_SEMANTIC_BASE,
    '',
    '【参考输入优先规则，所有技能强制执行】',
    '参考图片和用户原始文字是最高事实源；技能名称只决定如何处理这些输入，不允许用行业常识、通用广告模板或常见案例替换参考输入。',
    '先观察参考图并提取 3–8 个可验证的 sourceAnchors，包括真实主体、主体位置与占比、构图、背景、颜色、文字与排版、场景、材质、光影和视觉风格；不得把推测的人群、行业、卖点或效果写成图片事实。',
    '同时按字段回填 visualIdentity（subject / composition / color / scene / textLayout / style），每个字段只写图片中可直接观察到的内容，无法观察的字段留空字符串；没有参考图时省略 visualIdentity。',
    '最终提示词必须以 sourceAnchors 和用户原始文字为主干；不能只在分析中提到参考图，最终提示词却改用通用行业方案。',
    '行业知识只能补足完成任务不可缺少且参考输入没有说明的中性执行细节；不得新增产品、人物、场景、卖点、功效、受众、品牌、价格、活动、CTA 或渠道版式。',
    'sourceAnchors 仅用于内部规划，严禁把 sourceAnchors 列表、原始文字全文、分析过程、判断理由等说明性前缀拼接到生图提示词。',
    'prompt 必须直接描述要生成的画面，不写“经过分析”“基于上述分析”“视觉定位如下”等解释性内容。',
    '',
    `【当前技能：${effective.name}】`,
    `变化强度：${getIntensityLabel(effective.intensity)}。`,
    effective.preserveRules.length ? `必须保留：${effective.preserveRules.join('、')}。` : '',
    effective.editableRules.length
      ? `仅允许改变：${effective.editableRules.join('、')}。`
      : '本技能可编辑范围为空，视觉符号转换与商业画面包装不得添加图片中不存在的主体、装饰、卖点、人物、CTA 或商业符号。',
    effective.forbiddenRules.length ? `禁止改变：${effective.forbiddenRules.join('、')}。` : '',
    effective.instruction ? `技能专属指令：${effective.instruction}` : '',
    '',
    `当前文字：${context.text || '（无）'}`,
    `参考图片数量：${context.imageCount}`,
    '',
    INFORMATION_FLOW_AD_COMPLIANCE_PROMPT,
    '',
    'JSON 结构（只输出下面这种结构，prompt 永远只有一条）：',
  ]

  const schema: Record<string, unknown> = {
    prompt: '一条完整、可直接用于 GPT 生图的提示词',
    wordEntries: [] as unknown[],
  }
  if (context.hasImage) {
    schema.sourceAnchors = ['从参考图或原始文字提取的可验证依据，3–8 条']
    schema.assumptions = ['无法从参考输入确认、必须由模型给出的假设']
    schema.visualIdentity = { subject: '', composition: '', color: '', scene: '', textLayout: '', style: '' }
  }
  lines.push(JSON.stringify(schema, null, 2))

  if (effective.wordEntries) {
    lines.push(
      '',
      `【词条生成 · 策略：${effective.wordEntries.strategy === 'direction-pack' ? '方向套装' : '独立可替换词条'}】`,
      `每个分类至少生成 ${effective.wordEntries.count} 个不重复、可直接替换的短词条。`,
      `允许的分类只有：${effective.wordEntries.categories.join('、')}。`,
    )
    if (effective.wordEntries.strategy === 'direction-pack') {
      lines.push('每个词条本身必须是一个语义完整、连贯、可独立成立的大跨度创意方向（例如“金色宝箱爆发式开启，金币和红包飞向镜头的高能促销视觉”），不要拆解成孤立变量；所有方向之间差异要足够大，但每个方向内部必须逻辑自洽，避免随机抽取后互相冲突。')
      lines.push(`提示词中必须包含且仅包含占位符 {{${effective.wordEntries.categories[0]}}}。`)
    } else {
      lines.push('prompt 中的 {{变量名}} 必须与 wordEntries.category 完全一致；所有词条都能直接替换进 prompt。')
    }
  } else {
    lines.push(
      '',
      '本技能不生成词条：prompt 为一条普通完整提示词，不要写入 {{变量}}、variablePrompt 或 wordEntries。',
    )
  }

  const content: Array<Record<string, string>> = [{ type: 'input_text', text: lines.join('\n') }]
  for (const image of context.images) {
    content.push({ type: 'input_image', image_url: (image as InputImage).dataUrl })
  }
  return [{ role: 'user', content }]
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

/** Normalize the parsed payload into a single-prompt V2 result. Unmapped
 *  placeholders are converted to plain text one-by-one (never deleting mapped
 *  variables, spec §五.1). */
function normalizeVisualSkillResult(
  actionId: AssistantActionId,
  effective: EffectiveVisualSkill,
  payload: AssistantJsonPayload,
  grounding: ReturnType<typeof buildGroundingProfile>,
): AssistantActionResult {
  const title = effective.name
  let prompt = (payload.prompt ?? payload.finalPrompt ?? payload.variablePrompt ?? '').trim()
  prompt = stripExplanatoryPrefix(prompt)

  const config = effective.wordEntries
  const rawEntries = config ? normalizeWordEntries(payload.wordEntries, config) : []
  const placeholders = extractPlaceholders(prompt)
  const mappedEntries = rawEntries.filter((group) => placeholders.includes(group.category))
  const mappedNames = new Set(mappedEntries.map((group) => group.category))
  const unmapped = placeholders.filter((name) => !mappedNames.has(name))

  if (unmapped.length > 0) {
    prompt = prompt.replace(
      /\{\{\s*([^{}]+?)\s*\}\}/g,
      (match, name: string) => (mappedNames.has(name.trim()) ? match : name.trim()),
    )
  }

  let qualityState: AssistantQualityState = prompt ? 'complete' : 'insufficient-data'
  let qualityNote: string | undefined
  if (unmapped.length > 0) {
    qualityState = 'repaired'
    qualityNote = `已将 ${unmapped.length} 个无对应词条的占位符转为普通文字。`
  }

  void grounding
  return {
    actionId,
    title,
    ...deriveAssistantResultFields(prompt, mappedEntries.length > 0 ? mappedEntries : undefined),
    qualityState,
    qualityNote,
  }
}

/** Local degrade used when the single allowed repair still leaves an incomplete
 *  variable mapping: clean up invalid variables, drop orphaned word entries, and
 *  mark the result as repaired (spec §五.2). */
function degradeToRepaired(
  actionId: AssistantActionId,
  effective: EffectiveVisualSkill,
  payload: AssistantJsonPayload,
  grounding: ReturnType<typeof buildGroundingProfile>,
): AssistantActionResult {
  const normalized = normalizeVisualSkillResult(actionId, effective, payload, grounding)
  const sanitized = sanitizeInformationFlowAdResult(normalized)
  const reconciled = reconcileAfterSanitize(sanitized, effective)
  return {
    ...reconciled,
    ...deriveAssistantResultFields(reconciled.prompt, reconciled.wordEntries),
    qualityState: 'repaired',
    qualityNote: reconciled.qualityNote ?? '词条映射不完整，已降级为普通提示词。',
  }
}

/** Re-check the placeholder ↔ word-entry mapping after compliance cleaning.
 *  If a variable skill ended up with no mapped entries (isolated / orphaned),
 *  degrade to a plain prompt (spec §五.2). */
function reconcileAfterSanitize(result: AssistantActionResult, effective: EffectiveVisualSkill): AssistantActionResult {
  const placeholders = extractPlaceholders(result.prompt)
  const entries = result.wordEntries
  if (!entries || entries.length === 0) {
    if (placeholders.length === 0) return result
    const cleaned = result.prompt.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, name: string) => name.trim())
    return { ...result, prompt: cleaned, qualityState: 'repaired', qualityNote: result.qualityNote ?? '词条生成失败，已降级为普通提示词。' }
  }
  const keptEntries = entries.filter((group) => placeholders.includes(group.category))
  if (effective.wordEntries && keptEntries.length === 0) {
    const plain = result.prompt.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, name: string) => name.trim())
    return {
      ...result,
      prompt: plain,
      wordEntries: undefined,
      qualityState: 'repaired',
      qualityNote: '词条生成失败，已降级为普通提示词。',
    }
  }
  const categorySet = new Set(entries.map((group) => group.category))
  const orphan = placeholders.filter((name) => !categorySet.has(name))
  if (orphan.length === 0) return { ...result, wordEntries: keptEntries }
  const cleanedPrompt = result.prompt.replace(
    /\{\{\s*([^{}]+?)\s*\}\}/g,
    (match, name: string) => (categorySet.has(name.trim()) ? match : name.trim()),
  )
  return { ...result, prompt: cleanedPrompt, wordEntries: keptEntries }
}

function stripExplanatoryPrefix(text: string): string {
  return text
    .replace(/^(?:(?:经过分析|基于上述分析|视觉定位如下|分析结果|分析|思考过程|参考图分析|选择理由|概念母题)\s*[:：][^。；\n]*[。；\n]\s*)+/g, '')
    .replace(/^(?:最终生图提示词|最终提示词|生图提示词|提示词)\s*[:：]\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Extract a single usable prompt from non-JSON model output. Strips Markdown
 *  fences and code blocks, keeps only the first numbered item when the model
 *  returns multiple directions, and falls back to clean text (spec §五.4). */
function extractPromptFromText(text: string): { prompt: string; note?: string } {
  const rawLines = text.split(/\r?\n+/).map((line) => line.trim()).filter(Boolean)

  // 1) A fenced or inline JSON payload anywhere wins.
  for (const line of rawLines) {
    const fenceMatch = line.match(/```(?:json)?\s*([\s\S]*?)```/i)
    const candidate = fenceMatch ? fenceMatch[1].trim() : line
    const json = parseAssistantJsonPayload(candidate)
    if (json?.prompt) return { prompt: json.prompt }
    const jsonMatch = candidate.match(/\{[^{}]*"prompt"\s*:\s*"([^"]*)"[^{}]*\}/)
    if (jsonMatch) return { prompt: jsonMatch[1] }
  }

  // 2) Strip explanatory prefixes, then keep only the first numbered direction.
  const lines = rawLines.map((line) => stripExplanatoryPrefix(line))
  const inlineNumbered = lines.join(' ').match(/^\s*\d+[\.、\)]\s*(.*?)(?=\s+\d+[\.、\)]\s|$)/)
  if (inlineNumbered?.[1] && /\s+\d+[\.、\)]\s/.test(lines.join(' '))) {
    return { prompt: inlineNumbered[1].trim(), note: '模型返回多个方向，已保留第一条提示词。' }
  }
  const numberedIndex = lines.findIndex((line) => /^\d+[\.、\)]\s*/.test(line))
  if (numberedIndex >= 0 && lines.length > 1) {
    const first = lines[numberedIndex].replace(/^\d+[\.、\)]\s*/, '')
    return { prompt: first, note: '模型返回多个方向，已保留第一条提示词。' }
  }
  return { prompt: lines.join(' ').trim() }
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

function extractPlaceholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
    .map((match) => match[1]?.trim())
    .filter((name): name is string => Boolean(name))
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
    : []
}

function normalizeWordEntries(value: unknown, wordConfig: WordEntryConfig): AssistantWordEntryGroup[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((group): AssistantWordEntryGroup[] => {
    if (!group || typeof group !== 'object') return []
    const record = group as Record<string, unknown>
    const category = typeof record.category === 'string' ? record.category.trim() : ''
    if (!category || !wordConfig.categories.includes(category)) return []
    const entries = normalizeStringArray(record.entries)
      .filter(Boolean)
      .filter((entry, index, all) => all.indexOf(entry) === index) // dedupe
      .slice(0, wordConfig.count) // cap count
    return entries.length ? [{ category, entries }] : []
  })
}

// ---------------------------------------------------------------------------
// Custom skill drafting (AI generates a V2 skill draft from a natural-language
// description). The draft is reviewed in the UI form before being saved.
// ---------------------------------------------------------------------------

export interface AssistantSkillDraft {
  name: string
  icon: AssistantCustomSkill['icon']
  steps: string[]
  instruction: string
  contract?: AssistantSkillContract
  /** V2 fields populated by the model. */
  intensity: 'faithful' | 'controlled' | 'high' | 'maximum'
  inputMode: 'text' | 'image' | 'either' | 'both'
  wordEntries: WordEntryConfig
}

export async function createAssistantSkillDraft(description: string, opts: { settings: AppSettings; profile: ApiProfile; params: TaskParams }): Promise<AssistantSkillDraft> {
  if (!opts.profile.apiKey.trim()) throw new Error('请先在设置中配置 Agent 使用的 API Key')
  const result = await callAgentResponsesApi({
    settings: opts.settings,
    profile: opts.profile,
    params: opts.params,
    input: [{ role: 'user', content: [{ type: 'input_text', text: [
      '你是图片与素材技能设计师。用户用自然语言描述想要的功能，请把它做成一个可执行的小技能。所有技能都必须把参考图片和用户原始文字作为最高事实源，且自动继承共享 AI 视觉语义转换底座（输入事实识别→概念理解→视觉符号转换→完整画面包装→技能边界控制→结果校验），最终只输出一条提示词。',
      '只返回严格 JSON，不要 Markdown：',
      '{"name":"不超过8字的技能名称","icon":"image|wand|sparkles|palette|tags|thumbs-up","instruction":"给执行模型的完整中文指令。必须明确技能目标、必须保留项、仅允许改变项、禁止改变项、变化强度和是否生成词条；不得要求输出多个提示词或分析过程。","intensity":"faithful|controlled|high|maximum","inputMode":"text|image|either|both","wordEntries":{"enabled":false,"count":8,"categories":["主视觉主体","视觉符号","动作状态","情绪氛围","材质表现","光影效果","背景环境","商业构图"],"strategy":"atomic|direction-pack"},"contract":{"preserve":["必须保留项"],"editable":["仅允许改变项"],"forbidden":["禁止改变项"]}}',
      '规则：除非用户明确要求生成变量词条，wordEntries.enabled 必须为 false，且 prompt 中不得出现 {{变量}}；除非用户明确要求最大探索，intensity 不得为 maximum；direction-pack 仅用于需要“创意方向套装”的技能。',
      `用户需求：${description}`,
    ].join('\n') }] }],
  })
  const parsed = parseAssistantJsonPayload(result.text) as Partial<AssistantSkillDraft> | null
  const name = typeof parsed?.name === 'string' ? parsed.name.trim().slice(0, 16) : ''
  const instruction = typeof parsed?.instruction === 'string' ? parsed.instruction.trim() : ''
  if (!name || !instruction) throw new Error('没有生成可保存的技能，请换一种说法再试')
  const validIcons: AssistantCustomSkill['icon'][] = ['image', 'wand', 'sparkles', 'palette', 'tags', 'thumbs-up']
  const icon = validIcons.includes(parsed?.icon as AssistantCustomSkill['icon']) ? parsed?.icon as AssistantCustomSkill['icon'] : 'sparkles'
  const intensity = (['faithful', 'controlled', 'high', 'maximum'] as const).includes(parsed?.intensity as never) ? (parsed?.intensity as AssistantSkillDraft['intensity']) : 'controlled'
  const inputMode = (['text', 'image', 'either', 'both'] as const).includes(parsed?.inputMode as never) ? (parsed?.inputMode as AssistantSkillDraft['inputMode']) : 'either'
  const rawWord = parsed?.wordEntries
  const wordEntries: WordEntryConfig = {
    enabled: Boolean(rawWord?.enabled),
    count: typeof rawWord?.count === 'number' && Number.isFinite(rawWord.count) ? Math.max(1, Math.min(50, Math.round(rawWord.count))) : 8,
    categories: Array.isArray(rawWord?.categories) ? rawWord!.categories.map(String).filter(Boolean).slice(0, 12) : (rawWord?.enabled ? ['主视觉主体', '视觉符号', '动作状态', '情绪氛围', '材质表现', '光影效果', '背景环境', '商业构图'] : []),
    strategy: (rawWord?.strategy === 'direction-pack' ? 'direction-pack' : 'atomic') as WordEntryStrategy,
  }
  const contract = buildCustomSkillContractFromDraft(parsed?.contract, instruction, wordEntries.enabled)
  return { name, icon, steps: [], instruction, contract, intensity, inputMode, wordEntries }
}

function buildCustomSkillContractFromDraft(
  raw: unknown,
  instruction: string,
  wordEntriesEnabled: boolean,
): AssistantSkillContract {
  const base: AssistantSkillContract = {
    taskType: 'prompt-optimize',
    objective: instruction.slice(0, 60) || '执行自定义技能',
    preserve: ['参考图片和用户原始文字中的可观察事实', '原始意图'],
    editable: ['技能明确允许的处理'],
    forbidden: ['套用行业通用模板替换参考输入', '把推断内容当作输入事实'],
    variationLevel: 'low',
    requiresAdContext: false,
    allowExploreSellingPoint: false,
    primaryOutput: wordEntriesEnabled ? 'variablePrompt' : 'finalPrompt',
    output: { finalPrompt: true, candidates: false, analysis: false, wordEntries: wordEntriesEnabled },
  }
  if (!raw || typeof raw !== 'object') return base
  const record = raw as Record<string, unknown>
  const stringArray = (value: unknown) => Array.isArray(value) ? value.map(String).filter((item) => Boolean(item)) : []
  return {
    ...base,
    objective: typeof record.objective === 'string' && record.objective.trim() ? record.objective.trim() : base.objective,
    preserve: stringArray(record.preserve).length ? stringArray(record.preserve) : base.preserve,
    editable: stringArray(record.editable).length ? stringArray(record.editable) : base.editable,
    forbidden: stringArray(record.forbidden).length ? stringArray(record.forbidden) : base.forbidden,
  }
}
