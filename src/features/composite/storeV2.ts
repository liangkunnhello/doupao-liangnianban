import { create } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { persist } from 'zustand/middleware'
import { createPreviewHistory } from './lib/compositeBackgrounds'
import { addCompositeHistoryRecord } from './lib/compositeExportHistoryV2'
import { createDefaultCompositeV2State } from './lib/compositeV2Defaults'
import { fitCompositeTextLayer } from './lib/compositeTextLayout'
import { hasLegacyCompositeAssets, migrateLegacyCompositeAssets } from './lib/compositeAssetMigration'
import type {
  CompositeV2BackgroundImage,
  CompositeV2ExportStatus,
  CompositeV2ImageAssetRef,
  CompositeV2FailureItem,
  CompositeV2HistoryRecord,
  CompositeV2FitMode,
  CompositeV2Layer,
  CompositeV2OutputSizeRule,
  CompositeV2OutputRuleGroup,
  CompositeV2PersistedSnapshot,
  CompositeV2SuccessItem,
  CompositeV2State,
} from './lib/compositeV2Types'

type CompositeV2BatchState = {
  backgroundFolders: string[]
  recursiveBackgrounds: boolean
  backgrounds: CompositeV2BackgroundImage[]
  previewHistory: string[]
  previewHistoryIndex: number
  selectedPresetGroupId: string
  selectedPreviewPresetId: string
  enabledPresetIdsForRun: string[]
  smartMatchOrientation: boolean
  customValue: string
  preserveSourceDir: boolean
  exportStatus: CompositeV2ExportStatus
  exportCompleted: number
  exportTotal: number
  exportSuccesses: CompositeV2SuccessItem[]
  exportFailures: CompositeV2FailureItem[]
  clipboardLayer: CompositeV2Layer | null
}

type CompositeV2UndoSnapshot = {
  logoLibraryPath: string
  logoOrder: string[]
  projectLogos: CompositeV2State['projectLogos']
  customVariables: CompositeV2State['customVariables']
  backgroundFolders: string[]
  recursiveBackgrounds: boolean
  backgrounds: CompositeV2BackgroundImage[]
  previewHistory: string[]
  previewHistoryIndex: number
  selectedPresetGroupId: string
  selectedPreviewPresetId: string
  enabledPresetIdsForRun: string[]
  smartMatchOrientation: boolean
  customValue: string
  preserveSourceDir: boolean
  presets: CompositeV2State['presets']
  presetGroups: CompositeV2State['presetGroups']
  outputRuleGroups: CompositeV2State['outputRuleGroups']
  globalFitMode: CompositeV2FitMode
  historyRetention: number
  distributionConfig: CompositeV2State['distributionConfig']
}

type CompositeV2UndoState = {
  undoStack: CompositeV2UndoSnapshot[]
  redoStack: CompositeV2UndoSnapshot[]
  lastHistoryMeta: { mergeKey: string; timestamp: number } | null
  canUndo: boolean
  canRedo: boolean
}

type CompositeV2StoreActions = {
  undo: () => void
  redo: () => void
  setLogoLibraryPath: (path: string) => void
  setLogoOrder: (order: string[]) => void
  addProjectLogos: (logos: CompositeV2State['projectLogos']) => void
  removeProjectLogo: (id: string) => void
  renameProjectLogo: (id: string, name: string) => void
  setCustomVariables: (variables: CompositeV2State['customVariables']) => void
  setBackgroundFolders: (paths: string[]) => void
  setRecursiveBackgrounds: (recursive: boolean) => void
  setBackgrounds: (backgrounds: CompositeV2BackgroundImage[]) => void
  updatePreset: (presetId: string, patch: Partial<CompositeV2State['presets'][number]>) => void
  addImageLayer: (presetId: string, asset?: CompositeV2ImageAssetRef) => void
  replaceOrAddLogoLayer: (presetId: string, asset: CompositeV2ImageAssetRef, selectedLayerId?: string) => string
  addTextLayer: (presetId: string) => void
  addLogoLayer: (presetId: string) => void
  setSelectedPresetGroup: (groupId: string) => void
  setSelectedPreviewPresetId: (presetId: string) => void
  setEnabledPresetIdsForRun: (presetIds: string[]) => void
  setSmartMatchOrientation: (smartMatchOrientation: boolean) => void
  setCustomValue: (value: string) => void
  setPreserveSourceDir: (preserveSourceDir: boolean) => void
  pushPreviewBackground: (path: string) => void
  previousPreviewBackground: () => void
  nextPreviewBackground: () => void
  setExportProgress: (completed: number, total: number) => void
  setExportStatus: (status: CompositeV2ExportStatus) => void
  resetExportResults: () => void
  addExportSuccess: (item: CompositeV2SuccessItem) => void
  addExportFailure: (item: CompositeV2FailureItem) => void
  addHistoryRecord: (record: CompositeV2HistoryRecord) => void
  updateHistoryRecord: (id: string, patch: Partial<CompositeV2HistoryRecord>) => void
  setHistoryRetention: (retention: number) => void
  createPresetGroup: (name: string) => void
  createPreset: (name: string) => void
  deletePreset: (presetId: string) => void
  renamePresetGroup: (groupId: string, name: string) => void
  movePresetGroup: (groupId: string, targetIndex: number) => void
  duplicatePresetGroup: (groupId: string) => void
  deletePresetGroup: (groupId: string) => void
  reorderPresetInGroup: (groupId: string, presetId: string, targetIndex: number) => void
  duplicatePreset: (presetId: string) => void
  addPresetToGroup: (presetId: string, groupId: string) => void
  removePresetFromGroup: (presetId: string, groupId: string) => void
  copyLayer: (presetId: string, layerId: string) => void
  pasteLayer: (presetId: string) => void
  duplicateLayer: (presetId: string, layerId: string) => void
  setGlobalFitMode: (mode: CompositeV2FitMode) => void
  updateOutputRule: (ruleId: string, patch: Partial<CompositeV2OutputSizeRule>) => void
  setOutputRuleGroupEnabled: (groupId: string, enabled: boolean) => void
  addOutputRuleGroup: (name: string, id?: string) => void
  updateOutputRuleGroup: (groupId: string, patch: Partial<CompositeV2OutputRuleGroup>) => void
  deleteOutputRuleGroup: (groupId: string) => void
  addOutputRule: (groupId: string, rule: Omit<CompositeV2OutputSizeRule, 'id'>) => void
  deleteOutputRule: (groupId: string, ruleId: string) => void
  setDistributionConfig: (patch: Partial<CompositeV2State['distributionConfig']>) => void
}

export type CompositeV2StoreState = CompositeV2BatchState & CompositeV2UndoState & CompositeV2State & CompositeV2StoreActions

export type CompositeV2PersistedState = CompositeV2PersistedSnapshot

export type CreateCompositeV2StoreOptions = {
  pickRandomIndex?: (length: number) => number
}

const STORAGE_NAME = 'doupao-composite-v2-workspace-storage'
const DEFAULT_LAYER_POSITION = { mode: 'free' as const, x: 100, y: 100, width: 240, height: 120 }
const DEFAULT_LAYER_SHADOW = { enabled: false, color: '#000000', x: 0, y: 4, blur: 12, opacity: 0.25 }
const DEFAULT_LAYER_STROKE = { enabled: false, color: '#111827', width: 0 }
const HISTORY_LIMIT = 100
const HISTORY_MERGE_WINDOW_MS = 1200

export function createCompositeV2StoreState(): CompositeV2BatchState & CompositeV2UndoState & CompositeV2State {
  const defaults = createDefaultCompositeV2State()
  const selectedPresetGroupId = defaults.presetGroups[0]?.id ?? ''

  return {
    logoLibraryPath: defaults.logoLibraryPath,
    logoOrder: [],
    projectLogos: [],
    customVariables: defaults.customVariables,
    backgroundFolders: [],
    recursiveBackgrounds: false,
    backgrounds: [],
    previewHistory: [],
    previewHistoryIndex: -1,
    selectedPresetGroupId,
    selectedPreviewPresetId: getFirstPresetIdForGroup(defaults.presetGroups, selectedPresetGroupId),
    enabledPresetIdsForRun: getPresetIdsForGroup(defaults.presetGroups, selectedPresetGroupId),
    smartMatchOrientation: false,
    customValue: '',
    preserveSourceDir: false,
    exportStatus: 'idle',
    exportCompleted: 0,
    exportTotal: 0,
    exportSuccesses: [],
    exportFailures: [],
    presets: defaults.presets,
    presetGroups: defaults.presetGroups,
    outputRuleGroups: defaults.outputRuleGroups,
    globalFitMode: defaults.globalFitMode,
    historyRetention: defaults.historyRetention,
    history: defaults.history,
    distributionConfig: {
    enabled: false,
    mode: 'move',
    renameMode: 'date',
    modifyMd5: true,
    startDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''), // YYYYMMDD
    days: 3,
    randomize: true,
    skipWeekends: false,
  },
    clipboardLayer: null,
    undoStack: [],
    redoStack: [],
    lastHistoryMeta: null,
    canUndo: false,
    canRedo: false,
  }
}

export function getCompositeV2PersistedState(state: CompositeV2StoreState): CompositeV2PersistedState {
  return {
    logoLibraryPath: state.logoLibraryPath,
    logoOrder: state.logoOrder ?? [],
    projectLogos: state.projectLogos ?? [],
    customVariables: state.customVariables ?? [],
    presets: state.presets,
    presetGroups: state.presetGroups,
    outputRuleGroups: state.outputRuleGroups,
    globalFitMode: state.globalFitMode,
    historyRetention: state.historyRetention,
    history: state.history,
    distributionConfig: {
      ...state.distributionConfig,
      startDate: undefined as any, // Do not persist startDate so it uses the fresh default (today) on load
    },
    backgroundFolders: state.backgroundFolders,
    recursiveBackgrounds: state.recursiveBackgrounds,
    selectedPresetGroupId: state.selectedPresetGroupId,
    selectedPreviewPresetId: state.selectedPreviewPresetId,
    enabledPresetIdsForRun: state.enabledPresetIdsForRun,
    smartMatchOrientation: state.smartMatchOrientation,
  }
}

export function mergeCompositeV2PersistedState(
  persistedState: unknown,
  currentState: CompositeV2StoreState,
): CompositeV2StoreState {
  if (!persistedState || typeof persistedState !== 'object') return currentState

  const persisted = persistedState as Partial<CompositeV2PersistedState>
  const merged = {
    ...currentState,
    ...persisted,
    distributionConfig: {
      ...currentState.distributionConfig,
      ...(persisted.distributionConfig ?? {}),
      startDate: currentState.distributionConfig.startDate,
    },
  } as CompositeV2StoreState
  const selectedGroup = getSelectedGroup(
    merged.presetGroups,
    persisted.selectedPresetGroupId ?? currentState.selectedPresetGroupId,
  )
  const selectedPresetGroupId = selectedGroup?.id ?? ''
  const groupPresetIds = [...(selectedGroup?.presetIds ?? [])]
  const requestedPreviewPresetId = persisted.selectedPreviewPresetId ?? currentState.selectedPreviewPresetId
  const selectedPreviewPresetId = groupPresetIds.includes(requestedPreviewPresetId)
    ? requestedPreviewPresetId
    : groupPresetIds[0] ?? ''
  const requestedEnabledPresetIds = Array.isArray(persisted.enabledPresetIdsForRun)
    ? persisted.enabledPresetIdsForRun
    : currentState.enabledPresetIdsForRun
  const validEnabledPresetIds = requestedEnabledPresetIds.filter((id) => groupPresetIds.includes(id))

  return {
    ...merged,
    selectedPresetGroupId,
    selectedPreviewPresetId,
    enabledPresetIdsForRun: validEnabledPresetIds.length > 0 ? validEnabledPresetIds : groupPresetIds,
  }
}

export function replaceCompositeV2PersistedState(snapshot: CompositeV2PersistedState): void {
  const merged = mergeCompositeV2PersistedState(snapshot, useCompositeV2Store.getState())
  useCompositeV2Store.setState(getCompositeV2PersistedState(merged))
}

export function createCompositeV2Store(options: CreateCompositeV2StoreOptions = {}) {
  return createStore<CompositeV2StoreState>()(createCompositeV2StoreInitializer(options))
}

export const useCompositeV2Store = create<CompositeV2StoreState>()(createCompositeV2StoreInitializer())

queueMicrotask(() => {
  const state = useCompositeV2Store.getState()
  if (!hasLegacyCompositeAssets(state)) return
  void migrateLegacyCompositeAssets({
    getState: useCompositeV2Store.getState,
    setState: (patch) => useCompositeV2Store.setState(patch),
  }).catch((error) => console.error('后期处理资源迁移失败:', error))
})

function createCompositeV2StoreInitializer(options: CreateCompositeV2StoreOptions = {}) {
  const pickRandomIndex = options.pickRandomIndex ?? defaultPickRandomIndex

  return persist<CompositeV2StoreState, [], [], CompositeV2PersistedState>(
    (set, get) => {
      const setWithHistory = (
        updater: (state: CompositeV2StoreState) => Partial<CompositeV2StoreState> | {},
        mergeKey?: string,
      ) => {
        set((state) => {
          const patch = updater(state)
          if (!patch || Object.keys(patch).length === 0) return patch
          const prevSnapshot = captureUndoSnapshot(state)
          const nextSnapshot = captureUndoSnapshot({ ...state, ...patch } as CompositeV2StoreState)
          if (areUndoSnapshotsEqual(prevSnapshot, nextSnapshot)) return patch
          const now = Date.now()
          const shouldMerge = Boolean(
            mergeKey
            && state.lastHistoryMeta
            && state.lastHistoryMeta.mergeKey === mergeKey
            && now - state.lastHistoryMeta.timestamp <= HISTORY_MERGE_WINDOW_MS,
          )
          const undoStack = shouldMerge
            ? state.undoStack
            : trimHistoryStack([...state.undoStack, structuredClone(prevSnapshot)])
          return {
            ...patch,
            undoStack,
            redoStack: [],
            lastHistoryMeta: mergeKey ? { mergeKey, timestamp: now } : null,
            canUndo: undoStack.length > 0,
            canRedo: false,
          }
        })
      }

      const setWithoutHistory = (
        updater: (state: CompositeV2StoreState) => Partial<CompositeV2StoreState> | {},
      ) => {
        set((state) => updater(state))
      }

      return {
      ...createCompositeV2StoreState(),
      undo: () => set((state) => {
        if (state.exportStatus === 'running' || state.exportStatus === 'paused' || state.exportStatus === 'canceling') return {}
        const snapshot = state.undoStack[state.undoStack.length - 1]
        if (!snapshot) return {}
        const currentSnapshot = captureUndoSnapshot(state)
        const undoStack = state.undoStack.slice(0, -1)
        const redoStack = trimHistoryStack([...state.redoStack, structuredClone(currentSnapshot)])
        return {
          ...applyUndoSnapshot(snapshot),
          undoStack,
          redoStack,
          lastHistoryMeta: null,
          canUndo: undoStack.length > 0,
          canRedo: redoStack.length > 0,
        }
      }),
      redo: () => set((state) => {
        if (state.exportStatus === 'running' || state.exportStatus === 'paused' || state.exportStatus === 'canceling') return {}
        const snapshot = state.redoStack[state.redoStack.length - 1]
        if (!snapshot) return {}
        const currentSnapshot = captureUndoSnapshot(state)
        const undoStack = trimHistoryStack([...state.undoStack, structuredClone(currentSnapshot)])
        const redoStack = state.redoStack.slice(0, -1)
        return {
          ...applyUndoSnapshot(snapshot),
          undoStack,
          redoStack,
          lastHistoryMeta: null,
          canUndo: undoStack.length > 0,
          canRedo: redoStack.length > 0,
        }
      }),
      setLogoLibraryPath: (logoLibraryPath) => setWithHistory(() => ({ logoLibraryPath }), 'logos:library-path'),
      setLogoOrder: (logoOrder) => setWithHistory(() => ({ logoOrder }), 'logos:order'),
      addProjectLogos: (logos) => setWithHistory((state) => ({ projectLogos: [...(state.projectLogos ?? []), ...logos] }), 'logos:assets'),
      removeProjectLogo: (id) => setWithHistory((state) => ({ projectLogos: (state.projectLogos ?? []).filter(l => l.id !== id) }), 'logos:assets'),
      renameProjectLogo: (id, name) => setWithHistory((state) => ({ projectLogos: (state.projectLogos ?? []).map(l => l.id === id ? { ...l, name } : l) }), 'logos:assets'),
      setCustomVariables: (customVariables) => setWithHistory(() => ({ customVariables }), 'naming:custom-variables'),
      setBackgroundFolders: (backgroundFolders) => setWithHistory(() => ({ backgroundFolders }), 'backgrounds:source'),
      setRecursiveBackgrounds: (recursiveBackgrounds) => setWithHistory(() => ({ recursiveBackgrounds }), 'backgrounds:source'),
      setBackgrounds: (backgrounds) => setWithHistory(() => ({
        backgrounds,
        ...createRandomPreviewState(backgrounds, pickRandomIndex),
      }), 'backgrounds:source'),
      updatePreset: (presetId, patch) => setWithHistory((state) => ({
        presets: updatePresets(state.presets, presetId, (preset, now) => ({
          ...preset,
          ...patch,
          updatedAt: now,
        })),
      }), getPresetPatchMergeKey(presetId, patch)),
      addImageLayer: (presetId, asset) => setWithHistory((state) => ({
        presets: updatePresets(state.presets, presetId, (preset, now) => ({
          ...preset,
          layers: [
            ...preset.layers,
            createImageLayer(asset ?? null, now, preset.baseCanvas),
          ],
          updatedAt: now,
        })),
      }), `preset:${presetId}:layers`),
      replaceOrAddLogoLayer: (presetId, asset, selectedLayerId) => {
        let resolvedLayerId = ''
        setWithHistory((state) => ({
          presets: updatePresets(state.presets, presetId, (preset, now) => {
            const selectedIndex = preset.layers.findIndex((layer) => layer.id === selectedLayerId && layer.type === 'logo')
            const logoIndex = selectedIndex >= 0
              ? selectedIndex
              : preset.layers.findIndex((layer) => layer.type === 'logo')
            if (logoIndex >= 0) {
              const layers = [...preset.layers]
              const logo = layers[logoIndex]!
              if (logo.type !== 'logo') return preset
              resolvedLayerId = logo.id
              layers[logoIndex] = { ...logo, asset }
              return { ...preset, layers, updatedAt: now }
            }
            const logo = createLogoLayer(asset, now, preset.baseCanvas)
            resolvedLayerId = logo.id
            return { ...preset, layers: [...preset.layers, logo], updatedAt: now }
          }),
        }), `preset:${presetId}:layers`)
        return resolvedLayerId
      },
      addTextLayer: (presetId) => setWithHistory((state) => ({
        presets: updatePresets(state.presets, presetId, (preset, now) => ({
          ...preset,
          layers: [
            ...preset.layers,
            createTextLayer(now, preset.baseCanvas),
          ],
          updatedAt: now,
        })),
      }), `preset:${presetId}:layers`),
      addLogoLayer: (presetId) => setWithHistory((state) => ({
        presets: updatePresets(state.presets, presetId, (preset, now) => ({
          ...preset,
          layers: [
            ...preset.layers,
            createLogoLayer(null, now, preset.baseCanvas),
          ],
          updatedAt: now,
        })),
      }), `preset:${presetId}:layers`),
      setSelectedPresetGroup: (groupId) => setWithoutHistory((state) => {
        const selectedGroup = getSelectedGroup(state.presetGroups, groupId)
        return {
          selectedPresetGroupId: selectedGroup?.id ?? '',
          enabledPresetIdsForRun: getPresetIdsForGroup(state.presetGroups, groupId),
        }
      }),
      setSelectedPreviewPresetId: (selectedPreviewPresetId) => setWithoutHistory(() => ({ selectedPreviewPresetId })),
      setEnabledPresetIdsForRun: (enabledPresetIdsForRun) => setWithHistory(() => ({ enabledPresetIdsForRun }), 'batch:enabled-presets'),
      setSmartMatchOrientation: (smartMatchOrientation) => setWithHistory(() => ({ smartMatchOrientation }), 'batch:smart-match'),
      setCustomValue: (customValue) => setWithHistory(() => ({ customValue }), 'batch:custom-value'),
      setPreserveSourceDir: (preserveSourceDir) => setWithHistory(() => ({ preserveSourceDir }), 'batch:preserve-source'),
      pushPreviewBackground: (path) => setWithoutHistory((state) => {
        if (!path.trim()) return {}
        return createPreviewHistoryState(state, (preview) => preview.push(path))
      }),
      previousPreviewBackground: () => setWithoutHistory((state) => (
        createPreviewHistoryState(state, (preview) => preview.previous())
      )),
      nextPreviewBackground: () => setWithoutHistory((state) => (
        createPreviewHistoryState(state, (preview) => preview.next())
      )),
      setExportProgress: (exportCompleted, exportTotal) => setWithoutHistory(() => ({ exportCompleted, exportTotal })),
      setExportStatus: (exportStatus) => setWithoutHistory(() => ({ exportStatus })),
      resetExportResults: () => setWithoutHistory(() => ({ exportSuccesses: [], exportFailures: [], exportCompleted: 0, exportTotal: 0 })),
      addExportSuccess: (item) => setWithoutHistory((state) => ({ exportSuccesses: [...state.exportSuccesses, item] })),
      addExportFailure: (item) => setWithoutHistory((state) => ({ exportFailures: [...state.exportFailures, item] })),
      addHistoryRecord: (record) => setWithoutHistory((state) => ({
        history: addCompositeHistoryRecord(state.history, record, state.historyRetention),
      })),
      updateHistoryRecord: (id, patch) => setWithoutHistory((state) => ({
        history: state.history.map((record) => (record.id === id ? { ...record, ...patch } : record)),
      })),
      setHistoryRetention: (retention) => setWithHistory((state) => {
        const historyRetention = Math.max(1, Math.floor(Number.isFinite(retention) ? retention : 1))
        return { historyRetention, history: state.history.slice(0, historyRetention) }
      }, 'history:retention'),
      createPresetGroup: (name) => setWithHistory((state) => {
        const now = Date.now()
        const group = { id: uniqueId('group'), name: name.trim() || '新预设组', presetIds: [], updatedAt: now }
        return { presetGroups: [...state.presetGroups, group], selectedPresetGroupId: group.id, enabledPresetIdsForRun: [] }
      }, 'preset-groups:structure'),
      createPreset: (name) => setWithHistory((state) => {
        const now = Date.now()
        const preset: CompositeV2State['presets'][number] = {
          id: uniqueId('preset'),
          name: name.trim() || '新预设',
          outputRootPath: '',
          distributionPath: '',
          namingTemplate: '{date}-{channel}-{size}-{preset}-{index}',
          baseCanvas: { width: 1080, height: 1920 },
          sampleBackgroundPath: '',
          layers: [],
          useOutputOverrides: false,
          outputRuleGroupsOverride: [],
          updatedAt: now,
        }
        return {
          presets: [...state.presets, preset],
          selectedPreviewPresetId: preset.id,
        }
      }, 'presets:structure'),
      deletePreset: (presetId) => setWithHistory((state) => {
        const presets = state.presets.filter((preset) => preset.id !== presetId)
        if (presets.length === state.presets.length) return {}
        return {
          presets,
          presetGroups: state.presetGroups.map((group) => ({
            ...group,
            presetIds: group.presetIds.filter((id) => id !== presetId),
            updatedAt: group.presetIds.includes(presetId) ? Date.now() : group.updatedAt,
          })),
          enabledPresetIdsForRun: state.enabledPresetIdsForRun.filter((id) => id !== presetId),
          selectedPreviewPresetId: state.selectedPreviewPresetId === presetId
            ? (presets[0]?.id ?? '')
            : state.selectedPreviewPresetId,
        }
      }, 'presets:structure'),
      renamePresetGroup: (groupId, name) => setWithHistory((state) => ({
        presetGroups: state.presetGroups.map((group) => group.id === groupId ? { ...group, name: name.trim() || group.name, updatedAt: Date.now() } : group),
      }), `preset-group:${groupId}:name`),
      movePresetGroup: (groupId, targetIndex) => setWithHistory((state) => {
        const sourceIndex = state.presetGroups.findIndex((group) => group.id === groupId)
        if (sourceIndex < 0) return {}
        const nextIndex = Math.max(0, Math.min(state.presetGroups.length - 1, targetIndex))
        if (sourceIndex === nextIndex) return {}
        const presetGroups = [...state.presetGroups]
        const [group] = presetGroups.splice(sourceIndex, 1)
        presetGroups.splice(nextIndex, 0, group!)
        return { presetGroups }
      }, 'preset-groups:structure'),
      duplicatePresetGroup: (groupId) => setWithHistory((state) => {
        const source = state.presetGroups.find((group) => group.id === groupId)
        if (!source) return {}
        const group = { ...source, id: uniqueId('group'), name: `${source.name} copy`, presetIds: [...source.presetIds], updatedAt: Date.now() }
        return { presetGroups: [...state.presetGroups, group] }
      }, 'preset-groups:structure'),
      deletePresetGroup: (groupId) => setWithHistory((state) => {
        if (state.presetGroups.length <= 1) return {}
        const presetGroups = state.presetGroups.filter((group) => group.id !== groupId)
        const selected = presetGroups[0]
        return {
          presetGroups,
          selectedPresetGroupId: selected?.id ?? '',
          enabledPresetIdsForRun: [...(selected?.presetIds ?? [])],
        }
      }, 'preset-groups:structure'),
      reorderPresetInGroup: (groupId, presetId, targetIndex) => setWithHistory((state) => ({
        presetGroups: state.presetGroups.map((group) => {
          if (group.id !== groupId) return group
          const currentIndex = group.presetIds.indexOf(presetId)
          if (currentIndex < 0) return group
          const presetIds = [...group.presetIds]
          const [item] = presetIds.splice(currentIndex, 1)
          presetIds.splice(targetIndex, 0, item!)
          return { ...group, presetIds, updatedAt: Date.now() }
        })
      }), `preset-group:${groupId}:preset-order`),
      duplicatePreset: (presetId) => setWithHistory((state) => {
        const source = state.presets.find((preset) => preset.id === presetId)
        if (!source) return {}
        const preset = structuredClone({ ...source, id: uniqueId('preset'), name: `${source.name} 副本`, updatedAt: Date.now() })
        return {
          presets: [...state.presets, preset],
          selectedPreviewPresetId: preset.id,
        }
      }, 'presets:structure'),
      addPresetToGroup: (presetId, groupId) => setWithHistory((state) => {
        const group = state.presetGroups.find((g) => g.id === groupId)
        if (!group || group.presetIds.includes(presetId)) return {}
        return {
          presetGroups: state.presetGroups.map((g) => g.id === groupId ? { ...g, presetIds: [...g.presetIds, presetId], updatedAt: Date.now() } : g),
          enabledPresetIdsForRun: state.selectedPresetGroupId === groupId
            ? [...state.enabledPresetIdsForRun, presetId]
            : state.enabledPresetIdsForRun,
        }
      }, `preset-group:${groupId}:membership`),
      removePresetFromGroup: (presetId, groupId) => setWithHistory((state) => ({
        presetGroups: state.presetGroups.map((group) => group.id === groupId ? { ...group, presetIds: group.presetIds.filter((id) => id !== presetId), updatedAt: Date.now() } : group),
        enabledPresetIdsForRun: state.selectedPresetGroupId === groupId
          ? state.enabledPresetIdsForRun.filter((id) => id !== presetId)
          : state.enabledPresetIdsForRun,
      }), `preset-group:${groupId}:membership`),
      copyLayer: (presetId, layerId) => setWithoutHistory((state) => {
        const preset = state.presets.find(p => p.id === presetId)
        if (!preset) return {}
        const layer = preset.layers.find(l => l.id === layerId)
        if (!layer) return {}
        return { clipboardLayer: structuredClone(layer) }
      }),
      pasteLayer: (presetId) => setWithHistory((state) => {
        if (!state.clipboardLayer) return {}
        return {
          presets: updatePresets(state.presets, presetId, (preset, now) => {
            const newLayer = { ...structuredClone(state.clipboardLayer!), id: `layer-${now}-${Math.random().toString(36).slice(2, 6)}` }
            return {
              ...preset,
              layers: [...preset.layers, newLayer],
              updatedAt: now
            }
          })
        }
      }, `preset:${presetId}:layers`),
      duplicateLayer: (presetId, layerId) => setWithHistory((state) => ({
        presets: updatePresets(state.presets, presetId, (preset, now) => {
          const index = preset.layers.findIndex(l => l.id === layerId)
          if (index < 0) return preset
          const newLayer = { ...structuredClone(preset.layers[index]!), id: `layer-${now}-${Math.random().toString(36).slice(2, 6)}` }
          const layers = [...preset.layers]
          layers.splice(index + 1, 0, newLayer)
          return { ...preset, layers, updatedAt: now }
        })
      }), `preset:${presetId}:layers`),
      setGlobalFitMode: (globalFitMode) => setWithHistory(() => ({ globalFitMode }), 'output:fit-mode'),
      updateOutputRule: (ruleId, patch) => setWithHistory((state) => ({
        outputRuleGroups: state.outputRuleGroups.map((group) =>
          group.rules.some((rule) => rule.id === ruleId)
            ? { ...group, rules: group.rules.map((rule) => rule.id === ruleId ? { ...rule, ...patch } : rule) }
            : group
        ),
      }), getOutputRuleMergeKey(ruleId, patch)),
      setOutputRuleGroupEnabled: (groupId, enabled) => setWithHistory((state) => ({
        outputRuleGroups: state.outputRuleGroups.map((group) => group.id === groupId
          ? { ...group, rules: group.rules.map((rule) => ({ ...rule, enabled })) }
          : group),
      }), `output-group:${groupId}:enabled`),
      addOutputRuleGroup: (name, id) => setWithHistory((state) => ({
        outputRuleGroups: [...state.outputRuleGroups, { id: id || `group-${Date.now()}`, name, distributionPaths: [], rules: [] }],
      }), 'output-groups:structure'),
      updateOutputRuleGroup: (groupId, patch) => setWithHistory((state) => ({
        outputRuleGroups: state.outputRuleGroups.map((group) => group.id === groupId ? { ...group, ...patch } : group),
      }), getOutputRuleGroupMergeKey(groupId, patch)),
      deleteOutputRuleGroup: (groupId) => setWithHistory((state) => ({
        outputRuleGroups: state.outputRuleGroups.filter((group) => group.id !== groupId),
      }), 'output-groups:structure'),
      addOutputRule: (groupId, rule) => setWithHistory((state) => ({
        outputRuleGroups: state.outputRuleGroups.map((group) => group.id === groupId
          ? { ...group, rules: [...group.rules, { ...rule, id: (rule as any).id || `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }] }
          : group),
      }), `output-group:${groupId}:rules`),
      deleteOutputRule: (groupId, ruleId) => setWithHistory((state) => ({
        outputRuleGroups: state.outputRuleGroups.map((group) => group.id === groupId
          ? { ...group, rules: group.rules.filter((rule) => rule.id !== ruleId) }
          : group),
      }), `output-group:${groupId}:rules`),
      setDistributionConfig: (patch) => setWithHistory((state) => ({
        distributionConfig: { ...state.distributionConfig, ...patch },
      }), getDistributionConfigMergeKey(patch)),
    }
    },
    {
      name: STORAGE_NAME,
      version: 2,
      partialize: getCompositeV2PersistedState,
      merge: mergeCompositeV2PersistedState,
      migrate: (persistedState, version) => {
        if (!persistedState || typeof persistedState !== 'object' || version >= 2) {
          return persistedState as CompositeV2PersistedState
        }
        const legacyState = persistedState as CompositeV2PersistedState & {
          presets?: Array<CompositeV2State['presets'][number] & { customVariables?: CompositeV2State['customVariables'] }>
          customVariables?: CompositeV2State['customVariables']
        }
        const mergedCustomVariables = legacyState.customVariables?.length
          ? legacyState.customVariables
          : collectLegacyCustomVariables(legacyState.presets ?? [])
        return {
          ...legacyState,
          customVariables: mergedCustomVariables,
          presets: (legacyState.presets ?? []).map((preset) => {
            const { customVariables: _customVariables, ...nextPreset } = preset as typeof preset & {
              customVariables?: CompositeV2State['customVariables']
            }
            return nextPreset
          }),
        } as CompositeV2PersistedState
      },
    },
  )
}

function getSelectedGroup(
  presetGroups: CompositeV2State['presetGroups'],
  groupId: string,
) {
  return presetGroups.find((group) => group.id === groupId) ?? presetGroups[0] ?? null
}

function getPresetIdsForGroup(
  presetGroups: CompositeV2State['presetGroups'],
  groupId: string,
) {
  return [...(getSelectedGroup(presetGroups, groupId)?.presetIds ?? [])]
}

function getFirstPresetIdForGroup(
  presetGroups: CompositeV2State['presetGroups'],
  groupId: string,
) {
  return getSelectedGroup(presetGroups, groupId)?.presetIds[0] ?? ''
}

function createRandomPreviewState(
  backgrounds: CompositeV2BackgroundImage[],
  pickRandomIndex: (length: number) => number,
) {
  if (!backgrounds.length) {
    return { previewHistory: [], previewHistoryIndex: -1 }
  }

  const selectedBackground = backgrounds[clampIndex(pickRandomIndex(backgrounds.length), backgrounds.length)] ?? backgrounds[0]
  const preview = createPreviewHistory([selectedBackground.path]).snapshot()

  return {
    previewHistory: preview.entries,
    previewHistoryIndex: preview.index,
  }
}

function createPreviewHistoryState(
  state: Pick<CompositeV2StoreState, 'previewHistory' | 'previewHistoryIndex'>,
  updater: (preview: ReturnType<typeof createPreviewHistory>) => void,
) {
  const preview = createPreviewHistory({
    entries: state.previewHistory,
    index: state.previewHistoryIndex,
  })
  updater(preview)
  const snapshot = preview.snapshot()
  return {
    previewHistory: snapshot.entries,
    previewHistoryIndex: snapshot.index,
  }
}

function clampIndex(index: number, length: number) {
  if (length <= 0) return -1
  if (!Number.isFinite(index)) return 0
  return Math.min(Math.max(Math.floor(index), 0), length - 1)
}

function defaultPickRandomIndex(length: number) {
  return Math.floor(Math.random() * length)
}

function uniqueId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function trimHistoryStack<T>(stack: T[]) {
  if (stack.length <= HISTORY_LIMIT) return stack
  return stack.slice(stack.length - HISTORY_LIMIT)
}

function captureUndoSnapshot(state: CompositeV2StoreState): CompositeV2UndoSnapshot {
  return {
    logoLibraryPath: state.logoLibraryPath,
    logoOrder: structuredClone(state.logoOrder ?? []),
    projectLogos: structuredClone(state.projectLogos ?? []),
    customVariables: structuredClone(state.customVariables ?? []),
    backgroundFolders: structuredClone(state.backgroundFolders),
    recursiveBackgrounds: state.recursiveBackgrounds,
    backgrounds: structuredClone(state.backgrounds),
    previewHistory: structuredClone(state.previewHistory),
    previewHistoryIndex: state.previewHistoryIndex,
    selectedPresetGroupId: state.selectedPresetGroupId,
    selectedPreviewPresetId: state.selectedPreviewPresetId,
    enabledPresetIdsForRun: structuredClone(state.enabledPresetIdsForRun),
    smartMatchOrientation: state.smartMatchOrientation,
    customValue: state.customValue,
    preserveSourceDir: state.preserveSourceDir,
    presets: structuredClone(state.presets),
    presetGroups: structuredClone(state.presetGroups),
    outputRuleGroups: structuredClone(state.outputRuleGroups),
    globalFitMode: state.globalFitMode,
    historyRetention: state.historyRetention,
    distributionConfig: structuredClone(state.distributionConfig),
  }
}

function applyUndoSnapshot(snapshot: CompositeV2UndoSnapshot): Partial<CompositeV2StoreState> {
  return structuredClone(snapshot)
}

function areUndoSnapshotsEqual(a: CompositeV2UndoSnapshot, b: CompositeV2UndoSnapshot) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function getPresetPatchMergeKey(presetId: string, patch: Partial<CompositeV2State['presets'][number]>) {
  const keys = Object.keys(patch).sort()
  return `preset:${presetId}:${keys.join(',') || 'update'}`
}

function getOutputRuleMergeKey(ruleId: string, patch: Partial<CompositeV2OutputSizeRule>) {
  const keys = Object.keys(patch).sort()
  return `output-rule:${ruleId}:${keys.join(',') || 'update'}`
}

function getOutputRuleGroupMergeKey(groupId: string, patch: Partial<CompositeV2OutputRuleGroup>) {
  const keys = Object.keys(patch).sort()
  return `output-group:${groupId}:${keys.join(',') || 'update'}`
}

function getDistributionConfigMergeKey(patch: Partial<CompositeV2State['distributionConfig']>) {
  const keys = Object.keys(patch).sort()
  return `distribution:${keys.join(',') || 'update'}`
}

function collectLegacyCustomVariables(
  presets: Array<CompositeV2State['presets'][number] & { customVariables?: CompositeV2State['customVariables'] }>,
) {
  const byName = new Map<string, CompositeV2State['customVariables'][number]>()
  for (const preset of presets) {
    for (const variable of preset.customVariables ?? []) {
      if (!byName.has(variable.name)) {
        byName.set(variable.name, structuredClone(variable))
      }
    }
  }
  return [...byName.values()]
}

function updatePresets(
  presets: CompositeV2State['presets'],
  presetId: string,
  updater: (preset: CompositeV2State['presets'][number], now: number) => CompositeV2State['presets'][number],
) {
  let changed = false
  const now = Date.now()
  const nextPresets = presets.map((preset) => {
    if (preset.id !== presetId) return preset
    changed = true
    return updater(preset, now)
  })

  return changed ? nextPresets : presets
}

function createCenteredFreePosition(
  canvas: { width: number; height: number },
  size: { width: number; height: number },
) {
  return {
    mode: 'free' as const,
    x: Math.round((canvas.width - size.width) / 2),
    y: Math.round((canvas.height - size.height) / 2),
    width: size.width,
    height: size.height,
  }
}

function createImageLayer(asset: CompositeV2ImageAssetRef | null, now: number, baseCanvas: { width: number; height: number }) {
  return {
    id: `image-layer-${now}`,
    type: 'image' as const,
    name: 'Image Layer',
    visible: true,
    locked: false,
    opacity: 1,
    rotation: 0,
    position: createCenteredFreePosition(baseCanvas, {
      width: DEFAULT_LAYER_POSITION.width,
      height: DEFAULT_LAYER_POSITION.height,
    }),
    shadow: { ...DEFAULT_LAYER_SHADOW },
    stroke: { ...DEFAULT_LAYER_STROKE },
    asset,
    radius: 0,
    clip: false,
  }
}

function createLogoLayer(asset: CompositeV2ImageAssetRef | null, now: number, baseCanvas: { width: number; height: number }) {
  return {
    ...createImageLayer(asset, now, baseCanvas),
    id: `logo-layer-${now}`,
    type: 'logo' as const,
    name: 'LOGO Layer',
    position: {
      mode: 'anchor' as const,
      anchor: 'top-left' as const,
      marginX: 20,
      marginY: 20,
      offsetX: 0,
      offsetY: 0,
      width: 100,
      height: 100,
    },
  }
}

function createTextLayer(now: number, baseCanvas: { width: number; height: number }) {
  const layer = fitCompositeTextLayer({
    id: `text-layer-${now}`,
    type: 'text' as const,
    name: 'Text Layer',
    visible: true,
    locked: false,
    opacity: 1,
    rotation: 0,
    position: { ...DEFAULT_LAYER_POSITION },
    shadow: { ...DEFAULT_LAYER_SHADOW },
    text: 'New Text',
    fontFamily: 'sans-serif',
    fontSize: 48,
    fontWeight: 700,
    color: '#000000',
    align: 'center' as const,
    lineHeight: 1.1,
    letterSpacing: 0,
    padding: 5,
    stroke: {
      enabled: false,
      color: '#111827',
      width: 0,
    },
  })
  return {
    ...layer,
    position: createCenteredFreePosition(baseCanvas, {
      width: layer.position.width,
      height: layer.position.height,
    }),
  }
}
