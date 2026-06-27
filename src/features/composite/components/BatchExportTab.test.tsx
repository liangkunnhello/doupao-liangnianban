/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import {
  createDefaultCompositeV2OutputRuleGroups,
  createDefaultCompositeV2Preset,
  createDefaultCompositeV2PresetGroup,
} from '../lib/compositeV2Defaults'
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
  it('stores the folder immediately, sorts loaded backgrounds naturally, and updates recursive mode before rescanning', async () => {
    const selectDirectory = vi.fn().mockResolvedValue('D:/backgrounds')
    let resolveFirstScan: ((value: Array<{ path: string; name: string; relativeDir: string }>) => void) | null = null
    let resolveSecondScan: ((value: Array<{ path: string; name: string; relativeDir: string }>) => void) | null = null
    const listCompositeBackgroundFiles = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstScan = resolve
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecondScan = resolve
      }))

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
      void findButtonByText(renderer!.root, '选择背景文件夹')?.props.onClick()
      await Promise.resolve()
    })

    expect(selectDirectory).toHaveBeenCalledTimes(1)
    expect(listCompositeBackgroundFiles).toHaveBeenNthCalledWith(1, 'D:/backgrounds', false)
    expect(useCompositeV2Store.getState().backgroundFolder).toBe('D:/backgrounds')
    expect(useCompositeV2Store.getState().backgrounds).toEqual([])

    await act(async () => {
      resolveFirstScan?.([
        { path: 'D:/backgrounds/10.jpg', name: '10.jpg', relativeDir: '' },
        { path: 'D:/backgrounds/2.jpg', name: '2.jpg', relativeDir: '' },
        { path: 'D:/backgrounds/nested/1.jpg', name: '1.jpg', relativeDir: 'nested' },
      ])
      await Promise.resolve()
    })

    expect(useCompositeV2Store.getState().backgrounds.map((item) => item.path)).toEqual([
      'D:/backgrounds/2.jpg',
      'D:/backgrounds/10.jpg',
      'D:/backgrounds/nested/1.jpg',
    ])

    const recursiveToggle = findInputByLabel(renderer!.root, 'Recursive backgrounds')
    await act(async () => {
      void recursiveToggle?.props.onChange({ target: { checked: true } })
      await Promise.resolve()
    })

    expect(listCompositeBackgroundFiles).toHaveBeenNthCalledWith(2, 'D:/backgrounds', true)
    expect(useCompositeV2Store.getState().recursiveBackgrounds).toBe(true)

    await act(async () => {
      resolveSecondScan?.([
        { path: 'D:/backgrounds/nested/b.jpg', name: 'b.jpg', relativeDir: 'nested' },
      ])
      await Promise.resolve()
    })

    expect(useCompositeV2Store.getState().backgrounds[0]?.path).toBe('D:/backgrounds/nested/b.jpg')
  })

  it('keeps the selected folder, clears backgrounds, and shows feedback when scanning fails', async () => {
    const selectDirectory = vi.fn().mockResolvedValue('D:/backgrounds')
    const listCompositeBackgroundFiles = vi.fn().mockRejectedValue(new Error('scan failed'))

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        isElectron: true,
        selectDirectory,
        listCompositeBackgroundFiles,
        readImageFile: vi.fn().mockResolvedValue(null),
      },
    })

    useCompositeV2Store.setState({
      backgroundFolder: 'D:/old',
      backgrounds: [{ path: 'D:/old/a.jpg', name: 'a.jpg', relativeDir: '' }],
    })

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<BatchExportTab />)
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      await findButtonByText(renderer!.root, '选择背景文件夹')?.props.onClick()
    })

    expect(useCompositeV2Store.getState().backgroundFolder).toBe('D:/backgrounds')
    expect(useCompositeV2Store.getState().backgrounds).toEqual([])
    expect(getNodeText(renderer!.root)).toContain('scan failed')
  })

  it('renders separate preset preview and inclusion controls without nested interactive elements', async () => {
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Preset A', outputRootPath: 'D:/exports/a' }
    const group = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', name: 'Group A', presetIds: [presetA.id] }

    useCompositeV2Store.setState({
      presets: [presetA],
      presetGroups: [group],
      selectedPresetGroupId: group.id,
      selectedPreviewPresetId: presetA.id,
      enabledPresetIdsForRun: [presetA.id],
    })

    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        isElectron: true,
        readImageFile: vi.fn().mockResolvedValue(null),
      },
    })

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<BatchExportTab />)
    })
    mountedRenderers.push(renderer!)

    const previewButton = findButtonByLabel(renderer!.root, 'Preview preset Preset A')
    const includeCheckbox = findInputByLabel(renderer!.root, 'Include preset Preset A')

    expect(previewButton).toBeDefined()
    expect(includeCheckbox).toBeDefined()
    expect(previewButton?.findAllByType('input')).toEqual([])
  })

  it('pushes random preview history and moves shell export status into running preparation', async () => {
    const presetA = { ...createDefaultCompositeV2Preset(1), id: 'preset-a', name: 'Preset A', outputRootPath: 'D:/exports/a' }
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B', outputRootPath: '' }
    const group = { ...createDefaultCompositeV2PresetGroup(1), id: 'group-a', name: 'Group A', presetIds: [presetA.id, presetB.id] }
    const outputRuleGroups = createDefaultCompositeV2OutputRuleGroups()
    outputRuleGroups[0]!.rules[0]!.enabled = true

    useCompositeV2Store.setState({
      presets: [presetA, presetB],
      presetGroups: [group],
      outputRuleGroups,
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

    const startButton = findButtonByText(renderer!.root, '开始导出')
    expect(startButton?.props.disabled).toBe(true)

    await act(async () => {
      await findButtonByLabel(renderer!.root, 'Random preview')?.props.onClick()
    })

    expect(useCompositeV2Store.getState().previewHistory).toEqual(['D:/backgrounds/a.jpg', 'D:/backgrounds/b.jpg'])
    expect(useCompositeV2Store.getState().previewHistoryIndex).toBe(1)

    const presetBCheckbox = renderer!.root.findAllByType('input').find((node: ReactTestInstance) => node.props.type === 'checkbox' && node.props.checked === true && node.props.value === presetB.id)
    act(() => {
      presetBCheckbox?.props.onChange({ target: { checked: false } })
    })

    expect(useCompositeV2Store.getState().enabledPresetIdsForRun).toEqual([presetA.id])
    expect(findButtonByText(renderer!.root, '开始导出')?.props.disabled).toBe(false)

    await act(async () => {
      await findButtonByText(renderer!.root, '开始导出')?.props.onClick()
    })

    expect(useCompositeV2Store.getState().exportStatus).toBe('completed')
    expect(useCompositeV2Store.getState().exportCompleted).toBe(2)
    expect(useCompositeV2Store.getState().exportTotal).toBe(2)
    expect(useCompositeV2Store.getState().exportFailures).toHaveLength(2)
    expect(getNodeText(renderer!.root)).toContain('导出完成')
  })
})
