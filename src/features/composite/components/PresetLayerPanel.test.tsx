import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createCompositeV2Store } from '../storeV2'
import { PresetLayerPanel } from './PresetLayerPanel'

describe('PresetLayerPanel', () => {
  it('shows layer order and selected layer properties in the bottom panel', () => {
    const store = createCompositeV2Store()
    const presetId = store.getState().presets[0]!.id
    store.getState().addTextLayer(presetId)
    store.getState().addImageLayer(presetId)
    store.getState().replaceOrAddLogoLayer(presetId, { kind: 'path', path: 'D:/logos/a.png' })
    const currentPreset = store.getState().presets[0]!
    store.getState().updatePreset(presetId, {
      layers: currentPreset.layers.map((layer, index) => index === 0 ? {
        ...layer,
        position: {
          mode: 'anchor',
          anchor: 'center',
          marginX: 0,
          marginY: 0,
          offsetX: 0,
          offsetY: 0,
          width: layer.position.width,
          height: layer.position.height,
        },
      } : layer),
    })
    const preset = store.getState().presets[0]!
    const selectedLayerId = preset.layers[0]!.id

    const html = renderToStaticMarkup(
      <PresetLayerPanel
        preset={preset}
        selectedLayerId={selectedLayerId}
        onSelectLayer={() => {}}
        onUpdatePreset={() => {}}
      />,
    )

    expect(html).toContain('图层信息')
    expect(html.indexOf('Text Layer')).toBeLessThan(html.indexOf('Image Layer'))
    expect(html).toContain('LOGO Layer')
    expect(html).toContain('LOGO ·')
    expect(html).toContain('显示')
    expect(html).toContain('锁定')
    expect(html).toContain('透明度')
    expect(html).toContain('定位模式')
    expect(html).toContain('水平偏移')
    expect(html).toContain('垂直偏移')
  })
})
