/* @vitest-environment jsdom */

import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import GalleryImageTile, { type GalleryImageItem } from './GalleryImageTile'

const storeMocks = vi.hoisted(() => ({
  ensureImageCached: vi.fn(() => new Promise<string | undefined>(() => {})),
  ensureImageThumbnailCached: vi.fn(() => new Promise(() => {})),
  subscribeImageThumbnail: vi.fn(() => () => {}),
}))

vi.mock('../store', () => storeMocks)

const task: TaskRecord = {
  id: 'task-1',
  prompt: 'prompt',
  params: { ...DEFAULT_PARAMS },
  inputImageIds: [],
  outputImages: ['image-1', 'image-2'],
  status: 'done',
  error: null,
  createdAt: 1,
  finishedAt: 2,
  elapsed: 1,
}

const item: GalleryImageItem = {
  id: 'task-1:image-2:1',
  imageId: 'image-2',
  imageIndex: 1,
  task,
}

describe('GalleryImageTile interactions', () => {
  it('selects its task and opens the exact image detail by mouse or keyboard', () => {
    const onSelect = vi.fn()
    const onOpenDetail = vi.fn()
    let renderer!: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <GalleryImageTile item={item} selected={false} onSelect={onSelect} onOpenDetail={onOpenDetail} />,
      )
    })

    const tile = renderer.root.findByType('article')
    act(() => tile.props.onClick({ ctrlKey: true, metaKey: false }))
    expect(onSelect).toHaveBeenCalledWith(true)

    const preventDefault = vi.fn()
    act(() => tile.props.onDoubleClick({ preventDefault }))
    expect(preventDefault).toHaveBeenCalled()
    expect(onOpenDetail).toHaveBeenCalledTimes(1)

    act(() => tile.props.onKeyDown({ key: 'Enter', preventDefault }))
    expect(onOpenDetail).toHaveBeenCalledTimes(2)
    expect(tile.props['aria-label']).toContain('单击选择所属任务')
  })

  it('uses the original image source for a sharp tile preview', async () => {
    storeMocks.ensureImageCached.mockResolvedValueOnce('data:image/png;base64,full-resolution')
    let renderer!: ReturnType<typeof create>

    await act(async () => {
      renderer = create(
        <GalleryImageTile item={item} selected={false} onSelect={vi.fn()} onOpenDetail={vi.fn()} />,
      )
    })

    const image = renderer.root.findByType('img')
    expect(image.props.src).toBe('data:image/png;base64,full-resolution')
    expect(image.props['data-image-quality']).toBe('full')
  })
})
