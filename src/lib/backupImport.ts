import type { ExportData } from '../types'
import { restoreWorkspaceBackupState } from './workspaceBackup'

export type BackupImportSelection = {
  importConfig?: boolean
  importTasks?: boolean
  importImages?: boolean
}

const CURRENT_BACKUP_VERSION = 5

function assertArchivePath(path: string): void {
  const normalized = path.replace(/\\/g, '/')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`备份包含不安全路径：${path}`)
  }
}

function assertFilesExist(
  entries: Array<{ path: string }>,
  files: Record<string, Uint8Array>,
): void {
  for (const entry of entries) {
    assertArchivePath(entry.path)
    if (!files[entry.path]) throw new Error(`备份缺少文件：${entry.path}`)
  }
}

export function validateBackupArchive(
  data: ExportData,
  files: Record<string, Uint8Array>,
  selection: BackupImportSelection,
): void {
  if (!Number.isInteger(data.version) || data.version < 1) {
    throw new Error('备份版本无效')
  }
  if (data.version > CURRENT_BACKUP_VERSION) {
    throw new Error(`备份版本 ${data.version} 高于当前支持的版本 ${CURRENT_BACKUP_VERSION}，请升级应用后重试`)
  }

  if (selection.importImages) {
    assertFilesExist(Object.values(data.imageFiles ?? {}), files)
  }
  if (selection.importTasks) {
    assertFilesExist(Object.values(data.thumbnailFiles ?? {}), files)
  }
  if (selection.importConfig) {
    assertFilesExist(Object.values(data.compositeAssetFiles ?? {}), files)
  }

  if (
    data.version >= 5 &&
    data.workspaceState &&
    selection.importConfig &&
    selection.importTasks
  ) {
    restoreWorkspaceBackupState(
      data.workspaceState,
      data.tasks ?? [],
      new Set(Object.keys(data.imageFiles ?? {})),
    )
  }
}
