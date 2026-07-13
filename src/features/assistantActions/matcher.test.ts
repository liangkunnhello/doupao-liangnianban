import { describe, expect, it } from 'vitest'
import type { AssistantInputContext } from './types'
import { BUILT_IN_SKILL_STEPS } from './builtInActions'
import {
  applySkillOverride,
  buildCustomSkillContract,
  duplicateSkillAsCustom,
  getMoreAssistantActions,
  getOrderedManageActions,
  getRecommendedAssistantActions,
  getResolvedBuiltInActions,
  hasSkillOverride,
  normalizeAssistantActionPreferences,
  normalizeEditorOutputRule,
  normalizeSkillSteps,
  restoreSkillDefault,
  upsertSkillOverride,
} from './matcher'

function context(patch: Partial<AssistantInputContext> = {}): AssistantInputContext {
  return {
    text: '',
    hasText: false,
    images: [],
    hasImage: false,
    imageCount: 0,
    ...patch,
  }
}

describe('assistant action matcher', () => {
  it('uses a skill-named word group by default and migrates the previous numbered default', () => {
    expect(normalizeAssistantActionPreferences(undefined).actionSettings.wordDerive.targetGroupMode).toBe('skill-name')
    expect(normalizeAssistantActionPreferences({
      actionSettings: { wordDerive: { targetGroupMode: 'auto-numbered' } as never } as never,
    }).actionSettings.wordDerive.targetGroupMode).toBe('skill-name')
  })

  it('keeps core actions visible even when older preferences hid them', () => {
    const preferences = normalizeAssistantActionPreferences({
      hiddenActionIds: ['image-derive', 'prompt-optimize', 'batch-variants'],
    })

    expect(preferences.hiddenActionIds).toEqual(['batch-variants'])
  })

  it('prioritizes image derive when images are present', () => {
    const actions = getRecommendedAssistantActions(context({ hasImage: true, imageCount: 1 }), undefined, 3)

    expect(actions.map((action) => action.id)).toContain('image-derive')
    expect(actions[0]?.id).toBe('image-derive')
    expect(actions.some((action) => action.id === 'prompt-optimize')).toBe(false)
  })

  it('prioritizes prompt optimize when text is present', () => {
    const actions = getRecommendedAssistantActions(context({ text: '产品卖点', hasText: true }), undefined, 3)

    expect(actions[0]?.id).toBe('prompt-optimize')
    expect(actions.some((action) => action.id === 'image-derive')).toBe(false)
  })

  it('shows both core actions when image and text are present', () => {
    const actions = getRecommendedAssistantActions(
      context({ text: '产品卖点', hasText: true, hasImage: true, imageCount: 1 }),
      undefined,
      5,
    )

    expect(actions.map((action) => action.id).slice(0, 2)).toEqual(['image-derive', 'prompt-optimize'])
  })

  it('does not expose internal channel rewrite in recommended or overflow actions', () => {
    const input = context({ text: '通用素材提示词', hasText: true })
    const preferences = normalizeAssistantActionPreferences(undefined)
    const allVisibleIds = [
      ...getRecommendedAssistantActions(input, preferences).map((action) => action.id),
      ...getMoreAssistantActions(input, preferences).map((action) => action.id),
    ]

    expect(allVisibleIds).not.toContain('channel-rewrite')
  })

  it('rebuilds custom skill contract fields from explicit toggles', () => {
    const contract = buildCustomSkillContract({
      taskType: 'creative-expansion',
      objective: '跑量衍生',
      preserve: ['产品事实'],
      editable: ['场景'],
      forbidden: ['虚构功效'],
      variationLevel: 'high',
      requiresAdContext: false,
      allowExploreSellingPoint: false,
      primaryOutput: 'variablePrompt',
      output: { finalPrompt: true, candidates: false, analysis: true, wordEntries: false },
    }, '做跑量衍生', true, true, true)

    expect(contract.requiresAdContext).toBe(true)
    expect(contract.output.wordEntries).toBe(true)
    expect(contract.allowExploreSellingPoint).toBe(true)
    expect(contract.objective).toBe('跑量衍生')
  })
})

describe('skill override layer (builtin + override = actual)', () => {
  it('resolves built-in skills with their default step flow', () => {
    const preferences = normalizeAssistantActionPreferences(undefined)
    const resolved = getResolvedBuiltInActions(preferences)
    const breakdown = resolved.find((action) => action.id === 'market-breakdown')

    expect(breakdown?.steps?.length).toBeGreaterThan(0)
    expect(breakdown?.steps?.every((step) => step.enabled)).toBe(true)
    expect(hasSkillOverride(preferences, 'market-breakdown')).toBe(false)
  })

  it('applies a user override on top of the built-in definition', () => {
    const base = normalizeAssistantActionPreferences(undefined)
    const withOverride = upsertSkillOverride(base, {
      skillId: 'market-breakdown',
      name: '我的拆解',
      steps: [{ id: 's1', title: '只看样本', role: 'observe', outputTo: 'sections', instruction: '只统计参考图数量', enabled: true }],
    })

    expect(hasSkillOverride(withOverride, 'market-breakdown')).toBe(true)

    const resolved = getResolvedBuiltInActions(withOverride)
    const breakdown = resolved.find((action) => action.id === 'market-breakdown')!

    expect(breakdown.name).toBe('我的拆解')
    expect(breakdown.steps).toHaveLength(1)
    expect(breakdown.steps?.[0]?.instruction).toBe('只统计参考图数量')
  })

  it('never re-enables candidates through an override', () => {
    const base = normalizeAssistantActionPreferences(undefined)
    const withOverride = upsertSkillOverride(base, {
      skillId: 'market-breakdown',
      contract: { primaryOutput: 'finalPrompt', output: { finalPrompt: true, analysis: true, wordEntries: true } as never },
    })
    const resolved = getResolvedBuiltInActions(withOverride).find((action) => action.id === 'market-breakdown')!

    expect(resolved.contract?.output.candidates).toBe(false)
    expect(resolved.contract?.output.wordEntries).toBe(true)
  })

  it('ignores legacy overrides that try to disable the required final prompt', () => {
    const normalized = normalizeAssistantActionPreferences({
      skillOverrides: [{
        skillId: 'market-breakdown',
        contract: { output: { finalPrompt: false, analysis: true, wordEntries: false } },
      }],
    })
    const resolved = getResolvedBuiltInActions(normalized).find((action) => action.id === 'market-breakdown')!

    expect(normalized.skillOverrides[0]?.contract?.output?.finalPrompt).toBeUndefined()
    expect(resolved.contract?.output.finalPrompt).toBe(true)
    expect(resolved.contract?.output.candidates).toBe(false)
  })

  it('restores the shipped default by dropping the override', () => {
    const base = normalizeAssistantActionPreferences(undefined)
    const edited = upsertSkillOverride(base, { skillId: 'market-breakdown', name: '临时名称' })
    expect(hasSkillOverride(edited, 'market-breakdown')).toBe(true)

    const restored = restoreSkillDefault(edited, 'market-breakdown')
    expect(hasSkillOverride(restored, 'market-breakdown')).toBe(false)
    expect(getResolvedBuiltInActions(restored).find((action) => action.id === 'market-breakdown')?.name).toBe('大盘拆解')
  })

  it('keeps built-in definitions untouched when applying an override', () => {
    const base = normalizeAssistantActionPreferences(undefined)
    const edited = upsertSkillOverride(base, { skillId: 'market-breakdown', name: '改了' })
    expect(getResolvedBuiltInActions(base).find((action) => action.id === 'market-breakdown')?.name).toBe('大盘拆解')
    const source = getResolvedBuiltInActions(base).find((action) => action.id === 'market-breakdown')!
    expect(applySkillOverride(source, undefined).name).toBe('大盘拆解')
  })

  it('duplicates a built-in skill into an editable custom skill', () => {
    const base = normalizeAssistantActionPreferences(undefined)
    const source = getResolvedBuiltInActions(base).find((action) => action.id === 'market-breakdown')!
    const custom = duplicateSkillAsCustom(source)

    expect(custom.isCustom).toBe(true)
    expect(custom.source).toBe('custom')
    expect(custom.steps.length).toBe(source.steps?.length ?? 0)
    expect(custom.name).toContain('副本')
  })
})

describe('management list uses resolved built-ins', () => {
  it('shows the edited (overridden) name and enabled state instead of the shipped default', () => {
    const base = normalizeAssistantActionPreferences(undefined)
    const edited = upsertSkillOverride(base, { skillId: 'market-breakdown', name: '我的拆解', enabled: false })
    const ordered = getOrderedManageActions(edited)
    const breakdown = ordered.find((action) => action.id === 'market-breakdown')

    expect(breakdown?.name).toBe('我的拆解')
    expect(breakdown?.enabled).toBe(false)
    // Default preferences still render the shipped default name.
    expect(getOrderedManageActions(base).find((action) => action.id === 'market-breakdown')?.name).toBe('大盘拆解')
  })
})

describe('normalizeEditorOutputRule (output rule mutual exclusion)', () => {
  it('falls back to finalPrompt when variablePrompt has no word entries', () => {
    expect(normalizeEditorOutputRule({ primaryOutput: 'variablePrompt', allowWordEntries: false })).toEqual({
      primaryOutput: 'finalPrompt',
      allowFinalPrompt: true,
      allowWordEntries: false,
      allowAnalysis: true,
    })
  })

  it('keeps variablePrompt when word entries are enabled and never disables finalPrompt', () => {
    expect(normalizeEditorOutputRule({ primaryOutput: 'variablePrompt', allowWordEntries: true, allowAnalysis: false })).toEqual({
      primaryOutput: 'variablePrompt',
      allowFinalPrompt: true,
      allowWordEntries: true,
      allowAnalysis: false,
    })
  })
})

describe('built-in image-derive step flow', () => {
  it('ships an editable step flow that ends in a final prompt', () => {
    const steps = BUILT_IN_SKILL_STEPS['image-derive']
    expect(steps?.length).toBeGreaterThan(0)
    expect(steps?.some((step) => step.outputTo === 'finalPrompt')).toBe(true)
  })

  it('exposes those default steps on the resolved built-in action so the editor can show them', () => {
    const base = normalizeAssistantActionPreferences(undefined)
    const imageDerive = getResolvedBuiltInActions(base).find((action) => action.id === 'image-derive')
    expect(imageDerive?.steps?.length).toBeGreaterThan(0)
  })
})

describe('normalizeSkillSteps', () => {
  it('accepts both structured steps and legacy string hints', () => {
    const structured = normalizeSkillSteps([
      { id: 'a', title: '第一步', role: 'observe', outputTo: 'sections', instruction: '观察', enabled: true },
      'legacy hint',
    ])
    expect(structured).toHaveLength(2)
    expect(structured[0]?.role).toBe('observe')
    expect(structured[1]?.role).toBe('finalPrompt')
    expect(structured[1]?.outputTo).toBe('finalPrompt')
  })

  it('falls back to a final-prompt role for the last legacy step when word entries are allowed', () => {
    const steps = normalizeSkillSteps(['观察样本', '写变量提示词'], { allowWordEntries: true })
    expect(steps[steps.length - 1]?.role).toBe('variablePrompt')
    expect(steps[steps.length - 1]?.outputTo).toBe('variablePrompt')
  })

  it('drops invalid roles and outputs and limits length', () => {
    const steps = normalizeSkillSteps([{ title: 'x', role: 'bogus' as never, outputTo: 'nowhere' as never, instruction: '做点什么' }])
    expect(steps[0]?.role).toBe('observe')
    expect(steps[0]?.outputTo).toBe('sections')
  })
})
