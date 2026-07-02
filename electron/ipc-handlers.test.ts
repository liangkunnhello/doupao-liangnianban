import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
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
      { path: path.join(fixtureDir, '1.PNG'), name: '1.PNG', relativeDir: '', width: 0, height: 0 },
      { path: path.join(fixtureDir, '2.jpg'), name: '2.jpg', relativeDir: '', width: 0, height: 0 },
    ])
  })

  it('deletes backup files beyond the retention limit', async () => {
    const mod = await import('./ipc-handlers')
    const pruneBackupFiles = (mod as {
      pruneBackupFiles?: (paths: string[], keep: number) => void
    }).pruneBackupFiles
    const backupPaths = Array.from({ length: 31 }, (_, index) => path.join(fixtureDir, `backup-${index}.json`))
    backupPaths.forEach(writeFixtureFile)

    expect(pruneBackupFiles).toBeTypeOf('function')
    pruneBackupFiles!(backupPaths, 30)

    expect(existsSync(backupPaths[29])).toBe(true)
    expect(existsSync(backupPaths[30])).toBe(false)
  })

  it('recognizes current metadata-only state backups as usable', async () => {
    const mod = await import('./ipc-handlers')
    const backupJsonHasData = (mod as {
      backupJsonHasData?: (value: unknown) => boolean
    }).backupJsonHasData

    expect(backupJsonHasData).toBeTypeOf('function')
    expect(backupJsonHasData!({
      state: {
        settings: { backupInterval: 600 },
        workspaceTabs: [{ id: 'tab-a' }],
      },
    })).toBe(true)
    expect(backupJsonHasData!({ state: {} })).toBe(false)
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
      { path: path.join(fixtureDir, 'A', '2.png'), name: '2.png', relativeDir: 'A', width: 0, height: 0 },
      { path: path.join(fixtureDir, 'A', 'sub', '10.WEBP'), name: '10.WEBP', relativeDir: 'A/sub', width: 0, height: 0 },
      { path: path.join(fixtureDir, 'root.jpeg'), name: 'root.jpeg', relativeDir: '', width: 0, height: 0 },
    ])
  })

  it('authorizes and scans an explicitly entered background folder', async () => {
    const mod = await import('./ipc-handlers')
    const scanEnteredCompositeBackgroundFolder = (mod as {
      scanEnteredCompositeBackgroundFolder?: (
        dirPath: string,
        recursive: boolean,
      ) => {
        success: boolean
        folderPath?: string
        files?: Array<{ path: string; name: string; relativeDir: string; width: number; height: number }>
      }
    }).scanEnteredCompositeBackgroundFolder
    const enteredRoot = mkdtempSync(path.join(os.tmpdir(), 'composite-entered-'))
    writeFixtureFile(path.join(enteredRoot, 'manual.jpg'))

    expect(scanEnteredCompositeBackgroundFolder).toBeTypeOf('function')
    expect(scanEnteredCompositeBackgroundFolder!(enteredRoot, false)).toEqual({
      success: true,
      folderPath: realpathSync(enteredRoot),
      files: [{
        path: path.join(realpathSync(enteredRoot), 'manual.jpg'),
        name: 'manual.jpg',
        relativeDir: '',
        width: 0,
        height: 0,
      }],
    })

    rmSync(enteredRoot, { recursive: true, force: true })
  })

  it('rejects missing, file, and symlink folder inputs', async () => {
    const mod = await import('./ipc-handlers')
    const scanEnteredCompositeBackgroundFolder = (mod as {
      scanEnteredCompositeBackgroundFolder?: (
        dirPath: string,
        recursive: boolean,
      ) => { success: boolean; error?: string }
    }).scanEnteredCompositeBackgroundFolder
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), 'composite-entered-'))
    const filePath = path.join(outsideRoot, 'not-a-folder.jpg')
    const linkPath = path.join(outsideRoot, 'linked-folder')
    writeFixtureFile(filePath)
    symlinkSync(fixtureDir, linkPath, 'junction')

    expect(scanEnteredCompositeBackgroundFolder).toBeTypeOf('function')
    expect(scanEnteredCompositeBackgroundFolder!(path.join(outsideRoot, 'missing'), false).success).toBe(false)
    expect(scanEnteredCompositeBackgroundFolder!(filePath, false).success).toBe(false)
    expect(scanEnteredCompositeBackgroundFolder!(linkPath, false).success).toBe(false)

    rmSync(linkPath, { recursive: true, force: true })
    rmSync(outsideRoot, { recursive: true, force: true })
  })

  it('skips recursive symlink or junction directories instead of traversing them', async () => {
    const mod = await import('./ipc-handlers')
    const listCompositeBackgroundFiles = (mod as {
      listCompositeBackgroundFiles?: (dirPath: string, recursive: boolean) => Array<{ path: string; name: string; relativeDir: string }>
    }).listCompositeBackgroundFiles
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), 'composite-ipc-outside-'))
    const escapedFile = path.join(outsideRoot, 'escaped.png')
    const junctionPath = path.join(fixtureDir, 'linked-outside')

    writeFixtureFile(path.join(fixtureDir, 'safe.jpg'))
    writeFixtureFile(escapedFile)
    symlinkSync(outsideRoot, junctionPath, 'junction')

    expect(listCompositeBackgroundFiles).toBeTypeOf('function')
    expect(sortBackgrounds(listCompositeBackgroundFiles!(fixtureDir, true))).toEqual([
      { path: path.join(fixtureDir, 'safe.jpg'), name: 'safe.jpg', relativeDir: '', width: 0, height: 0 },
    ])

    rmSync(junctionPath, { recursive: true, force: true })
    rmSync(outsideRoot, { recursive: true, force: true })
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

  it('deletes only jpg files and rejects directory, wrong extension, and junction escapes', async () => {
    const mod = await import('./ipc-handlers')
    const deleteCompositeFiles = (mod as {
      deleteCompositeFiles?: (filePaths: string[]) => { deleted: string[]; failed: string[] }
    }).deleteCompositeFiles
    const insideJpg = path.join(fixtureDir, 'inside.jpg')
    const insidePng = path.join(fixtureDir, 'inside.png')
    const nestedDir = path.join(fixtureDir, 'folder.jpg')
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), 'composite-ipc-outside-'))
    const junctionPath = path.join(fixtureDir, 'outside-link')
    const escapedJpg = path.join(junctionPath, 'escaped.jpg')

    writeFixtureFile(insideJpg)
    writeFixtureFile(insidePng)
    mkdirSync(nestedDir, { recursive: true })
    writeFixtureFile(path.join(outsideRoot, 'escaped.jpg'))
    symlinkSync(outsideRoot, junctionPath, 'junction')

    expect(deleteCompositeFiles).toBeTypeOf('function')
    expect(deleteCompositeFiles!([insideJpg, insidePng, nestedDir, escapedJpg])).toEqual({
      deleted: [insideJpg],
      failed: [insidePng, nestedDir, escapedJpg],
    })
    expect(existsSync(insideJpg)).toBe(false)
    expect(existsSync(insidePng)).toBe(true)
    expect(existsSync(path.join(outsideRoot, 'escaped.jpg'))).toBe(true)

    rmSync(junctionPath, { recursive: true, force: true })
    rmSync(outsideRoot, { recursive: true, force: true })
  })

  it('returns structured results for malformed IPC payload helpers', async () => {
    const mod = await import('./ipc-handlers')
    const handleCompositeListBackgroundFilesPayload = (mod as {
      handleCompositeListBackgroundFilesPayload?: (payload: unknown) => Array<{ path: string; name: string; relativeDir: string }>
    }).handleCompositeListBackgroundFilesPayload
    const handleDeleteCompositeFilesPayload = (mod as {
      handleDeleteCompositeFilesPayload?: (payload: unknown) => { deleted: string[]; failed: string[] }
    }).handleDeleteCompositeFilesPayload

    expect(handleCompositeListBackgroundFilesPayload).toBeTypeOf('function')
    expect(handleDeleteCompositeFilesPayload).toBeTypeOf('function')
    expect(handleCompositeListBackgroundFilesPayload!({ dirPath: fixtureDir, recursive: 'yes' })).toEqual([])
    expect(handleCompositeListBackgroundFilesPayload!(null)).toEqual([])
    expect(handleDeleteCompositeFilesPayload!({ filePaths: ['ok.jpg', 1] })).toEqual({ deleted: [], failed: [] })
    expect(handleDeleteCompositeFilesPayload!(null)).toEqual({ deleted: [], failed: [] })
  })

  it('requires exactly one source for each streaming ZIP entry', async () => {
    const { parseStreamingZipRequest } = await import('./ipc-handlers')
    const base = {
      destinationPath: path.join(allowedRoot, 'backup.zip'),
      manifestJson: '{}',
    }

    expect(parseStreamingZipRequest({
      ...base,
      entries: [{ archivePath: 'composite-assets/a.png', data: new Uint8Array([1]) }],
    })).not.toBeNull()
    expect(parseStreamingZipRequest({
      ...base,
      entries: [{ archivePath: 'composite-assets/a.png' }],
    })).toBeNull()
    expect(parseStreamingZipRequest({
      ...base,
      entries: [{
        archivePath: 'composite-assets/a.png',
        sourcePath: path.join(allowedRoot, 'a.png'),
        data: new Uint8Array([1]),
      }],
    })).toBeNull()
  })

  it('deletes cache images only inside the configured cache directory', async () => {
    writeFileSync(path.join(allowedRoot, 'local-settings.json'), JSON.stringify({
      localSavePath: path.join(allowedRoot, 'local-saves'),
    }))
    const inside = path.join(allowedRoot, 'local-saves', 'cache-images', 'inside.png')
    const outside = path.join(fixtureDir, 'outside.png')
    writeFixtureFile(inside)
    writeFixtureFile(outside)
    const { deleteCacheImageFiles } = await import('./ipc-handlers')

    expect(deleteCacheImageFiles([inside, outside])).toEqual({
      deleted: [inside],
      failed: [outside],
    })
    expect(existsSync(inside)).toBe(false)
    expect(existsSync(outside)).toBe(true)
  })
})
