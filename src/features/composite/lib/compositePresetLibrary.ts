import type { CompositeV2Preset, CompositeV2PresetGroup } from './compositeV2Types'

export function addPresetToGroup(group: CompositeV2PresetGroup, presetId: string): CompositeV2PresetGroup {
  if (group.presetIds.includes(presetId)) return group
  return { ...group, presetIds: [...group.presetIds, presetId], updatedAt: Date.now() }
}

export function movePresetInGroup(
  group: CompositeV2PresetGroup,
  presetId: string,
  targetIndex: number,
): CompositeV2PresetGroup {
  const currentIndex = group.presetIds.indexOf(presetId)
  if (currentIndex < 0) return group

  const presetIds = [...group.presetIds]
  const [item] = presetIds.splice(currentIndex, 1)
  presetIds.splice(Math.max(0, Math.min(targetIndex, presetIds.length)), 0, item)

  return { ...group, presetIds, updatedAt: Date.now() }
}

export function duplicatePresetIntoGroup(
  presets: CompositeV2Preset[],
  group: CompositeV2PresetGroup,
  sourcePresetId: string,
  newPresetId: string,
  now = Date.now(),
): { presets: CompositeV2Preset[]; group: CompositeV2PresetGroup } {
  const source = presets.find((preset) => preset.id === sourcePresetId)
  if (!source) return { presets, group }
  if (presets.some((preset) => preset.id === newPresetId) || group.presetIds.includes(newPresetId)) {
    return { presets, group }
  }

  const copy: CompositeV2Preset = {
    ...structuredClone(source),
    id: newPresetId,
    name: `${source.name} 副本`,
    updatedAt: now,
  }

  return {
    presets: [...presets, copy],
    group: { ...group, presetIds: [...group.presetIds, copy.id], updatedAt: now },
  }
}

export function filterPresetsForLibrary(
  presets: CompositeV2Preset[],
  groups: CompositeV2PresetGroup[],
  filters: { query?: string; groupId?: string },
): CompositeV2Preset[] {
  const query = filters.query?.trim().toLowerCase()
  const group = filters.groupId ? groups.find((item) => item.id === filters.groupId) : null

  return presets
    .filter((preset) => !query || preset.name.toLowerCase().includes(query))
    .filter((preset) => !group || group.presetIds.includes(preset.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
