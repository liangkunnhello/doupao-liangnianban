/* @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import SopManagementCenter from './SopManagementCenter'
import type { SopLibraryItem } from './types'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const item: SopLibraryItem = {
  id: 'sop-1',
  name: '商品图 SOP',
  description: '生成统一风格商品图',
  content: '保持构图一致并替换主体。',
  source: 'manual',
  createdBy: 'user-1',
  createdAt: 1,
  updatedAt: 1,
}

function textContent(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textContent(child)).join('')
}

function findButton(root: ReactTestInstance, label: string) {
  return root.findAllByType('button').find((button) => textContent(button).includes(label))
}

function renderCenter(options: { selectedSopId?: string } = {}) {
  const onSaveItem = vi.fn()
  const onApply = vi.fn()
  const renderer = create(
    <SopManagementCenter
      minimized={false}
      groups={[]}
      items={[item]}
      metaInstructions={[]}
      currentUserId="user-1"
      onSaveGroup={vi.fn()}
      onDuplicateGroup={vi.fn(() => null)}
      onDeleteGroup={vi.fn()}
      onSaveItem={onSaveItem}
      onDuplicateItem={vi.fn(() => null)}
      onDeleteItem={vi.fn()}
      onSaveMetaInstruction={vi.fn()}
      onDuplicateMetaInstruction={vi.fn(() => null)}
      onDeleteMetaInstruction={vi.fn()}
      onGenerateSop={vi.fn()}
      selectedSopId={options.selectedSopId}
      onApply={onApply}
      onClear={vi.fn()}
      onMinimize={vi.fn()}
      onRestore={vi.fn()}
      onClose={vi.fn()}
    />,
  )
  return { renderer, onApply, onSaveItem }
}

describe('SopManagementCenter apply and save actions', () => {
  it('applies an existing SOP directly without requiring an edit save', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter()
    })

    const applyButton = findButton(result.renderer.root, '应用 SOP')
    expect(applyButton?.props.disabled).toBe(false)
    expect(findButton(result.renderer.root, '保存修改')?.props.disabled).toBe(true)

    act(() => applyButton!.props.onClick())

    expect(result.onApply).toHaveBeenCalledWith(expect.objectContaining({ id: item.id, name: item.name }))
    expect(result.onSaveItem).toHaveBeenCalledWith(expect.objectContaining({ id: item.id, lastUsedAt: expect.any(Number) }))
    result.renderer.unmount()
  })

  it('separates unsaved edits from applying the persisted SOP', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter()
    })

    const nameInput = result.renderer.root.findAllByType('input').find((input) => input.props.value === item.name)
    act(() => nameInput!.props.onChange({ target: { value: '新版商品图 SOP' } }))

    expect(findButton(result.renderer.root, '应用 SOP')?.props.disabled).toBe(true)
    const saveButton = findButton(result.renderer.root, '保存修改')
    expect(saveButton?.props.disabled).toBe(false)

    act(() => saveButton!.props.onClick())

    expect(result.onSaveItem).toHaveBeenCalledWith(expect.objectContaining({ id: item.id, name: '新版商品图 SOP' }))
    expect(result.onApply).not.toHaveBeenCalled()
    result.renderer.unmount()
  })

  it('shows the currently selected SOP as already applied', () => {
    let result!: ReturnType<typeof renderCenter>
    act(() => {
      result = renderCenter({ selectedSopId: item.id })
    })

    expect(findButton(result.renderer.root, '已应用')?.props.disabled).toBe(true)
    expect(findButton(result.renderer.root, '保存修改')?.props.disabled).toBe(true)
    result.renderer.unmount()
  })
})
