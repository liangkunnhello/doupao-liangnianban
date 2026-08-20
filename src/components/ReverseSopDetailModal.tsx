import { useEffect, useMemo, useState } from 'react'
import { CloseIcon, CopyIcon, ImageIcon, LoaderCircleIcon as LoaderCircle, WandSparklesIcon as WandSparkles } from '../design-system/icons'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import { ensureImageThumbnailCached, subscribeImageThumbnail, useStore } from '../store'
import type { TaskRecord } from '../types'

const stageOrder = ['queued', 'reverse-sop', 'generate-variable-prompts', 'expand-variable-prompts', 'generate-images', 'completed'] as const
const stageNames: Record<string, string> = {
  queued: '已建卡',
  'reverse-sop': '反推 SOP',
  'generate-variable-prompts': '生成变量提示词',
  'expand-variable-prompts': '展开提示词',
  'generate-images': '生成图片',
  completed: '完成',
  error: '失败',
  stopped: '已停止',
}

export default function ReverseSopDetailModal({
  controller,
  imageTasks,
  onClose,
  onOpenImage,
}: {
  controller: TaskRecord
  imageTasks: TaskRecord[]
  onClose: () => void
  onOpenImage: (imageId: string) => void
}) {
  const meta = controller.reverseSop?.role === 'controller' ? controller.reverseSop : null
  const showToast = useStore((state) => state.showToast)
  const imageIds = useMemo(() => imageTasks.flatMap((task) => task.outputImages), [imageTasks])
  if (!meta) return null
  const currentStageIndex = stageOrder.indexOf(meta.stage as typeof stageOrder[number])
  const copy = async (text: string, label: string) => {
    try {
      await copyTextToClipboard(text)
      showToast(`${label}已复制`, 'success')
    } catch (error) {
      showToast(getClipboardFailureMessage(`${label}复制失败`, error), 'error')
    }
  }

  return (
    <div className="ds-modal-layer fixed inset-0 z-[var(--ds-z-modal)] flex items-center justify-center p-3" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div className="ds-modal-scrim pointer-events-none absolute inset-0" />
      <section className="ds-modal-surface relative z-10 flex max-h-[88vh] w-[min(1100px,100%)] flex-col overflow-hidden rounded-2xl border" role="dialog" aria-modal="true" aria-label="反推 SOP 任务详情">
        <header className="flex items-center justify-between gap-3 border-b border-gray-200/80 px-5 py-4 dark:border-white/[0.08]">
          <div className="min-w-0"><h2 className="flex items-center gap-2 font-semibold"><WandSparkles size={18} />反推 SOP 任务</h2><p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{meta.stageMessage || meta.brief || '参考图反推变量提示词流程'}</p><p className="mt-1 truncate text-[11px] text-gray-400 dark:text-gray-500">标签页：{meta.workspaceTabName || '未指定'} · 元指令：{meta.metaInstructionName || '默认'}</p></div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.08]" aria-label="关闭"><CloseIcon size={18} /></button>
        </header>
        <div className="hide-scrollbar overflow-y-auto p-5">
          <ol className="mb-6 flex min-w-[620px] items-center gap-2 overflow-x-auto text-xs">
            {stageOrder.map((stage, index) => {
              const active = meta.stage === stage
              const complete = currentStageIndex > index || meta.stage === 'completed'
              return <li key={stage} className={`flex items-center gap-2 whitespace-nowrap ${active ? 'font-semibold text-violet-700 dark:text-violet-200' : complete ? 'text-emerald-600 dark:text-emerald-300' : 'text-gray-400'}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${active ? 'bg-violet-600 text-white' : complete ? 'bg-emerald-500 text-white' : 'bg-gray-200 dark:bg-white/[0.1]'}`}>{active && meta.stage !== 'completed' ? <LoaderCircle size={12} className="animate-spin motion-reduce:animate-none" /> : index + 1}</span>{stageNames[stage]}
                {index < stageOrder.length - 1 && <span className="h-px w-5 bg-gray-200 dark:bg-white/[0.12]" />}
              </li>
            })}
          </ol>

          {meta.sop && <Artifact title={`反推 SOP · ${meta.sop.name}`} text={meta.sop.content} onCopy={() => void copy(meta.sop!.content, 'SOP')} />}
          {meta.variablePrompts.length > 0 && <section className="mb-5"><h3 className="mb-2 text-sm font-semibold">变量提示词模板 ({meta.variablePrompts.length})</h3><div className="space-y-3">{meta.variablePrompts.map((item, index) => <Artifact key={item.id} title={`${index + 1}. ${item.name}`} text={item.content} onCopy={() => void copy(item.content, '变量提示词')} />)}</div></section>}
          {meta.concretePrompts.length > 0 && <section className="mb-5"><h3 className="mb-2 text-sm font-semibold">已展开提示词 ({meta.concretePrompts.length})</h3><div className="space-y-2">{meta.concretePrompts.map((item, index) => <div key={item.id} className="rounded-lg border border-gray-200/80 px-3 py-2 dark:border-white/[0.08]"><div className="mb-1 flex items-center justify-between gap-2"><span className="text-xs font-medium text-gray-500">第 {index + 1} 条</span><button type="button" onClick={() => void copy(item.text, '提示词')} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.08]" aria-label={`复制第 ${index + 1} 条提示词`}><CopyIcon size={14} /></button></div><p className="line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-gray-700 dark:text-gray-200">{item.text}</p></div>)}</div></section>}
          <section><h3 className="mb-2 text-sm font-semibold">生成图片 ({imageIds.length}/{meta.promptCount * meta.imagesPerPrompt})</h3>{imageIds.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">{imageIds.map((imageId) => <ImagePreview key={imageId} imageId={imageId} onOpen={() => onOpenImage(imageId)} />)}</div> : <p className="text-xs text-gray-500">图片生成后会在这里归集。</p>}</section>
        </div>
      </section>
    </div>
  )
}

function Artifact({ title, text, onCopy }: { title: string; text: string; onCopy: () => void }) {
  return <section className="mb-5 rounded-lg border border-gray-200/80 dark:border-white/[0.08]"><div className="flex items-center justify-between gap-3 border-b border-gray-200/80 px-3 py-2 dark:border-white/[0.08]"><h3 className="min-w-0 truncate text-sm font-semibold">{title}</h3><button type="button" onClick={onCopy} className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.08]" aria-label={`复制${title}`}><CopyIcon size={14} /></button></div><pre className="hide-scrollbar max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 py-3 text-xs leading-5 text-gray-700 dark:text-gray-200">{text}</pre></section>
}

function ImagePreview({ imageId, onOpen }: { imageId: string; onOpen: () => void }) {
  const [source, setSource] = useState('')
  useEffect(() => {
    let active = true
    const apply = (value: { dataUrl: string }) => {
      if (active) setSource(value.dataUrl)
    }
    const unsubscribe = subscribeImageThumbnail(imageId, apply)
    void ensureImageThumbnailCached(imageId).then((value) => value && apply(value))
    return () => {
      active = false
      unsubscribe()
    }
  }, [imageId])
  return <button type="button" onClick={onOpen} className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-gray-100 text-gray-500 dark:bg-white/[0.06]">{source ? <img src={source} alt="反推 SOP 生成结果" className="h-full w-full object-cover" /> : <ImageIcon size={18} />}</button>
}
