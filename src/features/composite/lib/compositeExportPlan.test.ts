import { describe, expect, it } from 'vitest'
import {
  createDefaultCompositeV2OutputRuleGroups,
  createDefaultCompositeV2Preset,
  createDefaultCompositeV2PresetGroup,
} from './compositeV2Defaults'
import { createCompositeExportSnapshot, expandCompositeExportItems } from './compositeExportPlan'
import type { CompositeV2BackgroundImage } from './compositeV2Types'

const backgrounds: CompositeV2BackgroundImage[] = [
  { path: 'D:/bg/a.jpg', name: 'a.jpg', relativeDir: '' },
  { path: 'D:/bg/b.jpg', name: 'b.jpg', relativeDir: '' },
]

describe('composite export plan', () => {
  it('expands items per preset and per enabled channel-size rule', () => {
    const outputRuleGroups = createDefaultCompositeV2OutputRuleGroups()
    outputRuleGroups[0]!.rules[0]!.enabled = true
    outputRuleGroups[1]!.rules[2]!.enabled = true
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'a', name: 'A' }
    const presetB = { ...createDefaultCompositeV2Preset(1), id: 'b', name: 'B' }
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: ['a', 'b'] }

    const snapshot = createCompositeExportSnapshot({
      id: 'job-1',
      date: '20260627',
      backgroundFolder: 'D:/bg',
      recursive: false,
      backgrounds,
      presets: [presetA, presetB],
      presetGroup: group,
      enabledPresetIds: ['a', 'b'],
      outputRuleGroups,
      custom: 'x',
      fitMode: 'crop-fill',
      preserveSourceDir: false,
    })
    const items = expandCompositeExportItems(snapshot)

    expect(items).toHaveLength(8)
    expect(items.filter((item) => item.preset.id === 'a' && item.outputRule.name === '1280x720').map((item) => item.index)).toEqual([1, 2])
    expect(items.filter((item) => item.preset.id === 'a' && item.outputRule.name === '1080x1920').map((item) => item.index)).toEqual([1, 2])
  })

  it('freezes presets inside the snapshot', () => {
    const outputRuleGroups = createDefaultCompositeV2OutputRuleGroups()
    outputRuleGroups[0]!.rules[0]!.enabled = true
    const preset = { ...createDefaultCompositeV2Preset(1), id: 'a', name: 'Before' }
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: ['a'] }

    const snapshot = createCompositeExportSnapshot({
      id: 'job-1',
      date: '20260627',
      backgroundFolder: 'D:/bg',
      recursive: false,
      backgrounds,
      presets: [preset],
      presetGroup: group,
      enabledPresetIds: ['a'],
      outputRuleGroups,
      custom: '',
      fitMode: 'crop-fill',
      preserveSourceDir: false,
    })
    preset.name = 'After'

    expect(snapshot.presets[0]?.name).toBe('Before')
  })
})
