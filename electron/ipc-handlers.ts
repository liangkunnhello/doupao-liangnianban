import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'path'
import { appendFileSync, existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync, readdirSync, readFileSync, copyFileSync, statSync, unlinkSync, renameSync, openSync, readSync, closeSync, rmdirSync } from 'fs'
import { promises as fsPromises } from 'fs'
import sizeOf from 'image-size'
import { writeStreamingZip, type StreamingZipRequest } from './streaming-zip'

const LOCAL_SETTINGS_FILE = 'local-settings.json'
const sessionAllowedRoots = new Set<string>()

export function pruneBackupFiles(pathsByNewestFirst: string[], keep: number): void {
  for (const filePath of pathsByNewestFirst.slice(Math.max(0, keep))) {
    try {
      unlinkSync(filePath)
    } catch {
      // Retention cleanup is best-effort and must not block the current save.
    }
  }
}

export function backupJsonHasData(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const root = value as Record<string, unknown>
  const state = (root.state && typeof root.state === 'object' ? root.state : root) as Record<string, unknown>
  const nonEmptyArray = (key: string) => Array.isArray(state[key]) && state[key].length > 0
  const nonEmptyRecord = (key: string) => Boolean(
    state[key] &&
    typeof state[key] === 'object' &&
    !Array.isArray(state[key]) &&
    Object.keys(state[key] as Record<string, unknown>).length > 0,
  )
  return (
    nonEmptyArray('tasks') ||
    nonEmptyArray('agentConversations') ||
    nonEmptyArray('workspaceTabs') ||
    nonEmptyArray('favoriteCollections') ||
    nonEmptyArray('wordLibraryEntries') ||
    nonEmptyRecord('settings') ||
    nonEmptyRecord('agentInputDrafts')
  )
}

export function copyCacheImageDirectory(
  sourceDir: string,
  targetDir: string,
): Array<{ from: string; to: string }> {
  if (!existsSync(sourceDir)) return []
  mkdirSync(targetDir, { recursive: true })
  const mappings: Array<{ from: string; to: string }> = []
  const supported = new Set(['.png', '.jpg', '.jpeg', '.webp'])
  for (const name of readdirSync(sourceDir).sort()) {
    if (!supported.has(path.extname(name).toLowerCase())) continue
    const from = path.join(sourceDir, name)
    if (!statSync(from).isFile()) continue
    const to = path.join(targetDir, name)
    copyFileSync(from, to)
    if (statSync(from).size !== statSync(to).size) {
      throw new Error(`Cache file verification failed: ${name}`)
    }
    mappings.push({ from, to })
  }
  return mappings
}

function getLocalSettingsPath(): string {
  return path.join(app.getPath('userData'), LOCAL_SETTINGS_FILE)
}

function normalizeFsPath(value: string): string {
  return path.resolve(value)
}

function addAllowedRoot(value: string | null | undefined): void {
  if (!value) return
  sessionAllowedRoots.add(normalizeFsPath(value))
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.access(filePath)
    return true
  } catch {
    return false
  }
}

async function listBackupFiles(backupDir: string, baseName: string): Promise<string[]> {
  const names = await fsPromises.readdir(backupDir)
  const entries: Array<{ fullPath: string; mtimeMs: number }> = []
  for (const name of names) {
    if (!name.startsWith(`${baseName}-`)) continue
    const fullPath = path.join(backupDir, name)
    try {
      entries.push({ fullPath, mtimeMs: (await fsPromises.stat(fullPath)).mtimeMs })
    } catch {
      // A concurrently removed backup is not relevant to the current write.
    }
  }
  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs).map((entry) => entry.fullPath)
}

async function pruneBackupFilesAsync(pathsByNewestFirst: string[], keep: number): Promise<void> {
  await Promise.all(pathsByNewestFirst.slice(Math.max(0, keep)).map(async (filePath) => {
    try {
      await fsPromises.unlink(filePath)
    } catch {
      // Retention cleanup is best-effort and must not block the current save.
    }
  }))
}

export function authorizeCompositeOutputDirectory(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) return false
  addAllowedRoot(value)
  return true
}

function getAllowedRoots(): string[] {
  const roots = [
    app.getPath('userData'),
    app.getPath('desktop'),
    app.getPath('documents'),
    app.getPath('downloads'),
    app.getPath('pictures'),
    ...sessionAllowedRoots,
  ]
  const settings = readLocalSettings()
  if (typeof settings.localSavePath === 'string') roots.push(settings.localSavePath)
  return roots.map(normalizeFsPath)
}

function isPathInside(targetPath: string, rootPath: string): boolean {
  const target = normalizeFsPath(targetPath).toLowerCase()
  const root = normalizeFsPath(rootPath).toLowerCase()
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function assertAllowedPath(targetPath: string): string {
  const normalized = normalizeFsPath(targetPath)
  if (!getAllowedRoots().some((root) => isPathInside(normalized, root))) {
    throw new Error('Path is outside allowed application directories')
  }
  return normalized
}

function resolveRealPathSafe(targetPath: string): string {
  try {
    return realpathSync(targetPath)
  } catch {
    return normalizeFsPath(targetPath)
  }
}

function findNearestExistingPath(targetPath: string): string | null {
  let current = normalizeFsPath(targetPath)
  while (true) {
    if (existsSync(current)) return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function assertAllowedRealPath(targetPath: string): string {
  const normalized = assertAllowedPath(targetPath)
  const existingPath = findNearestExistingPath(normalized)
  if (!existingPath) return normalized
  const realPath = resolveRealPathSafe(existingPath)
  const allowedRealRoots = getAllowedRoots().map(resolveRealPathSafe)
  if (!allowedRealRoots.some((root) => isPathInside(realPath, root))) {
    throw new Error('Path resolves outside allowed application directories')
  }
  return normalized
}

export function initLocalSavePath(): void {
  try {
    const settings = readLocalSettings()
    if (!settings.localSavePath) {
      settings.localSavePath = path.join(app.getPath('userData'), 'local-saves')
      writeLocalSettings(settings)
    }
    if (typeof settings.localSavePath === 'string') addAllowedRoot(settings.localSavePath)
  } catch (err) {
    console.error('初始化本地保存路径失败:', err)
  }
}

function readLocalSettings(): Record<string, unknown> {
  try {
    const content = readFileSync(getLocalSettingsPath(), 'utf-8')
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeLocalSettings(settings: Record<string, unknown>): void {
  writeFileSync(getLocalSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

function getCacheImagesDir(): string | null {
  const settings = readLocalSettings()
  return typeof settings.localSavePath === 'string'
    ? path.join(settings.localSavePath, 'cache-images')
    : null
}

export function deleteCacheImageFiles(filePaths: string[]): { deleted: string[]; failed: string[] } {
  const deleted: string[] = []
  const failed: string[] = []
  const cacheDir = getCacheImagesDir()
  if (!cacheDir) return { deleted, failed: [...filePaths] }
  for (const filePath of filePaths) {
    try {
      const normalized = normalizeFsPath(filePath)
      if (!isPathInside(normalized, cacheDir) || path.dirname(normalized).toLowerCase() !== normalizeFsPath(cacheDir).toLowerCase()) {
        throw new Error('outside cache')
      }
      if (existsSync(normalized)) {
        if (!statSync(normalized).isFile()) throw new Error('not a file')
        unlinkSync(normalized)
      }
      deleted.push(filePath)
    } catch {
      failed.push(filePath)
    }
  }
  return { deleted, failed }
}

export function reconcileCacheImageFiles(referencedFileNames: string[]): { deleted: string[]; failed: string[] } {
  const cacheDir = getCacheImagesDir()
  if (!cacheDir || !existsSync(cacheDir)) return { deleted: [], failed: [] }
  const keep = new Set(referencedFileNames)
  return deleteCacheImageFiles(
    readdirSync(cacheDir).filter((name) => !keep.has(name)).map((name) => path.join(cacheDir, name)),
  )
}

export function parseStreamingZipRequest(payload: unknown): StreamingZipRequest | null {
  if (!payload || typeof payload !== 'object') return null
  const value = payload as StreamingZipRequest
  if (typeof value.destinationPath !== 'string' || typeof value.manifestJson !== 'string' || !Array.isArray(value.entries)) return null
  if (!value.entries.every((entry) => {
    if (!entry || typeof entry.archivePath !== 'string' || (entry.mtime !== undefined && typeof entry.mtime !== 'number')) return false
    const hasSourcePath = 'sourcePath' in entry && typeof entry.sourcePath === 'string'
    const hasData = 'data' in entry && entry.data instanceof Uint8Array
    return hasSourcePath !== hasData
  })) return null
  return value
}

function dataUrlToBuffer(dataUrl: string): { buffer: Buffer; mime: string } {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!matches) throw new Error('Invalid data URL format')
  const mime = matches[1]
  const base64 = matches[2]
  return {
    buffer: Buffer.from(base64, 'base64'),
    mime,
  }
}

const COMPOSITE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const COMPOSITE_DELETE_EXTENSIONS = new Set(['.jpg', '.jpeg'])

type CompositeBackgroundFile = {
  path: string
  name: string
  relativeDir: string
  width: number
  height: number
}

type CompositeDeleteFilesResult = {
  deleted: string[]
  failed: string[]
}

type CompositeBackgroundScanResult =
  | { success: true; folderPath: string; files: CompositeBackgroundFile[] }
  | { success: false; error: string }

type CompositeListBackgroundFilesPayload = {
  dirPath: string
  recursive: boolean
}

function isCompositeImagePath(filePath: string): boolean {
  return COMPOSITE_IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function mimeFromImagePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

function normalizeRelativeDir(relativeDir: string): string {
  return relativeDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}

function getImageSizeSync(filePath: string) {
  let fd: number | null = null
  try {
    fd = openSync(filePath, 'r')
    const buffer = Buffer.alloc(128 * 1024)
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0)
    return sizeOf(buffer.subarray(0, bytesRead))
  } finally {
    if (fd !== null) {
      try { closeSync(fd) } catch { /* ignore */ }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseCompositeListBackgroundFilesPayload(payload: unknown): CompositeListBackgroundFilesPayload | null {
  if (!isRecord(payload)) return null
  if (typeof payload.dirPath !== 'string' || typeof payload.recursive !== 'boolean') return null
  return { dirPath: payload.dirPath, recursive: payload.recursive }
}

export function parseDeleteCompositeFilesPayload(payload: unknown): string[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.filePaths)) return null
  if (!payload.filePaths.every((filePath) => typeof filePath === 'string')) return null
  return payload.filePaths
}

function isCompositeDeletePath(filePath: string): boolean {
  return COMPOSITE_DELETE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function readImageFilePayload(filePath: string) {
  const safeFilePath = assertAllowedPath(filePath)
  if (!existsSync(safeFilePath) || !statSync(safeFilePath).isFile() || !isCompositeImagePath(safeFilePath)) return null
  const buffer = readFileSync(safeFilePath)
  return {
    path: safeFilePath,
    name: path.basename(safeFilePath),
    dataUrl: `data:${mimeFromImagePath(safeFilePath)};base64,${buffer.toString('base64')}`,
  }
}

function listCompositeImageFiles(dirPath: string) {
  const safeDirPath = assertAllowedPath(dirPath)
  if (!existsSync(safeDirPath) || !statSync(safeDirPath).isDirectory()) return []
  return readdirSync(safeDirPath)
    .map((name) => path.join(safeDirPath, name))
    .filter((filePath) => {
      try {
        return statSync(filePath).isFile() && isCompositeImagePath(filePath)
      } catch {
        return false
      }
    })
    .map((filePath) => {
      const buffer = readFileSync(filePath)
      return {
        path: filePath,
        name: path.basename(filePath),
        dataUrl: `data:${mimeFromImagePath(filePath)};base64,${buffer.toString('base64')}`,
      }
    })
}

export function listCompositeBackgroundFiles(dirPath: string, recursive: boolean): CompositeBackgroundFile[] {
  const safeDirPath = assertAllowedRealPath(dirPath)
  if (!existsSync(safeDirPath)) return []
  const dirStat = lstatSync(safeDirPath)
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return []
  if (!recursive) {
    return readdirSync(safeDirPath).flatMap((name) => {
      const filePath = path.join(safeDirPath, name)
      try {
        const stat = lstatSync(filePath)
        if (stat.isSymbolicLink() || !stat.isFile() || !isCompositeImagePath(filePath)) return []
        assertAllowedRealPath(filePath)
        
        let width = 0
        let height = 0
        try {
          const dimensions = getImageSizeSync(filePath)
          width = dimensions.width || 0
          height = dimensions.height || 0
          console.log(`[image-size] ${filePath}: ${width}x${height}`)
        } catch (err) {
          console.error(`[image-size] failed for ${filePath}:`, err)
        }

        return [{
          path: filePath,
          name,
          relativeDir: '',
          width,
          height,
        }]
      } catch {
        return []
      }
    })
  }
  return listCompositeBackgroundFilesRecursive(safeDirPath)
}

export function scanEnteredCompositeBackgroundFolder(
  dirPath: string,
  recursive: boolean,
): CompositeBackgroundScanResult {
  try {
    const trimmedPath = dirPath.trim()
    if (!trimmedPath) throw new Error('请输入文件夹地址。')
    const normalizedPath = normalizeFsPath(trimmedPath)
    if (!existsSync(normalizedPath)) throw new Error('文件夹不存在。')
    const stat = lstatSync(normalizedPath)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('地址不是可读取的文件夹。')
    }
    const realDirectory = realpathSync(normalizedPath)
    addAllowedRoot(realDirectory)
    return {
      success: true,
      folderPath: realDirectory,
      files: listCompositeBackgroundFiles(realDirectory, recursive),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '无法读取文件夹。',
    }
  }
}

function listCompositeBackgroundFilesRecursive(dirPath: string, rootPath = dirPath): CompositeBackgroundFile[] {
  const safeDirPath = assertAllowedRealPath(dirPath)
  if (!existsSync(safeDirPath)) return []
  const dirStat = lstatSync(safeDirPath)
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return []
  return readdirSync(safeDirPath).flatMap((name) => {
    const filePath = path.join(safeDirPath, name)
    try {
      const stat = lstatSync(filePath)
      if (stat.isSymbolicLink()) return []
      if (stat.isDirectory()) return listCompositeBackgroundFilesRecursive(filePath, rootPath)
      if (!stat.isFile() || !isCompositeImagePath(filePath)) return []
      assertAllowedRealPath(filePath)
      const relativeDir = path.relative(rootPath, path.dirname(filePath))
      
      let width = 0
      let height = 0
      try {
        const dimensions = getImageSizeSync(filePath)
        width = dimensions.width || 0
        height = dimensions.height || 0
        console.log(`[image-size recursive] ${filePath}: ${width}x${height}`)
      } catch (err) {
        console.error(`[image-size recursive] failed for ${filePath}:`, err)
      }

      return [{
        path: filePath,
        name: path.basename(filePath),
        relativeDir: relativeDir === '.' ? '' : normalizeRelativeDir(relativeDir),
        width,
        height,
      }]
    } catch {
      return []
    }
  })
}

export function deleteCompositeFiles(filePaths: string[]): CompositeDeleteFilesResult {
  const deleted: string[] = []
  const failed: string[] = []
  for (const filePath of filePaths) {
    try {
      const safeFilePath = assertAllowedRealPath(filePath)
      if (!isCompositeDeletePath(safeFilePath)) throw new Error('Only jpg files can be deleted')
      if (!existsSync(safeFilePath)) {
        deleted.push(safeFilePath)
        continue
      }
      const stat = lstatSync(safeFilePath)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Only regular files can be deleted')
      unlinkSync(safeFilePath)
      deleted.push(safeFilePath)
    } catch {
      failed.push(filePath)
    }
  }
  return { deleted, failed }
}

export function handleCompositeListBackgroundFilesPayload(payload: unknown): CompositeBackgroundFile[] {
  const parsed = parseCompositeListBackgroundFilesPayload(payload)
  if (!parsed) return []
  return listCompositeBackgroundFiles(parsed.dirPath, parsed.recursive)
}

export function handleDeleteCompositeFilesPayload(payload: unknown): CompositeDeleteFilesResult {
  const filePaths = parseDeleteCompositeFilesPayload(payload)
  if (!filePaths) return { deleted: [], failed: [] }
  return deleteCompositeFiles(filePaths)
}

export async function distributeCompositeFile(payload: unknown): Promise<{ success: boolean }> {
  if (!payload || typeof payload !== 'object') return { success: false }
  const input = payload as { sourcePath: string; targetPath: string; mode: 'copy' | 'move'; appendRandomByte?: boolean }
  try {
    const sourceSafe = assertAllowedRealPath(input.sourcePath)
    if (!existsSync(sourceSafe)) return { success: false }
    
    // Add target to allowed roots before asserting
    const targetDir = path.dirname(input.targetPath)
    if (!getAllowedRoots().some((root) => targetDir.startsWith(root))) {
      addAllowedRoot(targetDir)
    }
    const targetSafe = assertAllowedRealPath(input.targetPath)
    
    mkdirSync(path.dirname(targetSafe), { recursive: true })

    if (input.mode === 'move') {
      renameSync(sourceSafe, targetSafe)
    } else {
      copyFileSync(sourceSafe, targetSafe)
    }

    if (input.appendRandomByte) {
      const buffer = Buffer.from([Math.floor(Math.random() * 256)])
      appendFileSync(targetSafe, buffer)
    }

    return { success: true }
  } catch (error) {
    console.error('distributeCompositeFile error', error)
    return { success: false }
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('fs:select-directory', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择本地保存目录',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    addAllowedRoot(result.filePaths[0])
    return result.filePaths[0]
  })

  ipcMain.handle('fs:select-file', async (event, { filters }: { filters?: Electron.FileFilter[] }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      title: '选择本地文件',
      filters: filters ?? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    addAllowedRoot(path.dirname(result.filePaths[0]))
    return result.filePaths[0]
  })

  ipcMain.handle('fs:select-files', async (event, { filters }: { filters?: Electron.FileFilter[] }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      title: '选择本地文件',
      filters: filters ?? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    result.filePaths.forEach(p => addAllowedRoot(path.dirname(p)))
    return result.filePaths
  })

  ipcMain.handle('fs:save-image', async (_event, { filePath, dataUrl }: { filePath: string; dataUrl: string }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      const { buffer } = dataUrlToBuffer(dataUrl)
      const dir = path.dirname(safeFilePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(safeFilePath, buffer)
      return true
    } catch (err) {
      console.error('保存图片失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:save-json', async (_event, { filePath, data }: { filePath: string; data: unknown }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      const dir = path.dirname(safeFilePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(safeFilePath, JSON.stringify(data, null, 2), 'utf-8')
      return true
    } catch (err) {
      console.error('保存 JSON 失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:save-text', async (_event, { filePath, content }: { filePath: string; content: string }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      const dir = path.dirname(safeFilePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(safeFilePath, content, 'utf-8')
      return true
    } catch (err) {
      console.error('保存文本失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:ensure-dir', async (_event, { dirPath }: { dirPath: string }) => {
    try {
      const safeDirPath = assertAllowedPath(dirPath)
      if (!existsSync(safeDirPath)) mkdirSync(safeDirPath, { recursive: true })
      return true
    } catch (err) {
      console.error('创建目录失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:remove-empty-dir', async (_event, { dirPath }: { dirPath: string }) => {
    try {
      const safeDirPath = assertAllowedPath(dirPath)
      if (existsSync(safeDirPath) && statSync(safeDirPath).isDirectory()) {
        const files = readdirSync(safeDirPath)
        if (files.length === 0) {
          rmdirSync(safeDirPath)
          return true
        }
      }
      return false
    } catch (err) {
      console.error('删除空目录失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:path-join', async (_event, { paths }: { paths: string[] }) => {
    return path.join(...paths)
  })

  ipcMain.handle('fs:check-exists', async (_event, { filePath }: { filePath: string }) => {
    try {
      return existsSync(assertAllowedPath(filePath))
    } catch {
      return false
    }
  })

  ipcMain.handle('fs:read-dir', async (_event, { dirPath }: { dirPath: string }) => {
    try {
      const safeDirPath = assertAllowedPath(dirPath)
      if (!existsSync(safeDirPath)) return []
      return readdirSync(safeDirPath)
    } catch {
      return []
    }
  })

  ipcMain.handle('composite:read-image-file', async (_event, { filePath }: { filePath: string }) => {
    try {
      return readImageFilePayload(filePath)
    } catch (err) {
      console.error('读取合成图片失败:', err)
      return null
    }
  })

  ipcMain.handle('composite:list-image-files', async (_event, { dirPath }: { dirPath: string }) => {
    try {
      return listCompositeImageFiles(dirPath)
    } catch (err) {
      console.error('列出合成图片失败:', err)
      return []
    }
  })

  ipcMain.handle('composite:list-background-files', async (_event, payload: unknown) => {
    try {
      return handleCompositeListBackgroundFilesPayload(payload)
    } catch (err) {
      console.error('Failed to list composite background files:', err)
      return []
    }
  })

  ipcMain.handle('composite:scan-entered-background-folder', async (_event, payload: unknown) => {
    const parsed = parseCompositeListBackgroundFilesPayload(payload)
    if (!parsed) return { success: false, error: '文件夹参数无效。' }
    return scanEnteredCompositeBackgroundFolder(parsed.dirPath, parsed.recursive)
  })

  ipcMain.handle('composite:pick-image-file', async (_event, { path: inputPath, mode, index }: { path: string; mode: 'random' | 'sequential'; index: number }) => {
    try {
      const safePath = assertAllowedPath(inputPath)
      const stat = statSync(safePath)
      if (stat.isFile()) return readImageFilePayload(safePath)
      if (!stat.isDirectory()) return null
      const files = listCompositeImageFiles(safePath)
      if (!files.length) return null
      const picked = mode === 'random'
        ? files[Math.floor(Math.random() * files.length)]
        : files[((index % files.length) + files.length) % files.length]
      return readImageFilePayload(picked.path)
    } catch (err) {
      console.error('抽取合成图片失败:', err)
      return null
    }
  })

  ipcMain.handle('composite:delete-files', async (_event, payload: unknown) => {
    try {
      return handleDeleteCompositeFilesPayload(payload)
    } catch (err) {
      console.error('Failed to delete composite files:', err)
      return { deleted: [], failed: [] }
    }
  })

  ipcMain.handle('composite:distribute-file', async (_event, payload) => distributeCompositeFile(payload))

  ipcMain.handle('composite:authorize-output-directory', async (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return false
    return authorizeCompositeOutputDirectory((payload as { dirPath?: unknown }).dirPath)
  })

  ipcMain.handle('fs:read-file-buffer', async (_event, { filePath }: { filePath: string }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      if (!existsSync(safeFilePath)) return null
      const buffer = readFileSync(safeFilePath)
      const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      return { data: arrayBuffer, name: path.basename(safeFilePath) }
    } catch (err) {
      console.error('读取文件失败:', err)
      return null
    }
  })

  ipcMain.handle('composite:save-image', async (_event, { filePath, dataUrl }: { filePath: string; dataUrl: string; maxSizeKb?: number }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      const { buffer } = dataUrlToBuffer(dataUrl)
      const dir = path.dirname(safeFilePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(safeFilePath, buffer)
      return true
    } catch (err) {
      console.error('保存合成图片失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:get-default-path', async () => {
    return path.join(app.getPath('userData'), 'local-saves')
  })

  ipcMain.handle('fs:get-desktop-path', async () => {
    return app.getPath('desktop')
  })

  ipcMain.handle('fs:open-in-explorer', async (_event, { filePath }: { filePath: string }) => {
    const safePath = assertAllowedPath(filePath)
    if (existsSync(safePath) && statSync(safePath).isDirectory()) {
      await shell.openPath(safePath)
      return
    }
    shell.showItemInFolder(safePath)
  })

  ipcMain.handle('store:get-local-save-path', async () => {
    const settings = readLocalSettings()
    return (settings.localSavePath as string) ?? null
  })

  ipcMain.handle('store:set-local-save-path', async (_event, { path: savePath }: { path: string }) => {
    const settings = readLocalSettings()
    const safeSavePath = assertAllowedPath(savePath)
    addAllowedRoot(safeSavePath)
    settings.localSavePath = safeSavePath
    writeLocalSettings(settings)
  })

  ipcMain.handle('store:copy-cache-to-root', async (_event, { newRoot }: { newRoot: string }) => {
    const safeNewRoot = assertAllowedPath(newRoot)
    addAllowedRoot(safeNewRoot)
    const sourceDir = getCacheImagesDir()
    if (!sourceDir) return []
    return copyCacheImageDirectory(sourceDir, path.join(safeNewRoot, 'cache-images'))
  })

  ipcMain.handle('fs:read-json-text', async (_event, { filePath }: { filePath: string }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      if (!existsSync(safeFilePath)) return null
      const content = readFileSync(safeFilePath, 'utf-8')
      if (content && content.trim()) return content
      const bakPath = safeFilePath + '.bak'
      if (existsSync(bakPath)) {
        const bakContent = readFileSync(bakPath, 'utf-8')
        if (bakContent && bakContent.trim()) return bakContent
      }
      return null
    } catch (err) {
      console.error('读取 JSON 文本失败:', err)
      try {
        const bakPath = assertAllowedPath(filePath) + '.bak'
        if (existsSync(bakPath)) {
          const bakContent = readFileSync(bakPath, 'utf-8')
          if (bakContent && bakContent.trim()) return bakContent
        }
      } catch {}
      return null
    }
  })

  ipcMain.handle('fs:write-json-text', async (_event, { filePath, content, skipBackup, backupInterval }: { filePath: string; content: string; skipBackup?: boolean; backupInterval?: number }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      const dir = path.dirname(safeFilePath)
      await fsPromises.mkdir(dir, { recursive: true })
      // 写入前自动备份旧文件
      const fileExists = await pathExists(safeFilePath)
      if (!skipBackup && fileExists) {
        try {
          const backupDir = path.join(dir, 'backups')
          await fsPromises.mkdir(backupDir, { recursive: true })
          const intervalMs = (backupInterval ?? 0) * 60 * 1000
          const baseName = path.basename(safeFilePath).replace(/\.[^.]+$/, '')
          let shouldBackup = true
          if (intervalMs > 0) {
            const backups = await listBackupFiles(backupDir, baseName)
            if (backups.length > 0) {
              const lastBackupTime = (await fsPromises.stat(backups[0])).mtimeMs
              shouldBackup = Date.now() - lastBackupTime >= intervalMs
            }
          }
          if (shouldBackup) {
            const ts = new Date().toISOString().replace(/[:.]/g, '-')
            const backupName = baseName + '-' + ts + '.json'
            await fsPromises.copyFile(safeFilePath, path.join(backupDir, backupName))
          }
          // 只保留最近 30 个备份
          await pruneBackupFilesAsync(await listBackupFiles(backupDir, baseName), 30)
        } catch (backupErr) {
          console.error('自动备份失败（不影响写入）:', backupErr)
        }
      }
      const bakPath = safeFilePath + '.bak'
      if (fileExists) {
        try { await fsPromises.copyFile(safeFilePath, bakPath) } catch {}
      }
      const tmpPath = safeFilePath + '.tmp'
      await fsPromises.writeFile(tmpPath, content, 'utf-8')
      try {
        await fsPromises.rename(tmpPath, safeFilePath)
      } catch {
        try { await fsPromises.copyFile(tmpPath, safeFilePath) } catch {}
        try { await fsPromises.unlink(tmpPath) } catch {}
      }
      return true
    } catch (err) {
      console.error('写入 JSON 文本失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:list-backups', async (_event, { filePath }: { filePath: string }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      const dir = path.join(path.dirname(safeFilePath), 'backups')
      if (!existsSync(dir)) return []
      return readdirSync(dir)
        .map((name) => ({ name, fullPath: path.join(dir, name) }))
        .filter((f) => f.name.startsWith(path.basename(safeFilePath).replace(/\.[^.]+$/, '') + '-'))
        .sort((a, b) => statSync(b.fullPath).mtimeMs - statSync(a.fullPath).mtimeMs)
        .map((f) => f.fullPath)
    } catch (err) {
      console.error('列出备份失败:', err)
      return []
    }
  })

  ipcMain.handle('fs:check-backup-has-data', async (_event, { backupPath }: { backupPath: string }) => {
    try {
      const safeBackupPath = assertAllowedPath(backupPath)
      if (!existsSync(safeBackupPath)) return false
      const content = readFileSync(safeBackupPath, 'utf-8')
      return backupJsonHasData(JSON.parse(content))
    } catch (err) {
      return false
    }
  })

  ipcMain.handle('fs:restore-from-backup', async (_event, { backupPath, targetPath }: { backupPath: string; targetPath: string }) => {
    try {
      const safeBackupPath = assertAllowedPath(backupPath)
      const safeTargetPath = assertAllowedPath(targetPath)
      if (!existsSync(safeBackupPath)) return false
      const dir = path.dirname(safeTargetPath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      copyFileSync(safeBackupPath, safeTargetPath)
      return true
    } catch (err) {
      console.error('从备份恢复失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:delete-backup', async (_event, { backupPath }: { backupPath: string }) => {
    try {
      const safeBackupPath = assertAllowedPath(backupPath)
      if (!existsSync(safeBackupPath)) return false
      unlinkSync(safeBackupPath)
      return true
    } catch (err) {
      console.error('删除备份失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:save-zip-buffer', async (_event, { filePath, buffer }: { filePath: string; buffer: ArrayBuffer }) => {
    try {
      const safeFilePath = assertAllowedPath(filePath)
      const dir = path.dirname(safeFilePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(safeFilePath, Buffer.from(buffer))
      return true
    } catch (err) {
      console.error('保存 ZIP 文件失败:', err)
      return false
    }
  })

  ipcMain.handle('fs:select-zip-save-path', async (event, payload: { defaultName?: unknown }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showSaveDialog(win!, {
      title: '导出数据',
      defaultPath: typeof payload?.defaultName === 'string' ? payload.defaultName : 'gpt-image-playground-backup.zip',
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    })
    return result.canceled ? null : result.filePath ?? null
  })

  ipcMain.handle('store:delete-cache-images', (_event, payload: { filePaths?: unknown }) =>
    deleteCacheImageFiles(Array.isArray(payload?.filePaths) ? payload.filePaths.filter((item): item is string => typeof item === 'string') : []))

  ipcMain.handle('store:reconcile-cache-images', (_event, payload: { referencedFileNames?: unknown }) =>
    reconcileCacheImageFiles(Array.isArray(payload?.referencedFileNames) ? payload.referencedFileNames.filter((item): item is string => typeof item === 'string') : []))

  ipcMain.handle('fs:export-zip', async (_event, payload: unknown) => {
    try {
      const request = parseStreamingZipRequest(payload)
      if (!request) return { success: false, error: '导出参数无效' }
      const destinationPath = assertAllowedPath(request.destinationPath)
      const entries = request.entries.map((entry) => 'sourcePath' in entry
        ? { ...entry, sourcePath: assertAllowedRealPath(entry.sourcePath) }
        : entry)
      return writeStreamingZip({ ...request, destinationPath, entries })
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
