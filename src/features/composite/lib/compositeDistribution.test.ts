import { describe, expect, it } from 'vitest'
import {
  buildCompositeFolderName,
  buildCompositeFileName,
  expandCompositeBatches,
  getCompositeProgress,
  sanitizeCompositeFileName,
} from './compositeDistribution'

describe('composite distribution helpers', () => {
  it('expands fixed date batches across consecutive dates', () => {
    expect(expandCompositeBatches({
      mode: 'fixed',
      count: 2,
      startDate: '2026-06-25',
      days: 3,
    })).toEqual([
      { date: '20260625', count: 2 },
      { date: '20260626', count: 2 },
      { date: '20260627', count: 2 },
    ])
  })

  it('builds filenames from supported tokens', () => {
    expect(buildCompositeFileName({
      template: '{date}-{page}-{product}-{size}-{category}-{file}-{index}',
      date: '20260625',
      pageName: '主图/详情',
      productName: 'Product:X',
      sizeName: 'Main|Size',
      categoryName: '厂商',
      fileName: 'IMG/001.png',
      index: 4,
      extension: 'jpg',
    })).toBe('20260625-主图_详情-Product_X-Main_Size-厂商-IMG_001-4.jpg')
  })

  it('builds output folder names from naming templates without an extension', () => {
    expect(buildCompositeFolderName({
      template: '{date}-快手极速版-网赚-美女-GP组-陈泽杰-{size}-纯AI-{category}',
      date: '20260625',
      pageName: '水印',
      productName: '快手极速版',
      sizeName: '1080x1920',
      categoryName: '厂商',
      fileName: 'source.png',
      index: 1,
    })).toBe('20260625-快手极速版-网赚-美女-GP组-陈泽杰-1080x1920-纯AI-厂商')
  })

  it('sanitizes Windows filename characters', () => {
    expect(sanitizeCompositeFileName('a<>:"/\\|?*b')).toBe('a_________b')
  })

  it('does not report progress beyond 100 percent', () => {
    expect(getCompositeProgress(12, 10)).toEqual({ completed: 10, total: 10, percent: 100 })
  })
})
