import type { WordLibraryGroup } from '../../types'
import type { WordDeriveActionSettings } from './types'

type AssistantWordGroupOptions = Pick<WordDeriveActionSettings, 'targetGroupMode' | 'targetGroupId'> & {
  actionName: string
}

export function resolveAssistantWordGroupId(
  options: AssistantWordGroupOptions,
  groups: WordLibraryGroup[],
  createGroup: (name: string) => string,
) {
  const activeGroups = groups.filter((group) => group.archivedAt == null)
  if (options.targetGroupMode === 'selected' && options.targetGroupId) {
    const selected = activeGroups.find((group) => group.id === options.targetGroupId)
    if (selected) return selected.id
  }

  const skillName = options.actionName.trim() || '词条衍生'
  const existing = activeGroups.find((group) => group.name.trim() === skillName)
  return existing?.id ?? createGroup(skillName)
}
