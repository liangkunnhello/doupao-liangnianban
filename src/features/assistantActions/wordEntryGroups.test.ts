import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_WORD_DERIVE_SETTINGS } from './matcher'
import { resolveAssistantWordGroupId } from './wordEntryGroups'

const options = {
  ...DEFAULT_WORD_DERIVE_SETTINGS,
  actionName: '图片衍生',
}

describe('assistant word entry groups', () => {
  it('reuses the active group named after the skill', () => {
    const createGroup = vi.fn(() => 'new-group')
    const groupId = resolveAssistantWordGroupId(options, [
      { id: 'derive-group', name: '图片衍生', sortOrder: 1 },
      { id: 'other-group', name: '爆款衍生', sortOrder: 2 },
    ], createGroup)

    expect(groupId).toBe('derive-group')
    expect(createGroup).not.toHaveBeenCalled()
  })

  it('creates a skill-named group when only an archived match exists', () => {
    const createGroup = vi.fn(() => 'new-group')
    const groupId = resolveAssistantWordGroupId(options, [
      { id: 'archived-group', name: '图片衍生', sortOrder: 1, archivedAt: Date.now() },
    ], createGroup)

    expect(groupId).toBe('new-group')
    expect(createGroup).toHaveBeenCalledWith('图片衍生')
  })

  it('keeps an explicitly selected active group', () => {
    const createGroup = vi.fn(() => 'new-group')
    const groupId = resolveAssistantWordGroupId({ ...options, targetGroupMode: 'selected', targetGroupId: 'fixed' }, [
      { id: 'fixed', name: '固定分组', sortOrder: 1 },
    ], createGroup)

    expect(groupId).toBe('fixed')
    expect(createGroup).not.toHaveBeenCalled()
  })
})
