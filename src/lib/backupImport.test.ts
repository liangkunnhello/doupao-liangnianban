import { describe, expect, it } from 'vitest'
import type { ExportData } from '../types'
import { validateBackupArchive } from './backupImport'

function manifest(patch: Partial<ExportData> = {}): ExportData {
  return {
    version: 4,
    exportedAt: new Date(0).toISOString(),
    ...patch,
  }
}

describe('validateBackupArchive', () => {
  it('rejects unsupported future versions', () => {
    expect(() => validateBackupArchive(manifest({ version: 5 }), {}, {
      importImages: true,
      importTasks: true,
      importConfig: true,
    })).toThrow('备份版本 5')
  })

  it('rejects missing files before import starts', () => {
    expect(() => validateBackupArchive(manifest({
      imageFiles: {
        'image-a': { path: 'images/image-a.png' },
      },
    }), {}, {
      importImages: true,
      importTasks: false,
      importConfig: false,
    })).toThrow('images/image-a.png')
  })

  it('accepts legacy versions and ignores unselected domains', () => {
    expect(() => validateBackupArchive(manifest({
      version: 2,
      imageFiles: {
        'image-a': { path: 'images/image-a.png' },
      },
    }), {}, {
      importImages: false,
      importTasks: true,
      importConfig: false,
    })).not.toThrow()
  })
})
