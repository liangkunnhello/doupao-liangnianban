/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create } from 'react-test-renderer'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import HoverImagePreview from './HoverImagePreview'
import SopBatchDetailModal from './SopBatchDetailModal'

const storeMocks = vi.hoisted(() => ({
  ensureImageCached: vi.fn(),
  ensureImageThumbnailCached: vi.fn(),
  subscribeImageThumbnail: vi.fn(() => () => {}),
  retryTask: vi.fn(),
  rerunSopBatchTasks: vi.fn(),
}))

vi.mock('../store', () => storeMocks)
vi.mock('../lib/db', () => ({ getSopBatchSnapshot: vi.fn() }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

afterEach(() => {
  while (mountedRenderers.length) mountedRenderers.pop()?.unmount()
  vi.clearAllMocks()
})

function createTask(outputImages = ['image-1']): TaskRecord {
  return {
    id: 'sop-task-1',
    prompt: '测试 SOP 提示词',
    sopBatch: { batchId: 'batch-1', sopId: 'sop-1', sopName: '天体图', promptIndex: 1, promptCount: 1 },
    params: { ...DEFAULT_PARAMS, n: outputImages.length },
    inputImageIds: [],
    outputImages,
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
  }
}

describe('SopBatchDetailModal hover preview', () => {
  it('shows the full image on mouse hover, follows the pointer, and closes on leave', async () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValue({
      dataUrl: 'data:image/webp;base64,thumbnail',
      width: 1536,
      height: 1024,
    })
    storeMocks.ensureImageCached.mockResolvedValue('data:image/png;base64,full-image')

    const onOpenTask = vi.fn()
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<SopBatchDetailModal sopName="天体图" tasks={[createTask()]} onClose={vi.fn()} onOpenTask={onOpenTask} />)
    })
    mountedRenderers.push(renderer!)
    const imageButton = renderer!.root.findAllByType('button').find((node) => node.props['aria-label'] === '查看第 1 条提示词的第 1 张图片')
    expect(imageButton).toBeDefined()

    await act(async () => {
      imageButton!.props.onPointerEnter({ pointerType: 'mouse', clientX: 120, clientY: 150 })
      await Promise.resolve()
    })

    let floatingPreview = renderer!.root.findByType(HoverImagePreview)
    expect(floatingPreview.props.preview.src).toBe('data:image/png;base64,full-image')
    expect(floatingPreview.props.sizeText).toBe('1536 × 1024')
    expect(floatingPreview.props.zIndex).toBe(90)
    expect(storeMocks.ensureImageCached).toHaveBeenCalledWith('image-1')
    expect(imageButton!.props.style.aspectRatio).toBe('1536 / 1024')
    expect(renderer!.root.findAllByType('img').find((image) => image.props.alt.includes('生成结果'))!.props.className).toContain('object-cover')

    act(() => imageButton!.props.onClick())
    expect(onOpenTask).toHaveBeenCalledWith('sop-task-1')

    act(() => {
      imageButton!.props.onPointerMove({ pointerType: 'mouse', clientX: 900, clientY: 700 })
    })
    floatingPreview = renderer!.root.findByType(HoverImagePreview)
    expect(floatingPreview.props.preview.src).toBe('data:image/png;base64,full-image')
    expect(floatingPreview.props.preview.left).toBeLessThan(900)

    act(() => imageButton!.props.onPointerLeave())
    expect(renderer!.root.findAllByType(HoverImagePreview)).toHaveLength(0)
  })

  it('does not open a hover-only preview for touch pointers', async () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValue({
      dataUrl: 'data:image/webp;base64,thumbnail',
      width: 1024,
      height: 1024,
    })

    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<SopBatchDetailModal sopName="天体图" tasks={[createTask()]} onClose={vi.fn()} onOpenTask={vi.fn()} />)
    })
    mountedRenderers.push(renderer!)
    const imageButton = renderer!.root.findAllByType('button').find((node) => node.props['aria-label'] === '查看第 1 条提示词的第 1 张图片')

    act(() => imageButton!.props.onPointerEnter({ pointerType: 'touch', clientX: 120, clientY: 150 }))

    expect(renderer!.root.findAllByType(HoverImagePreview)).toHaveLength(0)
    expect(storeMocks.ensureImageCached).not.toHaveBeenCalled()
  })

  it('groups multiple variants in proportional four-column result cards', async () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValue({
      dataUrl: 'data:image/webp;base64,thumbnail',
      width: 1024,
      height: 1024,
    })
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<SopBatchDetailModal sopName="天体图" tasks={[createTask(['image-1', 'image-2'])]} onClose={vi.fn()} onOpenTask={vi.fn()} />)
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findAllByType('button').filter((button) => String(button.props['aria-label']).includes('第 1 条提示词的第'))).toHaveLength(2)
    const groupedGrid = renderer!.root.findAllByType('div').find((node) => String(node.props.className).includes('grid-cols-4'))
    expect(groupedGrid).toBeDefined()
    const groupedResultButtons = renderer!.root.findAllByType('button').filter((button) => String(button.props['aria-label']).includes('第 1 条提示词的第'))
    expect(groupedResultButtons[0].props.style.aspectRatio).toBe('1024 / 1024')

    const allViewButton = renderer!.root.findAllByType('button').find((button) => button.props.children?.some?.((child: unknown) => child === '全部预览'))
    await act(async () => {
      allViewButton!.props.onClick()
      await Promise.resolve()
    })

    const resultButtons = renderer!.root.findAllByType('button').filter((button) => String(button.props['aria-label']).includes('第 1 条提示词的第'))
    expect(resultButtons).toHaveLength(2)
    expect(resultButtons[0].props.style.aspectRatio).toBe('1024 / 1024')
    const allResultsGrid = renderer!.root.findAllByType('div').find((node) => String(node.props.className).includes('grid-cols-4'))
    expect(allResultsGrid).toBeDefined()
  })
})
