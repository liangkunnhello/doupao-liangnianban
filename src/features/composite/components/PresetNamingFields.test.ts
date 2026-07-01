/* @vitest-environment jsdom */

import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createDefaultCompositeV2Preset } from '../lib/compositeV2Defaults'
import {
  insertNamingVariable,
  PresetNamingFields,
  readNamingTemplate,
  renderNamingTemplateHtml,
} from './PresetNamingFields'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('PresetNamingFields helpers', () => {
  it('renders variable tokens with resolved output values and preserves token identity', () => {
    const html = renderNamingTemplateHtml(
      '{date}-快手-{size}-{channel}-{project}',
      {
        date: '20260625',
        size: '1080x1920',
        channel: '厂商',
        project: '极速版',
      },
    )

    expect(html).toContain('data-variable-name="date"')
    expect(html).toContain('>20260625<')
    expect(html).toContain('>1080x1920<')
    expect(html).toContain('>厂商<')
    expect(html).toContain('>极速版<')
    expect(html).toContain('mention-tag')
  })

  it('converts resolved variable chips back to template tokens', () => {
    const host = document.createElement('div')
    host.innerHTML = '项目-<span data-variable-name="size">1080x1920</span>-文案'

    expect(readNamingTemplate(host)).toBe('项目-{size}-文案')
  })

  it('converts nested dragged variable markup back to template tokens', () => {
    const host = document.createElement('div')
    host.innerHTML = '项目-<span><span data-variable-name="size">1080x1920</span></span><span>文案</span>'

    expect(readNamingTemplate(host)).toBe('项目-{size}文案')
  })

  it('uses a taller and smaller-font editor for naming templates', () => {
    const preset = createDefaultCompositeV2Preset(1)
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        createElement(PresetNamingFields, {
          preset,
          customVariables: [],
          previewValues: { date: '20260630', preset: preset.name, size: '1080x1920', channel: '渠道', index: '1' },
          onUpdatePreset: () => {},
          onUpdateCustomVariables: () => {},
        }),
      )
    })

    const editor = renderer!.root.findByProps({ 'aria-label': `预设命名模板 ${preset.name}` })
    expect(editor.props.className).toContain('min-h-32')
    expect(editor.props.className).toContain('text-xs')
    expect(editor.props.dangerouslySetInnerHTML.__html).toContain('font-size:11px')
  })
})

describe('insertNamingVariable', () => {
  it('inserts at a collapsed template selection without adding separators', () => {
    expect(insertNamingVariable('前-{size}-后', 'date', { start: 2, end: 2 })).toEqual({
      template: '前-{date}{size}-后',
      caret: 8,
    })
  })

  it('replaces a selected template range', () => {
    expect(insertNamingVariable('前-旧内容-后', 'size', { start: 2, end: 5 })).toEqual({
      template: '前-{size}-后',
      caret: 8,
    })
  })

  it('appends when there is no valid editor selection', () => {
    expect(insertNamingVariable('{date}', 'index', null)).toEqual({
      template: '{date}{index}',
      caret: 13,
    })
  })
})

describe('PresetNamingFields interactions', () => {
  function renderFields(
    preset = createDefaultCompositeV2Preset(1),
    customVariables = [] as Array<{ id: string; name: string; value: string }>,
    onUpdate = vi.fn(),
    onUpdateCustomVariables = vi.fn(),
  ) {
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(createElement(PresetNamingFields, {
        preset,
        customVariables,
        previewValues: {
          date: '20260701',
          channel: '渠道',
          size: '1280x720',
          preset: preset.name,
          index: '1',
        },
        onUpdatePreset: onUpdate,
        onUpdateCustomVariables,
      }))
    })
    return { renderer: renderer!, onUpdate, onUpdateCustomVariables }
  }

  it('keeps the editor selection when a variable button is pressed', () => {
    const preset = createDefaultCompositeV2Preset(1)
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(createElement(PresetNamingFields, {
        preset,
        customVariables: [],
        previewValues: {
          date: '20260701',
          channel: '渠道',
          size: '1280x720',
          preset: preset.name,
          index: '1',
        },
        onUpdatePreset: () => {},
        onUpdateCustomVariables: () => {},
      }))
    })

    const dateButton = renderer!.root.findByProps({ 'aria-label': '插入变量 {date}' })
    const preventDefault = vi.fn()
    dateButton.props.onMouseDown({ preventDefault })

    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('appends after the editor loses focus', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const { renderer, onUpdate } = renderFields(preset)
    const host = document.createElement('div')
    host.textContent = 'template'
    document.body.appendChild(host)
    const text = host.firstChild!
    const range = document.createRange()
    range.setStart(text, 0)
    range.collapse(true)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    const editor = renderer.root.findByProps({ 'aria-label': `预设命名模板 ${preset.name}` })
    act(() => editor.props.onMouseUp({ currentTarget: host }))
    act(() => editor.props.onBlur({ currentTarget: host }))
    act(() => renderer.root.findByProps({ 'aria-label': '插入变量 {index}' }).props.onClick())

    expect(onUpdate).toHaveBeenLastCalledWith({
      namingTemplate: `${preset.namingTemplate}{index}`,
    })
    host.remove()
  })

  it('rejects a custom variable that uses a built-in name', () => {
    const { renderer, onUpdate, onUpdateCustomVariables } = renderFields()
    const nameInput = renderer.root.findByProps({ 'aria-label': '自定义变量名' })

    act(() => nameInput.props.onChange({ target: { value: 'date' } }))
    act(() => renderer.root.findByProps({ 'aria-label': '添加自定义变量' }).props.onClick())

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onUpdateCustomVariables).not.toHaveBeenCalled()
    expect(renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props.value).toBe('date')
    expect(renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props['aria-invalid']).toBe(true)
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toBe('变量名已被使用')
  })

  it('rejects an existing custom variable name instead of updating it', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const customVariables = [{ id: 'custom-project', name: 'project', value: '项目A' }]
    const { renderer, onUpdate, onUpdateCustomVariables } = renderFields(preset, customVariables)

    act(() => renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props.onChange({
      target: { value: 'project' },
    }))
    act(() => renderer.root.findByProps({ 'aria-label': '添加自定义变量' }).props.onClick())

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onUpdateCustomVariables).not.toHaveBeenCalled()
    expect(customVariables).toEqual([
      { id: 'custom-project', name: 'project', value: '项目A' },
    ])
  })

  it('clears unsubmitted custom-variable state when the preset changes', () => {
    const presetA = createDefaultCompositeV2Preset(1)
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B' }
    const { renderer, onUpdate, onUpdateCustomVariables } = renderFields(presetA)

    act(() => renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props.onChange({
      target: { value: 'draftName' },
    }))
    act(() => renderer.root.findByProps({ 'aria-label': '自定义变量值' }).props.onChange({
      target: { value: '草稿值' },
    }))

    act(() => {
      renderer.update(createElement(PresetNamingFields, {
        preset: presetB,
        customVariables: [],
        previewValues: {
          date: '20260701',
          channel: '渠道',
          size: '1280x720',
          preset: presetB.name,
          index: '1',
        },
        onUpdatePreset: onUpdate,
        onUpdateCustomVariables,
      }))
    })

    expect(renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props.value).toBe('')
    expect(renderer.root.findByProps({ 'aria-label': '自定义变量值' }).props.value).toBe('')
    expect(renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props['aria-invalid']).toBeUndefined()
    expect(onUpdateCustomVariables).not.toHaveBeenCalled()
  })
})
