import { describe, expect, it } from 'vitest'
import {
  buildHanhaiImportBundle,
  createHanhaiImportPreview,
  getHanhaiPresetId,
  parseHanhaiPresetConfig,
} from './hanhaiPresetImport'

const SOURCE_JSON = JSON.stringify([
  {
    id: 'root-a',
    type: 'preset',
    name: '{date}-保险-{strategy_name}-',
    resize: { enabled: true, width: 1280, height: 720, mode: 'fill' },
    watermarks: [{ type: 'image', path: 'C:/assets/frame.png', resize_mode: 'fill', opacity: 255, position: 'center' }],
    output: {
      folder: 'D:/exports',
      filename_pattern: '{preset_name}-{sequence}',
      format: 'JPEG',
      quality: 85,
      max_size_kb: 200,
    },
  },
  {
    id: 'group-one',
    type: 'group',
    name: '快手 AI策略',
    children: [{
      id: 'child-b',
      type: 'preset',
      name: '{date}-快手-老歌-',
      resize: { enabled: true, width: 1080, height: 1920, mode: 'fill' },
      watermarks: [
        { type: 'text', content: '@K', size: 25, opacity: 55, position: 'top-center' },
        { type: 'image', path: 'F:/missing.png', resize_mode: 'fit', opacity: 255, position: 'center' },
      ],
      output: {
        folder: 'E:/exports',
        filename_pattern: '{preset_name},{sequence}',
        format: 'JPEG',
        quality: 100,
        max_size_kb: 180,
      },
    }],
  },
])

const assets = [
  { path: 'C:/assets/frame.png', name: 'frame.png', dataUrl: 'data:image/png;base64,AA==', width: 1280, height: 720 },
  { path: 'F:/missing.png', name: 'missing.png', dataUrl: null, width: 0, height: 0 },
] as const

describe('Hanhai preset import', () => {
  it('flattens root and grouped presets while preserving group membership', () => {
    const parsed = parseHanhaiPresetConfig(SOURCE_JSON)

    expect(parsed.presets).toHaveLength(2)
    expect(parsed.groups.map((group) => group.name)).toEqual(['瀚海未分组', '快手 AI策略'])
    expect(parsed.presets[1]).toMatchObject({ groupName: '快手 AI策略', source: { id: 'child-b' } })
  })

  it('previews only new presets and reports missing image assets', () => {
    const parsed = parseHanhaiPresetConfig(SOURCE_JSON)
    const preview = createHanhaiImportPreview(parsed, [...assets], [getHanhaiPresetId('root-a')])

    expect(preview).toMatchObject({
      totalCount: 2,
      newCount: 1,
      duplicateCount: 1,
      completeCount: 0,
      missingAssetPresetCount: 1,
    })
    expect(preview.missingAssets).toEqual([{
      presetId: 'child-b',
      presetName: '{date}-快手-老歌-',
      path: 'F:/missing.png',
    }])
  })

  it('builds stored watermark layers, missing placeholders, naming, and JPEG output limits', () => {
    const parsed = parseHanhaiPresetConfig(SOURCE_JSON)
    const bundle = buildHanhaiImportBundle(
      parsed,
      [...assets],
      new Map([['C:/assets/frame.png', 'asset-hash']]),
      [],
      123,
    )

    expect(bundle.presets).toHaveLength(2)
    expect(bundle.presetGroups.map((group) => group.presetIds)).toEqual([
      [getHanhaiPresetId('root-a')],
      [getHanhaiPresetId('child-b')],
    ])
    expect(bundle.presets[0]).toMatchObject({
      id: getHanhaiPresetId('root-a'),
      outputRootPath: 'D:/exports',
      filenameTemplate: '{date}-保险-{strategy_name}-{index}',
      outputFolderTemplate: '{date}-保险-{strategy_name}-',
      indexPadding: 3,
      outputRuleMode: 'replace',
      customVariableValues: { strategy_name: '未指定策略' },
      layers: [{
        type: 'logo',
        imageFit: 'crop-fill',
        asset: { kind: 'stored', assetId: 'asset-hash' },
      }],
      outputRuleGroupsOverride: [{
        rules: [{ width: 1280, height: 720, maxSizeKb: 200, jpegQuality: 0.85 }],
      }],
    })
    expect(bundle.presets[1]?.name).toContain('（缺水印）')
    expect(bundle.presets[1]?.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'logo', asset: null, name: expect.stringContaining('缺失水印') }),
      expect.objectContaining({ type: 'text', text: '@K' }),
    ]))
    expect(bundle.projectLogos).toEqual([expect.objectContaining({ assetId: 'asset-hash', name: 'frame.png' })])
  })

  it('rejects malformed configuration before any import mutation', () => {
    expect(() => parseHanhaiPresetConfig('{bad')).toThrow('JSON 格式无效')
    expect(() => parseHanhaiPresetConfig('{}')).toThrow('顶层必须是数组')
  })

  it('preserves sequence tokens embedded in the source preset name', () => {
    const parsed = parseHanhaiPresetConfig(JSON.stringify([{
      id: 'sequence-a',
      name: '{date}-图标-{sequence}',
      resize: { width: 1280, height: 720 },
      watermarks: [],
      output: { filename_pattern: '{preset_name}{sequence}', quality: 100, max_size_kb: 180 },
    }]))
    const preset = buildHanhaiImportBundle(parsed, [], new Map()).presets[0]!

    expect(preset.filenameTemplate).toBe('{date}-图标-{index}{index}')
    expect(preset.outputFolderTemplate).toBe('{date}-图标')
  })
})
