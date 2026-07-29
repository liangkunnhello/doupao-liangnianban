/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create } from 'react-test-renderer'
import type { TaskRecord } from '../types'
import SopBatchTaskCard from './SopBatchTaskCard'

const storeMocks = vi.hoisted(() => ({
  ensureImageThumbnailCached: vi.fn(),
  subscribeImageThumbnail: vi.fn(() => () => {}),
}))

vi.mock('../store', () => storeMocks)

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

afterEach(() => {
  while (mountedRenderers.length) mountedRenderers.pop()?.unmount()
  vi.clearAllMocks()
})

function task(id: string, index: number): TaskRecord {
  return {
    id,
    prompt: `提示词 ${index}`,
    sopBatch: { batchId: 'batch-1', sopId: 'sop-1', sopName: '天体图', promptIndex: index, promptCount: 2 },
    outputImages: [],
    status: 'done',
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
  } as unknown as TaskRecord
}

describe('SopBatchTaskCard', () => {
  it('uses batch-level selection, gallery opening, and deletion callbacks', () => {
    const onClick = vi.fn()
    const onOpenBatch = vi.fn()
    const onDelete = vi.fn()
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(<SopBatchTaskCard sopName="天体图" tasks={[task('task-1', 1), task('task-2', 2)]} summary={{ total: 2, running: 0, completed: 2, failed: 0 }} isSelected onClick={onClick} onOpenBatch={onOpenBatch} onDelete={onDelete} />)
    })
    mountedRenderers.push(renderer!)

    const card = renderer!.root.findAllByProps({ 'data-selected': true }).find((node) => String(node.props.className).includes('gallery-sop-card'))
    expect(card?.props.className).toContain('gallery-task-card')
    act(() => card!.props.onClick({}))
    expect(onClick).toHaveBeenCalledOnce()

    const thumbnail = renderer!.root.findAllByType('button').find((button) => button.props['aria-label'] === '查看第 1 条 SOP 提示词的图片')
    act(() => thumbnail!.props.onClick({ stopPropagation: vi.fn() }))
    expect(onOpenBatch).toHaveBeenCalledOnce()

    const deleteButton = renderer!.root.findAllByType('button').find((button) => button.props['aria-label'] === '删除 SOP 批量任务 天体图')
    act(() => deleteButton!.props.onClick({ stopPropagation: vi.fn() }))
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
