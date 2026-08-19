// 备份与数据板块工具

import { exportDataToPath } from '../../store'
import { formatStorageBytes, getStorageOverview } from '../../lib/storageStats'
import { getBackupList, getBackupPath, getLocalSavePath, isElectron } from '../../lib/localSave'
import { errorResult, textResult, type McpToolDefinition } from '../types'

export const backupTools: McpToolDefinition[] = [
  {
    name: 'backup_list',
    description: '列出应用状态文件的自动备份（按时间倒序的文件路径列表）以及本地保存根目录。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      if (!isElectron()) return errorResult('备份功能仅在桌面端可用')
      const [backups, backupDir, localSavePath] = await Promise.all([
        getBackupList().catch(() => [] as string[]),
        getBackupPath().catch(() => ''),
        getLocalSavePath().catch(() => null),
      ])
      return textResult({ backupDir, localSavePath, backups })
    },
  },
  {
    name: 'backup_create',
    description:
      '立即创建一次完整数据备份（导出 ZIP 到备份目录，包含配置/任务/Agent 对话/词库/合成预设等）。includeImages=false 时不打包图片文件（更快、更小）。',
    inputSchema: {
      type: 'object',
      properties: {
        includeImages: { type: 'boolean', description: '是否打包图片文件，默认 true' },
        includeTasks: { type: 'boolean', description: '是否包含任务记录，默认 true' },
      },
      additionalProperties: false,
    },
    timeoutSeconds: 600,
    handler: async (args) => {
      if (!isElectron()) return errorResult('备份功能仅在桌面端可用')
      const backupDir = await getBackupPath().catch(() => '')
      if (!backupDir) return errorResult('无法确定备份目录')
      const now = new Date()
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
      const filePath = `${backupDir}/doupao-backup-${stamp}.zip`
      const includeTasks = args.includeTasks !== false
      const success = await exportDataToPath(filePath, {
        exportConfig: true,
        exportTasks: includeTasks,
        exportImages: args.includeImages !== false,
      })
      if (!success) return errorResult('备份失败（应用内有详细提示）')
      return textResult({ filePath, message: '备份已创建' })
    },
  },
  {
    name: 'storage_stats',
    description: '查看本地存储占用：IndexedDB 用量/配额与各类记录数（任务、图片、缩略图、对话、合成素材）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const overview = await getStorageOverview()
      return textResult({
        usage: formatStorageBytes(overview.usageBytes),
        quota: formatStorageBytes(overview.quotaBytes),
        usagePercent: overview.usagePercent,
        counts: overview.counts,
      })
    },
  },
]
