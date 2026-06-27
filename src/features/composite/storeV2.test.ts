import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  createCompositeV2Store,
  createCompositeV2StoreState,
  getCompositeV2PersistedState,
} from './storeV2'
import { createDefaultCompositeV2Preset, createDefaultCompositeV2PresetGroup } from './lib/compositeV2Defaults'
import type { CompositeV2ImageLayer, CompositeV2TextLayer } from './lib/compositeV2Types'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('composite v2 store state factory', () => {
  it('creates batch state separate from persisted preset state', () => {
    const state = createCompositeV2StoreState()

    expect(state.backgroundFolder).toBe('')
    expect(state.recursiveBackgrounds).toBe(false)
    expect(state.backgrounds).toEqual([])
    expect(state.previewHistory).toEqual([])
    expect(state.previewHistoryIndex).toBe(-1)
    expect(state.customValue).toBe('')
    expect(state.presets.length).toBeGreaterThan(0)
    expect(state.historyRetention).toBe(10)
    expect(state.exportStatus).toBe('idle')
  })

  it('returns only persisted domain state for storage', () => {
    const store = createCompositeV2Store()
    store.setState({
      backgroundFolder: 'D:/bg',
      recursiveBackgrounds: true,
      backgrounds: [{ path: 'D:/bg/a.jpg', name: 'a.jpg', relativeDir: '' }],
      previewHistory: ['D:/bg/a.jpg'],
      previewHistoryIndex: 0,
      customValue: 'run-1',
      preserveSourceDir: true,
      exportStatus: 'running',
      exportCompleted: 2,
      exportTotal: 10,
    })

    const persisted = getCompositeV2PersistedState(store.getState())

    expect(persisted).toEqual({
      presets: store.getState().presets,
      presetGroups: store.getState().presetGroups,
      outputRuleGroups: store.getState().outputRuleGroups,
      globalFitMode: store.getState().globalFitMode,
      historyRetention: store.getState().historyRetention,
      history: store.getState().history,
    })
    expect(persisted).not.toHaveProperty('backgroundFolder')
    expect(persisted).not.toHaveProperty('previewHistory')
    expect(persisted).not.toHaveProperty('exportStatus')
  })

  it('resets enabled presets and preview preset when switching groups', () => {
    const store = createCompositeV2Store()
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Preset A' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B' }
    const presetC = { ...createDefaultCompositeV2Preset(3), id: 'preset-c', name: 'Preset C' }
    const groupA = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', presetIds: ['preset-a', 'preset-b'] }
    const groupB = { ...createDefaultCompositeV2PresetGroup(2), id: 'group-b', presetIds: ['preset-c', 'preset-b'] }

    store.setState({
      presets: [presetA, presetB, presetC],
      presetGroups: [groupA, groupB],
      selectedPresetGroupId: groupA.id,
      selectedPreviewPresetId: presetB.id,
      enabledPresetIdsForRun: [presetB.id],
    })

    store.getState().setSelectedPresetGroup(groupB.id)

    expect(store.getState().selectedPresetGroupId).toBe(groupB.id)
    expect(store.getState().enabledPresetIdsForRun).toEqual(groupB.presetIds)
    expect(store.getState().selectedPreviewPresetId).toBe('preset-c')
  })

  it('chooses a deterministic random preview when backgrounds refresh', () => {
    const store = createCompositeV2Store({ pickRandomIndex: () => 1 })
    const backgrounds = [
      { path: 'D:/bg/a.jpg', name: 'a.jpg', relativeDir: '' },
      { path: 'D:/bg/b.jpg', name: 'b.jpg', relativeDir: '' },
      { path: 'D:/bg/c.jpg', name: 'c.jpg', relativeDir: '' },
    ]

    store.getState().setBackgrounds(backgrounds)

    expect(store.getState().backgrounds).toEqual(backgrounds)
    expect(store.getState().previewHistory).toEqual(['D:/bg/b.jpg'])
    expect(store.getState().previewHistoryIndex).toBe(0)
  })

  it('updates batch controls through minimal setters', () => {
    const store = createCompositeV2Store()

    store.getState().setBackgroundFolder('D:/bg')
    store.getState().setRecursiveBackgrounds(true)
    store.getState().setSelectedPreviewPresetId('preset-default')
    store.getState().setEnabledPresetIdsForRun(['preset-default'])
    store.getState().setCustomValue('custom-1')
    store.getState().setPreserveSourceDir(true)
    store.getState().setExportProgress(3, 7)
    store.getState().setExportStatus('paused')

    expect(store.getState()).toMatchObject({
      backgroundFolder: 'D:/bg',
      recursiveBackgrounds: true,
      selectedPreviewPresetId: 'preset-default',
      enabledPresetIdsForRun: ['preset-default'],
      customValue: 'custom-1',
      preserveSourceDir: true,
      exportCompleted: 3,
      exportTotal: 7,
      exportStatus: 'paused',
    })
  })

  it('updates a preset immutably and refreshes updatedAt', () => {
    const store = createCompositeV2Store()
    const preset = { ...createDefaultCompositeV2Preset(10), id: 'preset-a', name: 'Preset A' }
    const group = { ...createDefaultCompositeV2PresetGroup(10), presetIds: [preset.id] }
    vi.spyOn(Date, 'now').mockReturnValue(99)

    store.setState({ presets: [preset], presetGroups: [group] })
    const previousPreset = store.getState().presets[0]

    store.getState().updatePreset(preset.id, { name: 'Preset A Updated', sampleBackgroundPath: 'D:/sample.jpg' })

    expect(store.getState().presets[0]).toMatchObject({
      id: preset.id,
      name: 'Preset A Updated',
      sampleBackgroundPath: 'D:/sample.jpg',
      updatedAt: 99,
    })
    expect(store.getState().presets[0]).not.toBe(previousPreset)
  })

  it('adds a text layer to the target preset and stamps updatedAt', () => {
    const store = createCompositeV2Store()
    const preset = { ...createDefaultCompositeV2Preset(10), id: 'preset-a', name: 'Preset A' }
    vi.spyOn(Date, 'now').mockReturnValue(123)

    store.setState({ presets: [preset] })
    store.getState().addTextLayer(preset.id)

    const layer = store.getState().presets[0]?.layers[0] as CompositeV2TextLayer | undefined
    expect(layer).toMatchObject({
      type: 'text',
      name: 'Text Layer',
      text: 'New Text',
      position: { mode: 'free', x: 100, y: 100, width: 240, height: 120 },
      shadow: { enabled: false, color: '#000000', x: 0, y: 4, blur: 12, opacity: 0.25 },
    })
    expect(store.getState().presets[0]?.updatedAt).toBe(123)
  })

  it('adds an image layer with the provided asset and stamps updatedAt', () => {
    const store = createCompositeV2Store()
    const preset = { ...createDefaultCompositeV2Preset(10), id: 'preset-a', name: 'Preset A' }
    vi.spyOn(Date, 'now').mockReturnValue(456)

    store.setState({ presets: [preset] })
    store.getState().addImageLayer(preset.id, { kind: 'path', path: 'D:/logos/logo.png' })

    const layer = store.getState().presets[0]?.layers[0] as CompositeV2ImageLayer | undefined
    expect(layer).toMatchObject({
      type: 'image',
      name: 'Image Layer',
      asset: { kind: 'path', path: 'D:/logos/logo.png' },
      position: { mode: 'free', x: 100, y: 100, width: 240, height: 120 },
      shadow: { enabled: false, color: '#000000', x: 0, y: 4, blur: 12, opacity: 0.25 },
    })
    expect(store.getState().presets[0]?.updatedAt).toBe(456)
  })
})
