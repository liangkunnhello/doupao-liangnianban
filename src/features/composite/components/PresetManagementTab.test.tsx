import { afterEach, describe, expect, it } from 'vitest'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { createDefaultCompositeV2Preset, createDefaultCompositeV2PresetGroup } from '../lib/compositeV2Defaults'
import { createCompositeV2StoreState, useCompositeV2Store } from '../storeV2'
import { PresetManagementTab } from './PresetManagementTab'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

afterEach(() => {
  while (mountedRenderers.length) {
    mountedRenderers.pop()?.unmount()
  }
  useCompositeV2Store.setState(createCompositeV2StoreState())
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
