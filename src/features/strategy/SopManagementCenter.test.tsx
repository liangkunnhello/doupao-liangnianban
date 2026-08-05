/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import SopManagementCenter from './SopManagementCenter'
import type { GenerateSop } from './sopGeneration'
import type { SopLibraryItem, SopMetaInstruction } from './types'
import { DEFAULT_PARAMS, type TaskRecord } from '../../types'

const imageStoreMocks = vi.hoisted(() => ({
  ensureImageThumbnailCached: vi.fn().mockResolvedValue(undefined),
  subscribeImageThumbnail: vi.fn(() => () => {}),
  showToast: vi.fn(),
  useStore: vi.fn((selector: (state: unknown) => unknown) => selector({
    settings: {
      agentShareApiParameters: false,
      agentProfile: {
        id: 'agent-test',
        name: 'Agent 测试',
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
        model: 'gpt-agent-test',
        apiMode: 'responses',
      },
    },
    showToast: imageStoreMocks.showToast,
  })),
}))
const agentApiMocks = vi.hoisted(() => ({
  transformSopDocument: vi.fn(),
  reviseSopDocument: vi.fn(),
}))

vi.mock('../../store', () => imageStoreMocks)
vi.mock('../../lib/agentApi', () => agentApiMocks)

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.useRealTimers()
  window.localStorage.clear()
})

const item: SopLibraryItem = {
  id: 'sop-1',
  name: '商品图 SOP',
  description: '生成统一风格商品图',
  content: '保持构图一致并替换主体。',
  source: 'manual',
  createdBy: 'user-1',
  createdAt: 1,
  updatedAt: 1,
}

const item2: SopLibraryItem = {
  id: 'sop-2',
  name: '详情页 SOP',
  description: '生成详情页场景',
  content: '使用明亮背景并突出卖点。',
  source: 'manual',
  createdBy: 'user-1',
  createdAt: 2,
  updatedAt: 2,
}

const imagePromptMeta: SopMetaInstruction = {
  id: 'meta-image-prompt',
  name: '图片画风多变体 SOP 编译器',
  description: '根据多张参考图生成 SOP',
  instruction: '分析全部参考图片并输出结构化 SOP。',
  kind: 'image-prompt',
  createdAt: 1,
  updatedAt: 1,
}

const generalMeta: SopMetaInstruction = {
  ...imagePromptMeta,
  id: 'meta-general',
  name: '通用 SOP 编译器',
  kind: 'general',
}

function textContent(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textContent(child)).join('')
}

function findButton(root: ReactTestInstance, label: string) {
  return root.findAllByType('button').find((button) => textContent(button).includes(label))
}

function renderCenter(options: {
  selectedSopId?: string
  tasks?: TaskRecord[]
  items?: SopLibraryItem[]
  metaInstructions?: SopMetaInstruction[]
  onGenerateSop?: GenerateSop
  onTestSopRevision?: (item: SopLibraryItem) => Promise<void>
} = {}) {
  const onSaveItem = vi.fn()
  const onApply = vi.fn()
  const renderer = create(
    <SopManagementCenter
      groups={[]}
      items={options.items ?? [item]}
      tasks={options.tasks}
      metaInstructions={options.metaInstructions ?? []}
      currentUserId="user-1"
      onSaveGroup={vi.fn()}
      onDuplicateGroup={vi.fn(() => null)}
      onDeleteGroup={vi.fn()}
      onSaveItem={onSaveItem}
      onDuplicateItem={vi.fn(() => null)}
      onDeleteItem={vi.fn()}
      onSaveMetaInstruction={vi.fn()}
      onDuplicateMetaInstruction={vi.fn(() => null)}
      onDeleteMetaInstruction={vi.fn()}
      onGenerateSop={options.onGenerateSop ?? vi.fn()}
      onTestSopRevision={options.onTestSopRevision}
      selectedSopId={options.selectedSopId}
      onApply={onApply}
      onClear={vi.fn()}
      onClose={vi.fn()}
    />,
  )
  return { renderer, onApply, onSaveItem }
}

describe('SopManagementCenter apply and save actions', () => {
  it('toggles and persists the SOP management large modal mode', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter()
    })

    const defaultDialog = result.renderer.root.find((node) => String(node.props.className).includes('sop-center-dialog'))
    expect(defaultDialog.props.style).toBeUndefined()

    act(() => {
      result.renderer.root.findByProps({ 'aria-label': '进入 SOP 管理中心大弹窗模式' }).props.onClick()
    })
    expect(result.renderer.root.find((node) => String(node.props.className).includes('sop-center-dialog')).props.style).toMatchObject({
      width: '80vw',
      height: '80vh',
      maxWidth: 'none',
    })

    act(() => result.renderer.unmount())
    act(() => {
      result = renderCenter()
    })
    expect(result.renderer.root.findByProps({ 'aria-label': '退出 SOP 管理中心大弹窗模式' }).props['aria-pressed']).toBe(true)
    result.renderer.unmount()
  })

  it('applies an existing SOP directly without requiring an edit save', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter()
    })

    const applyButton = findButton(result.renderer.root, '应用 SOP')
    expect(applyButton?.props.disabled).toBe(false)
    expect(findButton(result.renderer.root, '保存修改')?.props.disabled).toBe(true)

    act(() => applyButton!.props.onClick())

    expect(result.onApply).toHaveBeenCalledWith(expect.objectContaining({ id: item.id, name: item.name }))
    expect(result.onSaveItem).toHaveBeenCalledWith(expect.objectContaining({ id: item.id, lastUsedAt: expect.any(Number) }))
    result.renderer.unmount()
  })

  it('separates unsaved edits from applying the persisted SOP', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter()
    })

    const nameInput = result.renderer.root.findAllByType('input').find((input) => input.props.value === item.name)
    act(() => nameInput!.props.onChange({ target: { value: '新版商品图 SOP' } }))

    expect(findButton(result.renderer.root, '应用 SOP')?.props.disabled).toBe(true)
    const saveButton = findButton(result.renderer.root, '保存修改')
    expect(saveButton?.props.disabled).toBe(false)

    act(() => saveButton!.props.onClick())

    expect(result.onSaveItem).toHaveBeenCalledWith(expect.objectContaining({ id: item.id, name: '新版商品图 SOP' }))
    expect(result.onApply).not.toHaveBeenCalled()
    result.renderer.unmount()
  })

  it('automatically saves valid SOP edits after the debounce delay', () => {
    vi.useFakeTimers()
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter()
    })

    const nameInput = result.renderer.root.findAllByType('input').find((input) => input.props.value === item.name)
    act(() => nameInput!.props.onChange({ target: { value: '自动保存商品图 SOP' } }))

    expect(result.onSaveItem).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(799) })
    expect(result.onSaveItem).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(1) })
    expect(result.onSaveItem).toHaveBeenCalledOnce()
    expect(result.onSaveItem).toHaveBeenCalledWith(expect.objectContaining({
      id: item.id,
      name: '自动保存商品图 SOP',
      updatedAt: expect.any(Number),
    }))
    expect(textContent(result.renderer.root)).toContain('修改已自动保存')
    result.renderer.unmount()
  })

  it('flushes a pending automatic save before switching SOPs', () => {
    vi.useFakeTimers()
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ items: [item, item2] })
    })

    const nameInput = result.renderer.root.findAllByType('input').find((input) => input.props.value === item.name)
    act(() => nameInput!.props.onChange({ target: { value: '切换前保存的 SOP' } }))
    act(() => result.renderer.root.findByProps({ title: item2.name }).props.onClick())

    expect(result.onSaveItem).toHaveBeenCalledOnce()
    expect(result.onSaveItem).toHaveBeenCalledWith(expect.objectContaining({
      id: item.id,
      name: '切换前保存的 SOP',
    }))
    expect(result.renderer.root.findByProps({ 'aria-label': 'SOP 正文' }).props.value).toBe(item2.content)

    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.onSaveItem).toHaveBeenCalledOnce()
    result.renderer.unmount()
  })

  it('shows the currently selected SOP as already applied', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ selectedSopId: item.id })
    })

    expect(findButton(result.renderer.root, '已使用')?.props.disabled).toBe(true)
    expect(findButton(result.renderer.root, '保存修改')?.props.disabled).toBe(true)
    result.renderer.unmount()
  })

  it('selects and shows the applied SOP in the editor when applying from the list row', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ items: [item, item2] })
    })

    const rowApplyButton = result.renderer.root.findByProps({ 'aria-label': `应用 ${item2.name}` })
    act(() => rowApplyButton.props.onClick())

    expect(result.onApply).toHaveBeenCalledWith(expect.objectContaining({ id: item2.id, name: item2.name }))
    expect(result.onSaveItem).toHaveBeenCalledWith(expect.objectContaining({ id: item2.id, lastUsedAt: expect.any(Number) }))
    expect(result.renderer.root.findAllByType('textarea').some((input) => input.props.value === item2.content)).toBe(true)
    result.renderer.unmount()
  })

  it('uses a compact list cover and opens cover selection by double-clicking it', () => {
    const generatedTask: TaskRecord = {
      id: 'task-1',
      prompt: '生成结果',
      params: { ...DEFAULT_PARAMS },
      inputImageIds: [],
      outputImages: ['image-1'],
      status: 'done',
      error: null,
      createdAt: 2,
      finishedAt: 3,
      elapsed: 1,
      sopBatch: { batchId: 'batch-1', sopId: item.id, sopName: item.name, promptIndex: 1, promptCount: 1 },
    }
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ tasks: [generatedTask] })
    })

    const coverButton = result.renderer.root.findByProps({ 'aria-label': `双击选择 ${item.name} 的封面` })
    const cover = coverButton.findAll((node) => String(node.props.className).includes('h-12 w-12'))[0]
    expect(cover.props.className).toContain('h-12')
    expect(cover.props.className).toContain('w-12')
    expect(result.renderer.root.findAllByProps({ 'aria-label': 'SOP 封面' })).toHaveLength(0)
    expect(result.renderer.root.findAll((node) => String(node.props.className).includes('sop-center-badge'))).toHaveLength(0)

    act(() => coverButton.props.onDoubleClick({ stopPropagation: vi.fn() }))
    expect(result.renderer.root.findByProps({ 'aria-labelledby': 'sop-cover-picker-title' })).toBeTruthy()
    const candidate = result.renderer.root.findByProps({ 'aria-label': '选择第 1 条提示词的第 1 张图片作为封面' })
    act(() => candidate.props.onClick())
    expect(result.renderer.root.findByProps({ 'data-sop-cover-image-id': 'image-1' })).toBeTruthy()

    const saveButton = findButton(result.renderer.root, '保存修改')
    expect(saveButton?.props.disabled).toBe(false)
    act(() => saveButton!.props.onClick())

    expect(result.onSaveItem).toHaveBeenCalledWith(expect.objectContaining({
      id: item.id,
      coverImageId: 'image-1',
    }))
    result.renderer.unmount()
  })

  it('renders SOP rows with parameters and omits the description editor', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter()
    })

    expect(result.renderer.root.findByProps({ role: 'listitem' }).props.className).toContain('sop-center-sop-row')
    expect(textContent(result.renderer.root.findByProps({ 'aria-label': 'SOP 参数' }))).toContain('未分组')
    const parameters = textContent(result.renderer.root.findByProps({ 'aria-label': 'SOP 参数' }))
    expect(parameters).not.toContain('手动创建')
    expect(parameters).not.toContain('历史预设')
    expect(result.renderer.root.findByProps({ 'aria-label': `${item.name} 操作` })).toBeTruthy()
    expect(result.renderer.root.findByProps({ 'aria-label': 'SOP 正文编辑器' })).toBeTruthy()
    expect(result.renderer.root.find((node) => String(node.props.className).includes('sop-center-editor-panel')).props.className).toContain('overflow-y-auto')
    expect(result.renderer.root.find((node) => String(node.props.className).includes('sop-center-editor-card')).props.className).toContain('flex-1')
    expect(result.renderer.root.findByProps({ 'aria-label': '正文格式与编辑工具' })).toBeTruthy()
    expect(result.renderer.root.findByProps({ 'aria-label': 'SOP 文档整理工具' })).toBeTruthy()
    expect(findButton(result.renderer.root, '自动分段')).toBeTruthy()
    expect(findButton(result.renderer.root, '结构化')).toBeTruthy()
    expect(findButton(result.renderer.root, 'AI 检查')).toBeTruthy()
    expect(findButton(result.renderer.root, '最小化')).toBeUndefined()
    expect(result.renderer.root.findAllByType('textarea')).toHaveLength(1)
    expect(result.renderer.root.findByType('textarea').props.value).toBe(item.content)
    expect(result.renderer.root.findAll((node) => node.children.includes(item.description))).toHaveLength(0)
    result.renderer.unmount()
  })

  it('provides working formatting, history, wrapping, and fullscreen editor controls', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter()
    })

    const headingButton = result.renderer.root.findByProps({ 'aria-label': '设为标题' })
    act(() => headingButton.props.onClick())
    expect(result.renderer.root.findByProps({ 'aria-label': 'SOP 正文' }).props.value).toBe(`# ${item.content}`)

    const undoButton = result.renderer.root.findByProps({ 'aria-label': '撤销' })
    expect(undoButton.props.disabled).toBe(false)
    act(() => undoButton.props.onClick())
    expect(result.renderer.root.findByProps({ 'aria-label': 'SOP 正文' }).props.value).toBe(item.content)

    const wrapButton = result.renderer.root.findByProps({ title: '自动换行' })
    expect(wrapButton.props['aria-pressed']).toBe(true)
    act(() => wrapButton.props.onClick())
    expect(result.renderer.root.findByProps({ title: '自动换行' }).props['aria-pressed']).toBe(false)

    const fullscreenButton = result.renderer.root.findByProps({ 'aria-label': '全屏编辑' })
    act(() => fullscreenButton.props.onClick())
    expect(result.renderer.root.findByProps({ 'aria-label': 'SOP 正文编辑器' }).props['data-expanded']).toBe(true)
    expect(result.renderer.root.findByProps({ 'aria-label': '退出全屏编辑' })).toBeTruthy()
    result.renderer.unmount()
  })

  it('previews Agent SOP restructuring before explicitly replacing the source', async () => {
    agentApiMocks.transformSopDocument.mockResolvedValueOnce('# 目标\n\n保持输出一致。')
    let result!: ReturnType<typeof renderCenter>
    await act(async () => {
      result = renderCenter()
    })

    await act(async () => {
      findButton(result.renderer.root, 'AI 结构化')!.props.onClick()
    })

    expect(agentApiMocks.transformSopDocument).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'structure',
      content: item.content,
      profile: expect.objectContaining({ model: 'gpt-agent-test' }),
    }))
    expect(result.renderer.root.findAll((node) => node.children.includes('# 目标\n\n保持输出一致。'))).not.toHaveLength(0)
    expect(result.renderer.root.findByProps({ 'aria-label': 'SOP 正文' }).props.value).toBe(item.content)

    act(() => findButton(result.renderer.root, '替换正文')!.props.onClick())
    expect(result.renderer.root.findByProps({ 'aria-label': 'SOP 正文' }).props.value).toBe('# 目标\n\n保持输出一致。')
    result.renderer.unmount()
  })

  it('keeps a persistent SOP revision conversation with apply and test-image actions', async () => {
    const onTestSopRevision = vi.fn().mockResolvedValue(undefined)
    agentApiMocks.reviseSopDocument.mockResolvedValueOnce({
      reply: '已补充验收标准并压缩重复说明。',
      content: '# 修订 SOP\n\n1. 执行\n2. 验收',
      changeSummary: ['补充验收标准', '压缩重复说明'],
    })
    let result!: ReturnType<typeof renderCenter>
    await act(async () => {
      result = renderCenter({ onTestSopRevision })
    })

    act(() => findButton(result.renderer.root, 'AI 对话')!.props.onClick())
    const chatInput = result.renderer.root.findByProps({ 'aria-label': '向 AI 描述 SOP 修改要求' })
    act(() => chatInput.props.onChange({ target: { value: '补充可验证的验收标准' } }))
    await act(async () => {
      result.renderer.root.findByProps({ 'aria-label': '发送 SOP 修改要求' }).props.onClick()
    })

    expect(agentApiMocks.reviseSopDocument).toHaveBeenCalledWith(expect.objectContaining({
      content: item.content,
      conversation: [expect.objectContaining({ role: 'user', text: '补充可验证的验收标准' })],
    }))
    expect(textContent(result.renderer.root)).toContain('已补充验收标准并压缩重复说明。')
    expect(textContent(result.renderer.root)).toContain('补充验收标准')

    await act(async () => findButton(result.renderer.root, '测试生图')!.props.onClick())
    expect(onTestSopRevision).toHaveBeenCalledWith(expect.objectContaining({
      id: item.id,
      content: '# 修订 SOP\n\n1. 执行\n2. 验收',
    }))

    act(() => findButton(result.renderer.root, '应用到正文')!.props.onClick())
    expect(result.renderer.root.findByProps({ 'aria-label': 'SOP 正文' }).props.value).toBe('# 修订 SOP\n\n1. 执行\n2. 验收')

    act(() => result.renderer.unmount())
    act(() => {
      result = renderCenter({ onTestSopRevision })
    })
    act(() => findButton(result.renderer.root, 'AI 对话')!.props.onClick())
    expect(textContent(result.renderer.root)).toContain('已补充验收标准并压缩重复说明。')
    result.renderer.unmount()
  })

  it('accepts multiple dropped reference images inside an isolated drop zone', async () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ metaInstructions: [imagePromptMeta] })
    })
    act(() => findButton(result.renderer.root, '智能生成')!.props.onClick())

    const dropZone = result.renderer.root.findByProps({ 'data-sop-reference-dropzone': true })
    const preventDefault = vi.fn()
    const stopPropagation = vi.fn()
    await act(async () => {
      await dropZone.props.onDrop({
        preventDefault,
        stopPropagation,
        dataTransfer: {
          types: ['Files'],
          files: [
            new File(['a'], '参考图 A.png', { type: 'image/png' }),
            new File(['b'], '参考图 B.jpg', { type: 'image/jpeg' }),
          ],
        },
      })
    })

    expect(preventDefault).toHaveBeenCalled()
    expect(stopPropagation).toHaveBeenCalled()
    expect(result.renderer.root.findAllByType('img')).toHaveLength(2)
    expect(textContent(result.renderer.root)).toContain('已添加 2 张参考图片')
    expect(result.renderer.root.findByProps({ 'data-block-global-image-input': 'true' })).toBeTruthy()
    result.renderer.unmount()
  })

  it('shows actual generation phases and keeps the success state visible', async () => {
    const onGenerateSop: GenerateSop = vi.fn(async (_brief, _context, _images, _kind, _instruction, options) => {
      options?.onProgress?.({ stage: 'prepare', message: '正在整理 2 张参考图片' })
      options?.onProgress?.({ stage: 'request', message: 'AI 正在分析参考图片并编译 SOP' })
      options?.onProgress?.({ stage: 'parse', message: '正在校验生成结果' })
      return { name: '多图商品 SOP', description: '多图说明', sop: '# SOP 正文' }
    })
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ metaInstructions: [generalMeta], onGenerateSop })
    })
    act(() => findButton(result.renderer.root, '智能生成')!.props.onClick())

    const brief = result.renderer.root.findByProps({ 'aria-label': 'SOP 生成说明' })
    act(() => brief.props.onChange({ target: { value: '生成商品摄影 SOP' } }))
    await act(async () => {
      await findButton(result.renderer.root, '开始生成并保存')!.props.onClick()
    })

    expect(onGenerateSop).toHaveBeenCalledWith(
      '生成商品摄影 SOP',
      {},
      [],
      'general',
      generalMeta.instruction,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    )
    expect(result.onSaveItem).toHaveBeenCalledWith(expect.objectContaining({ name: '多图商品 SOP' }))
    expect(textContent(result.renderer.root)).toContain('校验生成条件')
    expect(textContent(result.renderer.root)).toContain('调用 AI 编译 SOP')
    expect(textContent(result.renderer.root)).toContain('SOP「多图商品 SOP」生成并保存成功')
    expect(findButton(result.renderer.root, '查看生成结果')).toBeTruthy()
    result.renderer.unmount()
  })
})
