import { describe, expect, it } from 'vitest'
import { createPreviewHistory, naturalSortBackgrounds, supportsCompositeBackground } from './compositeBackgrounds'
import type { CompositeV2BackgroundImage } from './compositeV2Types'

const image = (path: string, relativeDir = ''): CompositeV2BackgroundImage => ({
  path,
  name: path.split(/[\\/]/).pop() ?? path,
  relativeDir,
})

describe('composite backgrounds', () => {
  it('accepts supported image extensions only', () => {
    expect(supportsCompositeBackground('a.JPG')).toBe(true)
    expect(supportsCompositeBackground('a.jpeg')).toBe(true)
    expect(supportsCompositeBackground('a.png')).toBe(true)
    expect(supportsCompositeBackground('a.webp')).toBe(true)
    expect(supportsCompositeBackground('a.gif')).toBe(false)
  })

  it('sorts non-recursive backgrounds by natural filename', () => {
    const sorted = naturalSortBackgrounds([
      image('D:/bg/10.jpg'),
      image('D:/bg/2.jpg'),
      image('D:/bg/1.jpg'),
    ])

    expect(sorted.map((item) => item.name)).toEqual(['1.jpg', '2.jpg', '10.jpg'])
  })

  it('sorts recursive backgrounds by folder then filename', () => {
    const sorted = naturalSortBackgrounds([
      image('D:/bg/B/1.jpg', 'B'),
      image('D:/bg/A/10.jpg', 'A'),
      image('D:/bg/A/2.jpg', 'A'),
      image('D:/bg/A/sub/1.jpg', 'A/sub'),
    ])

    expect(sorted.map((item) => `${item.relativeDir}/${item.name}`)).toEqual([
      'A/2.jpg',
      'A/10.jpg',
      'A/sub/1.jpg',
      'B/1.jpg',
    ])
  })

  it('keeps preview navigation inside visited random backgrounds', () => {
    const history = createPreviewHistory(['a', 'b', 'c'])
    expect(history.current()).toBe('a')
    expect(history.push('c').current()).toBe('c')
    expect(history.previous().current()).toBe('a')
    expect(history.next().current()).toBe('c')
  })
})
