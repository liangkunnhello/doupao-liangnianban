import { describe, expect, it } from 'vitest'
import type { TaskRecord, WorkspaceTab } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { getGeneratedImageDownloadEntries } from './downloadImages'

function task(overrides: Partial<TaskRecord> & Pick<TaskRecord, 'id' | 'prompt' | 'createdAt' | 'outputImages'>): TaskRecord {
  return {
    params: { ...DEFAULT_PARAMS, n: overrides.outputImages.length },
    inputImageIds: [],
    status: 'done',
    error: null,
    finishedAt: overrides.createdAt,
    elapsed: 1,
    ...overrides,
  }
}

function tab(id: string, name: string, tasks: TaskRecord[]): WorkspaceTab {
  return {
    id,
    name,
    groupId: null,
    prompt: '',
    inputImages: [],
    inputImageFolder: null,
    params: { ...DEFAULT_PARAMS },
    maskDraft: null,
    maskEditorImageId: null,
    customOutputPath: '',
    tasks,
    createdAt: 0,
    updatedAt: 0,
    order: 0,
  }
}

describe('generated image download entries', () => {
  const settings = {
    imageFilenameDatePrefix: true,
    imageFilenameUsePrompt: true,
  }

  it('uses each task date, tab, prompt, and task-relative sequence', () => {
    const taskA = task({
      id: 'a',
      prompt: 'A prompt',
      createdAt: new Date(2026, 6, 3, 8).getTime(),
      outputImages: ['a-1', 'a-2'],
    })
    const taskB = task({
      id: 'b',
      prompt: 'B prompt',
      createdAt: new Date(2026, 6, 2, 8).getTime(),
      outputImages: ['b-1'],
    })

    const entries = getGeneratedImageDownloadEntries(
      [taskA, taskB],
      [tab('tab-a', '快手', [taskA]), tab('tab-b', '小红书', [taskB])],
      settings,
    )

    expect(entries).toEqual([
      { imageId: 'a-1', fileNameBase: '20260703-快手-A prompt-1' },
      { imageId: 'a-2', fileNameBase: '20260703-快手-A prompt-2' },
      { imageId: 'b-1', fileNameBase: '20260702-小红书-B prompt-1' },
    ])
  })

  it('keeps the original image sequence when filtering one image', () => {
    const sourceTask = task({
      id: 'a',
      prompt: 'prompt',
      createdAt: new Date(2026, 6, 3, 8).getTime(),
      outputImages: ['a-1', 'a-2', 'a-3'],
    })

    expect(getGeneratedImageDownloadEntries(
      [sourceTask],
      [tab('tab-a', '快手', [sourceTask])],
      settings,
      ['a-3'],
    )).toEqual([
      { imageId: 'a-3', fileNameBase: '20260703-快手-prompt-3' },
    ])
  })

  it('falls back to the scheduled output folder when no tab owns the task', () => {
    const sourceTask = task({
      id: 'a',
      prompt: '',
      createdAt: new Date(2026, 6, 3, 8).getTime(),
      outputImages: ['a-1'],
      scheduledOutputSubFolder: '定时任务',
    })

    expect(getGeneratedImageDownloadEntries([sourceTask], [], {
      imageFilenameDatePrefix: true,
      imageFilenameUsePrompt: false,
    })).toEqual([
      { imageId: 'a-1', fileNameBase: '20260703-定时任务-1' },
    ])
  })
})
