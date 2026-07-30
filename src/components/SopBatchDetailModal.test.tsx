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
  showToast: vi.fn(),
  useStore: (selector: (state: {
    lightboxImageId: string | null
    showToast: (message: string, tone: string) => void
    workspaceTabs: Array<{ id: string; name: string; tasks: TaskRecord[] }>
  }) => unknown) => selector({
    lightboxImageId: null,
    showToast: storeMocks.showToast,
    workspaceTabs: [],
  }),
}))
const localSaveMocks = vi.hoisted(() => ({
  getExplicitImageSaveDirectory: vi.fn(),
  getLocalImageSaveDirectory: vi.fn(),
  isElectron: vi.fn(() => true),
  joinPath: vi.fn(async (...parts: string[]) => parts.join('\\')),
  openInExplorer: vi.fn(),
}))

vi.mock('../store', () => storeMocks)
vi.mock('../lib/db', () => ({ getSopBatchSnapshot: vi.fn() }))
vi.mock('../lib/localSave', () => localSaveMocks)

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

afterEach(() => {
  while (mountedRenderers.length) mountedRenderers.pop()?.unmount()
  window.localStorage.clear()
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
  it('keeps modal size and image view size as independent controls', async () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValue(undefined)
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<SopBatchDetailModal sopName="天体图" tasks={[createTask()]} onClose={vi.fn()} onOpenImage={vi.fn()} />)
    })
    mountedRenderers.push(renderer!)

    const toolbar = renderer!.root.findByProps({ 'aria-label': 'SOP 批量任务视图控制' })
    const slider = renderer!.root.findByProps({ 'aria-label': '调整 SOP 批量任务图片视图大小' })
    expect(toolbar.props.className).not.toContain('hidden')
    expect(slider.props.value).toBe(240)
    expect(renderer!.root.findByProps({ role: 'dialog' }).props.style).toMatchObject({
      height: 'min(86vh, 820px)',
      maxWidth: '1024px',
    })
    expect(renderer!.root.findByProps({ 'data-testid': 'sop-batch-results-grid' }).props.style.gridTemplateColumns).toContain('240px')

    act(() => slider.props.onChange({ target: { value: '320' } }))
    expect(renderer!.root.findByProps({ 'aria-label': '调整 SOP 批量任务图片视图大小' }).props.value).toBe(320)
    expect(renderer!.root.findByProps({ 'data-testid': 'sop-batch-results-grid' }).props.style.gridTemplateColumns).toContain('320px')
    expect(renderer!.root.findByProps({ role: 'dialog' }).props.style).toMatchObject({ maxWidth: '1024px' })

    act(() => renderer!.root.findByProps({ 'aria-label': '进入 SOP 批量任务大弹窗模式' }).props.onClick())
    expect(renderer!.root.findByProps({ 'aria-label': '退出 SOP 批量任务大弹窗模式' }).props['aria-pressed']).toBe(true)
    expect(renderer!.root.findByProps({ role: 'dialog' }).props.style).toMatchObject({
      width: '80vw',
      height: '80vh',
      maxWidth: 'none',
    })
    expect(renderer!.root.findByProps({ 'aria-label': '调整 SOP 批量任务图片视图大小' }).props.value).toBe(320)

    act(() => renderer!.unmount())
    await act(async () => {
      renderer = create(<SopBatchDetailModal sopName="天体图" tasks={[createTask()]} onClose={vi.fn()} onOpenImage={vi.fn()} />)
    })
    mountedRenderers.push(renderer!)
    expect(renderer!.root.findByProps({ 'aria-label': '退出 SOP 批量任务大弹窗模式' }).props['aria-pressed']).toBe(true)
    expect(renderer!.root.findByProps({ role: 'dialog' }).props.style).toMatchObject({ width: '80vw', height: '80vh' })
    expect(renderer!.root.findByProps({ 'aria-label': '调整 SOP 批量任务图片视图大小' }).props.value).toBe(320)

    act(() => renderer!.root.findByProps({ 'aria-label': '退出 SOP 批量任务大弹窗模式' }).props.onClick())
    act(() => renderer!.unmount())
    await act(async () => {
      renderer = create(<SopBatchDetailModal sopName="天体图" tasks={[createTask()]} onClose={vi.fn()} onOpenImage={vi.fn()} />)
    })
    mountedRenderers.push(renderer!)
    expect(renderer!.root.findByProps({ 'aria-label': '进入 SOP 批量任务大弹窗模式' }).props['aria-pressed']).toBe(false)
    expect(renderer!.root.findByProps({ role: 'dialog' }).props.style).toMatchObject({ maxWidth: '1024px' })
    expect(renderer!.root.findByProps({ 'aria-label': '调整 SOP 批量任务图片视图大小' }).props.value).toBe(320)
  })

  it('shows the full image on mouse hover, follows the pointer, and closes on leave', async () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValue({
      dataUrl: 'data:image/webp;base64,thumbnail',
      width: 1536,
      height: 1024,
    })
    storeMocks.ensureImageCached.mockResolvedValue('data:image/png;base64,full-image')

    const onOpenImage = vi.fn()
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<SopBatchDetailModal sopName="天体图" tasks={[createTask()]} onClose={vi.fn()} onOpenImage={onOpenImage} />)
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

    act(() => {
      imageButton!.props.onPointerMove({ pointerType: 'mouse', clientX: 900, clientY: 700 })
    })
    floatingPreview = renderer!.root.findByType(HoverImagePreview)
    expect(floatingPreview.props.preview.src).toBe('data:image/png;base64,full-image')
    expect(floatingPreview.props.preview.left).toBeLessThan(900)

    act(() => imageButton!.props.onClick())
    expect(onOpenImage).toHaveBeenCalledWith('image-1')
    expect(renderer!.root.findAllByProps({ 'aria-label': '任务参数' })).toHaveLength(1)

    const regenerateButton = renderer!.root.findByProps({ 'aria-label': '再次生成第 1 条提示词' })
    act(() => regenerateButton.props.onClick())
    expect(storeMocks.retryTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'sop-task-1' }))

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
      renderer = create(<SopBatchDetailModal sopName="天体图" tasks={[createTask()]} onClose={vi.fn()} onOpenImage={vi.fn()} />)
    })
    mountedRenderers.push(renderer!)
    const imageButton = renderer!.root.findAllByType('button').find((node) => node.props['aria-label'] === '查看第 1 条提示词的第 1 张图片')

    act(() => imageButton!.props.onPointerEnter({ pointerType: 'touch', clientX: 120, clientY: 150 }))

    expect(renderer!.root.findAllByType(HoverImagePreview)).toHaveLength(0)
    expect(storeMocks.ensureImageCached).not.toHaveBeenCalled()
  })

  it('opens the saved batch image in Explorer from the detail toolbar', async () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValue(undefined)
    const savedTask = {
      ...createTask(),
      localSavedOutputImagePaths: { '0:image-1': 'D:\\outputs\\image-1.png' },
    }
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<SopBatchDetailModal sopName="天体图" tasks={[savedTask]} onClose={vi.fn()} onOpenImage={vi.fn()} />)
    })
    mountedRenderers.push(renderer!)

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': '打开 SOP 批量任务图片目录' }).props.onClick()
      await Promise.resolve()
    })

    expect(localSaveMocks.openInExplorer).toHaveBeenCalledWith('D:\\outputs\\image-1.png')
  })

  it('keeps proportional result images in the adjustable grid across both view modes', async () => {
    storeMocks.ensureImageThumbnailCached.mockResolvedValue({
      dataUrl: 'data:image/webp;base64,thumbnail',
      width: 1024,
      height: 1024,
    })
    let renderer: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<SopBatchDetailModal sopName="天体图" tasks={[createTask(['image-1', 'image-2'])]} onClose={vi.fn()} onOpenImage={vi.fn()} />)
    })
    mountedRenderers.push(renderer!)

    expect(renderer!.root.findAllByType('button').filter((button) => String(button.props['aria-label']).includes('第 1 条提示词的第'))).toHaveLength(2)
    const groupedGrid = renderer!.root.findByProps({ 'data-testid': 'sop-batch-results-grid' })
    expect(groupedGrid.props.style.gridTemplateColumns).toContain('240px')
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
    const allResultsGrid = renderer!.root.findByProps({ 'data-testid': 'sop-batch-results-grid' })
    expect(allResultsGrid.props.style.gridTemplateColumns).toContain('240px')
  })
})
