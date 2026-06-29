import { create } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { persist } from 'zustand/middleware'
import { createPreviewHistory } from './lib/compositeBackgrounds'
import { addCompositeHistoryRecord } from './lib/compositeExportHistoryV2'
import { createDefaultCompositeV2State } from './lib/compositeV2Defaults'
import { fitCompositeTextLayer } from './lib/compositeTextLayout'
import type {
  CompositeV2BackgroundImage,
  CompositeV2ExportStatus,
  CompositeV2ImageAssetRef,
  CompositeV2FailureItem,
  CompositeV2HistoryRecord,
  CompositeV2FitMode,
  CompositeV2OutputSizeRule,
  CompositeV2SuccessItem,
  CompositeV2State,
} from './lib/compositeV2Types'

type CompositeV2BatchState = {
  backgroundFolder: string
  recursiveBackgrounds: boolean
  backgrounds: CompositeV2BackgroundImage[]
  previewHistory: string[]
  previewHistoryIndex: number
  selectedPresetGroupId: string
  selectedPreviewPresetId: string
  enabledPresetIdsForRun: string[]
  customValue: string
  preserveSourceDir: boolean
  exportStatus: CompositeV2ExportStatus
  exportCompleted: number
  exportTotal: number
  exportSuccesses: CompositeV2SuccessItem[]
  exportFailures: CompositeV2FailureItem[]
}

type CompositeV2StoreActions = {
  setLogoLibraryPath: (path: string) => void
  setBackgroundFolder: (path: string) => void
  setRecursiveBackgrounds: (recursive: boolean) => void
  setBackgrounds: (backgrounds: CompositeV2BackgroundImage[]) => void
  updatePreset: (presetId: string, patch: Partial<CompositeV2State['presets'][number]>) => void
  addImageLayer: (presetId: string, asset?: CompositeV2ImageAssetRef) => void
  replaceOrAddLogoLayer: (presetId: string, asset: CompositeV2ImageAssetRef, selectedLayerId?: string) => string
  addTextLayer: (presetId: string) => void
  setSelectedPresetGroup: (groupId: string) => void
  setSelectedPreviewPresetId: (presetId: string) => void
  setEnabledPresetIdsForRun: (presetIds: string[]) => void
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
  setHistoryRetention: (retention: number) => void
  createPresetGroup: (name: string) => void
  renamePresetGroup: (groupId: string, name: string) => void
  duplicatePresetGroup: (groupId: string) => void
  deletePresetGroup: (groupId: string) => void
  duplicatePresetIntoGroup: (presetId: string, groupId: string) => void
  removePresetFromGroup: (presetId: string, groupId: string) => void
  setGlobalFitMode: (mode: CompositeV2FitMode) => void
  updateOutputRule: (ruleId: string, patch: Partial<CompositeV2OutputSizeRule>) => void
  setOutputRuleGroupEnabled: (groupId: string, enabled: boolean) => void
}

export type CompositeV2StoreState = CompositeV2BatchState & CompositeV2State & CompositeV2StoreActions

export type CreateCompositeV2StoreOptions = {
  pickRandomIndex?: (length: number) => number
}

const STORAGE_NAME = 'doupao-composite-v2-workspace-storage'
const DEFAULT_LAYER_POSITION = { mode: 'free' as const, x: 100, y: 100, width: 240, height: 120 }
const DEFAULT_LAYER_SHADOW = { enabled: false, color: '#000000', x: 0, y: 4, blur: 12, opacity: 0.25 }

export function createCompositeV2StoreState(): CompositeV2BatchState & CompositeV2State {
  const defaults = createDefaultCompositeV2State()
  const selectedPresetGroupId = defaults.presetGroups[0]?.id ?? ''

  return {
    logoLibraryPath: defaults.logoLibraryPath,
    backgroundFolder: '',
    recursiveBackgrounds: false,
    backgrounds: [],
    previewHistory: [],
    previewHistoryIndex: -1,
    selectedPresetGroupId,
    selectedPreviewPresetId: getFirstPresetIdForGroup(defaults.presetGroups, selectedPresetGroupId),
    enabledPresetIdsForRun: getPresetIdsForGroup(defaults.presetGroups, selectedPresetGroupId),
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
  }
}

export function getCompositeV2PersistedState(state: CompositeV2StoreState): CompositeV2State {
  return {
    logoLibraryPath: state.logoLibraryPath,
    presets: state.presets,
    presetGroups: state.presetGroups,
    outputRuleGroups: state.outputRuleGroups,
    globalFitMode: state.globalFitMode,
    historyRetention: state.historyRetention,
    history: state.history,
  }
}

export function createCompositeV2Store(options: CreateCompositeV2StoreOptions = {}) {
  return createStore<CompositeV2StoreState>()(createCompositeV2StoreInitializer(options))
}

export const useCompositeV2Store = create<CompositeV2StoreState>()(createCompositeV2StoreInitializer())

function createCompositeV2StoreInitializer(options: CreateCompositeV2StoreOptions = {}) {
  const pickRandomIndex = options.pickRandomIndex ?? defaultPickRandomIndex

  return persist<CompositeV2StoreState, [], [], CompositeV2State>(
    (set) => ({
      ...createCompositeV2StoreState(),
      setLogoLibraryPath: (logoLibraryPath) => set({ logoLibraryPath }),
      setBackgroundFolder: (backgroundFolder) => set({ backgroundFolder }),
      setRecursiveBackgrounds: (recursiveBackgrounds) => set({ recursiveBackgrounds }),
      setBackgrounds: (backgrounds) => set({
        backgrounds,
        ...createRandomPreviewState(backgrounds, pickRandomIndex),
      }),
      updatePreset: (presetId, patch) => set((state) => ({
        presets: updatePresets(state.presets, presetId, (preset, now) => ({
          ...preset,
          ...patch,
          updatedAt: now,
        })),
      })),
      addImageLayer: (presetId, asset) => set((state) => ({
        presets: updatePresets(state.presets, presetId, (preset, now) => ({
          ...preset,
          layers: [
            ...preset.layers,
            createImageLayer(asset ?? null, now),
          ],
          updatedAt: now,
        })),
      })),
      replaceOrAddLogoLayer: (presetId, asset, selectedLayerId) => {
        let resolvedLayerId = ''
        set((state) => ({
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
            const logo = createLogoLayer(asset, now)
            resolvedLayerId = logo.id
            return { ...preset, layers: [...preset.layers, logo], updatedAt: now }
          }),
        }))
        return resolvedLayerId
      },
      addTextLayer: (presetId) => set((state) => ({
        presets: updatePresets(state.presets, presetId, (preset, now) => ({
          ...preset,
          layers: [
            ...preset.layers,
            createTextLayer(now),
          ],
          updatedAt: now,
        })),
      })),
      setSelectedPresetGroup: (groupId) => set((state) => {
        const selectedGroup = getSelectedGroup(state.presetGroups, groupId)
        return {
          selectedPresetGroupId: selectedGroup?.id ?? '',
          enabledPresetIdsForRun: getPresetIdsForGroup(state.presetGroups, groupId),
          selectedPreviewPresetId: getFirstPresetIdForGroup(state.presetGroups, groupId),
        }
      }),
      setSelectedPreviewPresetId: (selectedPreviewPresetId) => set({ selectedPreviewPresetId }),
      setEnabledPresetIdsForRun: (enabledPresetIdsForRun) => set({ enabledPresetIdsForRun }),
      setCustomValue: (customValue) => set({ customValue }),
      setPreserveSourceDir: (preserveSourceDir) => set({ preserveSourceDir }),
      pushPreviewBackground: (path) => set((state) => {
        if (!path.trim()) return {}
        return createPreviewHistoryState(state, (preview) => preview.push(path))
      }),
      previousPreviewBackground: () => set((state) => (
        createPreviewHistoryState(state, (preview) => preview.previous())
      )),
      nextPreviewBackground: () => set((state) => (
        createPreviewHistoryState(state, (preview) => preview.next())
      )),
      setExportProgress: (exportCompleted, exportTotal) => set({ exportCompleted, exportTotal }),
      setExportStatus: (exportStatus) => set({ exportStatus }),
      resetExportResults: () => set({ exportSuccesses: [], exportFailures: [], exportCompleted: 0, exportTotal: 0 }),
      addExportSuccess: (item) => set((state) => ({ exportSuccesses: [...state.exportSuccesses, item] })),
      addExportFailure: (item) => set((state) => ({ exportFailures: [...state.exportFailures, item] })),
      addHistoryRecord: (record) => set((state) => ({
        history: addCompositeHistoryRecord(state.history, record, state.historyRetention),
      })),
      setHistoryRetention: (retention) => set((state) => {
        const historyRetention = Math.max(1, Math.floor(Number.isFinite(retention) ? retention : 1))
        return { historyRetention, history: state.history.slice(0, historyRetention) }
      }),
      createPresetGroup: (name) => set((state) => {
        const now = Date.now()
        const group = { id: uniqueId('group'), name: name.trim() || '新预设组', presetIds: [], updatedAt: now }
        return { presetGroups: [...state.presetGroups, group], selectedPresetGroupId: group.id, enabledPresetIdsForRun: [], selectedPreviewPresetId: '' }
      }),
      renamePresetGroup: (groupId, name) => set((state) => ({
        presetGroups: state.presetGroups.map((group) => group.id === groupId ? { ...group, name: name.trim() || group.name, updatedAt: Date.now() } : group),
      })),
      duplicatePresetGroup: (groupId) => set((state) => {
        const source = state.presetGroups.find((group) => group.id === groupId)
        if (!source) return {}
        const group = { ...source, id: uniqueId('group'), name: `${source.name} copy`, presetIds: [...source.presetIds], updatedAt: Date.now() }
        return { presetGroups: [...state.presetGroups, group] }
      }),
      deletePresetGroup: (groupId) => set((state) => {
        if (state.presetGroups.length <= 1) return {}
        const presetGroups = state.presetGroups.filter((group) => group.id !== groupId)
        const selected = presetGroups[0]
        return {
          presetGroups,
          selectedPresetGroupId: selected?.id ?? '',
          enabledPresetIdsForRun: [...(selected?.presetIds ?? [])],
          selectedPreviewPresetId: selected?.presetIds[0] ?? '',
        }
      }),
      duplicatePresetIntoGroup: (presetId, groupId) => set((state) => {
        const source = state.presets.find((preset) => preset.id === presetId)
        if (!source) return {}
        const preset = structuredClone({ ...source, id: uniqueId('preset'), name: `${source.name} copy`, updatedAt: Date.now() })
        return {
          presets: [...state.presets, preset],
          presetGroups: state.presetGroups.map((group) => group.id === groupId ? { ...group, presetIds: [...group.presetIds, preset.id], updatedAt: Date.now() } : group),
          selectedPreviewPresetId: preset.id,
        }
      }),
      removePresetFromGroup: (presetId, groupId) => set((state) => ({
        presetGroups: state.presetGroups.map((group) => group.id === groupId ? { ...group, presetIds: group.presetIds.filter((id) => id !== presetId), updatedAt: Date.now() } : group),
        enabledPresetIdsForRun: state.enabledPresetIdsForRun.filter((id) => id !== presetId),
        selectedPreviewPresetId: state.selectedPreviewPresetId === presetId ? '' : state.selectedPreviewPresetId,
      })),
      setGlobalFitMode: (globalFitMode) => set({ globalFitMode }),
      updateOutputRule: (ruleId, patch) => set((state) => ({
        outputRuleGroups: state.outputRuleGroups.map((group) => ({
          ...group,
          rules: group.rules.map((rule) => rule.id === ruleId ? { ...rule, ...patch } : rule),
        })),
      })),
      setOutputRuleGroupEnabled: (groupId, enabled) => set((state) => ({
        outputRuleGroups: state.outputRuleGroups.map((group) => group.id === groupId
          ? { ...group, rules: group.rules.map((rule) => ({ ...rule, enabled })) }
          : group),
      })),
    }),
    {
      name: STORAGE_NAME,
      version: 1,
      partialize: getCompositeV2PersistedState,
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

function createImageLayer(asset: CompositeV2ImageAssetRef | null, now: number) {
  return {
    id: `image-layer-${now}`,
    type: 'image' as const,
    name: 'Image Layer',
    visible: true,
    locked: false,
    opacity: 1,
    rotation: 0,
    position: { ...DEFAULT_LAYER_POSITION },
    shadow: { ...DEFAULT_LAYER_SHADOW },
    asset,
    radius: 0,
    clip: false,
  }
}

function createLogoLayer(asset: CompositeV2ImageAssetRef, now: number) {
  return {
    ...createImageLayer(asset, now),
    id: `logo-layer-${now}`,
    type: 'logo' as const,
    name: 'LOGO Layer',
  }
}

function createTextLayer(now: number) {
  return fitCompositeTextLayer({
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
      color: '#000000',
      width: 0,
    },
  })
}
