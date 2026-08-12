import { describe, expect, it } from 'vitest'
import {
  buildSopRequestContent,
  getSopGeneratorInstruction,
  IMAGE_PROMPT_SOP_GENERATOR_INSTRUCTION,
  parseGeneratedSop,
  parseGeneratedVariablePrompt,
  SOP_GENERATOR_META_PRESET,
  validateSopGenerationInput,
} from './sopGeneration'
import { seedSopMetaInstructions } from './sopLibrary'

describe('SOP natural-language generator', () => {
  it('ships a named meta instruction that requires structured SOP output', () => {
    expect(SOP_GENERATOR_META_PRESET.name).toContain('SOP 智能编译器')
    expect(SOP_GENERATOR_META_PRESET.description).toContain('参考图片')
    expect(SOP_GENERATOR_META_PRESET.instruction).toContain('动态 N 层结构')
    expect(SOP_GENERATOR_META_PRESET.instruction).toContain('共同规律和关键差异')
  })

  it('selects the image prompt SOP compiler only for image prompt SOP generation', () => {
    expect(getSopGeneratorInstruction('general')).toBe(SOP_GENERATOR_META_PRESET.instruction)
    expect(getSopGeneratorInstruction('image-prompt')).toBe(IMAGE_PROMPT_SOP_GENERATOR_INSTRUCTION)
    expect(IMAGE_PROMPT_SOP_GENERATOR_INSTRUCTION).toContain('多变体提示词直出 SOP')
    expect(IMAGE_PROMPT_SOP_GENERATOR_INSTRUCTION).toContain('每类至少写满 10 个')
    expect(IMAGE_PROMPT_SOP_GENERATOR_INSTRUCTION).toContain('Ready_To_Use_Prompts')
  })

  it('allows a managed meta instruction to override the built-in compiler', () => {
    expect(getSopGeneratorInstruction('general', '自定义元指令')).toBe('自定义元指令')
  })

  it('installs both requested skills as managed meta instructions', () => {
    const metaInstructions = seedSopMetaInstructions()
    const imageSkill = metaInstructions.find((item) => item.id === 'sop-meta-skill-image-generation-strategies')
    const copySkill = metaInstructions.find((item) => item.id === 'sop-meta-skill-app-copy-strategies')

    expect(imageSkill?.instruction).toContain('参考图生图策略提取器')
    expect(imageSkill?.instruction).toContain('可变项：')
    expect(imageSkill?.kind).toBe('variable-prompt-skill')
    expect(imageSkill?.instruction).toContain('variablePrompt')
    expect(imageSkill?.instruction).toContain('产物不是 SOP')
    expect(copySkill?.instruction).toContain('subject_copy_binding')
    expect(copySkill?.instruction).toContain('{{主体文案包}}')
    expect(copySkill?.kind).toBe('variable-prompt-skill')
  })

  it('requires a reference image for image prompt SOP generation', () => {
    expect(() => validateSopGenerationInput('生成画风 SOP', [], 'image-prompt'))
      .toThrow('图片生成 SOP 需要至少一张画风参考图片')
  })

  it('parses name, description and SOP body from a fenced model response', () => {
    const result = parseGeneratedSop('```json\n{"name":"视觉逆向 SOP","description":"拆解参考图并输出结构化变量池","sop":"### Role & Goal\\n严格执行视觉逆向分析"}\n```')

    expect(result).toEqual({
      name: '视觉逆向 SOP',
      description: '拆解参考图并输出结构化变量池',
      content: '### Role & Goal\n严格执行视觉逆向分析',
      executionMode: 'prompt-generator',
    })
  })

  it('fills recoverable metadata instead of rejecting a usable SOP body', () => {
    expect(parseGeneratedSop('{"sop":"# 商品摄影 SOP\\n\\n1. 分析主体\\n2. 固定构图"}')).toEqual({
      name: '商品摄影 SOP',
      description: '由 AI 根据生成说明和参考图片编译的可执行 SOP。',
      content: '# 商品摄影 SOP\n\n1. 分析主体\n2. 固定构图',
      executionMode: 'prompt-generator',
    })
  })

  it('accepts raw markdown and nested result envelopes from compatible models', () => {
    expect(parseGeneratedSop('# 电商主图 SOP\n\n## 执行步骤\n1. 分析参考图\n2. 输出完整提示词')).toMatchObject({
      name: '电商主图 SOP',
      content: expect.stringContaining('## 执行步骤'),
    })
    expect(parseGeneratedSop('{"result":{"title":"嵌套 SOP","summary":"嵌套说明","content":"# 正文\\n执行要求"}}')).toEqual({
      name: '嵌套 SOP',
      description: '嵌套说明',
      content: '# 正文\n执行要求',
      executionMode: 'prompt-generator',
    })
  })

  it('only rejects responses that contain no SOP body', () => {
    expect(() => parseGeneratedSop('{"name":"缺少正文","description":"说明"}')).toThrow('缺少可用的 SOP 正文')
  })

  it('parses a skill result as a direct variable prompt asset', () => {
    const variablePrompt = '图片比例为16:9。生成{{主体}}，使用{{构图}}。\n\n可变项：\n{{主体}}：猫 / 狗\n{{构图}}：中心构图 / 左右分栏'
    expect(parseGeneratedVariablePrompt(JSON.stringify({
      name: '宠物变量策略',
      description: '从参考图提取结构。',
      variablePrompt,
    }))).toEqual({
      name: '宠物变量策略',
      description: '从参考图提取结构。',
      content: variablePrompt,
      executionMode: 'variable-prompt',
    })
    expect(() => parseGeneratedVariablePrompt('{"name":"错误","sop":"# SOP"}')).toThrow('缺少可用的变量提示词正文')
  })

  it('builds a multimodal request from one or more reference images', () => {
    const content = buildSopRequestContent('', { product: '测试产品' }, [
      { name: '参考图 A.png', dataUrl: 'data:image/png;base64,AAA' },
      { name: '参考图 B.jpg', dataUrl: 'data:image/jpeg;base64,BBB' },
    ], 'image-prompt')

    expect(content).toHaveLength(5)
    expect(content[0].text).toContain('未提供，请根据参考图片推断')
    expect(content[0].text).toContain('已附带 2 张参考图片')
    expect(content[0].text).toContain('逐张分析')
    expect(content[0].text).toContain('图片生成 SOP')
    expect(content.slice(1)).toEqual([
      { type: 'input_text', text: '参考图 1/2：参考图 A.png' },
      { type: 'input_image', image_url: 'data:image/png;base64,AAA' },
      { type: 'input_text', text: '参考图 2/2：参考图 B.jpg' },
      { type: 'input_image', image_url: 'data:image/jpeg;base64,BBB' },
    ])
  })
})
