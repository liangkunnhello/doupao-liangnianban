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

  it('uses readable raw template editors', () => {
    const preset = createDefaultCompositeV2Preset(1)
    let renderer: ReturnType<typeof create>

    act(() => {
      renderer = create(
        createElement(PresetNamingFields, {
          preset,
          customVariables: [],
          previewValues: { date: '20260630', preset: preset.name, size: '1080x1920', channel: '渠道', index: '1' },
          onUpdatePreset: () => {},
          onAddCustomVariable: () => {},
          onUpdateCustomVariableValue: () => {},
          onRemoveCustomVariable: () => {},
        }),
      )
    })

    const editor = renderer!.root.findByProps({ 'aria-label': `预设目录模板 ${preset.name}` })
    expect(editor.props.className).toContain('min-h-20')
    expect(editor.props.className).toContain('text-xs')
    expect(editor.props.value).toBe(preset.subfolderTemplate)
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

  it('replaces a selected range in an absolute Windows path', () => {
    expect(insertNamingVariable(
      'D:\\Exports\\daily',
      'date',
      { start: 11, end: 16 },
    )).toEqual({
      template: 'D:\\Exports\\{date}',
      caret: 17,
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
    onAddCustomVariable = vi.fn(),
    onUpdateCustomVariableValue = vi.fn(),
    onRemoveCustomVariable = vi.fn(),
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
        onAddCustomVariable,
        onUpdateCustomVariableValue,
        onRemoveCustomVariable,
      }))
    })
    return {
      renderer: renderer!,
      onUpdate,
      onAddCustomVariable,
      onUpdateCustomVariableValue,
      onRemoveCustomVariable,
    }
  }

  it('shows raw directory and filename templates with a separate preview', () => {
    const preset = {
      ...createDefaultCompositeV2Preset(1),
      subfolderTemplate: '{project}/{size}',
      filenameTemplate: '{preset}-{index}',
      customVariableValues: { project: '项目A' },
    }
    const customVariables = [{ id: 'project', name: 'project', value: '默认项目' }]
    const { renderer } = renderFields(preset, customVariables)

    expect(renderer.root.findByProps({ 'aria-label': `预设目录模板 ${preset.name}` }).props.value)
      .toBe('{project}/{size}')
    expect(renderer.root.findByProps({ 'aria-label': `预设文件名模板 ${preset.name}` }).props.value)
      .toBe('{preset}-{index}')
    expect(renderer.root.findByProps({ 'data-testid': 'preset-subfolder-preview' }).children.join(''))
      .toBe('项目A/1280x720')
  })

  it('switches controlled naming fields without updating either preset', () => {
    const presetA = {
      ...createDefaultCompositeV2Preset(1),
      subfolderTemplate: 'A/{project}',
      filenameTemplate: 'A-{index}',
      customVariableValues: { project: '项目A' },
    }
    const presetB = {
      ...createDefaultCompositeV2Preset(2),
      id: 'preset-b',
      name: 'Preset B',
      subfolderTemplate: 'B/{project}',
      filenameTemplate: 'B-{index}',
      customVariableValues: { project: '项目B' },
    }
    const onUpdate = vi.fn()
    const { renderer } = renderFields(presetA, [], onUpdate)

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
        onAddCustomVariable: vi.fn(),
        onUpdateCustomVariableValue: vi.fn(),
        onRemoveCustomVariable: vi.fn(),
      }))
    })

    expect(renderer.root.findByProps({ 'aria-label': `预设目录模板 ${presetB.name}` }).props.value)
      .toBe('B/{project}')
    expect(renderer.root.findByProps({ 'aria-label': `预设文件名模板 ${presetB.name}` }).props.value)
      .toBe('B-{index}')
    expect(onUpdate).not.toHaveBeenCalled()
  })

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
        onAddCustomVariable: () => {},
        onUpdateCustomVariableValue: () => {},
        onRemoveCustomVariable: () => {},
      }))
    })

    const dateButton = renderer!.root.findByProps({ 'aria-label': '插入变量 {date}' })
    const preventDefault = vi.fn()
    dateButton.props.onMouseDown({ preventDefault })

    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('inserts into the active template field', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const { renderer, onUpdate } = renderFields(preset)
    const editor = renderer.root.findByProps({ 'aria-label': `预设目录模板 ${preset.name}` })
    act(() => editor.props.onFocus({
      currentTarget: {
        selectionStart: preset.subfolderTemplate.length,
        selectionEnd: preset.subfolderTemplate.length,
      },
    }))
    act(() => renderer.root.findByProps({ 'aria-label': '插入变量 {index}' }).props.onClick())

    expect(onUpdate).toHaveBeenLastCalledWith({
      subfolderTemplate: `${preset.subfolderTemplate}{index}`,
    })
  })

  it('inserts a variable at the output root caret', () => {
    const preset = {
      ...createDefaultCompositeV2Preset(1),
      outputRootPath: 'D:\\Exports\\',
    }
    const { renderer, onUpdate } = renderFields(preset)
    const outputRoot = renderer.root.findByProps({ 'aria-label': '输出根目录' })

    act(() => outputRoot.props.onFocus({
      currentTarget: {
        selectionStart: preset.outputRootPath.length,
        selectionEnd: preset.outputRootPath.length,
      },
    }))
    act(() => renderer.root.findByProps({ 'aria-label': '插入变量 {date}' }).props.onClick())

    expect(onUpdate).toHaveBeenLastCalledWith({
      outputRootPath: 'D:\\Exports\\{date}',
    })
  })

  it('appends to the output root when the browser does not expose a selection', () => {
    const preset = {
      ...createDefaultCompositeV2Preset(1),
      outputRootPath: 'D:\\Exports',
    }
    const { renderer, onUpdate } = renderFields(preset)
    const outputRoot = renderer.root.findByProps({ 'aria-label': '输出根目录' })

    act(() => outputRoot.props.onFocus({
      currentTarget: {
        value: preset.outputRootPath,
        selectionStart: null,
        selectionEnd: null,
      },
    }))
    act(() => renderer.root.findByProps({ 'aria-label': '插入变量 {date}' }).props.onClick())

    expect(onUpdate).toHaveBeenLastCalledWith({
      outputRootPath: 'D:\\Exports{date}',
    })
  })

  it('rejects a custom variable that uses a built-in name', () => {
    const { renderer, onUpdate, onAddCustomVariable } = renderFields()
    const nameInput = renderer.root.findByProps({ 'aria-label': '自定义变量名' })

    act(() => nameInput.props.onChange({ target: { value: 'date' } }))
    act(() => renderer.root.findByProps({ 'aria-label': '添加自定义变量' }).props.onClick())

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onAddCustomVariable).not.toHaveBeenCalled()
    expect(renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props.value).toBe('date')
    expect(renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props['aria-invalid']).toBe(true)
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toBe('变量名已被使用')
  })

  it('rejects an existing custom variable name instead of updating it', () => {
    const preset = createDefaultCompositeV2Preset(1)
    const customVariables = [{ id: 'custom-project', name: 'project', value: '项目A' }]
    const { renderer, onUpdate, onAddCustomVariable } = renderFields(preset, customVariables)

    act(() => renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props.onChange({
      target: { value: 'project' },
    }))
    act(() => renderer.root.findByProps({ 'aria-label': '添加自定义变量' }).props.onClick())

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onAddCustomVariable).not.toHaveBeenCalled()
    expect(customVariables).toEqual([
      { id: 'custom-project', name: 'project', value: '项目A' },
    ])
  })

  it('clears unsubmitted custom-variable state when the preset changes', () => {
    const presetA = createDefaultCompositeV2Preset(1)
    const presetB = { ...createDefaultCompositeV2Preset(2), id: 'preset-b', name: 'Preset B' }
    const { renderer, onUpdate, onAddCustomVariable, onUpdateCustomVariableValue, onRemoveCustomVariable } = renderFields(presetA)

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
        onAddCustomVariable,
        onUpdateCustomVariableValue,
        onRemoveCustomVariable,
      }))
    })

    expect(renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props.value).toBe('')
    expect(renderer.root.findByProps({ 'aria-label': '自定义变量值' }).props.value).toBe('')
    expect(renderer.root.findByProps({ 'aria-label': '自定义变量名' }).props['aria-invalid']).toBeUndefined()
    expect(onAddCustomVariable).not.toHaveBeenCalled()
  })
})
