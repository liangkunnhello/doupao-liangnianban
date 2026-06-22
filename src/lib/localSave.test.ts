import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveImageToLocal } from './localSave'

describe('local image saving', () => {
  const savedImages: Array<{ filePath: string; dataUrl: string }> = []
  const ensuredDirs: string[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-20T12:00:00+08:00'))
    savedImages.length = 0
    ensuredDirs.length = 0
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {},
    })
    Object.defineProperty(globalThis.window, 'electronAPI', {
      configurable: true,
      value: {
        isElectron: true,
        getLocalSavePath: vi.fn(async () => 'D:\\LocalSaves'),
        getDefaultPath: vi.fn(async () => 'D:\\LocalSaves'),
        setLocalSavePath: vi.fn(async () => {}),
        ensureDir: vi.fn(async (dirPath: string) => {
          ensuredDirs.push(dirPath)
          return true
        }),
        pathJoin: vi.fn(async (...parts: string[]) => parts.join('\\')),
        saveImage: vi.fn(async (filePath: string, dataUrl: string) => {
          savedImages.push({ filePath, dataUrl })
          return true
        }),
        readDir: vi.fn(async () => []),
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('resolves date variables in explicit output paths and names images with date-batch-seq format', async () => {
    const savedPath = await saveImageToLocal(
      'task-a',
      0,
      'data:image/png;base64,a',
      'png',
      undefined,
      'D:\\Exports\\{date}\\插画',
    )

    expect(ensuredDirs).toContain('D:\\Exports\\20260620\\插画')
    expect(savedPath).toBe('D:\\Exports\\20260620\\插画\\20260620-1-01.png')
    expect(savedImages[0].filePath).toBe('D:\\Exports\\20260620\\插画\\20260620-1-01.png')
  })

  it('increments batch index when existing files are present in directory', async () => {
    const readDir = vi.fn(async () => ['20260620-1-01.png', '20260620-1-02.png'])
    ;(globalThis.window as any).electronAPI.readDir = readDir

    const savedPath = await saveImageToLocal(
      'task-b',
      0,
      'data:image/png;base64,a',
      'png',
      undefined,
      'D:\\Exports\\{date}\\插画',
    )

    expect(savedPath).toBe('D:\\Exports\\20260620\\插画\\20260620-2-01.png')
  })

  it('uses provided batchIndex when passed explicitly', async () => {
    const savedPath = await saveImageToLocal(
      'task-c',
      2,
      'data:image/png;base64,a',
      'png',
      undefined,
      'D:\\Exports\\{date}\\插画',
      5,
    )

    expect(savedPath).toBe('D:\\Exports\\20260620\\插画\\20260620-5-03.png')
  })

  it('pads sequence number to 2 digits', async () => {
    const savedPath = await saveImageToLocal(
      'task-d',
      9,
      'data:image/png;base64,a',
      'png',
      undefined,
      'D:\\Exports\\{date}\\插画',
      1,
    )

    expect(savedPath).toBe('D:\\Exports\\20260620\\插画\\20260620-1-10.png')
  })
})
