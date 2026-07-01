import { describe, expect, it } from 'vitest'
import {
  createDefaultCompositeV2OutputRuleGroups,
  createDefaultCompositeV2Preset,
  createDefaultCompositeV2PresetGroup,
} from './compositeV2Defaults'
import { createCompositeExportSnapshot, expandCompositeExportItems } from './compositeExportPlan'
import type { CompositeV2BackgroundImage, CompositeV2OutputRuleGroup } from './compositeV2Types'

const backgrounds: CompositeV2BackgroundImage[] = [
  { path: 'D:/bg/a.jpg', name: 'a.jpg', relativeDir: '', width: 100, height: 100 },
  { path: 'D:/bg/b.jpg', name: 'b.jpg', relativeDir: '', width: 100, height: 100 },
]

describe('composite export plan', () => {
  it('expands items per preset and per enabled channel-size rule', () => {
  const outputRuleGroups: CompositeV2OutputRuleGroup[] = [
    {
      id: 'g1',
      name: 'Group 1',
      distributionPaths: [],
      rules: [
        { id: 'r1', name: '100x100', enabled: true, width: 100, height: 100, format: 'jpg', subfolderTemplate: '', filenameTemplate: '', maxSizeKb: 0 },
      ],
    },
  ]
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'a', name: 'A' }
    const presetB = { ...createDefaultCompositeV2Preset(1), id: 'b', name: 'B' }
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: ['a', 'b'] }

    const snapshot = createCompositeExportSnapshot({
      id: 'job-1',
      date: '20260627',
      backgroundFolders: ['D:/bg'],
      recursive: false,
      backgrounds,
      presets: [presetA, presetB],
      presetGroup: group,
      enabledPresetIds: ['a', 'b'],
      outputRuleGroups,
      smartMatchOrientation: true,
      custom: 'x',
      customVariables: [],
      fitMode: 'crop-fill',
      preserveSourceDir: false,
    })
    const items = expandCompositeExportItems(snapshot)

    expect(items).toHaveLength(4)
    expect(items.filter((item) => item.preset.id === 'a' && item.outputRule.name === '100x100').map((item) => item.index)).toEqual([1, 2])
    expect(items.filter((item) => item.preset.id === 'b' && item.outputRule.name === '100x100').map((item) => item.index)).toEqual([1, 2])
  })

  it('freezes presets inside the snapshot', () => {
    const outputRuleGroups = createDefaultCompositeV2OutputRuleGroups()
    outputRuleGroups[0]!.rules[0]!.enabled = true
    const preset = { ...createDefaultCompositeV2Preset(1), id: 'a', name: 'Before' }
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: ['a'] }

    const snapshot = createCompositeExportSnapshot({
      id: 'job-1',
      date: '20260627',
      backgroundFolders: ['D:/bg'],
      recursive: false,
      backgrounds,
      presets: [preset],
      presetGroup: group,
      enabledPresetIds: ['a'],
      outputRuleGroups,
      smartMatchOrientation: false,
      custom: '',
      customVariables: [],
      fitMode: 'crop-fill',
      preserveSourceDir: false,
    })
    preset.name = 'After'

    expect(snapshot.presets[0]?.name).toBe('Before')
  })
})
