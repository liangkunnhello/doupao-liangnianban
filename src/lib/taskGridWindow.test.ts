import { describe, expect, it } from 'vitest'
import { getNextTaskGridVisibleCount, getTaskGridRenderSlice } from './taskGridWindow'

describe('task grid windowing', () => {
  it('limits initial rendering and grows in batches', () => {
    expect(getTaskGridRenderSlice([1, 2, 3, 4, 5], 3)).toEqual([1, 2, 3])
    expect(getNextTaskGridVisibleCount(3, 5, 2)).toBe(5)
    expect(getNextTaskGridVisibleCount(5, 5, 2)).toBe(5)
  })
})
