import { describe, expect, it } from 'vitest'
import { buildCompositeOutputPathParts, sanitizePathSegment, withCollisionSuffix } from './compositePathTemplates'

describe('composite path templates', () => {
  it('replaces output variables and sanitizes path segments', () => {
    const parts = buildCompositeOutputPathParts({
      date: '20260627',
      channel: '百度',
      size: '1080x1920',
      preset: '产品:A',
      index: 3,
      source: '背景/1',
      sourceDir: 'A/B',
      custom: '投放1',
      subfolderTemplate: '{channel}/{size}/{custom}',
      filenameTemplate: '{preset}-{source}-{index}',
      preserveSourceDir: true,
    })

    expect(parts).toEqual({
      dateFolder: '20260627',
      subfolders: ['百度', '1080x1920', '投放1', 'A', 'B'],
      filename: '产品_A-背景_1-3.jpg',
    })
  })

  it('sanitizes reserved filename characters', () => {
    expect(sanitizePathSegment('a:b*c?d<e>f|g')).toBe('a_b_c_d_e_f_g')
  })

  it('rewrites dot-only path segments to safe visible folders', () => {
    const parts = buildCompositeOutputPathParts({
      date: '20260627',
      channel: '百度',
      size: '1080x1920',
      preset: '产品A',
      index: 1,
      source: '背景1',
      sourceDir: '',
      custom: '..\\outside',
      subfolderTemplate: '{custom}',
      filenameTemplate: '{preset}',
      preserveSourceDir: false,
    })

    expect(parts.subfolders).toEqual(['_', 'outside'])
    expect(parts.subfolders).not.toContain('..')
  })

  it('sanitizes Windows reserved device names and trailing dots', () => {
    expect(sanitizePathSegment('CON')).toBe('_CON')
    expect(sanitizePathSegment('com1.txt')).toBe('_com1.txt')
    expect(sanitizePathSegment('name.')).toBe('name_')
  })

  it('omits empty subfolder path segments', () => {
    const parts = buildCompositeOutputPathParts({
      date: '20260627',
      channel: '百度',
      size: '1080x1920',
      preset: '产品A',
      index: 1,
      source: '背景1',
      sourceDir: '',
      custom: '',
      subfolderTemplate: '',
      filenameTemplate: '{preset}',
      preserveSourceDir: true,
    })

    expect(parts.subfolders).toEqual([])
  })

  it('appends collision suffix before extension', () => {
    expect(withCollisionSuffix('image.jpg', 2)).toBe('image-2.jpg')
  })
})
