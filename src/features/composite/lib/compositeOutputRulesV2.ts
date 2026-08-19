import type { CompositeV2OutputRuleGroup, CompositeV2OutputSizeRule, CompositeV2Preset } from './compositeV2Types'

export type CompositeV2EnabledOutputRule = CompositeV2OutputSizeRule & {
  channelId: string
  channelName: string
}

export function getEffectiveOutputRuleGroups(
  preset: Pick<CompositeV2Preset, 'useOutputOverrides' | 'outputRuleGroupsOverride' | 'outputRuleMode'>,
  globalGroups: CompositeV2OutputRuleGroup[],
): CompositeV2OutputRuleGroup[] {
  if (preset.outputRuleMode === 'replace') {
    return preset.outputRuleGroupsOverride.map((group) => ({
      ...group,
      distributionPaths: [...group.distributionPaths],
      rules: group.rules.map((rule) => ({ ...rule })),
    }))
  }
  if (!preset.useOutputOverrides) {
    return globalGroups.map((group) => ({
      ...group,
      rules: group.rules.map((rule) => ({ ...rule })),
    }))
  }

  // Existing groups inherit global dimensions and limits; importer-owned groups are
  // appended intact so a migrated preset can preserve its source output contract.
  const globalIds = new Set(globalGroups.map((group) => group.id))
  const mergedGlobalGroups = globalGroups.map((globalGroup) => {
    const overrideGroup = preset.outputRuleGroupsOverride.find(g => g.id === globalGroup.id)
    return {
      ...globalGroup,
      rules: globalGroup.rules.map((globalRule) => {
        const overrideRule = overrideGroup?.rules.find(r => r.id === globalRule.id)
        return {
          ...globalRule,
          enabled: overrideRule ? overrideRule.enabled : globalRule.enabled,
        }
      })
    }
  })
  const customOverrideGroups = preset.outputRuleGroupsOverride
    .filter((group) => !globalIds.has(group.id))
    .map((group) => ({
      ...group,
      distributionPaths: [...group.distributionPaths],
      rules: group.rules.map((rule) => ({ ...rule })),
    }))
  return [...mergedGlobalGroups, ...customOverrideGroups]
}

export function getEnabledOutputRules(groups: CompositeV2OutputRuleGroup[]): CompositeV2EnabledOutputRule[] {
  return groups.flatMap((group) => group.rules
    .filter((rule) => rule.enabled)
    .map((rule) => ({ ...rule, channelId: group.id, channelName: group.name })))
}
