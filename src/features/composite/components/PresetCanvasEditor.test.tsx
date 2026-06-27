import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createDefaultCompositeV2Preset } from '../lib/compositeV2Defaults'
import { PresetCanvasEditor } from './PresetCanvasEditor'

describe('PresetCanvasEditor', () => {
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
  })
})
