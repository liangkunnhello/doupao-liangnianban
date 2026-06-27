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
    expect(html).toContain('显示')
    expect(html).toContain('锁定')
    expect(html).toContain('透明度')
    expect(html).toContain('定位模式')
  })
})
