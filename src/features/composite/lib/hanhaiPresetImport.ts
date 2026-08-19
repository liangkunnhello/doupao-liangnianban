import type {
  CompositeV2Anchor,
  CompositeV2CustomVariable,
  CompositeV2Layer,
  CompositeV2OutputRuleGroup,
  CompositeV2Preset,
  CompositeV2PresetGroup,
  CompositeV2ProjectLogo,
} from './compositeV2Types'

export type HanhaiImportAsset = {
  path: string
  name: string
  dataUrl: string
  width: number
  height: number
} | {
  path: string
  name: string
  dataUrl: null
  width: 0
  height: 0
}

export type HanhaiImportSource = {
  configPath: string
  jsonText: string
  assets: HanhaiImportAsset[]
}

type HanhaiWatermark = {
  type?: unknown
  path?: unknown
  asset?: unknown
  content?: unknown
  enabled?: unknown
  scale?: unknown
  resize_mode?: unknown
  resizeMode?: unknown
  opacity?: unknown
  position?: unknown
  offset_x?: unknown
  offset_y?: unknown
  size?: unknown
  font?: unknown
  color?: unknown
  stroke_width?: unknown
  stroke_color?: unknown
}

type HanhaiPresetRecord = {
  id: string
  name: string
  resize: Record<string, unknown>
  watermarks: HanhaiWatermark[]
  output: Record<string, unknown>
}

export type ParsedHanhaiPreset = {
  source: HanhaiPresetRecord
  groupId: string
  groupName: string
}

export type ParsedHanhaiPresetConfig = {
  presets: ParsedHanhaiPreset[]
  groups: Array<{ id: string; name: string }>
}

export type HanhaiImportPreview = {
  totalCount: number
  newCount: number
  duplicateCount: number
  completeCount: number
  missingAssetPresetCount: number
  missingAssets: Array<{ presetId: string; presetName: string; path: string }>
}

export type HanhaiImportBundle = {
  presets: CompositeV2Preset[]
  presetGroups: CompositeV2PresetGroup[]
  projectLogos: CompositeV2ProjectLogo[]
  customVariables: CompositeV2CustomVariable[]
}

export const HANHAI_UNGROUPED_ID = 'hanhai:group:ungrouped'
export const HANHAI_UNGROUPED_NAME = '瀚海未分组'

const INVISIBLE_PATH_CHARS = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g
const DEFAULT_SHADOW = { enabled: false, color: '#000000', x: 0, y: 4, blur: 12, opacity: 0.25 }
const DEFAULT_STROKE = { enabled: false, color: '#111827', width: 0 }
const VALID_ANCHORS = new Set([
  'top-left', 'top-center', 'top-right',
  'center-left', 'center', 'center-right',
  'bottom-left', 'bottom-center', 'bottom-right',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function number(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function bool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  return fallback
}

export function normalizeHanhaiAssetPath(value: unknown): string {
  return text(value).replace(INVISIBLE_PATH_CHARS, '').trim()
}

export function getHanhaiPresetId(sourceId: string): string {
  return `hanhai:preset:${sourceId}`
}

export function getHanhaiGroupId(sourceId: string): string {
  return `hanhai:group:${sourceId}`
}

function parsePreset(value: Record<string, unknown>, location: string): HanhaiPresetRecord {
  const id = text(value.id).trim()
  const name = text(value.name).trim()
  if (!id || !name) throw new Error(`${location} 缺少有效的 id 或 name`)
  return {
    id,
    name,
    resize: isRecord(value.resize) ? value.resize : {},
    watermarks: Array.isArray(value.watermarks)
      ? value.watermarks.filter(isRecord) as HanhaiWatermark[]
      : [],
    output: isRecord(value.output) ? value.output : {},
  }
}

export function parseHanhaiPresetConfig(jsonText: string): ParsedHanhaiPresetConfig {
  let root: unknown
  try {
    root = JSON.parse(jsonText)
  } catch {
    throw new Error('瀚海预设 JSON 格式无效')
  }
  if (!Array.isArray(root)) throw new Error('瀚海预设 JSON 顶层必须是数组')

  const presets: ParsedHanhaiPreset[] = []
  const groups: Array<{ id: string; name: string }> = []
  const seenPresetIds = new Set<string>()
  const seenGroupIds = new Set<string>()

  const addPreset = (value: Record<string, unknown>, groupId: string, groupName: string, location: string) => {
    const source = parsePreset(value, location)
    if (seenPresetIds.has(source.id)) return
    seenPresetIds.add(source.id)
    presets.push({ source, groupId, groupName })
  }

  root.forEach((item, rootIndex) => {
    if (!isRecord(item)) return
    const children = Array.isArray(item.children) ? item.children : null
    if (text(item.type) === 'group' || children) {
      const sourceGroupId = text(item.id).trim() || `group-${rootIndex + 1}`
      const groupId = getHanhaiGroupId(sourceGroupId)
      const groupName = text(item.name).trim() || `瀚海分组 ${rootIndex + 1}`
      if (!seenGroupIds.has(groupId)) {
        seenGroupIds.add(groupId)
        groups.push({ id: groupId, name: groupName })
      }
      ;(children ?? []).forEach((child, childIndex) => {
        if (isRecord(child)) addPreset(child, groupId, groupName, `第 ${rootIndex + 1} 组第 ${childIndex + 1} 条预设`)
      })
      return
    }
    addPreset(item, HANHAI_UNGROUPED_ID, HANHAI_UNGROUPED_NAME, `第 ${rootIndex + 1} 条预设`)
  })

  if (presets.some((preset) => preset.groupId === HANHAI_UNGROUPED_ID)) {
    groups.unshift({ id: HANHAI_UNGROUPED_ID, name: HANHAI_UNGROUPED_NAME })
  }
  if (presets.length === 0) throw new Error('瀚海配置中没有可导入的产品预设')
  return { presets, groups }
}

function getWatermarkPath(watermark: HanhaiWatermark): string {
  return normalizeHanhaiAssetPath(watermark.path ?? watermark.asset)
}

function isEnabledWatermark(watermark: HanhaiWatermark): boolean {
  return watermark.enabled === undefined || bool(watermark.enabled, true)
}

export function createHanhaiImportPreview(
  parsed: ParsedHanhaiPresetConfig,
  assets: HanhaiImportAsset[],
  existingPresetIds: Iterable<string>,
): HanhaiImportPreview {
  const existing = new Set(existingPresetIds)
  const assetByPath = new Map(assets.map((asset) => [normalizeHanhaiAssetPath(asset.path), asset]))
  const newPresets = parsed.presets.filter(({ source }) => !existing.has(getHanhaiPresetId(source.id)))
  const missingAssets = newPresets.flatMap(({ source }) => source.watermarks
    .filter((watermark) => isEnabledWatermark(watermark) && text(watermark.type, 'image').toLowerCase() !== 'text')
    .map(getWatermarkPath)
    .filter((path) => path && !assetByPath.get(path)?.dataUrl)
    .map((path) => ({ presetId: source.id, presetName: source.name, path })))
  const missingPresetIds = new Set(missingAssets.map((item) => item.presetId))
  return {
    totalCount: parsed.presets.length,
    newCount: newPresets.length,
    duplicateCount: parsed.presets.length - newPresets.length,
    completeCount: newPresets.length - missingPresetIds.size,
    missingAssetPresetCount: missingPresetIds.size,
    missingAssets,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getCanvasSize(source: HanhaiPresetRecord) {
  return {
    width: Math.max(1, Math.round(number(source.resize.width, 1280))),
    height: Math.max(1, Math.round(number(source.resize.height, 720))),
  }
}

function getAnchor(value: unknown): CompositeV2Anchor {
  const candidate = text(value, 'center').toLowerCase()
  return VALID_ANCHORS.has(candidate) ? candidate as CompositeV2Anchor : 'center'
}

function getImageLayerSize(
  watermark: HanhaiWatermark,
  asset: HanhaiImportAsset | undefined,
  canvas: { width: number; height: number },
) {
  const mode = text(watermark.resize_mode ?? watermark.resizeMode, 'scale').toLowerCase()
  if (mode === 'fill') return { width: canvas.width, height: canvas.height }
  const sourceWidth = asset?.width || canvas.width
  const sourceHeight = asset?.height || canvas.height
  if (mode === 'fit') {
    const factor = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight)
    return { width: Math.max(1, sourceWidth * factor), height: Math.max(1, sourceHeight * factor) }
  }
  const scale = Math.max(0.01, number(watermark.scale, 1))
  return { width: Math.max(1, sourceWidth * scale), height: Math.max(1, sourceHeight * scale) }
}

function createImageWatermarkLayer(
  sourceId: string,
  watermark: HanhaiWatermark,
  index: number,
  asset: HanhaiImportAsset | undefined,
  assetId: string | undefined,
  canvas: { width: number; height: number },
): CompositeV2Layer {
  const sourcePath = getWatermarkPath(watermark)
  const size = getImageLayerSize(watermark, asset, canvas)
  return {
    id: `hanhai:layer:${sourceId}:${index}`,
    type: 'logo',
    name: assetId ? `瀚海水印：${asset?.name || '图片'}` : `缺失水印：${asset?.name || sourcePath || '未指定文件'}`,
    visible: true,
    locked: false,
    opacity: clamp(number(watermark.opacity, 255) > 1 ? number(watermark.opacity, 255) / 255 : number(watermark.opacity, 1), 0, 1),
    rotation: 0,
    position: {
      mode: 'anchor',
      anchor: getAnchor(watermark.position),
      marginX: 0,
      marginY: 0,
      offsetX: number(watermark.offset_x, 0),
      offsetY: number(watermark.offset_y, 0),
      width: size.width,
      height: size.height,
    },
    shadow: { ...DEFAULT_SHADOW },
    stroke: { ...DEFAULT_STROKE },
    asset: assetId ? { kind: 'stored', assetId, name: asset?.name } : null,
    imageFit: text(watermark.resize_mode ?? watermark.resizeMode, 'scale').toLowerCase() === 'fill'
      ? 'crop-fill'
      : 'stretch',
    radius: 0,
    clip: false,
  }
}

function createTextWatermarkLayer(
  sourceId: string,
  watermark: HanhaiWatermark,
  index: number,
): CompositeV2Layer {
  const content = text(watermark.content ?? watermark.asset)
  const fontSize = Math.max(8, number(watermark.size, 24))
  const width = Math.max(fontSize * 1.2, [...content].length * fontSize)
  return {
    id: `hanhai:layer:${sourceId}:${index}`,
    type: 'text',
    name: `瀚海文字水印：${content || '空内容'}`,
    visible: true,
    locked: false,
    opacity: clamp(number(watermark.opacity, 255) > 1 ? number(watermark.opacity, 255) / 255 : number(watermark.opacity, 1), 0, 1),
    rotation: 0,
    position: {
      mode: 'anchor',
      anchor: getAnchor(watermark.position),
      marginX: 0,
      marginY: 0,
      offsetX: number(watermark.offset_x, 0),
      offsetY: number(watermark.offset_y, 0),
      width,
      height: fontSize * 1.35,
    },
    shadow: { ...DEFAULT_SHADOW },
    stroke: {
      enabled: number(watermark.stroke_width, 0) > 0,
      color: text(watermark.stroke_color, '#000000'),
      width: Math.max(0, number(watermark.stroke_width, 0)),
    },
    text: content,
    fontFamily: 'Microsoft YaHei',
    fontSize,
    fontWeight: 400,
    color: text(watermark.color, '#ffffff'),
    align: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    padding: 0,
  }
}

function transformPresetNameTemplate(template: string, sequence: '{index}' | ''): string {
  return template
    .replaceAll('{sequence}', sequence)
    .replaceAll('{strategy_name}', '{strategy_name}')
    .replace(/[-_. ]+$/, '')
}

export function transformHanhaiFilenameTemplate(source: HanhaiPresetRecord): string {
  const pattern = text(source.output.filename_pattern, '{date}-{preset_name}-{sequence}')
  return pattern
    .replaceAll('{preset_name}', transformPresetNameTemplate(source.name, '{index}'))
    .replaceAll('{sequence}', '{index}')
    .replaceAll('{strategy_name}', '{strategy_name}')
}

export function transformHanhaiOutputFolderTemplate(source: HanhaiPresetRecord): string {
  const pattern = text(source.output.filename_pattern, '{date}-{preset_name}-{sequence}')
  return pattern
    .replaceAll('{preset_name}', transformPresetNameTemplate(source.name, ''))
    .replaceAll('{sequence}', '')
    .replaceAll('{strategy_name}', '{strategy_name}')
}

function createOutputRuleGroup(source: HanhaiPresetRecord, canvas: { width: number; height: number }): CompositeV2OutputRuleGroup {
  const maxSizeKb = Math.max(0, Math.round(number(source.output.max_size_kb ?? source.output.maxSizeKb, 0)))
  const qualityPercent = clamp(number(source.output.quality, 95), 1, 100)
  return {
    id: `hanhai:output:${source.id}`,
    name: '瀚海迁移',
    distributionPaths: [],
    rules: [{
      id: `hanhai:output-rule:${source.id}`,
      name: `${canvas.width}x${canvas.height}`,
      enabled: true,
      width: canvas.width,
      height: canvas.height,
      maxSizeKb,
      jpegQuality: qualityPercent / 100,
      format: 'jpg',
      subfolderTemplate: '',
      filenameTemplate: '',
    }],
  }
}

export function buildHanhaiImportBundle(
  parsed: ParsedHanhaiPresetConfig,
  assets: HanhaiImportAsset[],
  assetIdsByPath: ReadonlyMap<string, string>,
  existingPresetIds: Iterable<string> = [],
  now = Date.now(),
): HanhaiImportBundle {
  const existing = new Set(existingPresetIds)
  const assetByPath = new Map(assets.map((asset) => [normalizeHanhaiAssetPath(asset.path), asset]))
  const imported = parsed.presets.filter(({ source }) => !existing.has(getHanhaiPresetId(source.id)))
  const presets = imported.map(({ source }) => {
    const canvas = getCanvasSize(source)
    const enabledWatermarks = source.watermarks.filter(isEnabledWatermark)
    const missingImage = enabledWatermarks.some((watermark) => {
      if (text(watermark.type, 'image').toLowerCase() === 'text') return false
      return !assetIdsByPath.get(getWatermarkPath(watermark))
    })
    const layers = enabledWatermarks.map((watermark, index) => {
      if (text(watermark.type, 'image').toLowerCase() === 'text') {
        return createTextWatermarkLayer(source.id, watermark, index)
      }
      const sourcePath = getWatermarkPath(watermark)
      return createImageWatermarkLayer(
        source.id,
        watermark,
        index,
        assetByPath.get(sourcePath),
        assetIdsByPath.get(sourcePath),
        canvas,
      )
    }).reverse()
    return {
      id: getHanhaiPresetId(source.id),
      name: `${source.name}${missingImage ? '（缺水印）' : ''}`,
      outputRootPath: text(source.output.folder),
      distributionPath: '',
      subfolderTemplate: '',
      filenameTemplate: transformHanhaiFilenameTemplate(source),
      outputFolderTemplate: transformHanhaiOutputFolderTemplate(source),
      indexPadding: 3,
      outputRuleMode: 'replace',
      customVariableValues: { strategy_name: '未指定策略' },
      baseCanvas: canvas,
      sampleBackgroundPath: '',
      layers,
      useOutputOverrides: true,
      outputRuleGroupsOverride: [createOutputRuleGroup(source, canvas)],
      updatedAt: now,
    } satisfies CompositeV2Preset
  })

  const importedIdsByGroup = new Map<string, string[]>()
  imported.forEach(({ source, groupId }) => {
    const ids = importedIdsByGroup.get(groupId) ?? []
    ids.push(getHanhaiPresetId(source.id))
    importedIdsByGroup.set(groupId, ids)
  })
  const presetGroups = parsed.groups
    .map((group) => ({
      id: group.id,
      name: group.name,
      presetIds: importedIdsByGroup.get(group.id) ?? [],
      updatedAt: now,
    }))
    .filter((group) => group.presetIds.length > 0)

  const usedAssets = new Map<string, CompositeV2ProjectLogo>()
  imported.forEach(({ source }) => source.watermarks.forEach((watermark) => {
    if (!isEnabledWatermark(watermark) || text(watermark.type, 'image').toLowerCase() === 'text') return
    const sourcePath = getWatermarkPath(watermark)
    const assetId = assetIdsByPath.get(sourcePath)
    const asset = assetByPath.get(sourcePath)
    if (!assetId || !asset?.dataUrl || usedAssets.has(assetId)) return
    usedAssets.set(assetId, {
      id: `hanhai:asset:${assetId}`,
      name: asset.name,
      assetId,
      width: asset.width || undefined,
      height: asset.height || undefined,
    })
  }))

  return {
    presets,
    presetGroups,
    projectLogos: [...usedAssets.values()],
    customVariables: [{ id: 'hanhai:variable:strategy_name', name: 'strategy_name', value: '未指定策略' }],
  }
}
