/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create } from 'react-test-renderer'
import { DEFAULT_PARAMS, type SopBatchSnapshot } from '../../../types'
import GallerySopBatchModal, { getGallerySopPromptRunStorageKey } from './GallerySopBatchModal'

const generateMocks = vi.hoisted(() => ({ generatePromptsFromSopStore: vi.fn() }))
const storeMocks = vi.hoisted(() => ({ ensureImageCached: vi.fn(), submitTaskWithData: vi.fn() }))
const dbMocks = vi.hoisted(() => ({
  deleteSopBatchSnapshot: vi.fn(),
  getAllSopBatchSnapshots: vi.fn(),
  getSopBatchSnapshot: vi.fn(),
  putSopBatchSnapshot: vi.fn(),
}))
const requirementState = vi.hoisted(() => ({
  sopLibrary: [{ id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。', source: 'manual', createdBy: 'user-1', createdAt: 1, updatedAt: 1 }],
}))
const storeState = vi.hoisted(() => ({
  params: { model: 'gpt-image-1', size: '1024x1024', quality: 'auto', output_format: 'png', n: 1 },
  inputImages: [] as Array<{ id: string; dataUrl: string }>,
  inputImageFolder: null,
  customOutputPath: '',
  activeWorkspaceTabId: 'tab-a',
  workspaceTabs: [{ id: 'tab-a', name: '标签 A' }],
  showToast: vi.fn(),
  setInputImages: vi.fn(),
  setInputImageFolder: vi.fn(),
  setParams: vi.fn(),
}))

vi.mock('../../../store', () => ({
  ensureImageCached: storeMocks.ensureImageCached,
  submitTaskWithData: storeMocks.submitTaskWithData,
  useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}))
vi.mock('../../../lib/db', () => ({
  deleteSopBatchSnapshot: dbMocks.deleteSopBatchSnapshot,
  getAllSopBatchSnapshots: dbMocks.getAllSopBatchSnapshots,
  getSopBatchSnapshot: dbMocks.getSopBatchSnapshot,
  putSopBatchSnapshot: dbMocks.putSopBatchSnapshot,
}))
vi.mock('../../requirementPrototype/store', () => ({
  useRequirementPrototype: (selector: (state: typeof requirementState) => unknown) => selector(requirementState),
}))
vi.mock('./storeSopGeneration', () => generateMocks)

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

beforeEach(() => {
  dbMocks.getAllSopBatchSnapshots.mockResolvedValue([])
  dbMocks.getSopBatchSnapshot.mockResolvedValue(undefined)
  dbMocks.putSopBatchSnapshot.mockResolvedValue('run-1')
  dbMocks.deleteSopBatchSnapshot.mockResolvedValue(undefined)
})

afterEach(() => {
  while (mountedRenderers.length) mountedRenderers.pop()?.unmount()
  window.localStorage.clear()
  storeState.inputImages = []
  vi.clearAllMocks()
})

describe('GallerySopBatchModal background generation', () => {
  it('continues generating and persists the result after being moved to the background', async () => {
    let resolveGeneration!: (value: string[]) => void
    generateMocks.generatePromptsFromSopStore.mockImplementation(() => new Promise<string[]>((resolve) => { resolveGeneration = resolve }))
    const onBackground = vi.fn()
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" autoStart onClose={vi.fn()} onBackground={onBackground} />)
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledOnce()
    const closeButton = renderer!.root.findAllByType('button').find((button) => button.props['aria-label'] === '转入后台继续生成 SOP 提示词')
    act(() => closeButton!.props.onClick())
    expect(onBackground).toHaveBeenCalledOnce()

    await act(async () => {
      resolveGeneration(['后台生成的提示词'])
      await Promise.resolve()
    })

    const persisted = JSON.parse(window.localStorage.getItem(getGallerySopPromptRunStorageKey('tab-a')) ?? '{}')
    expect(persisted).toMatchObject({ version: 4, selectedSopId: 'sop-1', availablePrompts: 1 })
    expect(persisted.activeRunId).toMatch(/^sop-run-/)
    expect(dbMocks.putSopBatchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        id: persisted.activeRunId,
        status: 'ready',
        prompts: [expect.objectContaining({ text: '后台生成的提示词', origin: 'ai' })],
      }),
    )
  })

  it('persists the automatic image-generation switch per workspace tab', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" onClose={vi.fn()} />)
    })
    mountedRenderers.push(renderer!)

    const toggle = renderer!.root.findAllByType('input').find((input) => input.props['aria-label'] === '提示词生成完成后自动生图')
    expect(toggle!.props.checked).toBe(false)
    act(() => toggle!.props.onChange({ target: { checked: true } }))

    expect(renderer!.root.findAllByType('input').find((input) => input.props['aria-label'] === '提示词生成完成后自动生图')!.props.checked).toBe(true)
    const persisted = JSON.parse(window.localStorage.getItem(getGallerySopPromptRunStorageKey('tab-a')) ?? '{}')
    expect(persisted.autoGenerate).toBe(true)
  })

  it('offers an explicit prompt-generation entry inside the SOP workspace', async () => {
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['从工作台生成的提示词'])
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={1}
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const generateButton = renderer!.root.findAllByType('button').find(
      (button) => button.props['aria-label'] === '生成 1 条 SOP 提示词',
    )
    expect(generateButton).toBeDefined()

    await act(async () => {
      generateButton!.props.onClick()
      await Promise.resolve()
    })

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledOnce()
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('从工作台生成的提示词')
  })

  it('restores the active SOP run from IndexedDB without mixing another SOP', async () => {
    const storedRun: SopBatchSnapshot = {
      id: 'sop-run-saved',
      batchId: '',
      workspaceTabId: 'tab-a',
      createdAt: 10,
      updatedAt: 20,
      status: 'ready',
      pinned: true,
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
      brief: '历史要求',
      referenceImageIds: [],
      promptCount: 1,
      imagesPerPrompt: 1,
      prompts: [{ id: 'prompt-1', text: '历史提示词', origin: 'ai', edited: false, sourceId: 'text-to-image' }],
      params: { ...DEFAULT_PARAMS },
    }
    window.localStorage.setItem(getGallerySopPromptRunStorageKey('tab-a'), JSON.stringify({
      version: 3,
      activeRunId: storedRun.id,
      selectedSopId: 'sop-1',
      promptCount: 1,
      imagesPerPrompt: 1,
      availablePrompts: 1,
      brief: storedRun.brief,
    }))
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([storedRun])
    dbMocks.getSopBatchSnapshot.mockResolvedValue(storedRun)

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('历史提示词')
    expect(storeState.setParams).toHaveBeenCalledWith(storedRun.params)
    expect(generateMocks.generatePromptsFromSopStore).not.toHaveBeenCalled()
  })

  it('submits images after a complete automatic prompt run', async () => {
    let resolveGeneration!: (value: string[]) => void
    generateMocks.generatePromptsFromSopStore.mockImplementation(() => new Promise<string[]>((resolve) => { resolveGeneration = resolve }))
    storeMocks.submitTaskWithData.mockResolvedValue('task-1')
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" initialQuantity={1} initialAutoGenerate autoStart onClose={vi.fn()} />)
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledOnce()
    await act(async () => {
      resolveGeneration(['自动生图提示词'])
      await Promise.resolve()
    })

    expect(storeMocks.submitTaskWithData).toHaveBeenCalledOnce()
  })

  it('uses the batch brief, all shared references, and the per-prompt image count', async () => {
    storeState.inputImages = [
      { id: 'image-1', dataUrl: 'data:image/png;base64,one' },
      { id: 'image-2', dataUrl: 'data:image/png;base64,two' },
    ]
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['共同参考提示词'])
    storeMocks.submitTaskWithData.mockResolvedValue('task-1')
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={1}
          initialImagesPerPrompt={2}
          initialBrief="夏日清爽，不要人物"
          initialSecondReference
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sop-1' }),
      1,
      '夏日清爽，不要人物',
      expect.objectContaining({
        referenceImages: [
          { name: '图1', dataUrl: 'data:image/png;base64,one' },
          { name: '图2', dataUrl: 'data:image/png;base64,two' },
        ],
      }),
    )

    const startButton = renderer!.root.findAllByType('button').find((button) => button.props['aria-label'] === '生成 2 张图片')
    await act(async () => {
      startButton!.props.onClick()
      await Promise.resolve()
    })

    expect(storeMocks.submitTaskWithData).toHaveBeenCalledWith(
      expect.objectContaining({
        inputImages: [
          { id: 'image-1', dataUrl: 'data:image/png;base64,one' },
          { id: 'image-2', dataUrl: 'data:image/png;base64,two' },
        ],
        params: expect.objectContaining({ n: 2, reference_mode: 'all' }),
      }),
      { silentSuccess: true },
    )
    expect(dbMocks.putSopBatchSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        brief: '夏日清爽，不要人物',
        referenceImageIds: ['image-1', 'image-2'],
        promptCount: 1,
        imagesPerPrompt: 2,
        params: expect.objectContaining({ n: 2, reference_mode: 'all' }),
      }),
    )
  })

  it('uses references for prompt generation only when second reference is off', async () => {
    storeState.inputImages = [{ id: 'image-1', dataUrl: 'data:image/png;base64,one' }]
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['仅提示词阶段参考'])
    storeMocks.submitTaskWithData.mockResolvedValue('task-1')
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={1}
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sop-1' }),
      1,
      '',
      expect.objectContaining({
        referenceImages: [{ name: '图1', dataUrl: 'data:image/png;base64,one' }],
      }),
    )

    const startButton = renderer!.root.findAllByType('button').find((button) => button.props['aria-label'] === '生成 1 张图片')
    await act(async () => {
      startButton!.props.onClick()
      await Promise.resolve()
    })

    expect(storeMocks.submitTaskWithData).toHaveBeenCalledWith(
      expect.objectContaining({ inputImages: [] }),
      { silentSuccess: true },
    )
  })

  it('submits a high-volume SOP batch without a confirmation popup', async () => {
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['高数量提示词'])
    storeMocks.submitTaskWithData.mockResolvedValue('task-1')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={1}
          initialImagesPerPrompt={20}
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const startButton = renderer!.root.findAllByType('button').find((button) => button.props['aria-label'] === '生成 20 张图片')
    await act(async () => {
      startButton!.props.onClick()
      await Promise.resolve()
    })

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(storeMocks.submitTaskWithData).toHaveBeenCalledOnce()
    confirmSpy.mockRestore()
  })
})
