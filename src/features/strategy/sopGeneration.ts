const GENERAL_SOP_GENERATOR_INSTRUCTION = `你是“标准作业程序（SOP）编译器”和 AI 视觉生产流程专家。你的任务是根据用户提供的自然语言需求和参考图片，编译成一套可直接作为模型核心指令使用的专业 SOP。

编写原则：
1. 忠实保留用户目标、专有名词、强制格式和禁止项，不擅自改变业务意图。
2. 将模糊要求补全为明确的角色、目标、输入条件、执行步骤、约束、变量规则、输出格式、自检和异常处理。
3. 如果涉及参考图逆向、视觉拆解或批量衍生，必须描述风格、排版、文字红线、动态 N 层结构、Z-Index、常量锁定、变量池和差异化规则。
4. 如果用户要求 JSON、伪代码或其他严格格式，必须在 SOP 中写出完整模板和格式警告，不得只做摘要。
5. SOP 要像资深策略员编写的系统指令，结构清晰、可重复执行、能直接交给模型使用。
6. 不要虚构用户没有提供的产品事实、法规结论、模型参数或品牌规则；不确定内容写成待输入变量或条件判断。
7. 收到参考图片时，先综合分析全部图片的共同规律和关键差异，包括构图、主体、层级、文案区域、色彩、光影、材质、镜头、风格和视觉约束，再把观察结果转换成可重复执行的步骤；不要把某张图片的偶然细节误当成通用规则。
8. 只有图片、没有文字需求时，也要基于图片推断其视觉生产流程，并把无法确认的业务信息标为待输入变量。

只返回一个合法 JSON 对象，不要 Markdown 代码围栏，不要解释。格式必须为：
{
  "name": "专业、清晰、可识别用途的 SOP 名称",
  "description": "一到两句话说明该 SOP 的用途、输入和产出",
  "sop": "完整 SOP 正文，使用 Markdown 标题和编号组织，可直接作为系统指令"
}`

export const IMAGE_PROMPT_SOP_GENERATOR_INSTRUCTION = `# Role & Goal
你是一个顶级的“元提示词架构师”和“SOP 编译器”。你的核心任务是：接收用户上传的某一类画风参考图，深度解析其画风、排版和视觉常量。然后，以此为基准，编译并输出一套专门针对该特定画风的《多变体提示词直出型 SOP》（系统预设提示词）。
用户后续会将你生成的这套 SOP 独立部署出去，让其他 AI 能够根据这套 SOP 直接为用户批量输出完整的中文绘图提示词。

# Meta-Analysis Rules (元编译规则)
收到图片后，立即执行以下反向工程，用于提炼并写入即将生成的 SOP 中：
1. 风格常模固化：提取画面的顶级视觉画风、全局主辅色卡、打光规范以及不可篡改的构图红线（如中心对称、放射轨道、图腾环绕等）。必须以参考图的主导视觉语言为最高优先级，锁定渲染方式、构图与视角、形状语言、配色、材质、光线、背景和留白，不得把不同渲染语言混成新画风。
2. 变体元素扩写：针对该画风，分别对主体、背景、边缘装饰进行发散，为即将生成的 SOP 预埋一套高质量的变体元素池，每类至少写满 10 个高质量中文描述。多图风格冲突时，以数量占优且内部最一致的参考图组为准；离群图只可辅助理解内容，不得改变主导画风。

# Strict Output Template (元指令输出格式)
绝对规则：不要输出任何多余的解释或具体的可用提示词列表。生成的 SOP 正文必须且只能严格按照以下格式编译；方括号中的编译提示必须替换为根据参考图得到的具体内容，不得原样保留，“...”“写满 10 个”等占位说明必须展开为完整内容：

---
## 【定制版】[由你命名的画风视觉主题] 多变体提示词直出 SOP

### ⚙️ Role & Goal
你是一个针对【锁定画风名称】的提示词生成专家。你的核心任务是：保持该画风的核心骨架、构图和视觉规范绝对不变，通过随机组合内部特定的局部主体、场景和装饰元素，直接为用户输出指定数量（N）的完整、高质量、可直接使用的中文绘图提示词。生成的结果必须与原图保持高度的视觉一致性（神似），但具体内容各自不同。

### 📌 视觉常量锁定 (Visual Constants)
- **画风与光影设定**：[由元指令编译器在此锁定：逆向出来的顶级画风描述、全局主辅色卡、打光方式]
- **构图与排版规范**：[由元指令编译器在此锁定：不可更改的几何构图红线，如中心发光正圆开窗、外围同心圆轨道对称排布等]
- **排他性红线**：
  1. 文字排他：严格执行文字排他性，仅允许渲染指定的古风汉字，严禁 AI 脑补乱码。
  2. 物理隔离：中心主体与四周的轨道徽章、悬浮装饰必须保持绝对空间隔离，严禁跨层融合。
  3. 连续背景：背景必须强制保持连续、无缝的纯色或平滑过渡。

### 📦 变体元素池 (Element Pool)
AI 在组装提示词时，必须从以下预设的高质量元素池中进行随机抽样并有机融合：
- **核心主体 / 中央视窗变体**：
  1. [由元指令编译器在此预埋：根据原图发散的变体元素 1]
  2. [根据原图发散的变体元素 2]
  ...（写满 10 个）
- **外围轨道 / 图腾徽章变体**：
  1. [由元指令编译器在此预埋：根据原图发散的外围变体 1]
  2. [根据原图发散的外围变体 2]
  ...（写满 10 个）
- **前景压角 / 边缘装饰变体**：
  1. [由元指令编译器在此预埋：根据原图发散的前景变体 1]
  2. [根据原图发散的前景变体 2]
  ...（写满 10 个）

### 🤖 运行机制与严格输出模板
当用户向你（本 SOP）输入“生成 N 条提示词”时（未指定数量则默认 5 条），你必须严格按照以下 JSON 格式输出，禁止任何多余的解释。每条 Prompt 必须是由上述[视觉常量]与[抽样变体元素]无缝拼接而成的完整中文描述。

\`\`\`json
{
  "Style_SOP_Title": "【锁定画风名称】变体直出工具_V1",
  "Ready_To_Use_Prompts": [
    "Prompt 1: [画风与光影设定] + [从中央视窗变体随机抽样1] + [从外围轨道变体随机抽样1] + [从前景压角变体随机抽样1] + [构图与排版规范] + [--ar 16:9 --style raw --v 6.0 --stylize 300]",
    "Prompt 2: [画风与光影设定] + [从中央视窗变体随机抽样2] + [从外围轨道变体随机抽样2] + [从前景压角变体随机抽样2] + [构图与排版规范] + [--ar 16:9 --style raw --v 6.0 --stylize 300]",
    "...（严格输出至用户要求的数量 N）"
  ]
}
\`\`\`

应用需要读取名称、说明和正文，因此最终响应仍必须只返回一个合法 JSON 对象，不要 Markdown 代码围栏，不要解释；上面的严格模板完整写入 sop 字段。格式必须为：
{
  "name": "【定制版】具体画风视觉主题 多变体提示词直出 SOP",
  "description": "一到两句话说明该 SOP 根据参考图锁定何种风格，并用于批量直出中文绘图提示词",
  "sop": "严格按上述模板编译完成的独立 SOP 全文"
}`

export type SopGeneratorKind = 'general' | 'image-prompt' | 'variable-prompt-skill'

export function getSopGeneratorInstruction(kind: SopGeneratorKind, overrideInstruction?: string) {
  const override = overrideInstruction?.trim()
  if (override) return override
  return kind === 'image-prompt' ? IMAGE_PROMPT_SOP_GENERATOR_INSTRUCTION : GENERAL_SOP_GENERATOR_INSTRUCTION
}

export const SOP_GENERATOR_META_PRESET = {
  name: 'SOP 智能编译器（文字 / 图片转标准作业程序）',
  description: '根据简单业务需求或一组参考图片，分析并生成可执行、可复用、可检查的专业 SOP。',
  instruction: GENERAL_SOP_GENERATOR_INSTRUCTION,
} as const

export interface GeneratedSop {
  name: string
  description: string
  content: string
  executionMode: 'prompt-generator' | 'variable-prompt'
}

export interface SopReferenceImage {
  name: string
  dataUrl: string
}

export type SopGenerationProgressStage = 'validate' | 'prepare' | 'request' | 'parse' | 'repair'

export interface SopGenerationProgress {
  stage: SopGenerationProgressStage
  message: string
}

export interface SopGenerationOptions {
  onProgress?: (progress: SopGenerationProgress) => void
  signal?: AbortSignal
  /** 变量提示词技能专用：忽略所有文字、文案与文案排版，并生成纯视觉模板。 */
  excludeText?: boolean
}

export type GenerateSop = (
  description: string,
  context: { product?: string; materialType?: string; generationMode?: string },
  referenceImages?: SopReferenceImage[],
  kind?: SopGeneratorKind,
  metaInstruction?: string,
  options?: SopGenerationOptions,
) => Promise<GeneratedSop>

export const MAX_SOP_REFERENCE_IMAGES = 8

export function validateSopGenerationInput(
  description: string,
  referenceImages: SopReferenceImage[],
  kind: SopGeneratorKind,
) {
  if (!description.trim() && referenceImages.length === 0) throw new Error('请填写生成说明，或添加至少一张参考图片')
  if (referenceImages.length > MAX_SOP_REFERENCE_IMAGES) throw new Error(`参考图分析最多支持 ${MAX_SOP_REFERENCE_IMAGES} 张图片`)
  if ((kind === 'image-prompt' || kind === 'variable-prompt-skill') && referenceImages.length === 0) {
    throw new Error(kind === 'variable-prompt-skill' ? '变量提示词技能至少需要一张参考图片' : '图片生成 SOP 需要至少一张画风参考图片')
  }
}

export function buildSopRequestContent(
  description: string,
  context: { product?: string; materialType?: string; generationMode?: string },
  referenceImages: SopReferenceImage[],
  kind: SopGeneratorKind = 'general',
  excludeText?: boolean,
) {
  const content: Array<Record<string, string>> = [{
    type: 'input_text',
    text: [
      `用户的自然语言需求：\n${description.trim() || '未提供，请根据参考图片推断'}`,
      `当前产品：${context.product || '未指定'}`,
      `当前素材类型：${context.materialType || '未指定'}`,
      `当前生成方式：${context.generationMode || '未指定'}`,
      `生成类型：${kind === 'variable-prompt-skill'
        ? '变量提示词技能（反推参考图并直接产出可解析的变量提示词模板，不生成 SOP）'
        : kind === 'image-prompt'
          ? '图片生成 SOP（参考图画风反推、多变体中文提示词直出）'
          : '通用执行 SOP'}`,
      kind === 'variable-prompt-skill' && typeof excludeText === 'boolean'
        ? `文字处理：${excludeText ? '排除全部文字与文案排版，只提取纯视觉策略' : '不强制排除文字，按所选技能处理有意设计的文案'}`
        : '',
      referenceImages.length > 0 ? `已附带 ${referenceImages.length} 张参考图片：${referenceImages.map((image) => image.name).join('、')}` : '未附带参考图片',
      referenceImages.length > 1 ? '请先逐张分析每张图片，再归纳共同视觉常量、可变元素和离群差异；不得只分析第一张图片。' : '',
      '请综合全部输入完整编译，不要省略用户要求的严格输出模板。',
    ].filter(Boolean).join('\n\n'),
  }]
  referenceImages.forEach((image, index) => {
    content.push({ type: 'input_text', text: `参考图 ${index + 1}/${referenceImages.length}：${image.name}` })
    content.push({ type: 'input_image', image_url: image.dataUrl })
  })
  return content
}

export function extractResponseText(payload: unknown) {
  if (!payload || typeof payload !== 'object') return ''
  const output = (payload as { output?: unknown[] }).output
  if (!Array.isArray(output)) return ''
  const parts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as { content?: unknown[] }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const text = (part as { text?: unknown }).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('\n')
}

/** 从 Chat Completions 响应（`choices[0].message.content`）提取文本。 */
export function extractChatCompletionText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const choices = (payload as { choices?: unknown[] }).choices
  if (!Array.isArray(choices) || choices.length === 0) return ''
  const first = choices[0]
  if (!first || typeof first !== 'object') return ''
  const message = (first as { message?: unknown }).message
  if (!message || typeof message !== 'object') return ''
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' ? content : ''
}

function toChatCompletionContent(content: unknown): unknown {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: Array<Record<string, unknown>> = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const record = part as Record<string, unknown>
    if ((record.type === 'input_text' || record.type === 'output_text') && typeof record.text === 'string') {
      parts.push({ type: 'text', text: record.text })
    } else if (record.type === 'input_image' && typeof record.image_url === 'string') {
      parts.push({ type: 'image_url', image_url: { url: record.image_url } })
    }
  }
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text
  return parts
}

/** 把 Responses 风格的 `instructions + input` 转成 Chat Completions 的 `messages`。 */
export function toChatCompletionMessages(instruction: string, input: unknown): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [{ role: 'system', content: instruction }]
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input })
    return messages
  }
  if (!Array.isArray(input)) {
    messages.push({ role: 'user', content: '' })
    return messages
  }
  for (const value of input) {
    if (!value || typeof value !== 'object') continue
    const record = value as Record<string, unknown>
    if (record.role !== 'user' && record.role !== 'assistant') continue
    messages.push({ role: record.role, content: toChatCompletionContent(record.content) })
  }
  return messages
}

/** 把 Responses 的结构化输出格式转成 Chat Completions 的 `response_format`。 */
export function toChatResponseFormat(format: { name: string; strict?: boolean; schema: unknown }) {
  return {
    type: 'json_schema',
    json_schema: {
      name: format.name,
      strict: format.strict === true,
      schema: format.schema,
    },
  }
}

export function parseGeneratedSop(text: string): GeneratedSop {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) {
    if (!trimmed || !/(?:^|\n)#{1,6}\s+\S|(?:^|\n)\s*\d+[.、]\s+\S/.test(trimmed)) {
      throw new Error('AI 返回内容无法识别为 SOP，请重试或切换文本模型')
    }
    const heading = trimmed.match(/(?:^|\n)#{1,6}\s+([^\n]+)/)?.[1]?.trim()
    return {
      name: heading || 'AI 生成 SOP',
      description: '由 AI 根据生成说明和参考图片编译的可执行 SOP。',
      content: trimmed,
      executionMode: 'prompt-generator',
    }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    throw new Error('模型返回的 SOP JSON 格式不正确，请重试')
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('模型返回的 SOP 结构不正确')
  const envelope = parsed as Record<string, unknown>
  const nested = envelope.result ?? envelope.data ?? envelope.output
  const record = nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : envelope
  const sopValue = record.sop ?? record.content ?? record.instruction ?? record.body
  const sop = typeof sopValue === 'string' ? sopValue.trim() : ''
  if (!sop) throw new Error('AI 返回结果缺少可用的 SOP 正文')
  const heading = sop.match(/(?:^|\n)#{1,6}\s+([^\n]+)/)?.[1]?.trim()
  const name = String(record.name ?? record.title ?? heading ?? 'AI 生成 SOP').trim()
  const description = String(
    record.description
    ?? record.summary
    ?? '由 AI 根据生成说明和参考图片编译的可执行 SOP。',
  ).trim()
  return { name, description, content: sop, executionMode: 'prompt-generator' }
}

export function parseGeneratedVariablePrompt(text: string): GeneratedSop {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI 返回内容无法识别为变量提示词资产')
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    throw new Error('模型返回的变量提示词 JSON 格式不正确，请重试')
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('模型返回的变量提示词结构不正确')
  const envelope = parsed as Record<string, unknown>
  const nested = envelope.result ?? envelope.data ?? envelope.output
  const record = nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : envelope
  const value = record.variablePrompt
  const content = typeof value === 'string' ? value.trim() : ''
  if (!content) throw new Error('AI 返回结果缺少可用的变量提示词正文')
  const name = String(record.name ?? record.title ?? 'AI 变量提示词').trim()
  const description = String(
    record.description
    ?? record.summary
    ?? '由技能根据参考图片反推的可执行变量提示词。',
  ).trim()
  return { name, description, content, executionMode: 'variable-prompt' }
}
