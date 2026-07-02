import { useEffect, useMemo, useRef, useState } from 'react'
import type { CompositeV2CustomVariable, CompositeV2Preset } from '../lib/compositeV2Types'

type Props = {
  preset: CompositeV2Preset
  customVariables: CompositeV2CustomVariable[]
  previewValues: Record<string, string>
  onUpdatePreset: (patch: Partial<CompositeV2Preset>) => void
  onAddCustomVariable: (name: string, value: string) => void
  onUpdateCustomVariableValue: (name: string, value: string) => void
  onRemoveCustomVariable: (name: string) => void
}

const BUILT_IN_VARIABLES = [
  { name: 'date', label: '日期' },
  { name: 'channel', label: '渠道' },
  { name: 'size', label: '尺寸' },
  { name: 'preset', label: '预设' },
  { name: 'index', label: '序号' },
  { name: 'source', label: '源文件' },
  { name: 'sourceDir', label: '源目录' },
  { name: 'custom', label: '自定义值' },
]
const BUILT_IN_VARIABLE_NAMES = new Set(BUILT_IN_VARIABLES.map((variable) => variable.name))
const MENTION_TAG_STYLE = 'display:inline-flex;align-items:center;max-width:100%;padding:1px 6px;border-radius:6px;margin:0 1px;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.28);color:#2563eb;font-size:11px;line-height:1.4;vertical-align:baseline;cursor:grab;user-select:none;'

export type NamingTemplateSelection = {
  start: number
  end: number
}

export function insertNamingVariable(
  template: string,
  name: string,
  selection: NamingTemplateSelection | null,
) {
  const token = `{${name}}`
  if (!selection) {
    return { template: `${template}${token}`, caret: template.length + token.length }
  }

  const start = Math.max(0, Math.min(selection.start, selection.end, template.length))
  const end = Math.max(start, Math.min(Math.max(selection.start, selection.end), template.length))
  return {
    template: `${template.slice(0, start)}${token}${template.slice(end)}`,
    caret: start + token.length,
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function renderNamingTemplateHtml(template: string, values: Record<string, string>): string {
  let result = ''
  let cursor = 0
  for (const match of template.matchAll(/\{([^{}]+)\}/g)) {
    const index = match.index ?? 0
    const name = match[1] ?? ''
    result += escapeHtml(template.slice(cursor, index))
    const resolved = values[name] ?? match[0]
    result += `<span contenteditable="false" draggable="true" class="mention-tag" data-variable-name="${escapeHtml(name)}" title="${escapeHtml(match[0])}" style="${MENTION_TAG_STYLE}">${escapeHtml(resolved)}</span>`
    cursor = index + match[0].length
  }
  return result + escapeHtml(template.slice(cursor))
}

export function readNamingTemplate(host: Pick<Node, 'childNodes'>): string {
  const readNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const element = node as Element
    const name = element.getAttribute('data-variable-name')
    if (name) return `{${name}}`
    if (element.tagName === 'BR') return ''
    return Array.from(element.childNodes).map(readNode).join('')
  }
  return Array.from(host.childNodes).map(readNode).join('')
}

export function resolveNamingTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([^{}]+)\}/g, (token, name: string) => values[name] ?? token)
}

type TemplateField = 'subfolderTemplate' | 'filenameTemplate'

export function PresetNamingFields({
  preset,
  customVariables,
  previewValues,
  onUpdatePreset,
  onAddCustomVariable,
  onUpdateCustomVariableValue,
  onRemoveCustomVariable,
}: Props) {
  const [customName, setCustomName] = useState('')
  const [customValue, setCustomValue] = useState('')
  const [customNameError, setCustomNameError] = useState('')
  const [activeField, setActiveField] = useState<TemplateField>('subfolderTemplate')
  const selectionRef = useRef<Record<TemplateField, NamingTemplateSelection | null>>({
    subfolderTemplate: null,
    filenameTemplate: null,
  })
  const pendingCaretRef = useRef<{ field: TemplateField; caret: number } | null>(null)
  const subfolderRef = useRef<HTMLTextAreaElement>(null)
  const filenameRef = useRef<HTMLTextAreaElement>(null)
  const customNameErrorId = `preset-custom-variable-name-error-${preset.id}`

  const resolvedValues = useMemo(() => ({
    ...previewValues,
    ...preset.customVariableValues,
  }), [preset.customVariableValues, previewValues])
  const subfolderPreview = resolveNamingTemplate(preset.subfolderTemplate, resolvedValues)
  const filenamePreview = resolveNamingTemplate(preset.filenameTemplate, resolvedValues)

  useEffect(() => {
    setCustomName('')
    setCustomValue('')
    setCustomNameError('')
    setActiveField('subfolderTemplate')
    selectionRef.current = { subfolderTemplate: null, filenameTemplate: null }
    pendingCaretRef.current = null
  }, [preset.id])

  useEffect(() => {
    const pending = pendingCaretRef.current
    if (!pending) return
    pendingCaretRef.current = null
    const input = pending.field === 'subfolderTemplate' ? subfolderRef.current : filenameRef.current
    input?.focus()
    input?.setSelectionRange(pending.caret, pending.caret)
  }, [preset.subfolderTemplate, preset.filenameTemplate])

  function rememberSelection(field: TemplateField, input: HTMLTextAreaElement) {
    setActiveField(field)
    selectionRef.current[field] = {
      start: input.selectionStart,
      end: input.selectionEnd,
    }
  }

  function insertVariable(name: string) {
    const template = preset[activeField]
    const inserted = insertNamingVariable(template, name, selectionRef.current[activeField])
    selectionRef.current[activeField] = { start: inserted.caret, end: inserted.caret }
    pendingCaretRef.current = { field: activeField, caret: inserted.caret }
    onUpdatePreset({ [activeField]: inserted.template })
  }

  function addCustomVariable() {
    const name = customName.trim().replace(/[{}\s]/g, '')
    if (!name) return
    if (BUILT_IN_VARIABLE_NAMES.has(name) || customVariables.some((variable) => variable.name === name)) {
      setCustomNameError('变量名已被使用')
      return
    }
    onAddCustomVariable(name, customValue)
    setCustomName('')
    setCustomValue('')
    setCustomNameError('')
  }

  return (
    <div data-layout="preset-naming-fields" className="space-y-3 border-t border-gray-200 pt-3 dark:border-white/[0.08]">
      <label className="block text-[11px] text-gray-500">
        目录模板
        <textarea
          ref={subfolderRef}
          aria-label={`预设目录模板 ${preset.name}`}
          value={preset.subfolderTemplate}
          onChange={(event) => onUpdatePreset({ subfolderTemplate: event.target.value })}
          onFocus={(event) => rememberSelection('subfolderTemplate', event.currentTarget)}
          onSelect={(event) => rememberSelection('subfolderTemplate', event.currentTarget)}
          className="mt-1 min-h-20 w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-gray-900"
        />
      </label>
      <label className="block text-[11px] text-gray-500">
        文件名模板
        <textarea
          ref={filenameRef}
          aria-label={`预设文件名模板 ${preset.name}`}
          value={preset.filenameTemplate}
          onChange={(event) => onUpdatePreset({ filenameTemplate: event.target.value })}
          onFocus={(event) => rememberSelection('filenameTemplate', event.currentTarget)}
          onSelect={(event) => rememberSelection('filenameTemplate', event.currentTarget)}
          className="mt-1 min-h-20 w-full resize-y rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-blue-400 dark:border-white/[0.08] dark:bg-gray-900"
        />
      </label>

      <div data-testid="preset-naming-preview" className="rounded-md border border-blue-100 bg-blue-50/50 p-2 text-[11px] text-blue-800 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
        <div>目录预览：<span data-testid="preset-subfolder-preview">{subfolderPreview || '（输出根目录）'}</span></div>
        <div className="mt-1">文件预览：<span data-testid="preset-filename-preview">{filenamePreview || '（空文件名）'}.jpg</span></div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {BUILT_IN_VARIABLES.map((variable) => (
          <button
            key={variable.name}
            type="button"
            aria-label={`插入变量 {${variable.name}}`}
            title={`{${variable.name}} → ${resolvedValues[variable.name] ?? ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => insertVariable(variable.name)}
            className="cursor-pointer rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          >
            {variable.label}
          </button>
        ))}
      </div>

      {customVariables.map((variable) => (
        <div key={variable.id} className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)_auto_auto] items-center gap-2">
          <code className="truncate text-[11px] text-violet-700 dark:text-violet-200">{`{${variable.name}}`}</code>
          <input
            aria-label={`变量值 ${variable.name}`}
            value={preset.customVariableValues[variable.name] ?? ''}
            onChange={(event) => onUpdateCustomVariableValue(variable.name, event.target.value)}
            className="min-w-0 rounded-md border border-gray-200 px-2 py-1.5 text-xs dark:border-white/[0.08] dark:bg-gray-900"
          />
          <button type="button" aria-label={`插入变量 {${variable.name}}`} onMouseDown={(event) => event.preventDefault()} onClick={() => insertVariable(variable.name)} className="rounded-md border border-violet-200 px-2 py-1 text-[11px] text-violet-700 dark:border-violet-500/30 dark:text-violet-200">插入</button>
          <button type="button" aria-label={`移除变量 {${variable.name}}`} onClick={() => onRemoveCustomVariable(variable.name)} className="rounded-md px-1.5 text-sm text-violet-500 hover:bg-violet-100">×</button>
        </div>
      ))}

      <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto] gap-2">
        <div className="min-w-0">
          <input
            aria-label="自定义变量名"
            aria-invalid={customNameError ? true : undefined}
            aria-describedby={customNameError ? customNameErrorId : undefined}
            value={customName}
            onChange={(event) => {
              setCustomName(event.target.value)
              setCustomNameError('')
            }}
            placeholder="变量名，如 project"
            className="w-full min-w-0 rounded-md border border-gray-200 px-2 py-1.5 text-xs dark:border-white/[0.08] dark:bg-gray-900"
          />
          {customNameError && <p id={customNameErrorId} role="alert" className="mt-1 text-[10px] text-red-600">{customNameError}</p>}
        </div>
        <input
          aria-label="自定义变量值"
          value={customValue}
          onChange={(event) => setCustomValue(event.target.value)}
          placeholder="当前预设的值"
          className="min-w-0 rounded-md border border-gray-200 px-2 py-1.5 text-xs dark:border-white/[0.08] dark:bg-gray-900"
        />
        <button type="button" aria-label="添加自定义变量" onClick={addCustomVariable} className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700">添加</button>
      </div>
    </div>
  )
}
