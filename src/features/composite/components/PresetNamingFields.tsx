import { useEffect, useMemo, useRef, useState } from 'react'
import type { CompositeV2CustomVariable, CompositeV2Preset } from '../lib/compositeV2Types'

type Props = {
  preset: CompositeV2Preset
  customVariables: CompositeV2CustomVariable[]
  previewValues: Record<string, string>
  onUpdatePreset: (patch: Partial<CompositeV2Preset>) => void
  onUpdateCustomVariables: (variables: CompositeV2CustomVariable[]) => void
}

const BUILT_IN_VARIABLES = [
  { name: 'date', label: '日期' },
  { name: 'channel', label: '渠道' },
  { name: 'size', label: '尺寸' },
  { name: 'preset', label: '预设' },
  { name: 'index', label: '序号' },
]
const BUILT_IN_VARIABLE_NAMES = new Set(BUILT_IN_VARIABLES.map((variable) => variable.name))
const DEFAULT_NAMING_TEMPLATE = '{date}-{preset}-{size}-{channel}'
const VARIABLE_DRAG_TYPE = 'application/x-doupao-naming-variable'
const MENTION_TAG_STYLE = 'display:inline-flex;align-items:center;max-width:100%;padding:1px 6px;border-radius:6px;margin:0 1px;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.28);color:#2563eb;font-size:11px;line-height:1.4;vertical-align:baseline;cursor:grab;user-select:none;'
const DROP_INDICATOR_STYLE = 'display:inline-block;width:2px;height:1.2em;margin:0 2px;border-radius:999px;background:rgb(59,130,246);vertical-align:-0.2em;pointer-events:none;'

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

function findMentionTag(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Node)) return null
  if (target instanceof HTMLElement && target.classList.contains('mention-tag')) return target
  return target.parentElement?.closest('.mention-tag') ?? null
}

function createMentionTag(doc: Document, variableName: string, resolvedValue: string) {
  const tag = doc.createElement('span')
  tag.contentEditable = 'false'
  tag.draggable = true
  tag.className = 'mention-tag'
  tag.setAttribute('data-variable-name', variableName)
  tag.setAttribute('title', `{${variableName}}`)
  tag.setAttribute('style', MENTION_TAG_STYLE)
  tag.textContent = resolvedValue
  return tag
}

function createDropIndicator(doc: Document) {
  const marker = doc.createElement('span')
  marker.className = 'mention-drop-indicator'
  marker.setAttribute('contenteditable', 'false')
  marker.setAttribute('aria-hidden', 'true')
  marker.setAttribute('style', DROP_INDICATOR_STYLE)
  marker.textContent = '\u200b'
  return marker
}

function getTemplateSelectionOffset(root: HTMLElement, container: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(root)
  range.setEnd(container, offset)
  const host = document.createElement('div')
  host.appendChild(range.cloneContents())
  return readNamingTemplate(host).length
}

function locateTemplateOffset(root: HTMLElement, templateOffset: number): { node: Node; offset: number } {
  let remaining = Math.max(0, templateOffset)

  const visit = (node: Node): { node: Node; offset: number } | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0
      if (remaining <= length) return { node, offset: remaining }
      remaining -= length
      return null
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return null

    const element = node as Element
    const variableName = element.getAttribute('data-variable-name')
    if (variableName) {
      const parent = element.parentNode
      if (!parent) return null
      const index = Array.from(parent.childNodes).indexOf(element)
      const tokenLength = `{${variableName}}`.length
      if (remaining <= 0) return { node: parent, offset: index }
      if (remaining <= tokenLength) return { node: parent, offset: index + 1 }
      remaining -= tokenLength
      return null
    }

    for (const child of Array.from(element.childNodes)) {
      const found = visit(child)
      if (found) return found
    }
    return null
  }

  const found = visit(root)
  return found ?? { node: root, offset: root.childNodes.length }
}

function restoreSelectionFromTemplateOffsets(root: HTMLElement, start: number, end = start) {
  const selection = window.getSelection()
  if (!selection) return

  const actualStart = Math.min(start, end)
  const actualEnd = Math.max(start, end)

  const startPoint = locateTemplateOffset(root, actualStart)
  const endPoint = locateTemplateOffset(root, actualEnd)
  const range = document.createRange()
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  selection.removeAllRanges()
  selection.addRange(range)
}

export function PresetNamingFields({ preset, customVariables, previewValues, onUpdatePreset, onUpdateCustomVariables }: Props) {
  const editorRef = useRef<HTMLDivElement>(null)
  const draggedMentionRef = useRef<HTMLElement | null>(null)
  const dropIndicatorRef = useRef<HTMLSpanElement | null>(null)
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null)
  const savedSelectionRef = useRef<({ presetId: string } & NamingTemplateSelection) | null>(null)
  const [customName, setCustomName] = useState('')
  const [customValue, setCustomValue] = useState('')
  const [customNameError, setCustomNameError] = useState('')
  const customNameErrorId = `preset-custom-variable-name-error-${preset.id}`
  const namingTemplate = preset.namingTemplate || preset.subfolderTemplate || DEFAULT_NAMING_TEMPLATE
  const resolvedValues = useMemo(() => ({
    ...previewValues,
    ...Object.fromEntries(customVariables.map((variable) => [variable.name, variable.value])),
  }), [customVariables, previewValues])
  const renderedHtml = useMemo(
    () => renderNamingTemplateHtml(namingTemplate, resolvedValues),
    [namingTemplate, resolvedValues],
  )
  const initialHtmlRef = useRef(renderedHtml)

  const [draggingVariableId, setDraggingVariableId] = useState('')

  useEffect(() => {
    setCustomName('')
    setCustomValue('')
    setCustomNameError('')
    savedSelectionRef.current = null
    pendingSelectionRef.current = null
  }, [preset.id])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const pendingSelection = pendingSelectionRef.current
    pendingSelectionRef.current = null

    if (editor.innerHTML === renderedHtml) {
      if (pendingSelection) {
        restoreSelectionFromTemplateOffsets(editor, pendingSelection.start, pendingSelection.end)
      }
      return
    }

    const selection = window.getSelection()
    const shouldRestoreSelection = selection
      && selection.rangeCount > 0
      && editor.contains(selection.anchorNode)
      && editor.contains(selection.focusNode)
    const start = pendingSelection
      ? pendingSelection.start
      : shouldRestoreSelection
        ? getTemplateSelectionOffset(editor, selection!.anchorNode!, selection!.anchorOffset)
        : null
    const end = pendingSelection
      ? pendingSelection.end
      : shouldRestoreSelection
        ? getTemplateSelectionOffset(editor, selection!.focusNode!, selection!.focusOffset)
        : null

    editor.innerHTML = renderedHtml

    if (start !== null && end !== null) {
      restoreSelectionFromTemplateOffsets(editor, start, end)
    }
  }, [renderedHtml])

  useEffect(() => () => {
    if (draggedMentionRef.current) {
      draggedMentionRef.current.style.opacity = '1'
      draggedMentionRef.current = null
    }
    if (dropIndicatorRef.current) {
      dropIndicatorRef.current.remove()
      dropIndicatorRef.current = null
    }
  }, [])

  function captureSelectionOffsets(editor: HTMLDivElement): { start: number; end: number } | null {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return null
    if (!editor.contains(selection.anchorNode) || !editor.contains(selection.focusNode)) return null
    return {
      start: getTemplateSelectionOffset(editor, selection.anchorNode!, selection.anchorOffset),
      end: getTemplateSelectionOffset(editor, selection.focusNode!, selection.focusOffset),
    }
  }

  function syncTemplateFromEditor(editor: HTMLDivElement | null, nextSelection?: { start: number; end: number } | null) {
    if (!editor) return
    const selection = nextSelection ?? captureSelectionOffsets(editor)
    pendingSelectionRef.current = selection
    if (selection) {
      savedSelectionRef.current = { presetId: preset.id, ...selection }
    }
    onUpdatePreset({ namingTemplate: readNamingTemplate(editor) })
  }

  function rememberSelection(editor: HTMLDivElement) {
    const selection = captureSelectionOffsets(editor)
    if (selection) {
      savedSelectionRef.current = { presetId: preset.id, ...selection }
    }
  }

  function clearDropIndicator() {
    if (dropIndicatorRef.current) {
      dropIndicatorRef.current.remove()
      dropIndicatorRef.current = null
    }
  }

  function findDropRange(editor: HTMLDivElement, event: React.DragEvent<HTMLDivElement>): Range {
    const documentRef = editor.ownerDocument
    const targetTag = findMentionTag(event.target)

    if (targetTag && editor.contains(targetTag)) {
      const rect = targetTag.getBoundingClientRect()
      const insertAfter = event.clientX > rect.left + rect.width / 2
      const range = documentRef.createRange()
      if (insertAfter) range.setStartAfter(targetTag)
      else range.setStartBefore(targetTag)
      range.collapse(true)
      return range
    }

    let range: Range | null = null
    const caretRangeFromPoint = (documentRef as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    }).caretRangeFromPoint
    const caretPositionFromPoint = (documentRef as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    }).caretPositionFromPoint

    if (caretRangeFromPoint) {
      range = caretRangeFromPoint(event.clientX, event.clientY)
    } else if (caretPositionFromPoint) {
      const position = caretPositionFromPoint(event.clientX, event.clientY)
      if (position) {
        range = documentRef.createRange()
        range.setStart(position.offsetNode, position.offset)
        range.collapse(true)
      }
    }

    if (!range || !editor.contains(range.startContainer)) {
      range = documentRef.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
    }

    return range
  }

  function showDropIndicator(editor: HTMLDivElement, event: React.DragEvent<HTMLDivElement>) {
    const documentRef = editor.ownerDocument
    const range = findDropRange(editor, event)
    clearDropIndicator()
    const indicator = createDropIndicator(documentRef)
    range.insertNode(indicator)
    dropIndicatorRef.current = indicator
  }

  function removeMentionFromSelection(direction: 'backward' | 'forward') {
    const editor = editorRef.current
    if (!editor) return false
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return false

    if (!selection.isCollapsed) {
      const range = selection.getRangeAt(0)
      const startOffset = getTemplateSelectionOffset(editor, range.startContainer, range.startOffset)
      const endOffset = getTemplateSelectionOffset(editor, range.endContainer, range.endOffset)
      
      range.deleteContents()
      
      const nextOffset = Math.min(startOffset, endOffset)
      restoreSelectionFromTemplateOffsets(editor, nextOffset, nextOffset)
      syncTemplateFromEditor(editor, { start: nextOffset, end: nextOffset })
      return true
    }

    const range = selection.getRangeAt(0)
    const container = range.startContainer
    const offset = range.startOffset
    let candidate: Node | null = null

    if (container.nodeType === Node.ELEMENT_NODE) {
      candidate = direction === 'backward'
        ? container.childNodes[offset - 1] ?? null
        : container.childNodes[offset] ?? null
    } else if (container.nodeType === Node.TEXT_NODE) {
      const text = container.textContent ?? ''
      const atBoundary = direction === 'backward' ? offset === 0 : offset === text.length
      if (!atBoundary) return false
      
      let currentCandidate = direction === 'backward' ? container.previousSibling : container.nextSibling
      while (currentCandidate && currentCandidate.nodeType === Node.TEXT_NODE && (currentCandidate.textContent ?? '') === '') {
        currentCandidate = direction === 'backward' ? currentCandidate.previousSibling : currentCandidate.nextSibling
      }
      candidate = currentCandidate
    }

    const mentionTag = candidate instanceof HTMLElement && candidate.classList.contains('mention-tag')
      ? candidate
      : null

    if (!mentionTag) return false

    const currentOffset = getTemplateSelectionOffset(editor, container, offset)
    const mentionLength = `{${mentionTag.getAttribute('data-variable-name') ?? ''}}`.length
    mentionTag.remove()
    const nextOffset = direction === 'backward'
      ? Math.max(0, currentOffset - mentionLength)
      : currentOffset
    restoreSelectionFromTemplateOffsets(editor, nextOffset, nextOffset)
    syncTemplateFromEditor(editor, { start: nextOffset, end: nextOffset })
    return true
  }

  function handleEditorDragStart(event: React.DragEvent<HTMLDivElement>) {
    const tag = findMentionTag(event.target)
    const variableName = tag?.getAttribute('data-variable-name')
    if (!tag || !variableName) return

    draggedMentionRef.current = tag
    setDraggingVariableId(variableName)
    event.dataTransfer.setData('text/plain', `{${variableName}}`)
    event.dataTransfer.setData(VARIABLE_DRAG_TYPE, variableName)
    event.dataTransfer.effectAllowed = 'move'
    requestAnimationFrame(() => {
      if (draggedMentionRef.current === tag) tag.style.opacity = '0.45'
    })
  }

  function handleEditorDragEnd() {
    if (draggedMentionRef.current) {
      draggedMentionRef.current.style.opacity = '1'
      draggedMentionRef.current = null
    }
    clearDropIndicator()
    setDraggingVariableId('')
  }

  function handleEditorDrop(event: React.DragEvent<HTMLDivElement>) {
    const editor = editorRef.current
    const variableName = event.dataTransfer.getData(VARIABLE_DRAG_TYPE)
    if (!editor || !variableName) return

    event.preventDefault()
    event.stopPropagation()

    const documentRef = editor.ownerDocument
    const indicator = dropIndicatorRef.current
    const mentionTag = draggedMentionRef.current && draggedMentionRef.current.getAttribute('data-variable-name') === variableName
      ? draggedMentionRef.current
      : createMentionTag(documentRef, variableName, resolvedValues[variableName] ?? `{${variableName}}`)

    if (indicator && indicator.isConnected) {
      indicator.replaceWith(mentionTag)
      dropIndicatorRef.current = null
    } else {
      const range = findDropRange(editor, event)
      range.deleteContents()
      range.insertNode(mentionTag)
    }

    const selection = window.getSelection()
    if (selection) {
      const nextRange = documentRef.createRange()
      nextRange.setStartAfter(mentionTag)
      nextRange.collapse(true)
      selection.removeAllRanges()
      selection.addRange(nextRange)
    }

    const nextSelection = captureSelectionOffsets(editor)
    handleEditorDragEnd()
    syncTemplateFromEditor(editor, nextSelection)
  }

  function insertVariable(name: string) {
    const saved = savedSelectionRef.current
    const selection = saved?.presetId === preset.id
      ? { start: saved.start, end: saved.end }
      : null
    const inserted = insertNamingVariable(namingTemplate, name, selection)

    pendingSelectionRef.current = { start: inserted.caret, end: inserted.caret }
    savedSelectionRef.current = {
      presetId: preset.id,
      start: inserted.caret,
      end: inserted.caret,
    }
    onUpdatePreset({ namingTemplate: inserted.template })
  }

  function addCustomVariable() {
    const name = customName.trim().replace(/[{}\s]/g, '')
    if (!name) return
    if (
      BUILT_IN_VARIABLE_NAMES.has(name)
      || customVariables.some((variable) => variable.name === name)
    ) {
      setCustomNameError('变量名已被使用')
      return
    }
    onUpdateCustomVariables([
      ...customVariables,
      { id: `custom-${Date.now()}-${name}`, name, value: customValue },
    ])
    setCustomName('')
    setCustomValue('')
    setCustomNameError('')
  }

  return (
    <div data-layout="preset-naming-fields" className="space-y-2 border-t border-gray-200 pt-3 dark:border-white/[0.08]">
      <label className="block text-[11px] text-gray-500">
        命名模板
        <div
          ref={editorRef}
          role="textbox"
          aria-label={`预设命名模板 ${preset.name}`}
          contentEditable
          suppressContentEditableWarning
          onInput={(event) => syncTemplateFromEditor(event.currentTarget)}
          onMouseUp={(event) => rememberSelection(event.currentTarget)}
          onKeyUp={(event) => rememberSelection(event.currentTarget)}
          onBlur={() => {
            savedSelectionRef.current = null
          }}
          onDragStart={handleEditorDragStart}
          onDragEnd={handleEditorDragEnd}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes(VARIABLE_DRAG_TYPE)) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              showDropIndicator(event.currentTarget, event)
            }
          }}
          onDrop={handleEditorDrop}
          onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault()
          if (event.key === 'Backspace' && removeMentionFromSelection('backward')) event.preventDefault()
          if (event.key === 'Delete' && removeMentionFromSelection('forward')) event.preventDefault()
        }}
        className={`mt-1 min-h-32 w-full cursor-text whitespace-pre-wrap break-words rounded-md border bg-white px-3 py-2 text-xs leading-6 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 dark:bg-gray-900 ${draggingVariableId ? 'border-blue-300 bg-blue-50/40 dark:border-blue-400/40 dark:bg-blue-500/10' : 'border-gray-200 dark:border-white/[0.08]'}`}
        dangerouslySetInnerHTML={{ __html: initialHtmlRef.current }}
      />
      </label>
      <p className="text-[10px] text-gray-400">变量会显示当前示例值，支持在编辑框内直接拖动调整顺序，蓝色词条仍表示动态变量。</p>
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
        {customVariables.map((variable) => (
          <span key={variable.id} className="inline-flex overflow-hidden rounded-md border border-violet-200 bg-violet-50 dark:border-violet-500/30 dark:bg-violet-500/10">
            <button
              type="button"
              aria-label={`插入变量 {${variable.name}}`}
              title={`{${variable.name}}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertVariable(variable.name)}
              className="cursor-pointer px-2 py-1 text-[11px] text-violet-700 dark:text-violet-200"
            >
              {variable.value || variable.name}
            </button>
            <button
              type="button"
              aria-label={`移除变量 {${variable.name}}`}
              onClick={() => onUpdateCustomVariables(customVariables.filter((item) => item.id !== variable.id))}
              className="cursor-pointer border-l border-violet-200 px-1.5 text-[11px] text-violet-500 hover:bg-violet-100 dark:border-violet-500/30"
            >
              ×
            </button>
          </span>
        ))}
      </div>
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
            className="w-full min-w-0 cursor-text rounded-md border border-gray-200 px-2 py-1.5 text-xs dark:border-white/[0.08] dark:bg-gray-900"
          />
          {customNameError && (
            <p id={customNameErrorId} role="alert" className="mt-1 text-[10px] text-red-600 dark:text-red-300">
              {customNameError}
            </p>
          )}
        </div>
        <input
          aria-label="自定义变量值"
          value={customValue}
          onChange={(event) => setCustomValue(event.target.value)}
          placeholder="最终显示内容"
          className="min-w-0 cursor-text rounded-md border border-gray-200 px-2 py-1.5 text-xs dark:border-white/[0.08] dark:bg-gray-900"
        />
        <button
          type="button"
          aria-label="添加自定义变量"
          onClick={addCustomVariable}
          className="cursor-pointer rounded-md border border-gray-200 px-3 text-xs hover:bg-gray-50 dark:border-white/[0.08] dark:hover:bg-white/[0.04]"
        >
          添加自定义值
        </button>
      </div>
    </div>
  )
}
