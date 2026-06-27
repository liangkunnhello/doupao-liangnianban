/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { createDefaultCompositeV2Preset, createDefaultCompositeV2PresetGroup } from '../lib/compositeV2Defaults'
import { createCompositeV2StoreState, useCompositeV2Store } from '../storeV2'
import { BatchExportTab } from './BatchExportTab'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

afterEach(() => {
  while (mountedRenderers.length) {
    mountedRenderers.pop()?.unmount()
  }
  useCompositeV2Store.setState(createCompositeV2StoreState())
  vi.restoreAllMocks()
  if (typeof window !== 'undefined') {
    delete (window as Window & { electronAPI?: typeof window.electronAPI }).electronAPI
  }
})

function getNodeText(node: ReactTestInstance): string {
  return node.children
    .map((child: string | ReactTestInstance) => (typeof child === 'string' ? child : getNodeText(child)))
    .join('')
}

function findButtonByText(root: ReactTestInstance, text: string) {
  return root.findAll((node: ReactTestInstance) => node.type === 'button').find((node: ReactTestInstance) => getNodeText(node).includes(text))
}

function findButtonByLabel(root: ReactTestInstance, label: string) {
  return root.findAll((node: ReactTestInstance) => node.type === 'button').find((node: ReactTestInstance) => node.props['aria-label'] === label)
}

function findInputByLabel(root: ReactTestInstance, label: string) {
  return root.findAllByType('input').find((node: ReactTestInstance) => node.props['aria-label'] === label)
}

describe('BatchExportTab', () => {
  it('loads backgrounds from the selected folder and reloads them when recursive mode changes', async () => {
    const selectDirectory = vi.fn().mockResolvedValue('D:/backgrounds')
    const listCompositeBackgroundFiles = vi
      .fn()
      .mockResolvedValueOnce([{ path: 'D:/backgrounds/a.jpg', name: 'a.jpg', relativeDir: '' }])
      .mockResolvedValueOnce([{ path: 'D:/backgrounds/nested/b.jpg', name: 'b.jpg', relativeDir: 'nested' }])

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        isElectron: true,
        selectDirectory,
        listCompositeBackgroundFiles,
        readImageFile: vi.fn().mockResolvedValue(null),
      },
    })

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<BatchExportTab />)
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      await findButtonByText(renderer!.root, 'Select Background Folder')?.props.onClick()
    })

    expect(selectDirectory).toHaveBeenCalledTimes(1)
    expect(listCompositeBackgroundFiles).toHaveBeenNthCalledWith(1, 'D:/backgrounds', false)
    expect(useCompositeV2Store.getState().backgroundFolder).toBe('D:/backgrounds')
    expect(useCompositeV2Store.getState().backgrounds).toHaveLength(1)

    const recursiveToggle = findInputByLabel(renderer!.root, 'Recursive backgrounds')
    await act(async () => {
      await recursiveToggle?.props.onChange({ target: { checked: true } })
    })

    expect(listCompositeBackgroundFiles).toHaveBeenNthCalledWith(2, 'D:/backgrounds', true)
    expect(useCompositeV2Store.getState().recursiveBackgrounds).toBe(true)
    expect(useCompositeV2Store.getState().backgrounds[0]?.path).toBe('D:/backgrounds/nested/b.jpg')
  })

  it('pushes random preview history and keeps the start button disabled until configuration is complete', async () => {
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Preset A', outputRootPath: 'D:/exports/a' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B', outputRootPath: '' }
    const group = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', name: 'Group A', presetIds: [presetA.id, presetB.id] }

    useCompositeV2Store.setState({
      presets: [presetA, presetB],
      presetGroups: [group],
      selectedPresetGroupId: group.id,
      selectedPreviewPresetId: presetA.id,
      enabledPresetIdsForRun: [presetA.id, presetB.id],
      backgroundFolder: 'D:/backgrounds',
      backgrounds: [
        { path: 'D:/backgrounds/a.jpg', name: 'a.jpg', relativeDir: '' },
        { path: 'D:/backgrounds/b.jpg', name: 'b.jpg', relativeDir: '' },
      ],
      previewHistory: ['D:/backgrounds/a.jpg'],
      previewHistoryIndex: 0,
    })

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        isElectron: true,
        readImageFile: vi.fn().mockResolvedValue(null),
      },
    })
    vi.spyOn(Math, 'random').mockReturnValue(0.99)

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<BatchExportTab />)
    })
    mountedRenderers.push(renderer!)

    const startButton = findButtonByText(renderer!.root, 'Start Export')
    expect(startButton?.props.disabled).toBe(true)

    await act(async () => {
      await findButtonByLabel(renderer!.root, '随机下一张')?.props.onClick()
    })

    expect(useCompositeV2Store.getState().previewHistory).toEqual(['D:/backgrounds/a.jpg', 'D:/backgrounds/b.jpg'])
    expect(useCompositeV2Store.getState().previewHistoryIndex).toBe(1)

    const presetBCheckbox = renderer!.root.findAllByType('input').find((node: ReactTestInstance) => node.props.type === 'checkbox' && node.props.checked === true && node.props.value === presetB.id)
    act(() => {
      presetBCheckbox?.props.onChange({ target: { checked: false } })
    })

    expect(useCompositeV2Store.getState().enabledPresetIdsForRun).toEqual([presetA.id])
    expect(findButtonByText(renderer!.root, 'Start Export')?.props.disabled).toBe(false)
  })
})
