import type {
  CompositeV2OutputRuleGroup,
  CompositeV2OutputSizeRule,
  CompositeV2Preset,
  CompositeV2PresetGroup,
  CompositeV2State,
} from './compositeV2Types'

function rule(id: string, name: string, width: number, height: number, maxSizeKb: number): CompositeV2OutputSizeRule {
  return {
    id,
    name,
    enabled: false,
    width,
    height,
    maxSizeKb,
    format: 'jpg',
    subfolderTemplate: '{channel}/{size}',
    filenameTemplate: '{preset}-{source}-{index}',
  }
}

export function createDefaultCompositeV2OutputRuleGroups(): CompositeV2OutputRuleGroup[] {
  return [
    {
      id: 'gdt-toutiao',
      name: '广点通/头条',
      rules: [
        rule('gdt-toutiao-1280x720', '1280x720', 1280, 720, 399),
        rule('gdt-toutiao-1080x1920', '1080x1920', 1080, 1920, 399),
      ],
    },
    {
      id: 'baidu',
      name: '百度',
      rules: [
        rule('baidu-1140x640', '1140x640', 1140, 640, 299),
        rule('baidu-370x245', '370x245', 370, 245, 299),
        rule('baidu-1080x1920', '1080x1920', 1080, 1920, 399),
      ],
    },
    {
      id: 'vendor',
      name: '厂商',
      rules: [
        rule('vendor-1280x720', '1280x720', 1280, 720, 99),
        rule('vendor-1080x1920', '1080x1920', 1080, 1920, 99),
        rule('vendor-320x211', '320x211', 320, 211, 80),
        rule('vendor-320x210', '320x210', 320, 210, 80),
      ],
    },
  ]
}

export function createDefaultCompositeV2Preset(now = Date.now()): CompositeV2Preset {
  return {
    id: 'preset-default',
    name: '默认产品预设',
    outputRootPath: '',
    baseCanvas: { width: 1280, height: 720 },
    sampleBackgroundPath: '',
    layers: [],
    useOutputOverrides: false,
    outputRuleGroupsOverride: [],
    updatedAt: now,
  }
}

export function createDefaultCompositeV2PresetGroup(now = Date.now()): CompositeV2PresetGroup {
  return {
    id: 'group-default',
    name: '默认预设组',
    presetIds: ['preset-default'],
    updatedAt: now,
  }
}

export function createDefaultCompositeV2State(now = Date.now()): CompositeV2State {
  return {
    logoLibraryPath: '',
    presets: [createDefaultCompositeV2Preset(now)],
    presetGroups: [createDefaultCompositeV2PresetGroup(now)],
    outputRuleGroups: createDefaultCompositeV2OutputRuleGroups(),
    globalFitMode: 'crop-fill',
    historyRetention: 10,
    history: [],
  }
}
