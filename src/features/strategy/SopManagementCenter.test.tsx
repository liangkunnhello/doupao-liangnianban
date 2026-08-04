/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import SopManagementCenter from './SopManagementCenter'
import type { SopLibraryItem } from './types'
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

function textContent(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textContent(child)).join('')
}

function findButton(root: ReactTestInstance, label: string) {
  return root.findAllByType('button').find((button) => textContent(button).includes(label))
}

function renderCenter(options: { selectedSopId?: string; tasks?: TaskRecord[]; items?: SopLibraryItem[] } = {}) {
  const onSaveItem = vi.fn()
  const onApply = vi.fn()
  const renderer = create(
    <SopManagementCenter
      groups={[]}
      items={options.items ?? [item]}
      tasks={options.tasks}
      metaInstructions={[]}
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
      onGenerateSop={vi.fn()}
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
})
