import { describe, expect, it } from 'vitest'
import { createDefaultCompositeV2Preset } from './compositeV2Defaults'
import { buildPresetOutputPathParts, dataUrlSizeKb, waitWhilePaused } from './compositeExportRuntime'
import type { CompositeV2ExportItem } from './compositeExportPlan'

describe('composite export runtime helpers', () => {
  it('measures base64 data URLs in kilobytes', () => {
    const oneKb = Buffer.alloc(1024).toString('base64')
    expect(dataUrlSizeKb(`data:image/jpeg;base64,${oneKb}`)).toBe(1)
  })

  it('stops waiting when cancellation is requested', async () => {
    let checks = 0
    await waitWhilePaused(
      () => true,
      () => ++checks > 1,
      async () => undefined,
    )
    expect(checks).toBe(2)
  })

  it('builds paths from each preset explicit templates and values', () => {
    const createItem = (id: string, project: string): CompositeV2ExportItem => ({
      snapshotId: 'snapshot',
      preset: {
        ...createDefaultCompositeV2Preset(1),
        id,
        name: `Preset ${id}`,
        namingTemplate: '{legacy}',
        subfolderTemplate: '{project}/{size}',
        filenameTemplate: '{preset}-{source}-{index}',
        customVariableValues: { project },
      },
      outputRule: {
        id: 'rule',
        name: '1280x720',
        channelId: 'baidu',
        channelName: '百度',
        width: 1280,
        height: 720,
        maxSizeKb: 399,
        format: 'jpg',
      },
      background: {
        path: 'D:/source.png',
        name: 'source.png',
        relativeDir: '',
        width: 1280,
        height: 720,
      },
      date: '20260702',
      index: 1,
      custom: '',
    })

    expect(buildPresetOutputPathParts(createItem('a', '项目A'), { preserveSourceDir: false })).toEqual({
      subfolders: ['项目A', '1280x720'],
      filename: 'Preset a-source-1.jpg',
    })
    expect(buildPresetOutputPathParts(createItem('b', '项目B'), { preserveSourceDir: false })).toEqual({
      subfolders: ['项目B', '1280x720'],
      filename: 'Preset b-source-1.jpg',
    })
  })
})
