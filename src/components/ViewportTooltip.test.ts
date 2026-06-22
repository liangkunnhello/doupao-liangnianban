import { describe, expect, it } from 'vitest'
import { getViewportTooltipClasses } from './ViewportTooltip'

describe('getViewportTooltipClasses', () => {
  it('uses light tooltip colors by default and dark colors in dark theme', () => {
    const classes = getViewportTooltipClasses('')

    expect(classes).toContain('bg-white')
    expect(classes).toContain('text-gray-700')
    expect(classes).toContain('dark:bg-gray-800')
    expect(classes).toContain('dark:text-white')
  })

  it('keeps caller classes', () => {
    expect(getViewportTooltipClasses('whitespace-nowrap')).toContain('whitespace-nowrap')
  })
})
