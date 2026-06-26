import { describe, expect, it } from 'vitest'
import { filterCompositeImageFiles, pickCompositeAsset } from './compositeAssets'
import type { CompositeFsImage } from './compositeTypes'

const files: CompositeFsImage[] = [
  { path: 'D:/素材/a.png', name: 'a.png' },
  { path: 'D:/素材/b.webp', name: 'b.webp' },
  { path: 'D:/素材/readme.txt', name: 'readme.txt' },
]

describe('composite asset helpers', () => {
  it('keeps only supported image extensions', () => {
    expect(filterCompositeImageFiles(files).map((file) => file.name)).toEqual(['a.png', 'b.webp'])
  })

  it('picks sequential assets by wrapping the index', () => {
    expect(pickCompositeAsset(files.slice(0, 2), 'sequential', 3, () => 0).name).toBe('b.webp')
  })

  it('picks random assets with injected random source', () => {
    expect(pickCompositeAsset(files.slice(0, 2), 'random', 0, () => 0.75).name).toBe('b.webp')
  })
})
