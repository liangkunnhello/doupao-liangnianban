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
        checkExists: vi.fn(async () => false),
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(globalThis, 'window')
  })

  it('resolves date variables in explicit output paths and names images from the folder name', async () => {
    const savedPath = await saveImageToLocal(
      'task-a',
      0,
      'data:image/png;base64,a',
      'png',
      undefined,
      'D:\\Exports\\{date}\\插画',
    )

    expect(ensuredDirs).toContain('D:\\Exports\\20260620\\插画')
    expect(savedPath).toBe('D:\\Exports\\20260620\\插画\\插画-1.png')
    expect(savedImages[0].filePath).toBe('D:\\Exports\\20260620\\插画\\插画-1.png')
  })

  it('uses an exact generated filename base when provided', async () => {
    const savedPath = await saveImageToLocal(
      'task-a',
      0,
      'data:image/png;base64,a',
      'png',
      '快手',
      undefined,
      '20260620-快手-4',
    )

    expect(savedPath).toBe('D:\\LocalSaves\\images\\快手\\20260620-快手-4.png')
    expect(savedImages[0].filePath).toBe('D:\\LocalSaves\\images\\快手\\20260620-快手-4.png')
  })

  it('reserves distinct sequential names when images are saved concurrently', async () => {
    const existingFiles = new Set(['images-1.png', 'images-2.png'])
    const api = globalThis.window.electronAPI!
    vi.mocked(api.checkExists).mockImplementation(async (filePath: string) => {
      const name = filePath.split('\\').pop()!
      return existingFiles.has(name)
    })
    api.readDir = vi.fn(async () => [...existingFiles])
    vi.mocked(api.saveImage).mockImplementation(async (filePath: string, dataUrl: string) => {
      savedImages.push({ filePath, dataUrl })
      existingFiles.add(filePath.split('\\').pop()!)
      return true
    })

    const savedPaths = await Promise.all([
      saveImageToLocal('task-a', 0, 'data:image/png;base64,a'),
      saveImageToLocal('task-a', 1, 'data:image/png;base64,b'),
    ])

    expect(new Set(savedPaths).size).toBe(2)
    expect(savedPaths).toEqual(expect.arrayContaining([
      'D:\\LocalSaves\\images\\images-3.png',
      'D:\\LocalSaves\\images\\images-4.png',
    ]))
  })
})
