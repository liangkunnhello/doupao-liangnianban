import { describe, expect, it } from 'vitest'
import { buildElectronImageExportEntries, collectReferencedExportImageIds } from './dataExport'

describe('data export planning', () => {
  it('collects referenced IDs once in first-seen order', () => {
    const tasks: any[] = [{
      inputImageIds: ['input-a'],
      maskImageId: 'mask-a',
      outputImages: ['output-a'],
      streamPartialImageIds: ['partial-a', 'output-a'],
    }]
    const conversations: any[] = [{ rounds: [{ inputImageIds: ['agent-a', 'input-a'] }] }]
    expect(collectReferencedExportImageIds(tasks, conversations)).toEqual([
      'input-a', 'mask-a', 'output-a', 'partial-a', 'agent-a',
    ])
  })

  it('builds entries sequentially from local metadata', async () => {
    const entry = await buildElectronImageExportEntries(['output-a'], async () => ({
      id: 'output-a',
      localPath: 'C:\\cache\\output-a.png',
      createdAt: 10,
    }))
    expect(entry).toEqual([{
      imageId: 'output-a',
      sourcePath: 'C:\\cache\\output-a.png',
      archivePath: 'images/output-a.png',
      createdAt: 10,
    }])
  })

  it('rejects records that have not migrated', async () => {
    await expect(buildElectronImageExportEntries(['output-a'], async () => ({
      id: 'output-a',
      dataUrl: 'data:image/png;base64,YQ==',
    }))).rejects.toThrow('output-a')
  })
})
