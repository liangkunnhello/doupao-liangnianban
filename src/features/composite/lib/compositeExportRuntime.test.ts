import { describe, expect, it, vi } from 'vitest'
import { createDefaultCompositeV2Preset } from './compositeV2Defaults'
import * as exportRuntime from './compositeExportRuntime'
import type { CompositeV2ExportItem } from './compositeExportPlan'

const {
  authorizeCompositeOutputRoot,
  buildPresetOutputPathParts,
  dataUrlSizeKb,
  waitWhilePaused,
} = exportRuntime

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

  it('uses each resolved filename as both the direct folder and file name', () => {
    const createItem = (id: string, project: string): CompositeV2ExportItem => ({
      snapshotId: 'snapshot',
      preset: {
        ...createDefaultCompositeV2Preset(1),
        id,
        name: `Preset ${id}`,
        namingTemplate: '{legacy}',
        subfolderTemplate: 'legacy/{preset}/{sourceDir}',
        filenameTemplate: '{channel}-{size}-{date}-{project}',
        customVariableValues: { project },
      },
      outputRule: {
        id: 'rule',
        name: '1280x720',
        channelId: 'baidu',
        channelName: '百度',
        enabled: true,
        width: 1280,
        height: 720,
        maxSizeKb: 399,
        format: 'jpg',
        subfolderTemplate: '',
        filenameTemplate: '',
      },
      background: {
        path: 'D:/source.png',
        name: 'source.png',
        relativeDir: '',
        width: 1280,
        height: 720,
      },
      date: '20260703',
      index: 1,
      custom: '',
    })

    expect(buildPresetOutputPathParts(createItem('a', '项目A'), { preserveSourceDir: false })).toEqual({
      subfolders: ['百度-1280x720-20260703-项目A'],
      filename: '百度-1280x720-20260703-项目A.jpg',
    })
    expect(buildPresetOutputPathParts(createItem('b', '项目B'), { preserveSourceDir: false })).toEqual({
      subfolders: ['百度-1280x720-20260703-项目B'],
      filename: '百度-1280x720-20260703-项目B.jpg',
    })
  })

  it('resolves built-in and custom variables in the preset output root', () => {
    const item: CompositeV2ExportItem = {
      snapshotId: 'snapshot',
      preset: {
        ...createDefaultCompositeV2Preset(1),
        name: '横版',
        outputRootPath: 'D:\\Exports\\{date}\\{project}',
        customVariableValues: { project: '项目A' },
      },
      outputRule: {
        id: 'rule',
        name: '1280x720',
        channelId: 'kuaishou',
        channelName: '快手',
        enabled: true,
        width: 1280,
        height: 720,
        maxSizeKb: 399,
        format: 'jpg',
        subfolderTemplate: '',
        filenameTemplate: '',
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
    }
    const buildPresetOutputRootPath = (
      exportRuntime as typeof exportRuntime & {
        buildPresetOutputRootPath: (item: CompositeV2ExportItem) => string
      }
    ).buildPresetOutputRootPath

    expect(buildPresetOutputRootPath(item)).toBe('D:\\Exports\\20260702\\项目A')
  })

  it('authorizes each composite output root once per export run', async () => {
    const authorize = vi.fn(async () => true)
    const api = {
      authorizeCompositeOutputDirectory: authorize,
    } as unknown as NonNullable<Window['electronAPI']>
    const authorizedRoots = new Set<string>()

    await authorizeCompositeOutputRoot(api, 'D:\\Exports\\A', authorizedRoots)
    await authorizeCompositeOutputRoot(api, 'D:\\Exports\\A', authorizedRoots)
    await authorizeCompositeOutputRoot(api, 'E:\\Exports\\B', authorizedRoots)

    expect(authorize).toHaveBeenCalledTimes(2)
  })

  it('rejects roots that cannot be authorized', async () => {
    const api = {
      authorizeCompositeOutputDirectory: vi.fn(async () => false),
    } as unknown as NonNullable<Window['electronAPI']>

    await expect(authorizeCompositeOutputRoot(api, 'relative/output', new Set()))
      .rejects.toThrow('输出目录必须是绝对路径')
  })
})
