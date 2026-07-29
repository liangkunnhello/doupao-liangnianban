import { describe, expect, it } from 'vitest'
import {
  buildSopRequestContent,
  getSopGeneratorInstruction,
  IMAGE_PROMPT_SOP_GENERATOR_INSTRUCTION,
  parseGeneratedSop,
  SOP_GENERATOR_META_PRESET,
  validateSopGenerationInput,
} from './sopGeneration'

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

  it('requires a reference image for image prompt SOP generation', () => {
    expect(() => validateSopGenerationInput('生成画风 SOP', [], 'image-prompt'))
      .toThrow('图片生成 SOP 需要至少一张画风参考图片')
  })

  it('parses name, description and SOP body from a fenced model response', () => {
    const result = parseGeneratedSop('```json\n{"name":"视觉逆向 SOP","description":"拆解参考图并输出结构化变量池","sop":"### Role & Goal\\n严格执行视觉逆向分析"}\n```')

    expect(result).toEqual({
      name: '视觉逆向 SOP',
      description: '拆解参考图并输出结构化变量池',
      sop: '### Role & Goal\n严格执行视觉逆向分析',
    })
  })

  it('rejects incomplete structured output', () => {
    expect(() => parseGeneratedSop('{"name":"缺少正文","description":"说明"}')).toThrow('缺少名称、说明或 SOP 正文')
  })

  it('builds a multimodal request from one or more reference images', () => {
    const content = buildSopRequestContent('', { product: '测试产品' }, [
      { name: '参考图 A.png', dataUrl: 'data:image/png;base64,AAA' },
      { name: '参考图 B.jpg', dataUrl: 'data:image/jpeg;base64,BBB' },
    ], 'image-prompt')

    expect(content).toHaveLength(3)
    expect(content[0].text).toContain('未提供，请根据参考图片推断')
    expect(content[0].text).toContain('已附带 2 张参考图片')
    expect(content[0].text).toContain('图片生成 SOP')
    expect(content.slice(1)).toEqual([
      { type: 'input_image', image_url: 'data:image/png;base64,AAA' },
      { type: 'input_image', image_url: 'data:image/jpeg;base64,BBB' },
    ])
  })
})
