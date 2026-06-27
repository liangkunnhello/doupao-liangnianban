import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('PresetManagementTab source wiring', () => {
  it('uses store selection state and setters as the source of truth', () => {
    const source = readFileSync(new URL('./PresetManagementTab.tsx', import.meta.url), 'utf-8')

    expect(source).toContain("const selectedPresetGroupId = useCompositeV2Store((state) => state.selectedPresetGroupId)")
    expect(source).toContain("const selectedPreviewPresetId = useCompositeV2Store((state) => state.selectedPreviewPresetId)")
    expect(source).toContain("const setSelectedPresetGroup = useCompositeV2Store((state) => state.setSelectedPresetGroup)")
    expect(source).toContain("const setSelectedPreviewPresetId = useCompositeV2Store((state) => state.setSelectedPreviewPresetId)")
    expect(source).toContain("groupId: selectedPresetGroupId || undefined")
    expect(source).toContain("onClick={() => setSelectedPresetGroup(group.id)}")
    expect(source).toContain("onClick={() => setSelectedPreviewPresetId(preset.id)}")
    expect(source).not.toContain('const [activeGroupId, setActiveGroupId]')
    expect(source).not.toContain('const [activePresetId, setActivePresetId]')
  })
})
