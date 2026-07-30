import { useState } from 'react'
import { useRequirementPrototype } from '../../requirementPrototype/store'
import { useStore } from '../../../store'
import SopManagementCenter from '../SopManagementCenter'
import { generateSopFromStore } from './storeSopGeneration'
import type { SopLibraryItem } from '../types'

export default function GallerySopManagementCenter({
  selectedSopId,
  onApply,
  onClear,
  onClose,
}: {
  selectedSopId?: string
  onApply?: (item: SopLibraryItem) => void
  onClear?: () => void
  onClose: () => void
}) {
  const [minimized, setMinimized] = useState(false)
  const sessionUserId = useRequirementPrototype((state) => state.sessionUserId)
  const groups = useRequirementPrototype((state) => state.sopGroups)
  const items = useRequirementPrototype((state) => state.sopLibrary)
  const tasks = useStore((state) => state.tasks)
  const metaInstructions = useRequirementPrototype((state) => state.sopMetaInstructions)
  const saveGroup = useRequirementPrototype((state) => state.saveSopGroup)
  const duplicateGroup = useRequirementPrototype((state) => state.duplicateSopGroup)
  const deleteGroup = useRequirementPrototype((state) => state.deleteSopGroup)
  const saveItem = useRequirementPrototype((state) => state.saveSopItem)
  const duplicateItem = useRequirementPrototype((state) => state.duplicateSopItem)
  const deleteItem = useRequirementPrototype((state) => state.deleteSopItem)
  const saveMetaInstruction = useRequirementPrototype((state) => state.saveSopMetaInstruction)
  const duplicateMetaInstruction = useRequirementPrototype((state) => state.duplicateSopMetaInstruction)
  const deleteMetaInstruction = useRequirementPrototype((state) => state.deleteSopMetaInstruction)

  return <SopManagementCenter
    minimized={minimized}
    groups={groups}
    items={items}
    tasks={tasks}
    metaInstructions={metaInstructions}
    currentUserId={sessionUserId ?? 'user-admin'}
    onSaveGroup={saveGroup}
    onDuplicateGroup={duplicateGroup}
    onDeleteGroup={deleteGroup}
    onSaveItem={saveItem}
    onDuplicateItem={duplicateItem}
    onDeleteItem={deleteItem}
    onSaveMetaInstruction={saveMetaInstruction}
    onDuplicateMetaInstruction={duplicateMetaInstruction}
    onDeleteMetaInstruction={deleteMetaInstruction}
    onGenerateSop={generateSopFromStore}
    selectedSopId={selectedSopId}
    onApply={onApply}
    onClear={onClear}
    onMinimize={() => setMinimized(true)}
    onRestore={() => setMinimized(false)}
    onClose={onClose}
  />
}
