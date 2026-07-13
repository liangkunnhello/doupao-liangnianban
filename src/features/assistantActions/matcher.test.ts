import { describe, expect, it } from 'vitest'
import type { AssistantInputContext } from './types'
import {
  getMoreAssistantActions,
  getRecommendedAssistantActions,
  normalizeAssistantActionPreferences,
} from './matcher'

function context(patch: Partial<AssistantInputContext> = {}): AssistantInputContext {
  return {
    text: '',
    hasText: false,
    images: [],
    hasImage: false,
    imageCount: 0,
    ...patch,
  }
}

describe('assistant action matcher', () => {
  it('keeps core actions visible even when older preferences hid them', () => {
    const preferences = normalizeAssistantActionPreferences({
      hiddenActionIds: ['image-derive', 'prompt-optimize', 'batch-variants'],
    })

    expect(preferences.hiddenActionIds).toEqual(['batch-variants'])
  })

  it('prioritizes image derive when images are present', () => {
    const actions = getRecommendedAssistantActions(context({ hasImage: true, imageCount: 1 }), undefined, 3)

    expect(actions.map((action) => action.id)).toContain('image-derive')
    expect(actions[0]?.id).toBe('image-derive')
    expect(actions.some((action) => action.id === 'prompt-optimize')).toBe(false)
  })

  it('prioritizes prompt optimize when text is present', () => {
    const actions = getRecommendedAssistantActions(context({ text: '产品卖点', hasText: true }), undefined, 3)

    expect(actions[0]?.id).toBe('prompt-optimize')
    expect(actions.some((action) => action.id === 'image-derive')).toBe(false)
  })

  it('shows both core actions when image and text are present', () => {
    const actions = getRecommendedAssistantActions(
      context({ text: '产品卖点', hasText: true, hasImage: true, imageCount: 1 }),
      undefined,
      5,
    )

    expect(actions.map((action) => action.id).slice(0, 2)).toEqual(['image-derive', 'prompt-optimize'])
  })

  it('does not expose internal channel rewrite in recommended or overflow actions', () => {
    const input = context({ text: '通用素材提示词', hasText: true })
    const preferences = normalizeAssistantActionPreferences(undefined)
    const allVisibleIds = [
      ...getRecommendedAssistantActions(input, preferences).map((action) => action.id),
      ...getMoreAssistantActions(input, preferences).map((action) => action.id),
    ]

    expect(allVisibleIds).not.toContain('channel-rewrite')
  })
})
