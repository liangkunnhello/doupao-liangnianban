/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create } from 'react-test-renderer'
import type { SopLibraryItem } from './types'
import SopPresetPickerModal from './SopPresetPickerModal'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRenderers: Array<ReturnType<typeof create>> = []

afterEach(() => {
  while (mountedRenderers.length) mountedRenderers.pop()?.unmount()
})

const item: SopLibraryItem = {
  id: 'sop-1',
  name: '商品图 SOP',
  description: '用于商品主图',
  content: '生成商品主图。',
  source: 'manual',
  createdBy: 'user-1',
  createdAt: 1,
  updatedAt: 1,
}

describe('SopPresetPickerModal', () => {
  it('closes only when the backdrop itself is pressed', () => {
    const onClose = vi.fn()
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <SopPresetPickerModal
          items={[item]}
          groups={[]}
          onSelect={vi.fn()}
          onClose={onClose}
        />,
      )
    })
    mountedRenderers.push(renderer!)

    const layer = renderer!.root.findByProps({ role: 'dialog' })
    const content = {}
    act(() => layer.props.onMouseDown({ target: content, currentTarget: layer }))
    expect(onClose).not.toHaveBeenCalled()

    act(() => layer.props.onMouseDown({ target: layer, currentTarget: layer }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('offers a clear SOP action and a management entry', () => {
    const onClear = vi.fn()
    const onManage = vi.fn()
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <SopPresetPickerModal
          items={[item]}
          groups={[]}
          selectedSopId={item.id}
          onSelect={vi.fn()}
          onClear={onClear}
          onManage={onManage}
          onClose={vi.fn()}
        />,
      )
    })
    mountedRenderers.push(renderer!)

    const buttons = renderer!.root.findAllByType('button')
    act(() => buttons.find((button) => button.props['aria-pressed'] === false)!.props.onClick())
    act(() => buttons.find((button) => button.props['aria-label'] === '打开 SOP 库')!.props.onClick())

    expect(onClear).toHaveBeenCalledOnce()
    expect(onManage).toHaveBeenCalledOnce()
  })

  it('edits and copies SOP presets inside the picker', () => {
    const onSaveItem = vi.fn()
    const onDuplicateItem = vi.fn(() => 'sop-copy')
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <SopPresetPickerModal
          items={[item]}
          groups={[]}
          onSelect={vi.fn()}
          onSaveItem={onSaveItem}
          onDuplicateItem={onDuplicateItem}
          onClose={vi.fn()}
        />,
      )
    })
    mountedRenderers.push(renderer!)

    act(() => renderer!.root.findAllByType('button').find((button) => button.props['aria-label'] === `复制 ${item.name}`)!.props.onClick())
    expect(onDuplicateItem).toHaveBeenCalledWith(item.id)

    act(() => renderer!.root.findAllByType('button').find((button) => button.props['aria-label'] === `编辑 ${item.name}`)!.props.onClick())
    const nameInput = renderer!.root.findAllByType('input').find((input) => input.props.value === item.name)
    act(() => nameInput!.props.onChange({ target: { value: '编辑后的 SOP' } }))
    act(() => renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }))

    expect(onSaveItem).toHaveBeenCalledWith(expect.objectContaining({ id: item.id, name: '编辑后的 SOP' }))
  })

  it('moves a dragged SOP into the dropped group', () => {
    const onSaveItem = vi.fn()
    const targetGroup = { id: 'group-2', name: '目标分组', createdAt: 1, updatedAt: 1 }
    const transfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => item.id) }
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        <SopPresetPickerModal
          items={[item]}
          groups={[targetGroup]}
          onSelect={vi.fn()}
          onSaveItem={onSaveItem}
          onClose={vi.fn()}
        />,
      )
    })
    mountedRenderers.push(renderer!)

    const draggableCard = renderer!.root.findAll((node) => node.props.draggable === true)[0]
    act(() => draggableCard.props.onDragStart({ dataTransfer: transfer }))
    const target = renderer!.root.findAll((node) => node.props['data-sop-drop-group'] === targetGroup.id)[0]
    act(() => target.props.onDrop({ preventDefault: vi.fn(), dataTransfer: transfer }))

    expect(onSaveItem).toHaveBeenCalledWith(expect.objectContaining({ id: item.id, groupId: targetGroup.id }))
  })
})
