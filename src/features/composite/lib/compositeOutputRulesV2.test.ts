import { describe, expect, it } from 'vitest'
import { createDefaultCompositeV2OutputRuleGroups } from './compositeV2Defaults'
import { getEffectiveOutputRuleGroups, getEnabledOutputRules } from './compositeOutputRulesV2'
import type { CompositeV2Preset } from './compositeV2Types'

function presetWithOverride(useOutputOverrides: boolean, override = createDefaultCompositeV2OutputRuleGroups()): Pick<CompositeV2Preset, 'useOutputOverrides' | 'outputRuleGroupsOverride'> {
  return { useOutputOverrides, outputRuleGroupsOverride: override }
}

describe('composite v2 output rules', () => {
  it('uses global output rules when preset override is disabled', () => {
    const global = createDefaultCompositeV2OutputRuleGroups()
    global[0]!.rules[0]!.enabled = true

    const effective = getEffectiveOutputRuleGroups(presetWithOverride(false), global)

    expect(effective[0]?.rules[0]?.enabled).toBe(true)
  })

  it('uses preset output rules when override is enabled', () => {
    const global = createDefaultCompositeV2OutputRuleGroups()
    global[0]!.rules[0]!.enabled = true
    const override = createDefaultCompositeV2OutputRuleGroups()
    override[1]!.rules[1]!.enabled = true
    override[1]!.rules[1]!.maxSizeKb = 123

    const enabled = getEnabledOutputRules(getEffectiveOutputRuleGroups(presetWithOverride(true, override), global))

    expect(enabled).toHaveLength(1)
    expect(enabled[0]).toMatchObject({ channelName: '百度', name: '370x245', maxSizeKb: 123 })
  })
})
