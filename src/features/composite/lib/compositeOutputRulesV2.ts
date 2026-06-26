import type { CompositeV2OutputRuleGroup, CompositeV2OutputSizeRule, CompositeV2Preset } from './compositeV2Types'

export type CompositeV2EnabledOutputRule = CompositeV2OutputSizeRule & {
  channelId: string
  channelName: string
}

export function getEffectiveOutputRuleGroups(
  preset: Pick<CompositeV2Preset, 'useOutputOverrides' | 'outputRuleGroupsOverride'>,
  globalGroups: CompositeV2OutputRuleGroup[],
): CompositeV2OutputRuleGroup[] {
  const groups = preset.useOutputOverrides && preset.outputRuleGroupsOverride.length
    ? preset.outputRuleGroupsOverride
    : globalGroups
  return groups.map((group) => ({
    ...group,
    rules: group.rules.map((rule) => ({ ...rule })),
  }))
}

export function getEnabledOutputRules(groups: CompositeV2OutputRuleGroup[]): CompositeV2EnabledOutputRule[] {
  return groups.flatMap((group) => group.rules
    .filter((rule) => rule.enabled)
    .map((rule) => ({ ...rule, channelId: group.id, channelName: group.name })))
}
