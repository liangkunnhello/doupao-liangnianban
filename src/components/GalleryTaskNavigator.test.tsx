/* @vitest-environment jsdom */

import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import GalleryTaskNavigator, { getGalleryTaskOverview } from './GalleryTaskNavigator'

const storeMocks = vi.hoisted(() => ({
  ensureImageThumbnailCached: vi.fn(),
  subscribeImageThumbnail: vi.fn(() => () => {}),
}))

vi.mock('../store', () => storeMocks)

function task(id: string, status: TaskRecord['status'], outputImages: string[]): TaskRecord {
  return {
    id,
    prompt: `任务 ${id}`,
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    outputImages,
    status,
    error: status === 'error' ? 'failed' : null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
  }
}

describe('GalleryTaskNavigator', () => {
  beforeEach(() => {
    storeMocks.ensureImageThumbnailCached.mockImplementation(async (imageId: string) => ({
      dataUrl: `data:image/png;base64,${imageId}`,
      width: imageId === 'wide' ? 1600 : 800,
      height: imageId === 'wide' ? 800 : 1200,
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('lists only tasks with images and navigates to the selected task', () => {
    const onNavigate = vi.fn()
    let renderer!: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <GalleryTaskNavigator
          tasks={[task('done', 'done', ['a', 'b']), task('empty', 'running', [])]}
          activeTaskId="done"
          onNavigate={onNavigate}
        />,
      )
    })

    const navigationButton = renderer.root.findByProps({ 'aria-current': 'location' })
    expect(navigationButton.props['aria-label']).toContain('定位到任务')
    act(() => navigationButton.props.onClick())
    expect(onNavigate).toHaveBeenCalledWith('done')
  })

  it('renders only the initial virtual window for a long task list', () => {
    let renderer!: ReturnType<typeof create>
    const tasks = Array.from({ length: 50 }, (_, index) => task(`task-${index}`, 'done', [`image-${index}`]))

    act(() => {
      renderer = create(<GalleryTaskNavigator tasks={tasks} activeTaskId={null} onNavigate={vi.fn()} />)
    })

    expect(renderer.root.findAll((node) => node.type === 'button' && node.props['aria-label']?.startsWith('定位到任务'))).toHaveLength(5)
  })

  it('keeps the original image ratio and switches previews only through arrow buttons', async () => {
    let renderer!: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GalleryTaskNavigator
          tasks={[task('carousel', 'done', ['wide', 'portrait', 'third'])]}
          activeTaskId={null}
          onNavigate={vi.fn()}
        />,
      )
      await Promise.resolve()
    })

    const button = renderer.root.find((node) => node.type === 'button' && node.props['aria-label']?.startsWith('定位到任务'))
    expect(button.props.title).toBeUndefined()
    let front = renderer.root.findByProps({ 'data-carousel-layer': 'front' })
    expect(front.props.style.aspectRatio).toBe('2')
    expect(front.findByType('img').props.src).toContain('wide')

    const nextButton = renderer.root.find((node) => node.type === 'button' && node.props['aria-label']?.startsWith('下一张'))
    const previousButton = renderer.root.find((node) => node.type === 'button' && node.props['aria-label']?.startsWith('上一张'))
    act(() => nextButton.props.onClick())

    front = renderer.root.findByProps({ 'data-carousel-layer': 'front' })
    expect(front.props.style.aspectRatio).toBe(String(2 / 3))
    expect(front.findByType('img').props.src).toContain('portrait')

    act(() => previousButton.props.onClick())
    expect(renderer.root.findByProps({ 'data-carousel-layer': 'front' }).findByType('img').props.src).toContain('wide')

    act(() => previousButton.props.onClick())
    expect(renderer.root.findByProps({ 'data-carousel-layer': 'front' }).findByType('img').props.src).toContain('third')
  })

  it('summarizes stages across current and legacy task records', () => {
    const running = task('running', 'running', ['done-image'])
    running.params.n = 4
    running.sopBatch = { batchId: 'batch-a', sopId: 'sop', sopName: 'SOP', promptIndex: 0, promptCount: 2 }
    running.generationSlots = [
      { index: 0, status: 'done', attempts: 1 },
      { index: 1, status: 'running', attempts: 1 },
      { index: 2, status: 'submitted', attempts: 1 },
      { index: 3, status: 'pending', attempts: 0 },
    ]
    running.remoteGenerationRequests = [{
      id: 'request',
      provider: 'fal',
      slotIndexes: [1, 2],
      requestedCount: 2,
      attempt: 0,
      status: 'running',
      createdAt: 1,
      updatedAt: 1,
    }]
    const failed = task('failed', 'error', [])
    failed.params.n = 2
    failed.sopBatch = { batchId: 'batch-a', sopId: 'sop', sopName: 'SOP', promptIndex: 1, promptCount: 2 }

    expect(getGalleryTaskOverview([running, failed])).toEqual({
      batchCount: 1,
      taskCount: 2,
      total: 6,
      completed: 1,
      failed: 2,
      processing: 2,
      concurrent: 1,
      queued: 1,
    })
  })

  it('shows reference images, compact parameters, and working stage and log views', async () => {
    const item = task('with-reference', 'done', ['output'])
    item.inputImageIds = ['reference-a', 'reference-b']
    item.params = { ...item.params, size: '1536x1024', quality: 'high', n: 2 }
    let renderer!: ReturnType<typeof create>

    await act(async () => {
      renderer = create(<GalleryTaskNavigator tasks={[item]} activeTaskId={null} onNavigate={vi.fn()} />)
      await Promise.resolve()
    })

    expect(renderer.root.findAll((node) => node.type === 'img' && node.props.alt?.startsWith('参考图'))).toHaveLength(2)
    const navigationButton = renderer.root.find((node) => node.type === 'button' && node.props['aria-label']?.startsWith('定位到任务'))
    expect(navigationButton.props['aria-label']).toContain('1536×1024 · 高 · 2 张')
    expect(renderer.root.findByProps({ 'data-overview-view': 'stage' })).toBeTruthy()

    const logsTab = renderer.root.find((node) => node.type === 'button' && node.props.role === 'radio' && node.props.children === '日志')
    act(() => logsTab.props.onClick())
    expect(renderer.root.findByProps({ 'data-overview-view': 'logs' })).toBeTruthy()
  })
})
