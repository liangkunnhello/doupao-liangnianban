import { describe, expect, it } from 'vitest'
import { resolveGalleryLibraryApplication } from './galleryLibraryApplication'
import type { SopLibraryItem } from './types'

function item(overrides: Partial<SopLibraryItem> = {}): SopLibraryItem {
  return {
    id: 'asset-1',
    name: '测试资产',
    description: '',
    content: '# SOP\n生成五条提示词',
    executionMode: 'prompt-generator',
    source: 'manual',
    createdBy: 'user',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('gallery library application routing', () => {
  it('keeps generated SOP assets in prompt-generator mode', () => {
    expect(resolveGalleryLibraryApplication(item())).toEqual({ mode: 'prompt-generator', sopId: 'asset-1' })
  })

  it('routes valid variable prompt assets directly to the image input', () => {
    const prompt = '图片比例为16:9。生成{{主体}}，采用{{镜头}}。\n\n可变项：\n{{主体}}：猫 / 狗\n{{镜头}}：近景 / 全景'
    expect(resolveGalleryLibraryApplication(item({ content: prompt, executionMode: 'variable-prompt' }))).toEqual({
      mode: 'variable-prompt',
      prompt,
    })
  })

  it('rejects malformed direct templates instead of activating SOP mode', () => {
    expect(() => resolveGalleryLibraryApplication(item({
      content: '生成{{主体}}。\n可变项：{{主体}}：猫 / 狗',
      executionMode: 'variable-prompt',
    }))).toThrow('变量提示词格式有误')
  })
})
