import { describe, expect, it } from 'vitest'
import { getMetaInstructionExcludeText, mergeBuiltInSopMetaInstructions, migrateSopLibraryExecutionModes, resolveMetaInstructionForWorkspaceTab, seedSopMetaInstructions } from './sopLibrary'
import type { SopLibraryItem, SopMetaInstruction } from './types'

function asset(content: string, metaInstructionId?: string): SopLibraryItem {
  return {
    id: Math.random().toString(),
    name: '旧资产',
    description: '',
    content,
    source: 'generated',
    metaInstructionId,
    createdBy: 'user',
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('SOP library compatibility migration', () => {
  it('repairs persisted skill meta instructions to direct variable-prompt skills', () => {
    const legacy: SopMetaInstruction = {
      id: 'sop-meta-skill-image-generation-strategies',
      name: '旧技能',
      description: '错误地生成 SOP',
      instruction: '返回 sop',
      kind: 'image-prompt',
      createdAt: 123,
      updatedAt: 123,
    }
    const repaired = mergeBuiltInSopMetaInstructions([legacy]).find((item) => item.id === legacy.id)
    expect(repaired).toMatchObject({ kind: 'variable-prompt-skill', createdAt: 123 })
    expect(repaired?.instruction).toContain('variablePrompt')
    expect(repaired?.instruction).not.toContain('name、description 和 sop')
  })

  it('defaults visual strategy extraction to no text and copy strategy extraction to preserving copy', () => {
    const metas = seedSopMetaInstructions()
    const visual = metas.find((item) => item.id === 'sop-meta-skill-image-generation-strategies')
    const copy = metas.find((item) => item.id === 'sop-meta-skill-app-copy-strategies')
    expect(getMetaInstructionExcludeText(visual)).toBe(true)
    expect(getMetaInstructionExcludeText(copy)).toBe(false)
  })

  it('migrates only valid skill templates to direct execution and preserves erroneous old SOP output', () => {
    const variablePrompt = '图片比例为16:9。生成{{主体}}。\n\n可变项：\n{{主体}}：猫 / 狗'
    const [valid, erroneous, legacy] = migrateSopLibraryExecutionModes([
      asset(variablePrompt, 'sop-meta-skill-image-generation-strategies'),
      asset('# 旧错误产物\n这是被技能错误生成的 SOP。', 'sop-meta-skill-app-copy-strategies'),
      asset('# 普通 SOP'),
    ])
    expect(valid.executionMode).toBe('variable-prompt')
    expect(erroneous.executionMode).toBe('prompt-generator')
    expect(legacy.executionMode).toBe('prompt-generator')
  })

  it('infers the text policy for existing variable assets without overwriting an explicit choice', () => {
    const visualPrompt = '图片比例为16:9。生成{{主体}}。\n\n可变项：\n{{主体}}：猫 / 狗'
    const copyPrompt = '图片比例为16:9。生成{{主体文案包}}。\n\n可变项：\n{{主体文案包}}：猫，标题“萌宠” / 狗，标题“伙伴”'
    const [visual, copySkill, manualCopy, explicit] = migrateSopLibraryExecutionModes([
      { ...asset(visualPrompt, 'sop-meta-skill-image-generation-strategies'), executionMode: 'variable-prompt' },
      { ...asset(copyPrompt, 'sop-meta-skill-app-copy-strategies'), executionMode: 'variable-prompt' },
      { ...asset(copyPrompt), executionMode: 'variable-prompt' },
      { ...asset(visualPrompt), executionMode: 'variable-prompt', excludeText: false },
    ])
    expect(visual.excludeText).toBe(true)
    expect(copySkill.excludeText).toBe(false)
    expect(manualCopy.excludeText).toBe(false)
    expect(explicit.excludeText).toBe(false)
  })
})

describe('workspace tab meta-instruction routing', () => {
  it('uses the meta instruction explicitly associated with a matching group', () => {
    const metas = seedSopMetaInstructions()
    const custom = {
      id: 'meta-insurance',
      groupId: 'group-insurance',
      name: '保险图标变量技能',
      description: '',
      instruction: '保险专用规则',
      kind: 'variable-prompt-skill' as const,
      createdAt: 1,
      updatedAt: 1,
    }
    const resolved = resolveMetaInstructionForWorkspaceTab(
      '保险',
      [{ id: 'group-insurance', name: '保险', createdAt: 1, updatedAt: 1 }],
      [],
      [...metas, custom],
    )
    expect(resolved?.id).toBe(custom.id)
  })

  it('supports existing generated assets that link a group to a meta instruction', () => {
    const metas = seedSopMetaInstructions()
    const resolved = resolveMetaInstructionForWorkspaceTab(
      '保险 / 图标',
      [{ id: 'group-insurance', name: '保险', createdAt: 1, updatedAt: 1 }],
      [{ ...asset('变量提示词', 'sop-meta-skill-image-generation-strategies'), groupId: 'group-insurance' }],
      metas,
    )
    expect(resolved?.id).toBe('sop-meta-skill-image-generation-strategies')
  })
})
