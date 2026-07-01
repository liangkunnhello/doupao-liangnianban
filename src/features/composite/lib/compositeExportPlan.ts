import { getEffectiveOutputRuleGroups, getEnabledOutputRules, type CompositeV2EnabledOutputRule } from './compositeOutputRulesV2'
import type {
  CompositeV2BackgroundImage,
  CompositeV2CustomVariable,
  CompositeV2FitMode,
  CompositeV2OutputRuleGroup,
  CompositeV2Preset,
  CompositeV2PresetGroup,
} from './compositeV2Types'

export type CompositeV2ExportSnapshotInput = {
  id: string
  date: string
  backgroundFolders: string[]
  recursive: boolean
  backgrounds: CompositeV2BackgroundImage[]
  presets: CompositeV2Preset[]
  presetGroup: CompositeV2PresetGroup
  enabledPresetIds: string[]
  outputRuleGroups: CompositeV2OutputRuleGroup[]
  smartMatchOrientation: boolean
  custom: string
  customVariables: CompositeV2CustomVariable[]
  fitMode: CompositeV2FitMode
  preserveSourceDir: boolean
}

export type CompositeV2ExportSnapshot = CompositeV2ExportSnapshotInput & {
  createdAt: number
}

export type CompositeV2ExportItem = {
  snapshotId: string
  background: CompositeV2BackgroundImage
  preset: CompositeV2Preset
  outputRule: CompositeV2EnabledOutputRule
  index: number
  date: string
  custom: string
}

export function createCompositeExportSnapshot(input: CompositeV2ExportSnapshotInput, now = Date.now()): CompositeV2ExportSnapshot {
  return structuredClone({ ...input, createdAt: now })
}

export function expandCompositeExportItems(snapshot: CompositeV2ExportSnapshot): CompositeV2ExportItem[] {
  const presetsById = new Map(snapshot.presets.map((preset) => [preset.id, preset]))
  const enabledPresetSet = new Set(snapshot.enabledPresetIds)
  const orderedPresets = snapshot.presetGroup.presetIds
    .filter((presetId) => enabledPresetSet.has(presetId))
    .map((presetId) => presetsById.get(presetId))
    .filter((preset): preset is CompositeV2Preset => Boolean(preset))

  const getOrientation = (w: number, h: number) => Number(w) > Number(h) ? 'landscape' : Number(h) > Number(w) ? 'portrait' : 'square'

  return orderedPresets.flatMap((preset) => {
    const rules = getEnabledOutputRules(getEffectiveOutputRuleGroups(preset, snapshot.outputRuleGroups))
    return rules.flatMap((rule) => {
      const ruleOrientation = getOrientation(rule.width, rule.height)
      
      return snapshot.backgrounds
        .filter((background) => {
          if (!snapshot.smartMatchOrientation) return true
          // 智能比例匹配：横版配横版，竖版配竖版，方形配方形
          const bgOrientation = getOrientation(background.width || 0, background.height || 0)
          return bgOrientation === ruleOrientation
        })
        .map((background, backgroundIndex) => {
          return {
            snapshotId: snapshot.id,
            background,
            preset,
            outputRule: rule,
            index: backgroundIndex + 1,
            date: snapshot.date,
            custom: snapshot.custom,
          }
        })
    })
  })
}
