import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const allowedRoot = mkdtempSync(path.join(os.tmpdir(), 'composite-ipc-'))

vi.mock('electron', () => ({
  app: {
    getPath: () => allowedRoot,
  },
  BrowserWindow: {
    fromWebContents: () => null,
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
    showItemInFolder: vi.fn(),
  },
}))

const fixtureDir = path.join(allowedRoot, 'fixtures')

function writeFixtureFile(filePath: string) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, 'fixture')
}

function sortBackgrounds(items: Array<{ path: string; name: string; relativeDir: string }>) {
  return [...items].sort((a, b) => a.path.localeCompare(b.path))
}

describe('ipc composite background filesystem helpers', () => {
  beforeEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true })
    mkdirSync(fixtureDir, { recursive: true })
  })

  afterAll(() => {
    rmSync(allowedRoot, { recursive: true, force: true })
  })

  it('lists only top-level supported background files when not recursive', async () => {
    const mod = await import('./ipc-handlers')
    const listCompositeBackgroundFiles = (mod as {
      listCompositeBackgroundFiles?: (dirPath: string, recursive: boolean) => Array<{ path: string; name: string; relativeDir: string }>
    }).listCompositeBackgroundFiles

    writeFixtureFile(path.join(fixtureDir, '2.jpg'))
    writeFixtureFile(path.join(fixtureDir, '1.PNG'))
    writeFixtureFile(path.join(fixtureDir, 'nested', '3.webp'))
    writeFixtureFile(path.join(fixtureDir, 'skip.txt'))

    expect(listCompositeBackgroundFiles).toBeTypeOf('function')
    expect(sortBackgrounds(listCompositeBackgroundFiles!(fixtureDir, false))).toEqual([
      { path: path.join(fixtureDir, '1.PNG'), name: '1.PNG', relativeDir: '' },
      { path: path.join(fixtureDir, '2.jpg'), name: '2.jpg', relativeDir: '' },
    ])
  })

  it('lists supported background files recursively with relative directories', async () => {
    const mod = await import('./ipc-handlers')
    const listCompositeBackgroundFiles = (mod as {
      listCompositeBackgroundFiles?: (dirPath: string, recursive: boolean) => Array<{ path: string; name: string; relativeDir: string }>
    }).listCompositeBackgroundFiles

    writeFixtureFile(path.join(fixtureDir, 'root.jpeg'))
    writeFixtureFile(path.join(fixtureDir, 'A', '2.png'))
    writeFixtureFile(path.join(fixtureDir, 'A', 'sub', '10.WEBP'))
    writeFixtureFile(path.join(fixtureDir, 'B', 'skip.gif'))

    expect(listCompositeBackgroundFiles).toBeTypeOf('function')
    expect(sortBackgrounds(listCompositeBackgroundFiles!(fixtureDir, true))).toEqual([
      { path: path.join(fixtureDir, 'A', '2.png'), name: '2.png', relativeDir: 'A' },
      { path: path.join(fixtureDir, 'A', 'sub', '10.WEBP'), name: '10.WEBP', relativeDir: 'A/sub' },
      { path: path.join(fixtureDir, 'root.jpeg'), name: 'root.jpeg', relativeDir: '' },
    ])
  })

  it('deletes allowed files, treats missing files as deleted, and rejects disallowed paths', async () => {
    const mod = await import('./ipc-handlers')
    const deleteCompositeFiles = (mod as {
      deleteCompositeFiles?: (filePaths: string[]) => { deleted: string[]; failed: string[] }
    }).deleteCompositeFiles
    const insideFile = path.join(fixtureDir, 'inside.jpg')
    const missingFile = path.join(fixtureDir, 'missing.jpg')
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), 'composite-ipc-outside-'))
    const outsideFile = path.join(outsideRoot, 'outside.jpg')

    writeFixtureFile(insideFile)
    writeFixtureFile(outsideFile)

    expect(deleteCompositeFiles).toBeTypeOf('function')
    expect(deleteCompositeFiles!([insideFile, missingFile, outsideFile])).toEqual({
      deleted: [insideFile, missingFile],
      failed: [outsideFile],
    })
    expect(existsSync(insideFile)).toBe(false)
    expect(existsSync(outsideFile)).toBe(true)

    rmSync(outsideRoot, { recursive: true, force: true })
  })
})
