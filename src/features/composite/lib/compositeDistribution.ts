import type { CompositeV2DistributionConfig, CompositeV2SuccessItem } from './compositeV2Types'

export type DistributionResult = {
  success: number
  failed: number
  errors: string[]
}

export async function runDistribution(
  items: CompositeV2SuccessItem[],
  config: CompositeV2DistributionConfig,
  electronApi: any,
  presets: any[]
): Promise<DistributionResult> {
  if (!config.enabled || items.length === 0 || config.days <= 0) {
    return { success: 0, failed: 0, errors: [] }
  }

  const result: DistributionResult = { success: 0, failed: 0, errors: [] }

  // 1. Parse start date
  let currentYear = 2026
  let currentMonth = 1
  let currentDay = 1
  const dateMatch = config.startDate.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (dateMatch) {
    currentYear = parseInt(dateMatch[1]!, 10)
    currentMonth = parseInt(dateMatch[2]!, 10)
    currentDay = parseInt(dateMatch[3]!, 10)
  } else {
    result.errors.push(`起始日期格式错误，期望 YYYYMMDD，实际为: ${config.startDate}`)
    return result
  }

  let currentDate = new Date(currentYear, currentMonth - 1, currentDay)

  // 2. Generate target dates
  const targetDates: string[] = []
  while (targetDates.length < config.days) {
    if (config.skipWeekends) {
      const dayOfWeek = currentDate.getDay()
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        currentDate.setDate(currentDate.getDate() + 1)
        continue
      }
    }
    const yyyy = currentDate.getFullYear()
    const mm = String(currentDate.getMonth() + 1).padStart(2, '0')
    const dd = String(currentDate.getDate()).padStart(2, '0')
    targetDates.push(`${yyyy}${mm}${dd}`)
    currentDate.setDate(currentDate.getDate() + 1)
  }

  // 3. Group files by their original parent directory
  // In `items`, the path is the full file path. The outputRule might have put them in different folders.
  // The user wants: "每个目标文件夹独立执行" (Independent execution for each target folder).
  // So we group by the directory of the file.
  // We also lookup preset.distributionPath or channel-specific distribution paths
  const groupedItems = new Map<string, CompositeV2SuccessItem[]>()
  for (const item of items) {
    const preset = presets.find((p) => p.id === item.presetId)
    
    let distPaths: string[] = []
    const overrideGroup = preset?.outputRuleGroupsOverride?.find((g: any) => g.id === item.channel)
    if (overrideGroup?.distributionPaths && overrideGroup.distributionPaths.length > 0) {
      const validPaths = overrideGroup.distributionPaths.filter((p: string) => p.trim() !== '')
      if (validPaths.length > 0) distPaths = validPaths
    }
    
    if (distPaths.length === 0) {
      const presetDistPath = preset?.distributionPath?.trim()
      if (presetDistPath) distPaths = [presetDistPath]
    }

    let originalDir = item.path.replace(/[/\\][^/\\]+$/, '')
    
    // If no dist paths, just use the original dir
    if (distPaths.length === 0) {
      const group = groupedItems.get(originalDir) || []
      group.push(item)
      groupedItems.set(originalDir, group)
      continue
    }

    // If there are dist paths, we create a group for EACH dist path
    for (const baseDistDir of distPaths) {
      let dir = originalDir
      const outRoot = preset?.outputRootPath?.trim()
      if (outRoot && dir.startsWith(outRoot)) {
        const relative = dir.slice(outRoot.length).replace(/^[/\\]+/, '')
        dir = `${baseDistDir}${baseDistDir.endsWith('\\') || baseDistDir.endsWith('/') ? '' : '\\'}${relative}`
      } else {
        dir = baseDistDir
      }

      const group = groupedItems.get(dir) || []
      group.push(item)
      groupedItems.set(dir, group)
    }
  }

  // 4. Distribute files for each group
  for (const [originalDir, groupItems] of groupedItems.entries()) {
    // Shuffle if needed
    let filesToDistribute = [...groupItems]
    if (config.randomize) {
      for (let i = filesToDistribute.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const temp = filesToDistribute[i]!
        filesToDistribute[i] = filesToDistribute[j]!
        filesToDistribute[j] = temp
      }
    }

    // Average distribution
    const totalFiles = filesToDistribute.length
    const days = targetDates.length
    const baseCount = Math.floor(totalFiles / days)
    const remainder = totalFiles % days

    let fileIndex = 0
    for (let dayIndex = 0; dayIndex < days; dayIndex++) {
      const targetDate = targetDates[dayIndex]!
      const countForThisDay = baseCount + (dayIndex < remainder ? 1 : 0)

      // Calculate target directory (始终使用日期来区分文件夹批次)
      let targetDir = originalDir
      // 如果原路径中存在类似 20260701 的日期，则替换它；否则，尝试在末尾追加日期子文件夹
      if (/\b(20\d{6})\b/.test(originalDir)) {
        targetDir = originalDir.replace(/\b(20\d{6})\b/, targetDate)
      } else {
        // 如果没有匹配到日期，直接把目标日期作为子文件夹追加在后面
        // 例如 D:\Exports\MyFolder -> D:\Exports\MyFolder\20260701
        targetDir = `${originalDir}\\${targetDate}`
      }

      const folderBasename = targetDir.split(/[/\\]/).pop() || targetDate

      for (let k = 0; k < countForThisDay; k++) {
        if (fileIndex >= totalFiles) break
        const item = filesToDistribute[fileIndex]!
        fileIndex++

        const originalFileName = item.path.split(/[/\\]/).pop() || ''
        let targetFileName = originalFileName
        
        if (config.renameMode === 'date') {
          // 仅替换原文件名中的日期
          targetFileName = originalFileName.replace(/\b(20\d{6})\b/, targetDate)
        } else {
          // sequence mode: 完全按照文件夹命名来命名文件，并追加序号
          const lastDot = originalFileName.lastIndexOf('.')
          const ext = lastDot !== -1 ? originalFileName.slice(lastDot) : ''
          targetFileName = `${folderBasename}_${String(k + 1).padStart(2, '0')}${ext}`
        }
        
        // Use electronAPI to pathJoin
        try {
          const targetPath = await electronApi.pathJoin(targetDir, targetFileName)
          
          // Actually do the copy/move using electronAPI
          const opResult = await electronApi.distributeFile?.({
            sourcePath: item.path,
            targetPath,
            mode: config.mode,
            appendRandomByte: config.modifyMd5,
          })

          if (opResult?.success) {
            result.success++
          } else {
            result.failed++
            result.errors.push(`操作失败: ${item.path} -> ${targetPath}`)
          }
        } catch (error: any) {
          result.failed++
          result.errors.push(`异常: ${error.message}`)
        }
      }
    }

    // After moving files out of originalDir, check if we should remove it
    if (config.mode === 'move') {
      try {
        await electronApi.removeEmptyDir?.(originalDir)
      } catch (e) {
        // ignore errors on folder deletion
      }
    }
  }

  return result
}