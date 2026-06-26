import { describe, expect, it } from 'vitest'
import { createDefaultCompositeV2Preset, createDefaultCompositeV2PresetGroup } from './compositeV2Defaults'
import { addPresetToGroup, duplicatePresetIntoGroup, filterPresetsForLibrary, movePresetInGroup } from './compositePresetLibrary'

describe('composite preset library', () => {
  it('adds a global preset reference to a group once', () => {
    const group = createDefaultCompositeV2PresetGroup(1)
    expect(addPresetToGroup(group, 'preset-default').presetIds).toEqual(['preset-default'])
    expect(addPresetToGroup(group, 'preset-2').presetIds).toEqual(['preset-default', 'preset-2'])
  })

  it('duplicates a global preset and adds the copy to the current group', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const group = createDefaultCompositeV2PresetGroup(1)

    const result = duplicatePresetIntoGroup([preset], group, preset.id, 'preset-copy', 2)

    expect(result.presets).toHaveLength(2)
    expect(result.presets[1]).toMatchObject({ id: 'preset-copy', name: '默认产品预设 副本', updatedAt: 2 })
    expect(result.presets[1]).not.toBe(preset)
    expect(result.group.presetIds).toEqual(['preset-default', 'preset-copy'])
  })

  it('reorders group preset ids', () => {
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: ['a', 'b', 'c'] }
    expect(movePresetInGroup(group, 'c', 0).presetIds).toEqual(['c', 'a', 'b'])
  })

  it('filters presets by name and group membership', () => {
    const presets = [
      { ...createDefaultCompositeV2Preset(1), id: 'a', name: '百度产品' },
      { ...createDefaultCompositeV2Preset(2), id: 'b', name: '厂商产品' },
    ]
    const groups = [{ ...createDefaultCompositeV2PresetGroup(1), id: 'g1', presetIds: ['b'] }]

    expect(filterPresetsForLibrary(presets, groups, { query: '产品', groupId: 'g1' }).map((preset) => preset.id)).toEqual(['b'])
  })
})
