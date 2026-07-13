import type { AssistantAction, AssistantActionId, AssistantSkillContract, AssistantSkillStep } from './types'

/** Current schema version of the built-in step definitions. Bump when the default
 *  steps below change so old user overrides can be migrated if needed. */
export const BUILT_IN_SKILL_VERSION = 1

function step(
  id: string,
  title: string,
  role: AssistantSkillStep['role'],
  outputTo: AssistantSkillStep['outputTo'],
  instruction: string,
  required = false,
): AssistantSkillStep {
  return { id, title, role, outputTo, instruction, enabled: true, required }
}

/** Default step flows for built-in skills. A skill is a flow of ordered steps
 *  instead of one opaque instruction; users can edit these via the override layer. */
export const BUILT_IN_SKILL_STEPS: Partial<Record<AssistantActionId, AssistantSkillStep[]>> = {
  // image-derive ships an editable step flow like every other skill. Its dedicated
  // single-image concept-extraction workflow only runs as a fallback when no step
  // flow is present (see runner: createConceptExtractionInput).
  'image-derive': [
    step('observe-reference', '第一步：观察参考图', 'observe', 'sections',
      '静默观察参考图，只提取构图、配色、材质、视角、背景、光线、阴影、主体尺度和留白等可观察视觉参数；不要把观察过程写进最终提示词。'),
    step('extract-concept', '第二步：提炼单一功能概念', 'extract', 'sections',
      '提炼一个简短的功能概念，只允许改变核心功能符号或主体隐喻；同一画面只保留一个清晰主体，必要时最多加入一个辅助元素。'),
    step('write-final-prompt', '第三步：输出单图提示词', 'finalPrompt', 'finalPrompt',
      '只输出一个 80–160 个汉字的自然段，明确“生成一张独立画面”；整体视觉风格和画面参数严格沿用参考图；禁止组图、多联画、同画布多方案。', true),
  ],
  'prompt-optimize': [
    step('diagnose', '第一步：诊断原始提示词', 'observe', 'sections',
      '只指出画面表达、主体关系、场景、风格、约束或合规上的不足；不要主动补充钩子、版式、CTA、渠道要求或变量词条。'),
    step('lock', '第二步：锁定不可改内容', 'lock', 'sections',
      '明确不得改变的核心卖点、产品事实、品牌、价格、承诺、适用人群、画幅和用户指定的风格或场景。'),
    step('write-final-prompt', '第三步：输出优化后提示词', 'finalPrompt', 'finalPrompt',
      '在不改变原意、事实和承诺的前提下，输出一个清晰、完整、可直接使用的最终生图提示词，不要套用信息流广告模板。', true),
  ],
  'angle-matrix': [
    step('observe', '第一步：理解产品与素材', 'observe', 'sections',
      '继承参考输入的主体、产品事实、核心卖点和视觉身份，梳理可用于测试的角度线索。'),
    step('extract', '第二步：锁定一个营销角度', 'extract', 'sections',
      '只改变一个营销切入角度；角度没有参考依据时不得强行套入固定行业模板。'),
    step('write-variable-prompt', '第三步：生成变量提示词', 'variablePrompt', 'variablePrompt',
      '输出一个角度明确的变量主提示词，把可变语义换成设置中的变量分类占位符。'),
    step('write-word-entries', '第四步：生成词条', 'wordEntries', 'wordEntries',
      '按设置中的变量分类输出可测试的短词条，每个分类都能直接替换进变量主提示词。'),
  ],
  'batch-variants': [
    step('observe', '第一步：确认基准方向', 'observe', 'sections',
      '锁定基准方向的产品事实和核心卖点，明确本轮只做 A/B 变体。'),
    step('extract', '第二步：选定唯一测试变量', 'extract', 'sections',
      '每条只改一个测试维度：钩子、场景、人物、卖点呈现方式或版式；其余内容保持基准不变。'),
    step('write-final-prompt', '第三步：输出可归因变体', 'finalPrompt', 'finalPrompt',
      '输出一个短而完整的生图提示词，并包含测试命名，格式示例：hook_pain_scene_home_v01。', true),
  ],
  'ad-review': [
    step('observe', '第一步：核对投放数据', 'observe', 'sections',
      '区分“数据事实”和“分析推断”；如果有 CTR、CVR、CPA、消耗、转化、留存、评论反馈，分析胜出与失败变量。数据不足必须明确说明，不得虚构结论。'),
    step('extract', '第二步：判断保留与淘汰', 'extract', 'sections',
      '给出保留变量、淘汰变量和下一轮衍生方向、建议测试组、风险提醒。'),
    step('write-final-prompt', '第三步：输出下一轮提示词', 'finalPrompt', 'finalPrompt',
      '输出一个下一轮素材提示词；数据不足时可以为空，并在分析中说明原因。', true),
  ],
  'super-derive': [
    step('observe', '第一步：拆解跑量结构', 'observe', 'sections',
      '若有参考图，先拆解首屏钩子、人物/产品主体、痛点场景、卖点表达、视觉冲突、情绪氛围、信任背书、CTA、平台原生感；若有文字，按产品信息、目标人群、投放目标、卖点、价格/优惠、素材限制理解。'),
    step('extract', '第二步：确定衍生方向', 'extract', 'sections',
      '在参考图与原始文字基础上确定可衍生的部分，先逐项写明保留的主体、结构、色板、排版、文案语义、场景和视觉风格，再写允许衍生的部分；不得套用通用竖版广告模板覆盖原素材。'),
    step('write-variable-prompt', '第三步：生成变量提示词', 'variablePrompt', 'variablePrompt',
      '把最终画面中可变的核心语义换成设置中的变量分类占位符，输出一个变量主提示词。'),
    step('write-word-entries', '第四步：生成词条', 'wordEntries', 'wordEntries',
      '按设置中的变量分类输出可替换短变量，必须能直接替换进变量主提示词。避免绝对化承诺、医疗/金融夸大、虚假前后对比、平台禁词和侵权。'),
  ],
  'market-breakdown': [
    step('observe', '第一步：观察样本', 'observe', 'sections',
      '统计参考图数量，提取背景、主体、构图、颜色、材质、光影、文字有无等可观察事实。'),
    step('extract-pattern', '第二步：提炼共性', 'extract', 'sections',
      '总结这些素材共同的视觉结构、功能语义和风格倾向，不要写成最终提示词。'),
    step('judge-direction', '第三步：判断测试方向', 'extract', 'sections',
      '推断适合测试的素材方向，但必须标记为推断，不能当作图片事实。'),
    step('write-final-prompt', '第四步：输出最终提示词', 'finalPrompt', 'finalPrompt',
      '只输出一个自然段最终提示词，概括这组素材适合测试的品类、功能语义、视觉一致性和可差异化方向；适合直接用于下一轮素材生成，不要写样本范围、风险、分析标题。', true),
  ],
  'viral-remix': [
    step('observe', '第一步：拆解结构', 'observe', 'sections',
      '拆解输入素材的结构：钩子、冲突或痛点、卖点证明、主体占比、场景、版式和 CTA。'),
    step('lock', '第二步：锁定结构逻辑', 'lock', 'sections',
      '保留信息层级、视觉节奏、主体占比关系和钩子到 CTA 的结构，只替换具体内容，不照抄品牌、人物、商标或原文案。'),
    step('write-final-prompt', '第三步：输出复刻提示词', 'finalPrompt', 'finalPrompt',
      '输出一个结构复刻但内容替换后的素材提示词，并保留测试命名。', true),
  ],
  'image-describe': [
    step('observe', '第一步：忠实拆解参考图', 'observe', 'sections',
      '分析画幅和构图、视觉主体、背景与色板、文字层级、光影与风格、广告信息结构；无法直接观察的卖点、受众或效果必须标记为“推断”。'),
    step('write-final-prompt', '第二步：整理为最终提示词', 'finalPrompt', 'finalPrompt',
      '把可观察视觉结构整理成一个可直接复用的素材风格最终提示词，保留画幅、构图、主体、背景、色板、文字层级和风格等可观察事实。', true),
  ],
  'style-expand': [
    step('lock', '第一步：锁定内容与风格', 'lock', 'sections',
      '保持主体、内容、场景、品牌、卖点、色板和视觉风格不变，不得改成真人口播、UGC 测评或不同场景。'),
    step('write-final-prompt', '第二步：输出版式提示词', 'finalPrompt', 'finalPrompt',
      '只改变主体位置、标题位置、图文比例、留白、信息层级或 CTA 区域位置，输出一个最终版式提示词。', true),
  ],
  'prompt-examples': [
    step('extract', '第一步：确定案例结构', 'extract', 'sections',
      '提供高潜信息流广告结构案例；存在参考图或原始文字时必须继承其产品事实、主体关系和视觉锚点，只改变案例结构，不得换成无关行业模板；无投放数据时不得声称一定是爆款。'),
    step('write-final-prompt', '第二步：输出案例提示词', 'finalPrompt', 'finalPrompt',
      '输出一个完整可直接用于生图的高潜案例结构提示词，包含标题/字幕位置和 CTA。', true),
  ],
  'word-extract': [
    step('extract', '第一步：识别可复用变量', 'extract', 'sections',
      '从当前输入中提取已经出现或可直接归纳的可复用短词条，不进行变量衍生，不为凑数量凭空扩写；只输出有明确依据的分类。'),
    step('write-variable-prompt', '第二步：生成变量主提示词', 'variablePrompt', 'variablePrompt',
      '输出一个可替换的变量主提示词，占位符与词条分类完全一致。', true),
    step('write-word-entries', '第三步：输出词条', 'wordEntries', 'wordEntries',
      '按设置中的变量分类输出短词条，适合直接复用。', true),
  ],
  'channel-rewrite': [
    step('lock', '第一步：锁定原始内容', 'lock', 'sections',
      '保留原提示词中的核心卖点、产品信息、价格、承诺、适用人群和活动机制，不得重新发散新卖点或改成无关方向。'),
    step('write-final-prompt', '第二步：输出渠道版提示词', 'finalPrompt', 'finalPrompt',
      '根据目标渠道调整画面比例、构图、字幕密度、平台原生感、CTA 表达和审核风险，输出一个目标渠道版完整提示词。', true),
  ],
}

const CONTRACTS: Record<AssistantActionId, AssistantSkillContract> = {
  'image-derive': {
    taskType: 'image-variation',
    objective: '从参考图中提炼简短概念，输出一段只生成单张独立画面、严格沿用参考图视觉参数的图生图提示词。',
    preserve: ['参考图的整体视觉风格与画面参数', '产品或功能语义', '主体尺度与留白'],
    editable: ['核心功能符号或主体隐喻', '必要时一个辅助元素'],
    forbidden: ['要求在同一画面生成组图、套图、多联画或多个方案', '把配色、材质、构图等参考参数改写成无依据的固定描述', '输出思考过程、营销分析、变量词条或多条候选'],
    variationLevel: 'low',
    primaryOutput: 'finalPrompt',
    output: { finalPrompt: true, candidates: false, analysis: true, wordEntries: false },
  },
  'prompt-optimize': {
    taskType: 'prompt-optimize',
    objective: '保持原始意图和事实，将提示词整理为更清晰、可执行的生图指令。',
    preserve: ['产品事实', '品牌', '卖点', '价格和活动机制', '用户已给出的风格、主体和场景'],
    editable: ['描述顺序', '模糊表达', '必要的视觉关系和合规表达'],
    forbidden: ['擅自更换创意方向', '新增卖点', '默认改为信息流广告或竖版', '生成变量词条'],
    variationLevel: 'low',
    primaryOutput: 'finalPrompt',
    output: { finalPrompt: true, candidates: false, analysis: true, wordEntries: false },
  },
  'angle-matrix': {
    taskType: 'creative-expansion',
    objective: '围绕同一产品或素材信息探索不同营销切入角度。',
    preserve: ['产品事实', '品牌', '已确认卖点和合规边界'],
    editable: ['人群切入', '场景', '情绪', '视觉钩子和证明方式'],
    forbidden: ['把推断卖点当作已确认事实'],
    variationLevel: 'high',
    primaryOutput: 'variablePrompt',
    output: { finalPrompt: true, candidates: false, analysis: true, wordEntries: true },
  },
  'batch-variants': {
    taskType: 'creative-expansion',
    objective: '基于一个基准方向创建可归因的 A/B 测试变体。',
    preserve: ['基准方向的产品事实和核心卖点'],
    editable: ['每个测试组中的唯一变量'],
    forbidden: ['在同一候选中同时改变场景、人物、卖点、钩子和版式'],
    variationLevel: 'medium',
    singleVariablePerCandidate: true,
    primaryOutput: 'finalPrompt',
    output: { finalPrompt: true, candidates: false, analysis: true, wordEntries: false },
  },
  'ad-review': {
    taskType: 'review-data',
    objective: '根据用户提供的投放数据分析保留、淘汰和下一轮测试变量。',
    preserve: ['用户提供的数据事实'],
    editable: ['测试建议'],
    forbidden: ['虚构数据结论', '将推断当作事实'],
    variationLevel: 'none',
    primaryOutput: 'finalPrompt',
    output: { finalPrompt: true, candidates: false, analysis: true, wordEntries: false },
  },
  'super-derive': {
    taskType: 'creative-expansion',
    objective: '基于有效素材结构进行较大幅度的创意扩展，产出新的可测试方向。',
    preserve: ['产品事实', '品牌', '已确认卖点和合规边界'],
    editable: ['场景', '人物', '构图', '视觉钩子', '版式和表现手法'],
    forbidden: ['虚构功效、价格、品牌或适用人群'],
    variationLevel: 'high',
    primaryOutput: 'variablePrompt',
    output: { finalPrompt: true, candidates: false, analysis: true, wordEntries: true },
  },
  'market-breakdown': {
    taskType: 'analyze',
    objective: '从一组参考素材中提炼一个可直接用于测试的最终生图提示词。',
    preserve: ['输入素材中的可观察事实'],
    editable: ['功能语义归纳和测试方向表达'],
    forbidden: ['输出拆解报告', '输出多段分析', '输出变量词条', '照抄品牌、人物、商标或文案'],
    variationLevel: 'none',
    primaryOutput: 'finalPrompt',
    output: { finalPrompt: true, candidates: false, analysis: true, wordEntries: false },
  },
  'viral-remix': {
    taskType: 'creative-expansion',
    objective: '复刻有效素材的结构逻辑和视觉节奏，不复制其具体内容。',
    preserve: ['信息层级', '视觉节奏', '主体占比关系', '钩子到 CTA 的结构'],
    editable: ['品牌', '产品', '人物', '场景和文案'],
    forbidden: ['照抄品牌、人物、商标、原文案或专有画面'],
    variationLevel: 'high',
    primaryOutput: 'finalPrompt',
    output: { finalPrompt: true, candidates: false, analysis: true, wordEntries: false },
  },
  'image-describe': {
    taskType: 'analyze',
    objective: '忠实拆解参考素材的视觉和广告结构。',
    preserve: ['图片中可观察到的内容'],
    editable: [],
    forbidden: ['擅自生成新素材方向', '把推断内容描述为图片事实'],
    variationLevel: 'none',
    primaryOutput: 'finalPrompt',
    output: { finalPrompt: true, candidates: false, analysis: true, wordEntries: false },
  },
  'style-expand': {
    taskType: 'layout-variation',
    objective: '保持内容和视觉资产不变，探索信息层级和元素位置的不同布局。',
    preserve: ['主体', '人物', '场景', '品牌', '文案内容', '卖点', '色板和视觉风格'],
    editable: ['主体位置', '标题位置', '图文比例', '留白', '信息层级和 CTA 区域位置'],
    forbidden: ['更换视觉风格', '更换场景', '新增人物或卖点'],
    variationLevel: 'medium',
    primaryOutput: 'finalPrompt',
    output: { finalPrompt: true, candidates: false, analysis: true, wordEntries: false },
  },
  'prompt-examples': {
    taskType: 'creative-expansion',
    objective: '提供可供参考的高潜广告素材结构案例。',
    preserve: ['用户提供的产品事实和合规边界'],
    editable: ['案例角度和画面表达'],
    forbidden: ['在无投放数据时声称一定是爆款'],
    variationLevel: 'high',
    primaryOutput: 'finalPrompt',
    output: { finalPrompt: true, candidates: false, analysis: true, wordEntries: false },
  },
  'word-extract': {
    taskType: 'extract-variables',
    objective: '从当前输入中提取已有的、可复用的变量，不凭空扩写。',
    preserve: ['输入中的原始事实和表述'],
    editable: ['变量分类和归纳方式'],
    forbidden: ['凭空生成大量新变量', '输出长句', '生成不在输入中的卖点'],
    variationLevel: 'none',
    primaryOutput: 'variablePrompt',
    output: { finalPrompt: true, candidates: false, analysis: true, wordEntries: true },
  },
  'channel-rewrite': {
    taskType: 'prompt-optimize',
    objective: '保持现有内容和创意方向，仅做目标渠道适配。',
    preserve: ['产品信息', '核心卖点', '价格', '承诺', '适用人群', '活动机制和创意方向'],
    editable: ['画幅', '字幕密度', 'CTA 语气', '平台原生感和审核表达'],
    forbidden: ['重新发散新卖点', '改成无关创意方向'],
    variationLevel: 'low',
    primaryOutput: 'finalPrompt',
    output: { finalPrompt: true, candidates: false, analysis: true, wordEntries: false },
  },
}

/** Skills that genuinely live inside an information-flow ad workflow.
 *  Everything else (analysis, plain optimization, layout) must not be wrapped
 *  with channel / selling-point / test-plan packaging. */
const AD_CONTEXT_SKILL_IDS = new Set<AssistantActionId>([
  'super-derive',
  'angle-matrix',
  'viral-remix',
  'prompt-examples',
  'batch-variants',
  'channel-rewrite',
])

for (const id of Object.keys(CONTRACTS) as AssistantActionId[]) {
  const contract = CONTRACTS[id]
  contract.requiresAdContext = contract.requiresAdContext ?? AD_CONTEXT_SKILL_IDS.has(id)
  contract.channelAware = contract.channelAware ?? contract.requiresAdContext
}

const RAW_BUILT_IN_ASSISTANT_ACTIONS: AssistantAction[] = [
  {
    id: 'image-derive',
    name: '概念抽取',
    icon: 'image',
    priority: 120,
    when: { image: 'required', text: 'optional' },
    outputMode: 'show-candidates',
    contract: CONTRACTS['image-derive'],
  },
  {
    id: 'prompt-optimize',
    name: '提示词优化',
    icon: 'sparkles',
    priority: 115,
    when: { text: 'required', image: 'optional' },
    outputMode: 'show-candidates',
    contract: CONTRACTS['prompt-optimize'],
  },
  {
    id: 'angle-matrix',
    name: '角度探索',
    icon: 'wand',
    priority: 100,
    when: { text: 'optional', image: 'optional' },
    outputMode: 'show-candidates',
    contract: CONTRACTS['angle-matrix'],
  },
  {
    id: 'batch-variants',
    name: '批量变体',
    icon: 'palette',
    priority: 95,
    when: { text: 'optional', image: 'optional' },
    outputMode: 'show-candidates',
    contract: CONTRACTS['batch-variants'],
  },
  {
    id: 'ad-review',
    name: '投放复盘',
    icon: 'tags',
    priority: 90,
    when: { text: 'required', image: 'optional' },
    outputMode: 'show-candidates',
    contract: CONTRACTS['ad-review'],
  },
  {
    id: 'super-derive',
    name: '爆款衍生',
    icon: 'wand',
    priority: 70,
    when: { image: 'optional', text: 'optional' },
    outputMode: 'show-candidates',
    contract: CONTRACTS['super-derive'],
  },
  {
    id: 'market-breakdown',
    name: '大盘拆解',
    icon: 'image',
    priority: 60,
    when: { image: 'optional', text: 'optional' },
    outputMode: 'show-candidates',
    contract: CONTRACTS['market-breakdown'],
  },
  {
    id: 'viral-remix',
    name: '爆款复刻',
    icon: 'wand',
    priority: 58,
    when: { image: 'optional', text: 'optional' },
    outputMode: 'show-candidates',
    contract: CONTRACTS['viral-remix'],
  },
  {
    id: 'image-describe',
    name: '素材拆解',
    icon: 'image',
    priority: 55,
    when: { image: 'required', text: 'optional' },
    outputMode: 'show-candidates',
    contract: CONTRACTS['image-describe'],
  },
  {
    id: 'style-expand',
    name: '版式扩展',
    icon: 'palette',
    priority: 50,
    when: { text: 'optional', image: 'optional' },
    outputMode: 'show-candidates',
    contract: CONTRACTS['style-expand'],
  },
  {
    id: 'prompt-examples',
    name: '爆款案例',
    icon: 'thumbs-up',
    priority: 45,
    when: { text: 'optional', image: 'optional' },
    outputMode: 'show-candidates',
    contract: CONTRACTS['prompt-examples'],
  },
  {
    id: 'word-extract',
    name: '变量拆解',
    icon: 'tags',
    priority: 40,
    when: { text: 'required', image: 'optional' },
    outputMode: 'create-word-tags',
    contract: CONTRACTS['word-extract'],
  },
  {
    id: 'channel-rewrite',
    name: '渠道改写',
    icon: 'sparkles',
    priority: 10,
    when: { text: 'required', image: 'optional' },
    outputMode: 'show-candidates',
    contract: CONTRACTS['channel-rewrite'],
  },
]

/** Deep-clone the default steps so callers can freely edit their own copies. */
export function cloneBuiltInSkillSteps(actionId: AssistantActionId): AssistantSkillStep[] {
  const steps = BUILT_IN_SKILL_STEPS[actionId]
  return steps ? steps.map((step) => ({ ...step })) : []
}

export const BUILT_IN_ASSISTANT_ACTIONS: AssistantAction[] = RAW_BUILT_IN_ASSISTANT_ACTIONS.map((action) => ({
  ...action,
  source: 'builtin',
  version: BUILT_IN_SKILL_VERSION,
  steps: cloneBuiltInSkillSteps(action.id),
}))

export const BUILT_IN_ASSISTANT_ACTION_IDS = BUILT_IN_ASSISTANT_ACTIONS.map((action) => action.id) as AssistantActionId[]
