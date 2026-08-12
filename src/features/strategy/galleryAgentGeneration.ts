import { getAgentTextApiProfile, validateApiProfile } from '../../lib/apiProfiles'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from '../../lib/devProxy'
import { parseVariablePrompt, renderVariablePromptBatch } from '../../lib/variablePrompt'
import type { InputImage } from '../../types'
import { extractResponseText } from './sopGeneration'
import {
  APP_COPY_STRATEGY_SKILL_META_INSTRUCTION,
  IMAGE_GENERATION_STRATEGY_SKILL_META_INSTRUCTION,
} from './skillMetaInstructions'
import { generateSopFromStore } from './adapters/storeSopGeneration'
import { useStore } from '../../store'

export type GalleryAgentSimilarity = 1 | 2 | 3 | 4 | 5
export type GalleryAgentSkillKind = 'visual' | 'app-copy'

export interface GalleryAgentStrategyDirection {
  name: string
  focus: string
}

export interface GalleryAgentPlan {
  productType: string
  hasIntentionalCopy: boolean
  skillKind: GalleryAgentSkillKind
  skillReason: string
  strategyDirections: GalleryAgentStrategyDirection[]
}

export interface GalleryAgentVariablePrompt {
  name: string
  description: string
  variablePrompt: string
}

export interface GalleryAgentGenerationResult {
  plan: GalleryAgentPlan
  variablePrompts: GalleryAgentVariablePrompt[]
}

export interface GalleryAgentProgress {
  stage: 'analyze' | 'extract'
  message: string
  completed?: number
  total?: number
}

export const GALLERY_AGENT_SIMILARITY_LEVELS: Record<GalleryAgentSimilarity, {
  label: string
  maxStrategies: number
  generationDirection: 'explore' | 'balanced' | 'replica'
  useReferenceImagesForGeneration: boolean
  guidance: string
}> = {
  1: {
    label: '创意扩展',
    maxStrategies: 4,
    generationDirection: 'explore',
    useReferenceImagesForGeneration: false,
    guidance: '保留产品类别和核心用途，允许主体呈现、场景、镜头、构图和视觉机制显著变化。',
  },
  2: {
    label: '灵活变化',
    maxStrategies: 3,
    generationDirection: 'explore',
    useReferenceImagesForGeneration: false,
    guidance: '保留产品识别特征与核心卖点，同时允许较明显的场景、动作、构图和风格变化。',
  },
  3: {
    label: '平衡',
    maxStrategies: 3,
    generationDirection: 'balanced',
    useReferenceImagesForGeneration: true,
    guidance: '平衡参考图识别度与批量差异，稳定产品身份，适度变化叙事、镜头、构图和版式。',
  },
  4: {
    label: '高相似',
    maxStrategies: 2,
    generationDirection: 'replica',
    useReferenceImagesForGeneration: true,
    guidance: '紧密保持产品外观、核心结构、材质、配色关系和主要版式，只在不破坏识别度的维度上变化。',
  },
  5: {
    label: '贴近原图',
    maxStrategies: 1,
    generationDirection: 'replica',
    useReferenceImagesForGeneration: true,
    guidance: '最大程度贴近参考图的产品身份、结构关系、镜头、材质、光线和文案版式，仅保留生成所需的最小变化。',
  },
}

const GALLERY_AGENT_PLAN_FORMAT = {
  type: 'json_schema',
  name: 'gallery_agent_plan',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      productType: { type: 'string', description: '图中产品或内容类型的简洁中文名称' },
      hasIntentionalCopy: { type: 'boolean', description: '是否存在需要保留、替换或重新组织的有意设计文案' },
      skillKind: { type: 'string', enum: ['visual', 'app-copy'] },
      skillReason: { type: 'string', description: '选择该技能的简短证据说明' },
      strategyDirections: {
        type: 'array',
        minItems: 1,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '策略方向名称' },
            focus: { type: 'string', description: '该策略必须提炼的独特视觉或文案机制' },
          },
          required: ['name', 'focus'],
          additionalProperties: false,
        },
      },
    },
    required: ['productType', 'hasIntentionalCopy', 'skillKind', 'skillReason', 'strategyDirections'],
    additionalProperties: false,
  },
} as const

function normalizeSimilarity(value: number): GalleryAgentSimilarity {
  return Math.max(1, Math.min(5, Math.round(value))) as GalleryAgentSimilarity
}

function parseJsonObject(text: string) {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = normalized.indexOf('{')
  const end = normalized.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('智能体未返回可识别的分析结果')
  return JSON.parse(normalized.slice(start, end + 1)) as Record<string, unknown>
}

export function normalizeGalleryAgentPlan(value: unknown, similarity: GalleryAgentSimilarity): GalleryAgentPlan {
  if (!value || typeof value !== 'object') throw new Error('智能体分析结果结构不正确')
  const record = value as Record<string, unknown>
  const level = GALLERY_AGENT_SIMILARITY_LEVELS[normalizeSimilarity(similarity)]
  const productType = typeof record.productType === 'string' && record.productType.trim()
    ? record.productType.trim()
    : '未识别产品'
  const hasIntentionalCopy = record.hasIntentionalCopy === true
  const skillKind: GalleryAgentSkillKind = record.skillKind === 'app-copy' && hasIntentionalCopy
    ? 'app-copy'
    : 'visual'
  const skillReason = typeof record.skillReason === 'string' && record.skillReason.trim()
    ? record.skillReason.trim()
    : skillKind === 'app-copy' ? '检测到有意设计的文案信息层' : '主要提取主体与视觉结构'
  const rawDirections = Array.isArray(record.strategyDirections) ? record.strategyDirections : []
  const strategyDirections = rawDirections
    .flatMap((item, index): GalleryAgentStrategyDirection[] => {
      if (!item || typeof item !== 'object') return []
      const direction = item as Record<string, unknown>
      const name = typeof direction.name === 'string' && direction.name.trim()
        ? direction.name.trim()
        : `策略 ${index + 1}`
      const focus = typeof direction.focus === 'string' ? direction.focus.trim() : ''
      return focus ? [{ name, focus }] : []
    })
    .slice(0, level.maxStrategies)

  if (strategyDirections.length === 0) {
    strategyDirections.push({
      name: level.generationDirection === 'replica' ? '参考图高保真复用' : '产品视觉策略扩展',
      focus: level.guidance,
    })
  }
  return { productType, hasIntentionalCopy, skillKind, skillReason, strategyDirections }
}

function buildPlanInstruction(similarity: GalleryAgentSimilarity, brief: string, excludeText: boolean) {
  const level = GALLERY_AGENT_SIMILARITY_LEVELS[similarity]
  return [
    '你是画廊智能体的策略路由器。先识别参考图是什么产品或内容，再判断应使用哪一种策略提取技能。',
    excludeText
      ? '本次已开启“排除文字”：无论参考图是否有文字，都只提取主体、结构、材质、光线和构图策略，不把文案或文案排版作为变量。'
      : '当图片包含标题、卖点、价格、配料、参数、标签、步骤或其他有意设计的信息层，并且用户没有明确要求排除文字时，选择 app-copy；否则选择 visual。',
    'visual 表示纯视觉策略提取，默认忽略参考图中的文字与文案排版；app-copy 表示带文案策略提取，必须保持主体与对应文案、价格、参数或配料绑定。',
    `当前相似度为 ${similarity}/5（${level.label}）。${level.guidance}`,
    `最多输出 ${level.maxStrategies} 个真正不同的策略方向。实际数量由图片中可复用的视觉机制决定，不要为了凑数拆分近义策略。`,
    'strategyDirections 只描述每个后续变量提示词应关注的独特机制，不直接生成最终提示词。',
    brief.trim() ? `用户补充要求：${brief.trim()}` : '用户没有补充文字要求，以参考图为准。',
  ].join('\n\n')
}

async function requestGalleryAgentPlan(
  images: InputImage[],
  brief: string,
  similarity: GalleryAgentSimilarity,
  targetImageCount: number,
  excludeText: boolean,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  const settings = useStore.getState().settings
  const profile = getAgentTextApiProfile(settings)
  const validationError = validateApiProfile(profile)
  if (validationError) throw new Error(`文本模型配置：${validationError}`)
  if (profile.provider !== 'openai' || profile.apiMode !== 'responses') {
    throw new Error('画廊智能体需要支持 Responses API 的 OpenAI 兼容文本模型')
  }
  const proxy = readClientDevProxyConfig()
  const url = buildApiUrl(profile.baseUrl, 'responses', proxy, shouldUseApiProxy(profile.apiProxy, proxy))
  const inputContent: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }> = [
    { type: 'input_text', text: `${buildPlanInstruction(similarity, brief, excludeText)}\n\n最终计划生成 ${targetImageCount} 张图片，策略方向数量不得超过 ${targetImageCount}。` },
  ]
  images.forEach((image, index) => {
    inputContent.push({ type: 'input_text', text: `参考图 ${index + 1}/${images.length}` })
    inputContent.push({ type: 'input_image', image_url: image.dataUrl })
  })
  const send = (structured: boolean) => {
    signal?.throwIfAborted()
    return fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${profile.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal,
      cache: 'no-store',
      body: JSON.stringify({
        model: profile.model || settings.model,
        instructions: '只返回请求的 JSON 规划对象，不要生成最终图片提示词，不要使用 Markdown 代码围栏。',
        input: [{ role: 'user', content: inputContent }],
        max_output_tokens: 2200,
        ...(structured ? { text: { format: GALLERY_AGENT_PLAN_FORMAT } } : {}),
      }),
    })
  }

  let response = await send(true)
  signal?.throwIfAborted()
  if (!response.ok && (response.status === 400 || response.status === 422)) response = await send(false)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`智能体产品分析失败（${response.status}）：${body.slice(0, 180)}`)
  }
  const text = extractResponseText(await response.json())
  signal?.throwIfAborted()
  return normalizeGalleryAgentPlan(parseJsonObject(text), similarity)
}

function buildDynamicSkillInstruction(
  plan: GalleryAgentPlan,
  direction: GalleryAgentStrategyDirection,
  similarity: GalleryAgentSimilarity,
  strategyIndex: number,
) {
  const level = GALLERY_AGENT_SIMILARITY_LEVELS[similarity]
  const baseSkill = plan.skillKind === 'app-copy'
    ? APP_COPY_STRATEGY_SKILL_META_INSTRUCTION
    : IMAGE_GENERATION_STRATEGY_SKILL_META_INSTRUCTION
  return `${baseSkill}

画廊智能体模式覆盖规则（优先于上文中的固定数量建议）：
1. 本次识别产品为“${plan.productType}”，使用${plan.skillKind === 'app-copy' ? 'APP 带文案策略' : '纯视觉策略'}，只生成第 ${strategyIndex + 1} 个方向“${direction.name}”：${direction.focus}。
2. 当前相似度为 ${similarity}/5（${level.label}），generation_direction 为 ${level.generationDirection}。${level.guidance}
3. 变量的组数、每组的选项数量都必须根据当前产品、该策略方向和真实可变空间自行判断，不执行“至少三组”“固定四组”或“每组默认10个”的固定数量要求，也不得用近义词、颜色替换或空泛选项凑数。
4. 只保留会产生有效画面差异的变量；必须绑定的产品身份、型号、价格、参数、菜名、配料和文案继续放在同一个变量选项中，禁止错配。
5. ${level.useReferenceImagesForGeneration ? '正式生图仍会携带参考图，可以在最终提示词中明确参考输入图。' : '正式生图不会携带参考图，最终提示词必须把风格、材质、色彩关系、光线和结构展开写清，不得出现“参考输入图”“沿用原图”等依赖参考图的表达。'}
6. 最终仍只返回一个可解析的 variablePrompt 资产；不得返回 SOP、分析过程或元数据章节。`
}

export async function generateGalleryAgentVariablePrompts(options: {
  images: InputImage[]
  brief?: string
  similarity: GalleryAgentSimilarity
  targetImageCount?: number
  /** 开启后强制纯视觉策略，排除文字和文案排版；关闭时自动在两种技能间分流。 */
  excludeText?: boolean
  signal?: AbortSignal
  onProgress?: (progress: GalleryAgentProgress) => void
  onPlan?: (plan: GalleryAgentPlan) => void
}): Promise<GalleryAgentGenerationResult> {
  const { images, brief = '', signal, onProgress, onPlan, excludeText = false } = options
  const similarity = normalizeSimilarity(options.similarity)
  const targetImageCount = Math.max(1, Math.trunc(options.targetImageCount ?? 1))
  if (images.length === 0) throw new Error('智能体模式至少需要一张参考图片')
  onProgress?.({ stage: 'analyze', message: '正在识别产品与素材类型' })
  const plan = await requestGalleryAgentPlan(images, brief, similarity, targetImageCount, excludeText, signal)
  if (excludeText) {
    plan.hasIntentionalCopy = false
    plan.skillKind = 'visual'
    plan.skillReason = '已开启排除文字开关，本次只提取纯视觉策略'
  }
  plan.strategyDirections = plan.strategyDirections.slice(0, targetImageCount)
  signal?.throwIfAborted()
  onPlan?.(plan)
  const total = plan.strategyDirections.length
  let completed = 0
  onProgress?.({
    stage: 'extract',
    message: `已识别“${plan.productType}”，正在使用${plan.skillKind === 'app-copy' ? '带文案' : '纯视觉'}技能提取 ${total} 个策略`,
    completed,
    total,
  })

  const variablePrompts = await Promise.all(plan.strategyDirections.map(async (direction, strategyIndex) => {
    const generated = await generateSopFromStore(
      brief,
      { product: plan.productType, generationMode: GALLERY_AGENT_SIMILARITY_LEVELS[similarity].generationDirection },
      images.map((image, index) => ({ name: `参考图 ${index + 1}`, dataUrl: image.dataUrl })),
      'variable-prompt-skill',
      buildDynamicSkillInstruction(plan, direction, similarity, strategyIndex),
      {
        signal,
        excludeText: excludeText || plan.skillKind === 'visual',
        onProgress: (progress) => {
          if (progress.stage !== 'request' && progress.stage !== 'repair') return
          onProgress?.({
            stage: 'extract',
            message: `${direction.name}：${progress.message}`,
            completed,
            total,
          })
        },
      },
    )
    signal?.throwIfAborted()
    if (generated.executionMode !== 'variable-prompt') throw new Error(`策略“${direction.name}”未生成变量提示词`)
    const parsed = parseVariablePrompt(generated.content)
    if (!parsed.enabled) throw new Error(`策略“${direction.name}”格式有误：${parsed.errors[0] ?? '没有有效变量'}`)
    completed += 1
    onProgress?.({
      stage: 'extract',
      message: `已完成 ${completed}/${total} 个变量策略`,
      completed,
      total,
    })
    return {
      name: generated.name,
      description: generated.description,
      variablePrompt: generated.content,
    }
  }))

  return { plan, variablePrompts }
}

export function buildGalleryAgentPromptBatch(
  variablePrompts: GalleryAgentVariablePrompt[],
  count: number,
  seed = `${Date.now()}`,
) {
  const normalizedCount = Math.max(1, Math.trunc(count))
  const usable = variablePrompts.filter((item) => parseVariablePrompt(item.variablePrompt).enabled)
  if (usable.length === 0) return []
  const selected = usable.slice(0, normalizedCount)
  const baseCount = Math.floor(normalizedCount / selected.length)
  const remainder = normalizedCount % selected.length
  const prompts = selected.flatMap((item, index) => {
    const itemCount = baseCount + (index < remainder ? 1 : 0)
    return renderVariablePromptBatch(item.variablePrompt, itemCount, `${seed}:${index}:${item.name}`)
  })
  return prompts.slice(0, normalizedCount)
}

export function shouldUseGalleryAgentReferenceImages(similarity: GalleryAgentSimilarity) {
  return GALLERY_AGENT_SIMILARITY_LEVELS[normalizeSimilarity(similarity)].useReferenceImagesForGeneration
}
