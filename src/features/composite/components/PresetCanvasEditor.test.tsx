/* @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create } from 'react-test-renderer'
import { createDefaultCompositeV2Preset } from '../lib/compositeV2Defaults'
import { createCompositeV2Store } from '../storeV2'
import { PresetCanvasEditor } from './PresetCanvasEditor'

describe('PresetCanvasEditor', () => {
  it('opens an in-place editor when a text layer is double-clicked', () => {
    const store = createCompositeV2Store()
    const presetId = store.getState().presets[0]!.id
    store.getState().addTextLayer(presetId)
    const preset = store.getState().presets[0]!
    const textLayer = preset.layers[0]!

    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(
        <PresetCanvasEditor
          preset={preset}
          logoLibraryPath=""
          logoAssets={[]}
          logoStatusText=""
          selectedLayerId={textLayer.id}
          onLogoLibraryPathChange={() => {}}
          onAddText={() => {}}
          onAddImage={() => {}}
          onSelectLogoFolder={() => {}}
          onRefreshLogoFolder={() => {}}
          onPickLogo={() => {}}
          onUpdatePreset={() => {}}
        />,
      )
    })

    const hitbox = renderer!.root.findAllByType('button').find((node) => node.props.title === textLayer.name)
    expect(typeof hitbox?.props.onDoubleClick).toBe('function')

    act(() => {
      hitbox?.props.onDoubleClick({
        stopPropagation: () => {},
        currentTarget: { parentElement: null },
      })
    })

    const editor = renderer!.root.findAllByType('textarea').find((node) => node.props['aria-label'] === `Edit text ${textLayer.name}`)
    expect(editor?.props.value).toBe('New Text')
    act(() => renderer!.unmount())
  })

  it('renders the floating toolbar and logo library shell', () => {
    const html = renderToStaticMarkup(
      <PresetCanvasEditor
        preset={{ ...createDefaultCompositeV2Preset(1), name: 'Preset Shell' }}
        logoLibraryPath="D:/logos"
        logoAssets={[{ path: 'D:/logos/logo-a.png', name: 'logo-a.png', dataUrl: 'data:image/png;base64,AAAA' }]}
        logoStatusText="Ready"
        onLogoLibraryPathChange={() => {}}
        onAddText={() => {}}
        onAddImage={() => {}}
        onSelectLogoFolder={() => {}}
        onRefreshLogoFolder={() => {}}
        onPickLogo={() => {}}
      />,
    )

    expect(html).toContain('Preset Shell')
    expect(html).toContain('aria-label="Add text layer"')
    expect(html).toContain('aria-label="Select logo folder"')
    expect(html).toContain('logo-a.png')
    expect(html).toContain('<canvas')
    expect(html).toContain('data-layout="floating-layer-panel"')
    expect(html).toContain('图层信息')
  })

  it('disables layer creation and logo picking when no preset is selected', () => {
    const html = renderToStaticMarkup(
      <PresetCanvasEditor
        preset={null}
        logoLibraryPath="D:/logos"
        logoAssets={[{ path: 'D:/logos/logo-a.png', name: 'logo-a.png', dataUrl: 'data:image/png;base64,AAAA' }]}
        logoStatusText="Select a preset first."
        onLogoLibraryPathChange={() => {}}
        onAddText={() => {}}
        onAddImage={() => {}}
        onSelectLogoFolder={() => {}}
        onRefreshLogoFolder={() => {}}
        onPickLogo={() => {}}
      />,
    )

    expect(html).toContain('aria-label="Add text layer unavailable until a preset is selected"')
    expect(html).toContain('title="Select a preset first to add text layers"')
    expect(html).toContain('aria-label="Add image layer unavailable until a preset is selected"')
    expect(html).toContain('title="Select a preset first to add image layers"')
    expect(html).toContain('aria-label="logo-a.png unavailable until a preset is selected"')
    expect(html).toContain('title="Select a preset first to insert this logo"')
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
})
