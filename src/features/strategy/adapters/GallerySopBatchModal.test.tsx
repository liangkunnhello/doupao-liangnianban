/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
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
  sopLibrary: [
    { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。', source: 'manual', createdBy: 'user-1', createdAt: 1, updatedAt: 1 },
    { id: 'sop-2', name: '海报 SOP', description: '', content: '生成海报。', source: 'manual', createdBy: 'user-1', createdAt: 2, updatedAt: 2 },
  ],
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
  it('starts generating before consuming the one-shot auto-start request', async () => {
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['自动生成的提示词'])

    function AutoStartHost() {
      const [autoStart, setAutoStart] = useState(true)
      return (
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={1}
          autoStart={autoStart}
          onAutoStartConsumed={() => setAutoStart(false)}
          onClose={vi.fn()}
        />
      )
    }

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<AutoStartHost />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledOnce()
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('自动生成的提示词')
  })

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

  it('pauses before the next prompt batch and continues on demand', async () => {
    let releaseCurrentBatch!: () => void
    let secondBatchStarted = false
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, _quantity, _brief, options) => {
      await options.beforeBatch?.()
      await options.onBatch?.(['第一批提示词'], 1, 2)
      await new Promise<void>((resolve) => { releaseCurrentBatch = resolve })
      await options.beforeBatch?.()
      secondBatchStarted = true
      await options.onBatch?.(['第二批提示词'], 2, 2)
      return ['第一批提示词', '第二批提示词']
    })
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" initialPromptCount={2} autoStart onClose={vi.fn()} />)
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '暂停提示词生成' }).props.onClick()
      releaseCurrentBatch()
      await Promise.resolve()
    })

    expect(secondBatchStarted).toBe(false)
    expect(renderer!.root.findByProps({ 'aria-label': '继续提示词生成' })).toBeTruthy()
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('第一批提示词')

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '继续提示词生成' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(secondBatchStarted).toBe(true)
    expect(renderer!.root.findByProps({ 'aria-label': '第 2 条提示词' }).props.value).toBe('第二批提示词')
  })

  it('cancels the active prompt request and returns to an idle state', async () => {
    let requestSignal!: AbortSignal
    generateMocks.generatePromptsFromSopStore.mockImplementation((_sop, _quantity, _brief, options) => {
      requestSignal = options.signal
      return new Promise<string[]>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    })
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" autoStart onClose={vi.fn()} />)
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '取消提示词生成' }).props.onClick()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(requestSignal.aborted).toBe(true)
    expect(renderer!.root.findAllByProps({ 'aria-label': '取消提示词生成' })).toHaveLength(0)
    expect(renderer!.root.findAllByType('p').some((node) => String(node.children.join('')).includes('提示词生成已取消'))).toBe(true)
    expect(JSON.parse(window.localStorage.getItem(getGallerySopPromptRunStorageKey('tab-a')) ?? '{}')).toMatchObject({
      selectedSopId: 'sop-1',
      availablePrompts: 0,
    })
  })

  it('aborts the previous SOP request when a keyed workbench switches SOPs', async () => {
    let previousSignal!: AbortSignal
    generateMocks.generatePromptsFromSopStore.mockImplementation((_sop, _quantity, _brief, options) => {
      previousSignal = options.signal
      return new Promise<string[]>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    })
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<GallerySopBatchModal key="sop-1" workspaceTabId="tab-a" initialSopId="sop-1" autoStart onClose={vi.fn()} />)
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      renderer!.update(<GallerySopBatchModal key="sop-2" workspaceTabId="tab-a" initialSopId="sop-2" onClose={vi.fn()} />)
      await Promise.resolve()
    })

    expect(previousSignal.aborted).toBe(true)
    expect(renderer!.root.findAllByType('p').some((node) => String(node.children.join('')).includes('当前 SOP：海报 SOP'))).toBe(true)
    expect(renderer!.root.findAllByProps({ 'aria-label': '第 1 条提示词' })).toHaveLength(0)
  })

  it('persists the automatic image-generation switch per workspace tab', () => {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" onClose={vi.fn()} />)
    })
    mountedRenderers.push(renderer!)

    const toggle = renderer!.root.findAllByType('input').find((input) => input.props['aria-label'] === '每生成一条提示词立即发送生图')
    expect(toggle!.props.checked).toBe(false)
    act(() => toggle!.props.onChange({ target: { checked: true } }))

    expect(renderer!.root.findAllByType('input').find((input) => input.props['aria-label'] === '每生成一条提示词立即发送生图')!.props.checked).toBe(true)
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
      promptCount: 80,
      imagesPerPrompt: 1,
      prompts: [{ id: 'prompt-1', text: '历史提示词', origin: 'ai', edited: false, sourceId: 'text-to-image' }],
      params: { ...DEFAULT_PARAMS },
    }
    window.localStorage.setItem(getGallerySopPromptRunStorageKey('tab-a'), JSON.stringify({
      version: 3,
      activeRunId: storedRun.id,
      selectedSopId: 'sop-1',
      promptCount: 80,
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
    expect(renderer!.root.findAllByType('button').some(
      (button) => button.props['aria-label'] === '重新生成 80 条 SOP 提示词',
    )).toBe(true)
    expect(storeState.setParams).toHaveBeenCalledWith(storedRun.params)
    expect(generateMocks.generatePromptsFromSopStore).not.toHaveBeenCalled()
  })

  it('does not restore prompts or parameters saved by a different SOP', async () => {
    const previousRun: SopBatchSnapshot = {
      id: 'sop-run-previous',
      batchId: '',
      workspaceTabId: 'tab-a',
      createdAt: 10,
      status: 'ready',
      sop: { id: 'sop-1', name: '商品图 SOP', description: '', content: '生成商品图。' },
      brief: '旧 SOP 要求',
      referenceImageIds: [],
      promptCount: 80,
      imagesPerPrompt: 4,
      prompts: [{ id: 'prompt-old', text: '旧 SOP 提示词', origin: 'ai', edited: false }],
      params: { ...DEFAULT_PARAMS, n: 4 },
    }
    window.localStorage.setItem(getGallerySopPromptRunStorageKey('tab-a'), JSON.stringify({
      version: 4,
      activeRunId: previousRun.id,
      selectedSopId: 'sop-1',
      promptCount: 80,
      imagesPerPrompt: 4,
      availablePrompts: 1,
    }))
    dbMocks.getAllSopBatchSnapshots.mockResolvedValue([previousRun])
    dbMocks.getSopBatchSnapshot.mockResolvedValue(previousRun)
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-2" onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findAllByProps({ 'aria-label': '第 1 条提示词' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ 'aria-label': '生成 5 条 SOP 提示词' })).toBeTruthy()
    expect(storeState.setParams).not.toHaveBeenCalled()
  })

  it('generates and dispatches prompts sequentially, then resets for the next run', async () => {
    const events: string[] = []
    storeState.inputImages = [{ id: 'image-1', dataUrl: 'data:image/png;base64,one' }]
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, _quantity, _brief, options) => {
      events.push('generate-1')
      await options.onBatch?.(['第一条提示词'], 1, 2)
      events.push('generate-2')
      await options.onBatch?.(['第二条提示词'], 2, 2)
      return ['第一条提示词', '第二条提示词']
    })
    storeMocks.submitTaskWithData.mockImplementation(async ({ prompt }) => {
      events.push(`dispatch-${prompt}`)
      return prompt === '第一条提示词' ? 'task-1' : 'task-2'
    })
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" initialPromptCount={2} initialAutoGenerate initialSecondReference autoStart onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledOnce()
    expect(generateMocks.generatePromptsFromSopStore).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sop-1' }),
      2,
      '',
      expect.objectContaining({ maxBatchSize: 1, onBatch: expect.any(Function) }),
    )
    expect(events).toEqual([
      'generate-1',
      'dispatch-第一条提示词',
      'generate-2',
      'dispatch-第二条提示词',
    ])
    expect(storeMocks.submitTaskWithData).toHaveBeenCalledTimes(2)
    expect(storeMocks.submitTaskWithData.mock.calls[0][0].sopBatch).toMatchObject({ promptIndex: 1, promptCount: 2 })
    expect(storeMocks.submitTaskWithData.mock.calls[1][0].sopBatch).toMatchObject({ promptIndex: 2, promptCount: 2 })
    expect(storeMocks.submitTaskWithData.mock.calls[0][0].sopBatch.batchId)
      .toBe(storeMocks.submitTaskWithData.mock.calls[1][0].sopBatch.batchId)
    expect(renderer!.root.findAllByProps({ 'aria-label': '第 1 条提示词' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ 'aria-label': '生成 0 张图片' }).props.disabled).toBe(true)
    expect(renderer!.root.findAllByType('p').some((node) => String(node.children.join('')).includes('当前 SOP：商品图 SOP'))).toBe(true)
    expect(storeState.inputImages).toEqual([{ id: 'image-1', dataUrl: 'data:image/png;base64,one' }])
    expect(JSON.parse(window.localStorage.getItem(getGallerySopPromptRunStorageKey('tab-a')) ?? '{}')).toMatchObject({
      selectedSopId: 'sop-1',
      availablePrompts: 0,
    })
  })

  it('continues the progressive run when one image task fails to dispatch', async () => {
    generateMocks.generatePromptsFromSopStore.mockImplementation(async (_sop, _quantity, _brief, options) => {
      await options.onBatch?.(['会失败的提示词'], 1, 2)
      await options.onBatch?.(['会成功的提示词'], 2, 2)
      return ['会失败的提示词', '会成功的提示词']
    })
    storeMocks.submitTaskWithData
      .mockRejectedValueOnce(new Error('图片接口暂时不可用'))
      .mockResolvedValueOnce('task-2')
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<GallerySopBatchModal workspaceTabId="tab-a" initialSopId="sop-1" initialPromptCount={2} initialAutoGenerate autoStart onClose={vi.fn()} />)
      await Promise.resolve()
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    expect(storeMocks.submitTaskWithData).toHaveBeenCalledTimes(2)
    expect(renderer!.root.findByProps({ 'aria-label': '第 1 条提示词' }).props.value).toBe('会失败的提示词')
    expect(renderer!.root.findByProps({ 'aria-label': '第 2 条提示词' }).props.value).toBe('会成功的提示词')
    expect(renderer!.root.findAllByProps({ role: 'alert' }).some((node) =>
      String(node.children.join('')).includes('部分提示词未创建生图任务'))).toBe(true)
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
    const firstReferenceButton = renderer!.root.findByProps({ 'aria-label': '查看第 1 条提示词的参考图 1 大图' })
    expect(renderer!.root.findByProps({ 'aria-label': '查看第 1 条提示词的参考图 2 大图' })).toBeTruthy()

    act(() => firstReferenceButton.props.onClick())
    expect(renderer!.root.findByProps({ 'aria-labelledby': 'gallery-sop-reference-preview-title' })).toBeTruthy()
    expect(renderer!.root.findAllByProps({ alt: '图1' })).toHaveLength(2)

    act(() => renderer!.root.findByProps({ 'aria-label': '关闭参考图大图预览' }).props.onClick())
    expect(renderer!.root.findAllByProps({ 'aria-label': '关闭参考图大图预览' })).toHaveLength(0)

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
        prompts: [
          expect.objectContaining({ referenceImageIds: ['image-1', 'image-2'] }),
        ],
        params: expect.objectContaining({ n: 2, reference_mode: 'all' }),
      }),
    )
  })

  it('accepts more than sixteen shared references for SOP prompts and second-reference generation', async () => {
    storeState.inputImages = Array.from({ length: 17 }, (_, index) => ({
      id: `image-${index + 1}`,
      dataUrl: `data:image/png;base64,image-${index + 1}`,
    }))
    generateMocks.generatePromptsFromSopStore.mockResolvedValue(['多图共同参考提示词'])
    storeMocks.submitTaskWithData.mockResolvedValue('task-1')
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GallerySopBatchModal
          workspaceTabId="tab-a"
          initialSopId="sop-1"
          initialPromptCount={1}
          initialSecondReference
          autoStart
          onClose={vi.fn()}
        />,
      )
      await Promise.resolve()
    })
    mountedRenderers.push(renderer!)

    const generationOptions = generateMocks.generatePromptsFromSopStore.mock.calls[0][3]
    expect(generationOptions.referenceImages).toHaveLength(17)

    const startButton = renderer!.root.findAllByType('button').find((button) => button.props['aria-label'] === '生成 1 张图片')
    await act(async () => {
      startButton!.props.onClick()
      await Promise.resolve()
    })

    expect(storeMocks.submitTaskWithData.mock.calls[0][0].inputImages).toHaveLength(17)
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
