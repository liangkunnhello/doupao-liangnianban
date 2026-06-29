/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import {
  createDefaultCompositeV2OutputRuleGroups,
  createDefaultCompositeV2Preset,
  createDefaultCompositeV2PresetGroup,
} from '../lib/compositeV2Defaults'
import { createCompositeV2StoreState, useCompositeV2Store } from '../storeV2'
import { PresetManagementTab } from './PresetManagementTab'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

afterEach(() => {
  while (mountedRenderers.length) {
    mountedRenderers.pop()?.unmount()
  }
  useCompositeV2Store.setState(createCompositeV2StoreState())
  vi.restoreAllMocks()
  delete (window as Window & { electronAPI?: typeof window.electronAPI }).electronAPI
})

function getNodeText(node: ReactTestInstance): string {
  return node.children
    .map((child: string | ReactTestInstance) => (typeof child === 'string' ? child : getNodeText(child)))
    .join('')
}

function findButtonByText(root: ReactTestInstance, text: string) {
  return root.findAll((node: ReactTestInstance) => node.type === 'button').find((node: ReactTestInstance) => getNodeText(node).includes(text))
}

function findInputByAriaLabel(root: ReactTestInstance, label: string) {
  return root.findAllByType('input').find((node: ReactTestInstance) => node.props['aria-label'] === label)
}

describe('PresetManagementTab', () => {
  it('uses a stacked library rail beside a full preview workspace', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'preset-management-workspace')).toHaveLength(1)
    expect(renderer!.root.findAll((node) => node.props['data-layout'] === 'stacked-library-rail')).toHaveLength(1)

    const workspace = renderer!.root.find(
      (node) => node.props['data-layout'] === 'preset-management-workspace',
    )
    expect(workspace.props.className).toContain('h-full')
    expect(workspace.props.className).not.toContain('min-h-[680px]')

    const fixedMinimumHeightNodes = renderer!.root.findAll(
      (node) => typeof node.props.className === 'string'
        && node.props.className.includes('min-h-[680px]'),
    )
    expect(fixedMinimumHeightNodes).toHaveLength(0)
  })

  it('replaces an existing LOGO layer instead of adding an image layer', async () => {
    const preset = { ...createDefaultCompositeV2Preset(1), id: 'preset-logo' }
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: [preset.id] }
    useCompositeV2Store.setState({
      presets: [preset],
      presetGroups: [group],
      selectedPresetGroupId: group.id,
      selectedPreviewPresetId: preset.id,
      logoLibraryPath: 'D:/logos',
    })
    const logoId = useCompositeV2Store.getState().replaceOrAddLogoLayer(
      preset.id,
      { kind: 'path', path: 'D:/logos/old.png' },
    )
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        listImageFiles: vi.fn().mockResolvedValue([
          { path: 'D:/logos/new.png', name: 'new.png', dataUrl: 'data:image/png;base64,AAAA' },
        ]),
      },
    })

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<PresetManagementTab />)
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const logoButton = renderer!.root.findAllByType('button').find((node) => node.props['aria-label'] === 'new.png')
    act(() => {
      logoButton?.props.onClick()
    })

    const layers = useCompositeV2Store.getState().presets[0]!.layers
    expect(layers).toHaveLength(1)
    expect(layers[0]).toMatchObject({
      id: logoId,
      type: 'logo',
      asset: { kind: 'path', path: 'D:/logos/new.png' },
    })
  })

  it('toggles every override size in a channel from its select-all checkbox', () => {
    const outputRuleGroupsOverride = createDefaultCompositeV2OutputRuleGroups()
    const targetGroup = outputRuleGroupsOverride[1]!
    const preset = {
      ...createDefaultCompositeV2Preset(1),
      useOutputOverrides: true,
      outputRuleGroupsOverride,
    }
    const group = { ...createDefaultCompositeV2PresetGroup(1), presetIds: [preset.id] }
    useCompositeV2Store.setState({
      presets: [preset],
      presetGroups: [group],
      selectedPresetGroupId: group.id,
      selectedPreviewPresetId: preset.id,
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const selectAll = findInputByAriaLabel(renderer!.root, `Select all override ${targetGroup.name} sizes`)
    expect(selectAll).toBeDefined()

    act(() => {
      selectAll?.props.onChange({ target: { checked: true } })
    })

    expect(useCompositeV2Store.getState().presets[0]!.outputRuleGroupsOverride[1]!.rules.every((rule) => rule.enabled)).toBe(true)
  })

  it('reloads the persisted LOGO library when preset management opens', async () => {
    const listImageFiles = vi.fn().mockResolvedValue([
      { path: 'D:/logos/logo.png', name: 'logo.png', dataUrl: 'data:image/png;base64,AAAA' },
    ])
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { listImageFiles },
    })
    useCompositeV2Store.setState({ logoLibraryPath: 'D:/logos' } as never)

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<PresetManagementTab />)
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(listImageFiles).toHaveBeenCalledWith('D:/logos')
    expect(findInputByAriaLabel(renderer!.root, 'Logo library path')?.props.value).toBe('D:/logos')
    expect(getNodeText(renderer!.root)).toContain('logo.png')
  })

  it('uses aria-pressed and syncs store selection when switching groups', () => {
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Preset A' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B' }
    const groupA = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', name: 'Group A', presetIds: [presetA.id] }
    const groupB = { ...createDefaultCompositeV2PresetGroup(2), id: 'group-b', name: 'Group B', presetIds: [presetB.id] }

    useCompositeV2Store.setState({
      presets: [presetA, presetB],
      presetGroups: [groupA, groupB],
      selectedPresetGroupId: groupA.id,
      selectedPreviewPresetId: presetA.id,
      enabledPresetIdsForRun: [presetA.id],
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const groupAButton = findButtonByText(renderer!.root, 'Group A')
    const groupBButton = findButtonByText(renderer!.root, 'Group B')

    expect(groupAButton?.props['aria-pressed']).toBe(true)
    expect(groupBButton?.props['aria-pressed']).toBe(false)

    act(() => {
      groupBButton?.props.onClick()
    })

    expect(useCompositeV2Store.getState().selectedPresetGroupId).toBe(groupB.id)
    expect(useCompositeV2Store.getState().selectedPreviewPresetId).toBe(presetB.id)
  })

  it('syncs to the first visible preset when filtering hides the current selection', () => {
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Alpha Preset' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Beta Preset' }
    const group = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', name: 'Group A', presetIds: [presetA.id, presetB.id] }

    useCompositeV2Store.setState({
      presets: [presetA, presetB],
      presetGroups: [group],
      selectedPresetGroupId: group.id,
      selectedPreviewPresetId: presetB.id,
      enabledPresetIdsForRun: [presetA.id, presetB.id],
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const searchInput = findInputByAriaLabel(renderer!.root, 'Search presets')
    act(() => {
      searchInput?.props.onChange({ target: { value: 'Alpha' } })
    })

    expect(useCompositeV2Store.getState().selectedPreviewPresetId).toBe(presetA.id)
    expect(renderer!.root.findAllByType('input').some((node: ReactTestInstance) => node.props.value === 'Alpha Preset')).toBe(true)
  })

  it('does not render the editor for a hidden preset when filtering returns no results', () => {
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Alpha Preset' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Beta Preset' }
    const group = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', name: 'Group A', presetIds: [presetA.id, presetB.id] }

    useCompositeV2Store.setState({
      presets: [presetA, presetB],
      presetGroups: [group],
      selectedPresetGroupId: group.id,
      selectedPreviewPresetId: presetB.id,
      enabledPresetIdsForRun: [presetA.id, presetB.id],
    })

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<PresetManagementTab />)
    })
    mountedRenderers.push(renderer!)

    const searchInput = findInputByAriaLabel(renderer!.root, 'Search presets')
    act(() => {
      searchInput?.props.onChange({ target: { value: 'No Match' } })
    })

    expect(renderer!.root.findAllByType('input').some((node: ReactTestInstance) => node.props.value === 'Alpha Preset' || node.props.value === 'Beta Preset')).toBe(false)
    expect(renderer!.root.findAllByType('input').some((node: ReactTestInstance) => node.props.placeholder === '鍙€夛紝鐢ㄤ簬鍚庣画棰勮鎺ョ嚎')).toBe(false)
  })
})
