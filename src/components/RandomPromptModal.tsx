import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useStore } from '../store'
import { render_prompt } from '../lib/promptGenerator'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { CloseIcon, PlusIcon, TrashIcon, ChevronDownIcon } from './icons'
import { useDialogFocusTrap } from '../design-system'

const uid = () => Math.random().toString(36).slice(2, 9)

interface DrawReport {
  id: string
  label: string
  drawn: string[]
}

interface Segment {
  id: string
  type: 'text' | 'wildcard'
  text?: string
  wildcardId?: string
  label?: string
}

function createDefaultSegments(): Segment[] {
  return [{ id: uid(), type: 'text', text: '' }]
}

export default function WordLibraryManager() {
  const open = useStore((s) => s.randomPromptModalOpen)
  const setOpen = useStore((s) => s.setRandomPromptModalOpen)
  const setPrompt = useStore((s) => s.setPrompt)
  const showToast = useStore((s) => s.showToast)
  const wordLibraryEntries = useStore((s) => s.wordLibraryEntries)
  const entries = useMemo(
    () => wordLibraryEntries.filter((e) => e.deletedAt == null),
    [wordLibraryEntries],
  )

  const [segments, setSegments] = useState<Segment[]>(() => createDefaultSegments())
  const [result, setResult] = useState<[string, DrawReport[]] | null>(null)
  const [showTemplate, setShowTemplate] = useState(true)
  const [seed, setSeed] = useState(0)

  useEffect(() => {
    if (!open) return
    setSegments(createDefaultSegments())
    setResult(null)
    setSeed(0)
  }, [open])

  const close = useCallback(() => {
    setOpen(false)
  }, [setOpen])

  const updateSegment = useCallback((id: string, patch: Partial<Segment>) => {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const removeSegment = useCallback((id: string) => {
    setSegments((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const addTextSegment = useCallback(() => {
    setSegments((prev) => [...prev, { id: uid(), type: 'text', text: '' }])
  }, [])

  const addWildcardSegment = useCallback(() => {
    setSegments((prev) => [...prev, { id: uid(), type: 'wildcard', wildcardId: '', label: '' }])
  }, [])

  const buildLibrary = useCallback(() => {
    const library: Record<string, { entries: string[]; draw_count: number; label: string }> = {}
    for (const entry of entries) {
      if (entry.key && entry.entries.length > 0) {
        library[entry.key] = {
          entries: entry.entries,
          draw_count: entry.draw_count,
          label: entry.label,
        }
      }
    }
    return library
  }, [entries])

  const handleGenerate = useCallback(() => {
    const library = buildLibrary()
    const state = {
      segments: segments.map((s) => {
        if (s.type === 'text') {
          return { type: 'text' as const, text: s.text ?? '' }
        }
        return { type: 'wildcard' as const, id: s.wildcardId ?? '' }
      }),
      library,
    }
    const newSeed = seed > 0 ? seed + 1 : Date.now()
    setSeed(newSeed)
    const [text, reports] = render_prompt(state, newSeed)
    setResult([text, reports])
  }, [segments, buildLibrary, seed])

  const handleRegenerate = useCallback(() => {
    const library = buildLibrary()
    const state = {
      segments: segments.map((s) => {
        if (s.type === 'text') {
          return { type: 'text' as const, text: s.text ?? '' }
        }
        return { type: 'wildcard' as const, id: s.wildcardId ?? '' }
      }),
      library,
    }
    const newSeed = Date.now()
    setSeed(newSeed)
    const [text, reports] = render_prompt(state, newSeed)
    setResult([text, reports])
  }, [segments, buildLibrary])

  const handleUse = useCallback(() => {
    if (!result || !result[0]) return
    setPrompt(result[0])
    close()
    showToast('已使用生成的提示词', 'success')
  }, [result, setPrompt, close, showToast])

  useCloseOnEscape(open, close)
  const modalRef = useRef<HTMLDivElement>(null)
  usePreventBackgroundScroll(open, modalRef)
  useDialogFocusTrap(open, modalRef)

  if (!open) return null

  const libraryKeys = entries.filter((e) => e.key).map((e) => e.key)

  return (
    <div
      data-no-drag-select
      className="ds-modal-layer fixed inset-0 flex items-center justify-center p-4"
      onClick={close}
    >
      <div className="ds-modal-scrim absolute inset-0" />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="random-prompt-title"
        className="ds-modal-surface relative max-h-[85vh] w-full max-w-4xl flex flex-col rounded-2xl border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部 */}
        <div className="flex items-center justify-between shrink-0 p-5 border-b border-gray-100 dark:border-white/[0.08]">
          <h2 id="random-prompt-title" className="text-lg font-bold text-gray-800 dark:text-gray-100">
            提示词模板
          </h2>
          <button
            onClick={close}
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            aria-label="关闭"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* 主体 */}
        <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
          <div className="flex min-h-0">
            <div className="flex-1 p-4 flex flex-col min-w-0">
              {/* 模板区域（可折叠） */}
              <div className="border rounded-2xl border-gray-100 dark:border-white/[0.08]">
                <button
                  onClick={() => setShowTemplate(!showTemplate)}
                  className="flex items-center justify-between w-full px-5 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition"
                >
                  <span>▼ 模板 (Segments)</span>
                  <ChevronDownIcon
                    className={`h-4 w-4 transition-transform ${showTemplate ? '' : '-rotate-90'}`}
                  />
                </button>

                {showTemplate && (
                  <div className="px-5 pb-4 space-y-3">
                    {/* Segments 列表 */}
                    <div className="space-y-2">
                      {segments.map((seg) => (
                        <div
                          key={seg.id}
                          className="rounded-2xl border border-gray-100 dark:border-white/[0.08] bg-gray-50/50 dark:bg-white/[0.03] p-3 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                seg.type === 'text'
                                  ? 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300'
                                  : 'bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-300'
                              }`}
                            >
                              {seg.type === 'text' ? '文本' : '通配符'}
                            </span>
                            <button
                              onClick={() => removeSegment(seg.id)}
                              className="rounded-full p-1 text-gray-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                              aria-label="删除段落"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </div>

                          {seg.type === 'text' ? (
                            <input
                              type="text"
                              value={seg.text ?? ''}
                              onChange={(e) => updateSegment(seg.id, { text: e.target.value })}
                              placeholder="输入文本内容..."
                              className="w-full px-3 py-2 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] text-sm outline-none focus:ring-1 focus:ring-blue-300/40"
                            />
                          ) : (
                            <div className="space-y-2">
                              <div className="flex gap-2">
                                <input
                                  list={`wildcard-keys-${seg.id}`}
                                  type="text"
                                  value={seg.wildcardId ?? ''}
                                  onChange={(e) => updateSegment(seg.id, { wildcardId: e.target.value })}
                                  placeholder="词库 key（下拉选择或手动输入）"
                                  className="flex-1 px-3 py-2 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] text-sm outline-none focus:ring-1 focus:ring-blue-300/40"
                                />
                                <datalist id={`wildcard-keys-${seg.id}`}>
                                  {libraryKeys.map((key) => (
                                    <option key={key} value={key} />
                                  ))}
                                </datalist>
                              </div>
                              <input
                                type="text"
                                value={seg.label ?? ''}
                                onChange={(e) => updateSegment(seg.id, { label: e.target.value })}
                                placeholder="标签（可选）"
                                className="w-full px-3 py-2 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] text-sm outline-none focus:ring-1 focus:ring-blue-300/40"
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* 添加段按钮 */}
                    <div className="flex gap-2">
                      <button
                        onClick={addTextSegment}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl bg-blue-500 text-white transition hover:bg-blue-600"
                      >
                        <PlusIcon className="h-3.5 w-3.5" />
                        文本段
                      </button>
                      <button
                        onClick={addWildcardSegment}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl bg-purple-500 text-white transition hover:bg-purple-600"
                      >
                        <PlusIcon className="h-3.5 w-3.5" />
                        通配符段
                      </button>
                    </div>

                    {/* 预览 */}
                    {result && (
                      <div className="space-y-3 animate-fade-in">
                        <div className="rounded-2xl border border-gray-100 dark:border-white/[0.08] bg-gray-50/50 dark:bg-white/[0.03] p-4">
                          <p className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words leading-relaxed">
                            {result[0] || (
                              <span className="text-gray-400 dark:text-gray-500 italic">（空结果）</span>
                            )}
                          </p>
                        </div>
                        {result[1].length > 0 && (
                          <div className="rounded-2xl border border-gray-100 dark:border-white/[0.08] bg-gray-50/50 dark:bg-white/[0.03] p-3 space-y-1.5">
                            <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400">抽取报告</h5>
                            {result[1].map((report) => (
                              <div key={report.id} className="text-xs text-gray-600 dark:text-gray-400">
                                <span className="font-medium text-gray-700 dark:text-gray-300">
                                  {report.label || report.id}
                                </span>
                                ：抽取了 {report.drawn.join(', ') || '（无）'}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 底部操作按钮 */}
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        onClick={handleGenerate}
                        className="px-4 py-2 text-sm font-medium rounded-xl bg-blue-500 text-white transition hover:bg-blue-600"
                      >
                        生成
                      </button>
                      <button
                        onClick={handleRegenerate}
                        className="px-4 py-2 text-sm font-medium rounded-xl bg-gray-100 text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-400 dark:hover:bg-white/[0.1]"
                      >
                        重新生成
                      </button>
                      <button
                        onClick={handleUse}
                        disabled={!result || !result[0]}
                        className="px-4 py-2 text-sm font-medium rounded-xl bg-blue-500 text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50 ml-auto"
                      >
                        使用
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
