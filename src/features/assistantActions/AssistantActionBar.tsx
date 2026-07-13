import { useEffect, useMemo, useRef, useState } from 'react'
import type { WheelEvent } from 'react'
import { AlertCircle, ArrowDown, ArrowUp, Check, Image, Loader2, Palette, Plus, Settings, Sparkles, Tags, ThumbsUp, Trash2, Type, Wand2, X } from 'lucide-react'
import { buildAssistantInputContext } from './context'
import { BUILT_IN_ASSISTANT_ACTIONS } from './builtInActions'
import { buildCustomSkillContract, DEFAULT_SUPER_DERIVE_SETTINGS, getMoreAssistantActions, getRecommendedAssistantActions, getWhenByTrigger, normalizeAssistantActionPreferences } from './matcher'
import { createAssistantSkillDraft, runAssistantAction } from './runner'
import type { AssistantRunnerProgressUpdate, AssistantSkillDraft } from './runner'
import type { ApiProfile, AppSettings, InputImage, TaskParams, WordLibraryGroup } from '../../types'
import type { AdChannel, AssistantAction, AssistantActionIcon, AssistantActionPreferences, AssistantActionResult, AssistantActionSettings, AssistantCustomSkill, AssistantSkillTrigger, AssistantWordEntryGroup, SellingPointPolicy, VisualIdentity, WordDeriveActionSettings } from './types'
import { AD_CHANNEL_OPTIONS, OUTPUT_COUNT_OPTIONS, SELLING_POINT_POLICY_OPTIONS } from './types'
import Select from '../../components/Select'

interface AssistantActionBarProps {
  prompt: string
  inputImages: InputImage[]
  settings: AppSettings
  profile: ApiProfile
  params: TaskParams
  wordLibraryGroups: WordLibraryGroup[]
  preferences?: Partial<AssistantActionPreferences>
  feedback: AssistantActionFeedbackState
  onInsert: (text: string, mode: 'replace' | 'append') => void
  onSaveWordEntries?: (groups: AssistantWordEntryGroup[], options: AssistantWordEntryApplyOptions) => void
  onApplyWordPrompt?: (groups: AssistantWordEntryGroup[], prompt: string, options: AssistantWordEntryApplyOptions) => void
  onCreateWordGroup?: (name: string) => string
  onUpdatePreferences?: (preferences: AssistantActionPreferences) => void
  onFeedbackChange: (feedback: AssistantActionFeedbackState) => void
}

export type AssistantActionFeedbackState =
  | { type: 'idle' }
  | { type: 'loading'; action: AssistantAction; startedAt: number; updatedAt: number; phaseIndex: number; phases: AssistantActionProgressPhase[]; detail?: string }
  | { type: 'error'; action: AssistantAction; message: string }
  | { type: 'success'; action: AssistantAction; result: AssistantActionResult }

type PositionedAction = { action: AssistantAction; rect: DOMRect }

export interface AssistantActionProgressPhase {
  id: string
  label: string
  detail: string
  indeterminate?: boolean
}

export interface AssistantWordEntryApplyOptions extends WordDeriveActionSettings {
  actionName: string
}

const iconMap: Record<AssistantActionIcon, typeof Sparkles> = {
  image: Image,
  wand: Wand2,
  sparkles: Sparkles,
  palette: Palette,
  tags: Tags,
  'thumbs-up': ThumbsUp,
}

const CORE_VISIBLE_ACTION_IDS = new Set(['image-derive', 'prompt-optimize'])

function isCoreVisibleAction(action: AssistantAction) {
  return CORE_VISIBLE_ACTION_IDS.has(action.id)
}

function createAssistantLoadingFeedback(action: AssistantAction): Extract<AssistantActionFeedbackState, { type: 'loading' }> {
  const now = Date.now()
  return {
    type: 'loading',
    action,
    startedAt: now,
    updatedAt: now,
    phaseIndex: 0,
    phases: getAssistantProgressPhases(action),
  }
}

function phase(id: string, label: string, detail: string, indeterminate = false): AssistantActionProgressPhase {
  return { id, label, detail, indeterminate }
}

function getAssistantProgressPhases(action: AssistantAction): AssistantActionProgressPhase[] {
  const phases = [
    phase('prepare-input', '准备输入', '读取当前提示词、参考图和技能设置。'),
    phase('request-model', '等待模型返回', '请求已发送，模型生成阶段无法提供精确百分比。', true),
    phase('parse-response', '解析结果', '解析模型返回的 JSON 或普通文本。'),
    phase('validate-result', '校验内容', '校验主推提示词、候选项和变量词条完整性。'),
    phase('organize-result', '整理结果', '整理可应用的提示词、词条和测试计划。'),
  ]
  if (!isVariableResultAction(action)) return phases
  return [
    ...phases.slice(0, 4),
    phase('repair-variables', '补全变量词条', '当变量数量不足或提示词缺少占位符时自动修复。'),
    phases[4],
  ]
}

function applyAssistantProgress(
  loading: Extract<AssistantActionFeedbackState, { type: 'loading' }>,
  update: AssistantRunnerProgressUpdate,
): Extract<AssistantActionFeedbackState, { type: 'loading' }> {
  const phaseIndex = loading.phases.findIndex((phase) => phase.id === update.stage)
  return {
    ...loading,
    updatedAt: Date.now(),
    detail: update.detail,
    phaseIndex: phaseIndex >= 0 ? phaseIndex : loading.phaseIndex,
  }
}

export default function AssistantActionBar({
  prompt,
  inputImages,
  settings,
  profile,
  params,
  wordLibraryGroups,
  preferences,
  feedback,
  onInsert,
  onSaveWordEntries,
  onApplyWordPrompt,
  onCreateWordGroup,
  onUpdatePreferences,
  onFeedbackChange,
}: AssistantActionBarProps) {
  const normalizedPreferences = useMemo(() => normalizeAssistantActionPreferences(preferences), [preferences])
  const context = useMemo(() => buildAssistantInputContext(prompt, inputImages), [prompt, inputImages])
  const actions = useMemo(() => getRecommendedAssistantActions(context, normalizedPreferences), [context, normalizedPreferences])
  const moreActions = useMemo(() => getMoreAssistantActions(context, normalizedPreferences), [context, normalizedPreferences])
  const visibleActions = useMemo(() => [...actions, ...moreActions], [actions, moreActions])
  const skillScrollRef = useRef<HTMLDivElement>(null)
  const [contextAction, setContextAction] = useState<PositionedAction | null>(null)
  const [settingsAction, setSettingsAction] = useState<PositionedAction | null>(null)
  const [skillEntryOpen, setSkillEntryOpen] = useState(false)
  const [skillPanelMode, setSkillPanelMode] = useState<'add' | 'manage' | null>(null)
  const [hoveredSkill, setHoveredSkill] = useState<{ action: AssistantAction; rect: DOMRect } | null>(null)

  const runningActionId = feedback.type === 'loading' ? feedback.action.id : null
  const runningPhase = feedback.type === 'loading' ? feedback.phases[feedback.phaseIndex] ?? feedback.phases[feedback.phases.length - 1] : null
  const isBusy = runningActionId != null
  const updatePreferences = (next: AssistantActionPreferences) => onUpdatePreferences?.(next)

  if (!normalizedPreferences.enabled) return null

  const updateWordDeriveSettings = (patch: Partial<WordDeriveActionSettings>) => {
    const nextSettings = {
      ...normalizedPreferences.actionSettings.wordDerive,
      ...patch,
    }
    updatePreferences({
      ...normalizedPreferences,
      actionSettings: {
        ...normalizedPreferences.actionSettings,
        superDerive: nextSettings,
        wordDerive: nextSettings,
      },
    })
  }

  const updateGlobalActionSettings = (patch: Partial<AssistantActionSettings>) => {
    updatePreferences({
      ...normalizedPreferences,
      actionSettings: {
        ...normalizedPreferences.actionSettings,
        ...patch,
      },
    })
  }

  const runActionWithSettings = async (action: AssistantAction, settingsOverride: Partial<AssistantActionSettings> = {}) => {
    if (isBusy) return
    setContextAction(null)
    setHoveredSkill(null)
    let loadingFeedback = createAssistantLoadingFeedback(action)
    onFeedbackChange(loadingFeedback)
    try {
      const result = await runAssistantAction(action.id, context, {
        settings,
        profile,
        params,
        actionSettings: { ...normalizedPreferences.actionSettings, ...settingsOverride },
        customSkill: normalizedPreferences.customSkills.find((skill) => skill.id === action.id),
        onProgress: (update) => {
          loadingFeedback = applyAssistantProgress(loadingFeedback, update)
          onFeedbackChange(loadingFeedback)
        },
      })
      if (!result.content.trim()) {
        onFeedbackChange({ type: 'error', action, message: '没有生成可用内容，请稍后重试。' })
        return
      }
      onFeedbackChange({ type: 'success', action, result })
    } catch (error) {
      onFeedbackChange({ type: 'error', action, message: error instanceof Error ? error.message : String(error) })
    }
  }

  const runAction = (action: AssistantAction) => void runActionWithSettings(action)

  const getActionById = (id: string) =>
    [...BUILT_IN_ASSISTANT_ACTIONS, ...normalizedPreferences.customSkills].find((action) => action.id === id)

  const runActionWithContext = async (
    action: AssistantAction,
    overrideText: string,
    settingsOverride: Partial<AssistantActionSettings> = {},
  ) => {
    if (isBusy) return
    setContextAction(null)
    setHoveredSkill(null)
    const nextContext = {
      ...context,
      text: overrideText,
      hasText: overrideText.trim().length > 0,
    }
    let loadingFeedback = createAssistantLoadingFeedback(action)
    onFeedbackChange(loadingFeedback)
    try {
      const result = await runAssistantAction(action.id, nextContext, {
        settings,
        profile,
        params,
        actionSettings: { ...normalizedPreferences.actionSettings, ...settingsOverride },
        customSkill: normalizedPreferences.customSkills.find((skill) => skill.id === action.id),
        onProgress: (update) => {
          loadingFeedback = applyAssistantProgress(loadingFeedback, update)
          onFeedbackChange(loadingFeedback)
        },
      })
      if (!result.content.trim()) {
        onFeedbackChange({ type: 'error', action, message: '没有生成可用内容，请稍后重试。' })
        return
      }
      onFeedbackChange({ type: 'success', action, result })
    } catch (error) {
      onFeedbackChange({ type: 'error', action, message: error instanceof Error ? error.message : String(error) })
    }
  }

  const hideAction = (action: AssistantAction) => {
    if (isCoreVisibleAction(action)) return
    updatePreferences({
      ...normalizedPreferences,
      hiddenActionIds: [...new Set([...normalizedPreferences.hiddenActionIds, action.id])],
    })
  }

  const togglePinAction = (action: AssistantAction) => {
    const isPinned = normalizedPreferences.pinnedActionIds.includes(action.id)
    updatePreferences({
      ...normalizedPreferences,
      pinnedActionIds: isPinned
        ? normalizedPreferences.pinnedActionIds.filter((id) => id !== action.id)
        : [...normalizedPreferences.pinnedActionIds, action.id],
    })
  }

  const handleSkillWheel = (event: WheelEvent<HTMLDivElement>) => {
    const target = skillScrollRef.current
    if (!target) return
    const maxScrollLeft = target.scrollWidth - target.clientWidth
    if (maxScrollLeft <= 0) return
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (!delta) return
    event.preventDefault()
    target.scrollLeft += delta
  }

  return (
    <div className="relative mb-2 pointer-events-auto">
      <div onWheel={handleSkillWheel} className={`flex min-h-[46px] items-center gap-2 rounded-2xl border px-2.5 py-2 shadow-[0_8px_24px_rgba(15,23,42,0.08)] ring-1 ring-black/5 backdrop-blur-xl transition-all dark:ring-white/10 ${
        'border-gray-200/70 bg-white/85 dark:border-white/[0.08] dark:bg-gray-900/85'
      }`}>
        <div ref={skillScrollRef} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visibleActions.map((action) => (
            <AssistantActionButton
              key={action.id}
              action={action}
              running={runningActionId === action.id}
              loadingLabel={runningActionId === action.id ? runningPhase?.label : undefined}
              disabled={runningActionId === action.id}
              onRun={() => void runAction(action)}
              onOpenMenu={(rect) => setContextAction({ action, rect })}
              onHoverChange={setHoveredSkill}
            />
          ))}
        </div>
        <div className="h-6 w-px shrink-0 bg-gray-200 dark:bg-white/[0.08]" />
        <div className="relative ml-auto shrink-0">
          <button
            type="button"
            onClick={() => setSkillEntryOpen((open) => !open)}
            disabled={isBusy}
            title="添加 / 管理技能"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-dashed border-blue-200 bg-blue-50/70 text-blue-600 transition-colors hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300"
            aria-label="添加或管理技能"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {hoveredSkill && (
        <AssistantActionHoverCard action={hoveredSkill.action} rect={hoveredSkill.rect} />
      )}

      {skillEntryOpen && !isBusy && (
        <div className="absolute bottom-full right-0 z-50 mb-2 w-36 overflow-hidden rounded-2xl border border-gray-200/70 bg-white p-1.5 shadow-xl ring-1 ring-black/5 dark:border-white/[0.08] dark:bg-gray-900 dark:ring-white/10">
          <button type="button" onClick={() => { setSkillEntryOpen(false); setSkillPanelMode('add') }} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.06]">
            <Plus className="h-4 w-4 text-blue-500" />
            添加技能
          </button>
          <button type="button" onClick={() => { setSkillEntryOpen(false); setSkillPanelMode('manage') }} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.06]">
            <Settings className="h-4 w-4 text-blue-500" />
            管理技能
          </button>
        </div>
      )}

      {contextAction && !isBusy && (
        <AssistantActionContextMenu
          action={contextAction.action}
          rect={contextAction.rect}
          pinned={normalizedPreferences.pinnedActionIds.includes(contextAction.action.id)}
          canHide={visibleActions.length > 1 && !isCoreVisibleAction(contextAction.action)}
          onRun={() => void runAction(contextAction.action)}
          onSettings={() => {
            setSettingsAction(contextAction)
            setContextAction(null)
          }}
          onPin={() => {
            togglePinAction(contextAction.action)
            setContextAction(null)
          }}
          onHide={() => {
            hideAction(contextAction.action)
            setContextAction(null)
          }}
          onClose={() => setContextAction(null)}
        />
      )}

      {settingsAction && (
        <AssistantActionSettingsPanel
          actionName={settingsAction.action.name}
          rect={settingsAction.rect}
          settings={normalizedPreferences.actionSettings}
          showWordSettings={isWordDeriveAction(settingsAction.action)}
          groups={wordLibraryGroups}
          onChangeGlobal={updateGlobalActionSettings}
          onChangeWord={updateWordDeriveSettings}
          onCreateGroup={onCreateWordGroup}
          onResetGlobal={() => updateGlobalActionSettings({ channel: 'general', sellingPointPolicy: 'lock', outputCount: 6 })}
          onResetWord={() => updateWordDeriveSettings(DEFAULT_SUPER_DERIVE_SETTINGS)}
          onClose={() => setSettingsAction(null)}
        />
      )}

      {skillPanelMode && (
        <SkillBuilderPanel
          mode={skillPanelMode}
          settings={settings}
          profile={profile}
          params={params}
          preferences={normalizedPreferences}
          skills={normalizedPreferences.customSkills}
          onModeChange={setSkillPanelMode}
          onClose={() => setSkillPanelMode(null)}
          onUpdatePreferences={updatePreferences}
        />
      )}

      {feedback.type === 'error' && (
        <AssistantErrorPanel action={feedback.action} message={feedback.message} onClose={() => onFeedbackChange({ type: 'idle' })} onRetry={() => void runAction(feedback.action)} />
      )}
      {feedback.type === 'loading' && (
        <AssistantLoadingPanel feedback={feedback} />
      )}
      {feedback.type === 'success' && (
        <AssistantActionResultPanel
          result={feedback.result}
          wordDeriveSettings={normalizedPreferences.actionSettings.wordDerive}
          onClose={() => onFeedbackChange({ type: 'idle' })}
          onReplace={(text) => {
            onInsert(text, 'replace')
          }}
          onAppend={(text) => {
            onInsert(text, 'append')
          }}
          onSaveWordEntries={onSaveWordEntries}
          onApplyWordPrompt={onApplyWordPrompt}
          onContinueVariants={(seedText) => {
            const action = getActionById('batch-variants')
            if (action) void runActionWithContext(action, seedText)
          }}
          onRewriteChannel={(seedText, channel) => {
            const action = getActionById('channel-rewrite')
            if (action) void runActionWithContext(action, seedText, { channel })
          }}
        />
      )}
    </div>
  )
}

function AssistantActionButton({
  action,
  running,
  loadingLabel,
  disabled,
  onRun,
  onOpenMenu,
  onHoverChange,
}: {
  action: AssistantAction
  running: boolean
  loadingLabel?: string
  disabled: boolean
  onRun: () => void
  onOpenMenu: (rect: DOMRect) => void
  onHoverChange: (value: { action: AssistantAction; rect: DOMRect } | null) => void
}) {
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={onRun}
        onMouseEnter={(event) => onHoverChange({ action, rect: event.currentTarget.getBoundingClientRect() })}
        onMouseLeave={() => onHoverChange(null)}
        onContextMenu={(event) => {
          event.preventDefault()
          if (!disabled) onOpenMenu(event.currentTarget.getBoundingClientRect())
        }}
        disabled={disabled}
        aria-busy={running}
        className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition-all active:scale-[0.98] disabled:cursor-wait dark:border-white/[0.08] ${
          running
            ? 'border-blue-300 bg-blue-500 text-white shadow-sm dark:border-blue-400/40 dark:bg-blue-500'
            : 'border-gray-200/70 bg-white text-gray-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-45 dark:bg-white/[0.04] dark:text-gray-200 dark:hover:border-blue-500/30 dark:hover:bg-blue-500/10 dark:hover:text-blue-300'
        }`}
      >
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ActionIcon icon={action.icon} />}
        <span>{running ? loadingLabel ?? '生成中' : action.name}</span>
        {!running && (
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${
            isVariableResultAction(action)
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
              : 'bg-gray-100 text-gray-500 dark:bg-white/[0.08] dark:text-gray-400'
          }`}>
            {isVariableResultAction(action) ? '词条' : '普通'}
          </span>
        )}
      </button>
    </div>
  )
}

function AssistantActionHoverCard({ action, rect }: { action: AssistantAction; rect: DOMRect }) {
  const width = 292
  const viewportWidth = typeof window === 'undefined' ? width : window.innerWidth
  const left = Math.max(12, Math.min(rect.left, viewportWidth - width - 12))
  const top = Math.max(12, rect.top - 10)
  const inputHint = getAssistantActionInputHint(action)
  const purposeHint = getAssistantActionPurposeHint(action)

  return (
    <div
      className="pointer-events-none fixed z-[80] w-[292px] -translate-y-full rounded-2xl border border-gray-200/70 bg-white p-3 text-left shadow-xl ring-1 ring-black/5 dark:border-white/[0.08] dark:bg-gray-900 dark:ring-white/10"
      style={{ left, top }}
    >
      <div className="mb-1 flex items-center gap-2">
        <ActionIcon icon={action.icon} />
        <div className="min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{action.name}</div>
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
          {inputHint.icon}
          {inputHint.label}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">
          <Sparkles className="h-3 w-3" />
          {purposeHint}
        </span>
      </div>
      <div className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">{getAssistantActionDescription(action)}</div>
      <div className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">右键可设置、固定或隐藏</div>
    </div>
  )
}

function getAssistantActionInputHint(action: AssistantAction) {
  if (action.trigger === 'image_text' || (action.when.image === 'required' && action.when.text === 'required')) {
    return { label: '适合图片+文字', icon: <><Image className="h-3 w-3" /><Type className="h-3 w-3" /></> }
  }
  if (action.trigger === 'image' || action.when.image === 'required') {
    return { label: '适合图片', icon: <Image className="h-3 w-3" /> }
  }
  if (action.trigger === 'text' || action.when.text === 'required') {
    return { label: '适合文字', icon: <Type className="h-3 w-3" /> }
  }
  return { label: '通用', icon: <Sparkles className="h-3 w-3" /> }
}

function getAssistantActionPurposeHint(action: AssistantAction) {
  switch (action.id) {
    case 'image-derive':
      return '概念抽取'
    case 'image-describe':
      return '素材拆解'
    case 'market-breakdown':
      return '大盘拆解'
    case 'super-derive':
      return '爆款衍生'
    case 'viral-remix':
      return '爆款复刻'
    case 'prompt-optimize':
      return '提示词优化'
    case 'style-expand':
      return '版式扩展'
    case 'word-extract':
      return '变量提取'
    case 'prompt-examples':
      return '案例参考'
    case 'angle-matrix':
      return '角度探索'
    case 'batch-variants':
      return '批量变体'
    case 'ad-review':
      return '投放复盘'
    default:
      return isCustomAssistantSkill(action) ? '自定义技能' : '智能处理'
  }
}

function getAssistantActionDescription(action: AssistantAction) {
  if (isCustomAssistantSkill(action)) {
    const steps = action.steps.slice(0, 3).join('；')
    return steps || '按你创建技能时的自然语言规则执行，结合当前输入生成可直接使用的素材提示词或变量结果。'
  }

  switch (action.id) {
    case 'image-derive':
      return '输出一段简短的单图图生图提示词；画面参数沿用参考图，只变化核心主体，禁止组图和分析过程。'
    case 'image-describe':
      return '忠实拆解参考图的构图、主体、色板、文字层级、风格和广告信息结构，不生成新素材。'
    case 'super-derive':
      return '围绕有效素材结构进行大幅创意扩展，探索新的场景、钩子、人物和表现形式。'
    case 'prompt-optimize':
      return '在不改变原意、事实和承诺的前提下提升提示词清晰度、完整性与可执行性；不默认加入钩子、版式、CTA 或渠道要求，也不生成变量词条。'
    case 'style-expand':
      return '锁定主体、内容、色板和视觉风格，只扩展标题、主体、图文比例和 CTA 的布局方式。'
    case 'word-extract':
      return '从输入中提取已有的产品主体、目标人群、场景、卖点等可复用变量，不凭空扩写。'
    case 'prompt-examples':
      return '生成可参考的高潜信息流广告案例，覆盖痛点、结果、测评、种草、福利和反常识角度。'
    case 'market-breakdown':
      return '分析市场或竞品素材的共性结构、差异化机会和风险；单张图按单素材分析处理。'
    case 'viral-remix':
      return '复刻爆款素材的结构而不照抄内容，生成新的画面、钩子、卖点和测试命名。'
    case 'angle-matrix':
      return '围绕产品生成多种投放角度矩阵，用于快速搭建第一轮素材测试方向。'
    case 'batch-variants':
      return '按钩子、场景、人群、卖点呈现或版式生成可归因的 A/B 变体；每条只改一个变量。'
    case 'ad-review':
      return '根据 CTR、CVR、CPA、消耗等投放数据复盘素材变量，给出下一轮衍生方向。'
    default:
      return '根据当前输入执行技能规则，生成适合信息流广告素材生产的提示词、角度或变量。'
  }
}

function isWordDeriveAction(action: AssistantAction) {
  return isVariableResultAction(action)
}

function isVariableResultAction(action: AssistantAction) {
  return action.outputMode === 'create-word-tags' || [
    'super-derive',
    'market-breakdown',
    'angle-matrix',
    'word-extract',
    'image-describe',
  ].includes(action.id)
}

function AssistantActionContextMenu({
  action,
  rect,
  pinned,
  canHide,
  onRun,
  onSettings,
  onPin,
  onHide,
  onClose,
}: {
  action: AssistantAction
  rect: DOMRect
  pinned: boolean
  canHide: boolean
  onRun: () => void
  onSettings: () => void
  onPin: () => void
  onHide: () => void
  onClose: () => void
}) {
  const width = 160
  const viewportWidth = typeof window === 'undefined' ? width : window.innerWidth
  const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8))
  const top = Math.max(8, rect.top - 8)

  return (
    <div className="fixed z-[90] w-40 -translate-y-full overflow-hidden rounded-2xl border border-gray-200/70 bg-white p-1.5 shadow-xl ring-1 ring-black/5 dark:border-white/[0.08] dark:bg-gray-900 dark:ring-white/10" style={{ left, top }}>
      <button type="button" onClick={onRun} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.06]"><ActionIcon icon={action.icon} />运行</button>
      <button type="button" onClick={onSettings} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.06]"><Settings className="h-4 w-4 text-blue-500" />设置</button>
      <button type="button" onClick={onPin} className="block w-full rounded-xl px-2.5 py-2 text-left text-xs text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]">{pinned ? '取消固定' : '固定'}</button>
      {canHide && <button type="button" onClick={onHide} className="block w-full rounded-xl px-2.5 py-2 text-left text-xs text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]">隐藏</button>}
      <button type="button" onClick={onClose} className="block w-full rounded-xl px-2.5 py-2 text-left text-xs text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.06]">关闭</button>
    </div>
  )
}

function AssistantActionSettingsPanel({
  actionName,
  rect,
  settings,
  showWordSettings,
  groups,
  onChangeGlobal,
  onChangeWord,
  onCreateGroup,
  onResetGlobal,
  onResetWord,
  onClose,
}: {
  actionName: string
  rect: DOMRect
  settings: AssistantActionSettings
  showWordSettings: boolean
  groups: WordLibraryGroup[]
  onChangeGlobal: (patch: Partial<AssistantActionSettings>) => void
  onChangeWord: (patch: Partial<WordDeriveActionSettings>) => void
  onCreateGroup?: (name: string) => string
  onResetGlobal: () => void
  onResetWord: () => void
  onClose: () => void
}) {
  const [newGroupName, setNewGroupName] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const width = 540
  const viewportWidth = typeof window === 'undefined' ? width : window.innerWidth
  const left = Math.max(12, Math.min(rect.left, viewportWidth - width - 12))
  const top = Math.max(12, rect.top - 8)
  const wordSettings = settings.wordDerive
  const selectClassName = 'rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-700 outline-none dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100'

  const createGroup = () => {
    const name = newGroupName.trim()
    if (!name || !onCreateGroup) return
    const id = onCreateGroup(name)
    onChangeWord({ targetGroupId: id })
    setNewGroupName('')
  }

  const toggleCategory = (category: string) => {
    const next = wordSettings.categories.includes(category)
      ? wordSettings.categories.filter((item) => item !== category)
      : [...wordSettings.categories, category]
    onChangeWord({ categories: next.length ? next : [category] })
  }

  const addCategory = () => {
    const name = newCategory.trim()
    if (!name || wordSettings.categories.includes(name)) return
    onChangeWord({ categories: [...wordSettings.categories, name] })
    setNewCategory('')
  }

  return (
    <div className="fixed z-[90] w-[min(540px,calc(100vw-1.5rem))] -translate-y-full rounded-2xl border border-gray-200/70 bg-white p-4 shadow-xl ring-1 ring-black/5 dark:border-white/[0.08] dark:bg-gray-900 dark:ring-white/10" style={{ left, top }}>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{actionName}设置</div>
        <button type="button" onClick={onClose} className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.08]"><X className="h-4 w-4" /></button>
      </div>

      <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">通用投放设置</div>
      <div className="grid gap-3 text-xs text-gray-600 dark:text-gray-300 sm:grid-cols-3">
        <label className="grid gap-1">
          <span>目标渠道</span>
          <Select
            value={settings.channel}
            onChange={(value) => onChangeGlobal({ channel: value as AdChannel })}
            options={AD_CHANNEL_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            className={selectClassName}
          />
        </label>
        <label className="grid gap-1">
          <span>卖点文案策略</span>
          <Select
            value={settings.sellingPointPolicy}
            onChange={(value) => onChangeGlobal({ sellingPointPolicy: value as SellingPointPolicy })}
            options={SELLING_POINT_POLICY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            className={selectClassName}
          />
        </label>
        <label className="grid gap-1">
          <span>输出数量</span>
          <Select
            value={settings.outputCount}
            onChange={(value) => onChangeGlobal({ outputCount: Number(value) || 6 })}
            options={OUTPUT_COUNT_OPTIONS.map((count) => ({ value: count, label: String(count) }))}
            className={selectClassName}
          />
        </label>
      </div>

      {showWordSettings && (
        <div className="mt-4 border-t border-gray-100 pt-3 dark:border-white/[0.08]">
          <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">变量词条设置</div>
          <div className="grid gap-3 text-xs text-gray-600 dark:text-gray-300 sm:grid-cols-2">
            <label className="grid gap-1">
              <span>保存分组策略</span>
              <Select
                value={wordSettings.targetGroupMode}
                onChange={(value) => onChangeWord({ targetGroupMode: value as WordDeriveActionSettings['targetGroupMode'] })}
                options={[
                  { value: 'skill-name', label: '使用技能名称分组' },
                  { value: 'selected', label: '使用固定分组' },
                ]}
                className={selectClassName}
              />
            </label>
            <label className="grid gap-1">
              <span>固定词条分组</span>
              <Select
                value={wordSettings.targetGroupId ?? ''}
                onChange={(value) => onChangeWord({ targetGroupId: String(value) || null })}
                options={[{ value: '', label: '默认分组' }, ...groups.map((group) => ({ value: group.id, label: group.name }))]}
                className={selectClassName}
              />
            </label>
            <label className="grid gap-1">
              <span>每类变量数量</span>
              <input type="number" min={1} max={50} value={wordSettings.variableCount} onChange={(event) => onChangeWord({ variableCount: Number(event.target.value) || 1 })} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-700 outline-none dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
            </label>
            <label className="grid gap-1">
              <span>写入方式</span>
              <Select
                value={wordSettings.promptMode}
                onChange={(value) => onChangeWord({ promptMode: value === 'append' ? 'append' : 'replace' })}
                options={[
                  { value: 'replace', label: '替换输入框' },
                  { value: 'append', label: '追加到输入框' },
                ]}
                className={selectClassName}
              />
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 dark:border-white/[0.08]">
              <input type="checkbox" checked={wordSettings.autoSaveWordEntries} onChange={(event) => onChangeWord({ autoSaveWordEntries: event.target.checked })} />
              <span>添加时自动保存词条</span>
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="新建分组名称" className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 outline-none placeholder:text-gray-400 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
            <button type="button" onClick={createGroup} className="rounded-xl bg-blue-500 px-3 py-2 text-xs font-medium text-white hover:bg-blue-600">新建</button>
          </div>
          <div className="mt-3">
            <div className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-300">衍生分类</div>
            <div className="flex flex-wrap gap-2">
              {[...new Set([...DEFAULT_SUPER_DERIVE_SETTINGS.categories, ...wordSettings.categories])].map((category) => (
                <label key={category} className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-xs dark:border-white/[0.08]">
                  <input type="checkbox" checked={wordSettings.categories.includes(category)} onChange={() => toggleCategory(category)} />
                  {category}
                </label>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="添加分类" className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 outline-none placeholder:text-gray-400 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
              <button type="button" onClick={addCategory} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.06]">添加分类</button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onResetGlobal} className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.06]">恢复通用默认</button>
        {showWordSettings && <button type="button" onClick={onResetWord} className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.06]">恢复词条默认</button>}
        <button type="button" onClick={onClose} className="rounded-xl bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600">完成</button>
      </div>
    </div>
  )
}

function ActionIcon({ icon }: { icon: AssistantActionIcon }) {
  const Icon = iconMap[icon]
  return <Icon className="h-4 w-4 text-blue-500" />
}

function AssistantLoadingPanel({ feedback }: { feedback: Extract<AssistantActionFeedbackState, { type: 'loading' }> }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const currentPhase = feedback.phases[feedback.phaseIndex] ?? feedback.phases[feedback.phases.length - 1]
  const progress = feedback.phases.length > 1
    ? Math.round((feedback.phaseIndex / (feedback.phases.length - 1)) * 100)
    : 30
  const elapsedSeconds = Math.max(0, Math.floor((now - feedback.startedAt) / 1000))
  const currentDetail = feedback.detail || currentPhase?.detail || '正在按当前技能流程处理，请稍等。'

  return (
    <div className="absolute bottom-full left-0 right-0 z-40 mb-2 rounded-2xl border border-blue-200 bg-white p-3 shadow-xl ring-1 ring-blue-100 dark:border-blue-500/30 dark:bg-gray-900 dark:ring-blue-500/20">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-500 dark:bg-blue-500/10"><Loader2 className="h-5 w-5 animate-spin" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{feedback.action.name}处理中</div>
            <div className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">已耗时 {elapsedSeconds}s</div>
          </div>
          <div className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-300">{currentPhase?.label ?? '生成中'}</div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{currentDetail}</div>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-500/10">
        {currentPhase?.indeterminate ? (
          <div className="h-full w-1/2 rounded-full bg-blue-500/80 animate-pulse" />
        ) : (
          <div className="h-full rounded-full bg-blue-500 transition-all duration-500 ease-out" style={{ width: `${Math.max(8, Math.min(92, progress))}%` }} />
        )}
      </div>
      <div className="mt-3 grid gap-1.5">
        {feedback.phases.map((phase, index) => {
          const done = index < feedback.phaseIndex
          const active = index === feedback.phaseIndex
          return (
            <div key={phase.id} className={`flex items-start gap-2 rounded-xl px-2 py-1.5 text-xs transition-colors ${
              active
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200'
                : done
                ? 'text-gray-500 dark:text-gray-400'
                : 'text-gray-400 dark:text-gray-600'
            }`}>
              <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                done
                  ? 'bg-emerald-500 text-white'
                  : active
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 text-gray-500 dark:bg-white/[0.08] dark:text-gray-500'
              }`}>
                {done ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              <span className="min-w-0">
                <span className="font-medium">{phase.label}</span>
                {active && <span className="ml-1 text-gray-500 dark:text-gray-400">{currentDetail}</span>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AssistantErrorPanel({ action, message, onClose, onRetry }: { action: AssistantAction; message: string; onClose: () => void; onRetry: () => void }) {
  return (
    <div className="absolute bottom-full left-0 right-0 z-40 mb-2 rounded-2xl border border-red-200 bg-white p-3 shadow-xl ring-1 ring-red-100 dark:border-red-500/30 dark:bg-gray-900 dark:ring-red-500/20">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2"><AlertCircle className="h-4 w-4 shrink-0 text-red-500" /><div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{action.name}失败</div></div>
        <button type="button" onClick={onClose} className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.08] dark:hover:text-gray-200"><X className="h-4 w-4" /></button>
      </div>
      <div className="rounded-xl bg-red-50 p-3 text-xs leading-relaxed text-red-700 dark:bg-red-500/10 dark:text-red-200">{message}</div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.06]">关闭</button>
        <button type="button" onClick={onRetry} className="rounded-xl bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600">重试</button>
      </div>
    </div>
  )
}

function AssistantActionResultPanel({
  result,
  wordDeriveSettings,
  onClose,
  onReplace,
  onAppend,
  onSaveWordEntries,
  onApplyWordPrompt,
  onContinueVariants,
  onRewriteChannel,
}: {
  result: AssistantActionResult
  wordDeriveSettings: WordDeriveActionSettings
  onClose: () => void
  onReplace: (text: string) => void
  onAppend: (text: string) => void
  onSaveWordEntries?: (groups: AssistantWordEntryGroup[], options: AssistantWordEntryApplyOptions) => void
  onApplyWordPrompt?: (groups: AssistantWordEntryGroup[], prompt: string, options: AssistantWordEntryApplyOptions) => void
  onContinueVariants?: (seedText: string) => void
  onRewriteChannel?: (seedText: string, channel: AdChannel) => void
}) {
  const candidates = result.candidates ?? []
  const sections = result.sections ?? []
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState(0)
  const [channelMenuOpen, setChannelMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [mainCopied, setMainCopied] = useState(false)
  const [wordEntriesOpen, setWordEntriesOpen] = useState(false)
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [showAllCandidates, setShowAllCandidates] = useState(false)
  const [candidateStates, setCandidateStates] = useState<Record<number, 'appended' | 'replaced' | 'copied'>>({})
  const hasWordEntries = Boolean(result.wordEntries?.some((group) => group.entries.length > 0))
  const canApplyWordPrompt = hasWordEntries && Boolean(result.variablePrompt)
  const applyOptions: AssistantWordEntryApplyOptions = {
    ...wordDeriveSettings,
    actionName: result.title,
  }
  const applyText = result.variablePrompt || ''
  const mainPrompt = canApplyWordPrompt
    ? applyText
    : result.primaryText || candidates[0] || result.content
  const visibleCandidates = showAllCandidates ? candidates : candidates.slice(0, 3)
  const hiddenCandidateCount = Math.max(0, candidates.length - visibleCandidates.length)
  const wordEntryCount = result.wordEntries?.reduce((sum, group) => sum + group.entries.length, 0) ?? 0
  const channelLabel = result.channel ? (AD_CHANNEL_OPTIONS.find((option) => option.value === result.channel)?.label ?? result.channel) : '通用信息流'
  const policyLabel = result.sellingPointPolicy ? (SELLING_POINT_POLICY_OPTIONS.find((option) => option.value === result.sellingPointPolicy)?.label ?? result.sellingPointPolicy) : '锁定原卖点'
  const qualityState = result.qualityState ?? 'complete'
  const qualityLabel =
    qualityState === 'repaired' ? '已局部修复'
      : qualityState === 'insufficient-data' ? '数据不足'
        : qualityState === 'failed' ? '生成失败'
          : '完成'
  const qualityNote = result.qualityNote
  const [factOpen, setFactOpen] = useState(true)
  const [sourceOpen, setSourceOpen] = useState(true)
  const grounding = result.grounding
  const observedFacts = grounding?.observedFacts ?? []
  const missingInfo = grounding?.missingInformation ?? []
  const sourceAnchors = result.sourceAnchors ?? []
  const assumptions = result.assumptions ?? []
  const visualIdentity = grounding?.visualIdentity
  const visualIdentityFields: Array<{ key: keyof VisualIdentity; label: string }> = [
    { key: 'subject', label: '主体' },
    { key: 'composition', label: '构图' },
    { key: 'color', label: '色彩' },
    { key: 'scene', label: '场景' },
    { key: 'textLayout', label: '文字/字幕' },
    { key: 'style', label: '风格' },
  ]
  const hasVisualIdentity = !!visualIdentity && visualIdentityFields.some((field) => (visualIdentity as VisualIdentity)[field.key])
  const hadImage = grounding?.observedFacts.some((fact) => fact.source === 'image') ?? false
  // P0: 第4层不再写死“无依据事实：0”。系统没有做逐句事实校验，
  // 因此只展示可解释的质量指标：模型是否回报了输入依据与假设。
  const evidenceLabel =
    sourceAnchors.length > 0 ? `输入依据 ${sourceAnchors.length}` : '未返回输入依据'
  const assumptionLabel =
    assumptions.length > 0 ? `假设 ${assumptions.length}` : '无显式假设'
  const placeholderNames = extractPlaceholderNames(result.variablePrompt ?? '')
  const placeholderMapped = placeholderNames.filter((name) => (result.wordEntries ?? []).some((group) => group.category === name))
  const placeholderUnmapped = placeholderNames.filter((name) => !placeholderMapped.includes(name))
  const copyTestPlan = async () => {
    const text = result.testPlan || mainPrompt
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }
  const copyMainPrompt = async () => {
    try {
      await navigator.clipboard.writeText(mainPrompt)
      setMainCopied(true)
      setTimeout(() => setMainCopied(false), 1600)
    } catch {
      setMainCopied(false)
    }
  }
  const markCandidate = (index: number, state: 'appended' | 'replaced' | 'copied') => {
    setCandidateStates((current) => ({ ...current, [index]: state }))
  }
  const copyCandidate = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text)
      markCandidate(index, 'copied')
    } catch {
      // Keep the result panel open even when clipboard permission is unavailable.
    }
  }
  const appendCandidate = (text: string, index: number) => {
    onAppend(text)
    markCandidate(index, 'appended')
  }
  const replaceCandidate = (text: string, index: number) => {
    onReplace(text)
    markCandidate(index, 'replaced')
  }
  const appendResult = () => {
    if (canApplyWordPrompt && onApplyWordPrompt) {
      onApplyWordPrompt(result.wordEntries ?? [], applyText, { ...applyOptions, promptMode: 'append' })
      markCandidate(selectedCandidateIndex, 'appended')
      return
    }
    onAppend(mainPrompt)
  }
  const replaceResult = () => {
    if (canApplyWordPrompt && onApplyWordPrompt) {
      onApplyWordPrompt(result.wordEntries ?? [], applyText, { ...applyOptions, promptMode: 'replace' })
      markCandidate(selectedCandidateIndex, 'replaced')
      return
    }
    onReplace(mainPrompt)
  }

  useEffect(() => {
    setSelectedCandidateIndex(0)
    setCandidateStates({})
    setCopied(false)
    setMainCopied(false)
    setWordEntriesOpen(false)
    setAnalysisOpen(false)
    setShowAllCandidates(false)
    setFactOpen(true)
    setSourceOpen(true)
  }, [result])

  return (
    <div className="absolute bottom-full left-0 right-0 z-40 mb-2 rounded-2xl border border-gray-200/70 bg-white p-3 shadow-xl ring-1 ring-black/5 dark:border-white/[0.08] dark:bg-gray-900 dark:ring-white/10">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {qualityState === 'failed' ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
            ) : qualityState === 'repaired' ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
            ) : qualityState === 'insufficient-data' ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-blue-500" />
            ) : (
              <Check className="h-4 w-4 shrink-0 text-green-500" />
            )}
            <div className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
              {result.title}
              <span className="ml-1 text-[11px] font-normal text-gray-400">{qualityLabel}</span>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {result.channel && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">渠道：{channelLabel}</span>
            )}
            {result.sellingPointPolicy && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">卖点：{policyLabel}</span>
            )}
            {qualityState === 'repaired' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">局部修复</span>
            )}
            {qualityState === 'insufficient-data' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">数据不足</span>
            )}
          </div>
          {qualityNote && <div className="mt-1 text-[11px] leading-relaxed text-amber-600 dark:text-amber-300">{qualityNote}</div>}
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.08] dark:hover:text-gray-200"><X className="h-4 w-4" /></button>
      </div>
      <div className="max-h-72 overflow-auto rounded-xl bg-gray-50 p-3 text-xs leading-relaxed text-gray-700 dark:bg-white/[0.04] dark:text-gray-200">
        {/* Layer 1: 输入事实卡（只读，供用户确认“你理解的是这些”） */}
        {(observedFacts.length > 0 || missingInfo.length > 0) && (
          <div className="mb-2 rounded-xl border border-gray-200/70 bg-white dark:border-white/[0.08] dark:bg-white/[0.03]">
            <button type="button" onClick={() => setFactOpen((open) => !open)} className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left">
              <span className="flex items-center gap-1.5 font-medium text-gray-800 dark:text-gray-100">
                <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-500 dark:bg-white/[0.08] dark:text-gray-400">第1层</span>输入事实卡
              </span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400">{observedFacts.length} 条事实 · {factOpen ? '收起' : '展开'}</span>
            </button>
            {factOpen && (
              <div className="space-y-1.5 border-t border-gray-100 p-2 dark:border-white/[0.08]">
                {observedFacts.map((fact, index) => (
                  <div key={index} className="flex items-start gap-1.5">
                    <span className="mt-0.5 shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">已确认</span>
                    <span className="text-gray-600 dark:text-gray-300">{fact.fact}<span className="ml-1 text-[10px] text-gray-400">（{fact.sourceRef ?? fact.source}）</span></span>
                  </div>
                ))}
                {missingInfo.map((info, index) => (
                  <div key={`m-${index}`} className="flex items-start gap-1.5">
                    <span className="mt-0.5 shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">缺信息</span>
                    <span className="text-gray-600 dark:text-gray-300">{info}</span>
                  </div>
                ))}
                {hasVisualIdentity ? (
                  <div className="mt-1.5 border-t border-gray-100 pt-1.5 dark:border-white/[0.08]">
                    <div className="mb-1 text-[11px] font-medium text-blue-700 dark:text-blue-300">图片结构化观察（来自模型，非本地猜测）</div>
                    <dl className="space-y-0.5 text-[11px] text-gray-600 dark:text-gray-300">
                      {visualIdentityFields.map((field) => {
                        const value = (visualIdentity as VisualIdentity)[field.key]
                        if (!value) return null
                        return (
                          <div key={field.key} className="flex gap-1">
                            <span className="shrink-0 text-gray-400">{field.label}：</span>
                            <span>{value}</span>
                          </div>
                        )
                      })}
                    </dl>
                  </div>
                  ) : (
                  hadImage && (
                    <div className="mt-1.5 border-t border-gray-100 pt-1.5 text-[11px] text-gray-400 dark:border-white/[0.08]">
                      未返回图片结构化观察，请勿将其误认为已理解图片内容。
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )}

        {/* Layer 2: 生成内容 */}
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">
          <span className="rounded bg-blue-50 px-1 text-[10px] text-blue-600 dark:bg-blue-500/15 dark:text-blue-300">第2层</span>生成内容
        </div>
        <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-2 dark:border-blue-500/30 dark:bg-blue-500/10">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="font-medium text-blue-700 dark:text-blue-200">{canApplyWordPrompt ? '变量主提示词' : '主推提示词'}</div>
            {canApplyWordPrompt && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-medium text-white">词条版</span>}
          </div>
          <div className="whitespace-pre-wrap text-gray-800 dark:text-gray-100">{mainPrompt}</div>
          {placeholderNames.length > 0 && (
            <div className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${placeholderUnmapped.length === 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'}`}>
              占位符与词条对齐 {placeholderMapped.length}/{placeholderNames.length}
            </div>
          )}
        </div>
        {hasWordEntries && (
          <div className="mt-2 rounded-xl border border-gray-200/70 bg-white dark:border-white/[0.08] dark:bg-white/[0.03]">
            <button type="button" onClick={() => setWordEntriesOpen((open) => !open)} className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left">
              <span className="font-medium text-gray-800 dark:text-gray-100">变量词条</span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400">{result.wordEntries!.length} 类 / {wordEntryCount} 条 · {wordEntriesOpen ? '收起' : '展开'}</span>
            </button>
            {wordEntriesOpen && (
              <div className="border-t border-gray-100 p-2 dark:border-white/[0.08]">
                <div className="flex flex-wrap gap-1.5">
                  {result.wordEntries!.filter((group) => group.entries.length > 0).map((group) => (
                    <span key={group.category} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">{group.category}：{group.entries.join('、')}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {candidates.length > 0 && (
          <div className="mt-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium text-gray-800 dark:text-gray-100">候选提示词</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400">默认显示 {Math.min(3, candidates.length)} / {candidates.length}</div>
            </div>
            {visibleCandidates.map((candidate, index) => {
              const selected = index === selectedCandidateIndex
              const state = candidateStates[index]
              const stateLabel = state === 'appended' ? '已追加' : state === 'replaced' ? '已替换' : state === 'copied' ? '已复制' : ''
              return (
              <div
                key={`${index}-${candidate.slice(0, 16)}`}
                onClick={() => setSelectedCandidateIndex(index)}
                className={`block w-full rounded-xl border p-2 text-left transition-colors ${
                  selected
                    ? 'border-blue-300 bg-blue-50 text-gray-800 ring-1 ring-blue-200 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-gray-100 dark:ring-blue-500/20'
                    : 'border-gray-200/70 bg-white text-gray-700 hover:border-blue-200 hover:bg-blue-50/60 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:hover:border-blue-500/30 dark:hover:bg-blue-500/10'
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className={`font-medium ${selected ? 'text-blue-600 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400'}`}>候选 {index + 1}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    {stateLabel && <span className="rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-medium text-white">{stateLabel}</span>}
                    {selected && <span className="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-medium text-white">已选</span>}
                  </div>
                </div>
                <div className="whitespace-pre-wrap">{candidate}</div>
                <div className="mt-2 flex flex-nowrap items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <button type="button" onClick={(event) => { event.stopPropagation(); appendCandidate(candidate, index) }} className="h-6 shrink-0 rounded-md border border-gray-200 bg-white px-2 text-[11px] font-medium leading-none text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]">追加</button>
                  <button type="button" onClick={(event) => { event.stopPropagation(); replaceCandidate(candidate, index) }} className="h-6 shrink-0 rounded-md bg-blue-500 px-2 text-[11px] font-medium leading-none text-white hover:bg-blue-600">替换</button>
                  <button type="button" onClick={(event) => { event.stopPropagation(); void copyCandidate(candidate, index) }} className="h-6 shrink-0 rounded-md border border-gray-200 bg-white px-2 text-[11px] font-medium leading-none text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]">复制</button>
                </div>
              </div>
              )
            })}
            {hiddenCandidateCount > 0 && (
              <button type="button" onClick={() => setShowAllCandidates(true)} className="h-7 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]">展开其余 {hiddenCandidateCount} 条</button>
            )}
          </div>
        )}
        {sections.length > 0 && (
          <div className="mt-2 rounded-xl border border-gray-200/70 bg-white dark:border-white/[0.08] dark:bg-white/[0.03]">
            <button type="button" onClick={() => setAnalysisOpen((open) => !open)} className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left">
              <span className="font-medium text-gray-800 dark:text-gray-100">分析说明</span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400">{sections.length} 组 · {analysisOpen ? '收起' : '展开'}</span>
            </button>
            {analysisOpen && (
              <div className="space-y-2 border-t border-gray-100 p-2 dark:border-white/[0.08]">
                {sections.map((section) => (
                  <div key={section.title} className="rounded-lg bg-gray-50 p-2 dark:bg-white/[0.04]">
                    <div className="mb-1 font-medium text-gray-800 dark:text-gray-100">{section.title}</div>
                    <ul className="space-y-1">
                      {section.items.map((item, index) => (
                        <li key={index} className="text-gray-600 dark:text-gray-300">{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {!mainPrompt && sections.length === 0 && candidates.length === 0 && (
          <pre className="whitespace-pre-wrap font-sans">{result.content}</pre>
        )}

        {/* Layer 3: 来源校验 —— 区分来自输入的依据与模型假设 */}
        {(sourceAnchors.length > 0 || assumptions.length > 0) && (
          <div className="mt-2 rounded-xl border border-gray-200/70 bg-white dark:border-white/[0.08] dark:bg-white/[0.03]">
            <button type="button" onClick={() => setSourceOpen((open) => !open)} className="flex w-full items-center justify-between gap-2 px-2 py-2 text-left">
              <span className="flex items-center gap-1.5 font-medium text-gray-800 dark:text-gray-100">
                <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-500 dark:bg-white/[0.08] dark:text-gray-400">第3层</span>来源校验
              </span>
              <span className="text-[11px] text-gray-500 dark:text-gray-400">输入 {sourceAnchors.length} · 假设 {assumptions.length} · {sourceOpen ? '收起' : '展开'}</span>
            </button>
            {sourceOpen && (
              <div className="space-y-2 border-t border-gray-100 p-2 dark:border-white/[0.08]">
                {sourceAnchors.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">来自输入的依据</div>
                    <ul className="space-y-1">
                      {sourceAnchors.map((anchor, index) => (
                        <li key={index} className="text-gray-600 dark:text-gray-300">{anchor}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {assumptions.length > 0 && (
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">模型假设 / 推断（非输入事实）</div>
                    <ul className="space-y-1">
                      {assumptions.map((item, index) => (
                        <li key={index} className="text-gray-600 dark:text-gray-300">{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Layer 4: 质量状态与信任 */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl bg-gray-100/70 px-2 py-1.5 text-[10px] text-gray-500 dark:bg-white/[0.04] dark:text-gray-400">
          <span className="rounded-full bg-gray-200 px-1.5 py-0.5 font-medium text-gray-600 dark:bg-white/[0.08] dark:text-gray-300">第4层</span>
          <span>状态：{qualityLabel}</span>
          <span>· {evidenceLabel}</span>
          <span>· {assumptionLabel}</span>
          {placeholderNames.length > 0 && <span>· 占位符对齐 {placeholderMapped.length}/{placeholderNames.length}</span>}
          {missingInfo.length > 0 && <span>· 输入缺 {missingInfo.length} 项</span>}
        </div>
      </div>
      <div className="mt-3 flex flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button type="button" onClick={appendResult} className="h-8 shrink-0 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]">追加</button>
        <button type="button" onClick={replaceResult} className="h-8 shrink-0 rounded-lg bg-blue-500 px-3 text-xs font-medium text-white transition-colors hover:bg-blue-600">替换</button>
        <button type="button" onClick={() => void copyMainPrompt()} className="h-8 shrink-0 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]">{mainCopied ? '已复制' : '复制'}</button>
        {hasWordEntries && (
          <button type="button" onClick={() => onSaveWordEntries?.(result.wordEntries ?? [], applyOptions)} className="h-8 shrink-0 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]">保存变量词条</button>
        )}
        <button type="button" onClick={copyTestPlan} className="h-8 shrink-0 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]">{copied ? '已复制计划' : '测试计划'}</button>
        <div className="relative shrink-0">
          <button type="button" onClick={() => setChannelMenuOpen((open) => !open)} className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]">按渠道改写</button>
          {channelMenuOpen && (
            <div className="absolute bottom-full left-0 z-50 mb-2 w-full overflow-hidden rounded-xl border border-gray-200/70 bg-white p-1.5 shadow-xl ring-1 ring-black/5 dark:border-white/[0.08] dark:bg-gray-900 dark:ring-white/10">
              {AD_CHANNEL_OPTIONS.filter((option) => option.value !== result.channel).map((option) => (
                <button key={option.value} type="button" onClick={() => { setChannelMenuOpen(false); onRewriteChannel?.(mainPrompt, option.value) }} className="block w-full rounded-lg px-2.5 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.06]">{option.label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SkillBuilderPanel({
  mode,
  settings,
  profile,
  params,
  preferences,
  skills,
  onModeChange,
  onClose,
  onUpdatePreferences,
}: {
  mode: 'add' | 'manage'
  settings: AppSettings
  profile: ApiProfile
  params: TaskParams
  preferences: AssistantActionPreferences
  skills: AssistantCustomSkill[]
  onModeChange: (mode: 'add' | 'manage') => void
  onClose: () => void
  onUpdatePreferences: (preferences: AssistantActionPreferences) => void
}) {
  const [description, setDescription] = useState('')
  const [draft, setDraft] = useState<AssistantSkillDraft | null>(null)
  const [trigger, setTrigger] = useState<AssistantSkillTrigger>('always')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editTrigger, setEditTrigger] = useState<AssistantSkillTrigger>('always')
  const [editAdContext, setEditAdContext] = useState(false)
  const [editWordEntries, setEditWordEntries] = useState(false)
  const [editExplore, setEditExplore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const hidden = new Set(preferences.hiddenActionIds)
  const orderedActions = getOrderedManageActions(preferences)

  const createDraft = async () => {
    const input = description.trim()
    if (!input || loading) return
    setLoading(true)
    setError('')
    try {
      setDraft(await createAssistantSkillDraft(input, { settings, profile, params }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  const saveDraft = () => {
    if (!draft) return
    // P3: 三个开关从草稿契约中提取，作为该技能契约的单一事实来源。
    const requiresAdContext = draft.contract?.requiresAdContext ?? false
    const allowWordEntries = draft.contract?.output?.wordEntries ?? false
    const allowExploreSellingPoint = draft.contract?.allowExploreSellingPoint ?? false
    const skill: AssistantCustomSkill = {
      id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: draft.name,
      icon: draft.icon,
      instruction: draft.instruction,
      steps: draft.steps,
      trigger,
      enabled: true,
      priority: 65,
      when: getWhenByTrigger(trigger),
      outputMode: 'show-candidates',
      isCustom: true,
      requiresAdContext,
      allowWordEntries,
      allowExploreSellingPoint,
      contract: draft.contract,
    }
    onUpdatePreferences({ ...preferences, customSkills: [...preferences.customSkills, skill] })
    setDraft(null)
    setDescription('')
    setTrigger('always')
    onModeChange('manage')
  }

  const updateCustomSkill = (id: string, patch: Partial<AssistantCustomSkill>) => {
    onUpdatePreferences({
      ...preferences,
      customSkills: preferences.customSkills.map((skill) => skill.id === id ? { ...skill, ...patch } : skill),
    })
  }

  const setActionVisible = (action: AssistantAction, visible: boolean) => {
    if (!visible && isCoreVisibleAction(action)) return
    if ('isCustom' in action && action.isCustom) {
      updateCustomSkill(action.id, { enabled: visible })
      return
    }
    onUpdatePreferences({
      ...preferences,
      hiddenActionIds: visible
        ? preferences.hiddenActionIds.filter((id) => id !== action.id)
        : [...new Set([...preferences.hiddenActionIds, action.id])],
    })
  }

  const deleteCustomSkill = (id: string) => {
    onUpdatePreferences({
      ...preferences,
      customSkills: preferences.customSkills.filter((skill) => skill.id !== id),
      hiddenActionIds: preferences.hiddenActionIds.filter((actionId) => actionId !== id),
      pinnedActionIds: preferences.pinnedActionIds.filter((actionId) => actionId !== id),
      actionOrder: preferences.actionOrder.filter((actionId) => actionId !== id),
    })
    if (editingId === id) setEditingId(null)
  }

  const moveAction = (id: string, direction: -1 | 1) => {
    const ids = orderedActions.map((action) => action.id)
    const index = ids.indexOf(id)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return
    const next = [...ids]
    const [item] = next.splice(index, 1)
    next.splice(nextIndex, 0, item)
    onUpdatePreferences({ ...preferences, actionOrder: next })
  }

  const beginEdit = (skill: AssistantCustomSkill) => {
    setEditingId(skill.id)
    setEditName(skill.name)
    setEditTrigger(skill.trigger ?? 'always')
    setEditAdContext(skill.requiresAdContext === true)
    setEditWordEntries(skill.allowWordEntries === true)
    setEditExplore(skill.allowExploreSellingPoint === true)
  }

  const saveEdit = () => {
    if (!editingId || !editName.trim()) return
    const current = preferences.customSkills.find((skill) => skill.id === editingId)
    const contract = current
      ? buildCustomSkillContract(current.contract, current.instruction, editAdContext, editWordEntries, editExplore)
      : undefined
    updateCustomSkill(editingId, {
      name: editName.trim().slice(0, 16),
      trigger: editTrigger,
      when: getWhenByTrigger(editTrigger),
      requiresAdContext: editAdContext,
      allowWordEntries: editWordEntries,
      allowExploreSellingPoint: editExplore,
      contract,
    })
    setEditingId(null)
  }

  return (
    <div className="absolute bottom-full right-0 z-50 mb-2 w-[min(560px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-xl ring-1 ring-black/5 dark:border-white/[0.08] dark:bg-gray-900 dark:ring-white/10">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-white/[0.08]">
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-white/[0.06]">
          <button type="button" onClick={() => onModeChange('add')} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${mode === 'add' ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-800 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400'}`}>添加技能</button>
          <button type="button" onClick={() => onModeChange('manage')} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${mode === 'manage' ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-800 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400'}`}>管理技能</button>
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.08]"><X className="h-4 w-4" /></button>
      </div>
      <div className="p-4">
        {mode === 'add' ? (
          <>
            <div className="rounded-xl bg-gray-50 p-3 dark:bg-white/[0.04]">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {TRIGGER_OPTIONS.map((option) => (
                  <button key={option.value} type="button" onClick={() => setTrigger(option.value)} className={`rounded-lg border px-2.5 py-1 text-xs ${trigger === option.value ? 'border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300' : 'border-gray-200 text-gray-500 hover:bg-white dark:border-white/[0.08] dark:text-gray-400 dark:hover:bg-white/[0.06]'}`}>
                    {option.label}
                  </button>
                ))}
              </div>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="描述你想要的技能，例如：分析产品图，输出适合电商主图的三种提示词，并提取卖点词条" rows={4} className="w-full resize-none bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:text-gray-100" />
              <div className="mt-2 flex justify-end">
                <button type="button" onClick={() => void createDraft()} disabled={!description.trim() || loading} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:cursor-wait disabled:opacity-60">
                  {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {loading ? '正在拆解' : '生成技能'}
                </button>
              </div>
            </div>
            {error && <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-200">{error}</div>}
            {draft && (
              <div className="mt-3 rounded-xl border border-blue-100 p-3 dark:border-blue-500/25">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{draft.name}</span>
                  <button type="button" onClick={saveDraft} className="rounded-lg bg-blue-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-600">添加到技能条</button>
                </div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">触发：{getTriggerLabel(trigger)}</div>
                <div className="mt-2 space-y-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300">{draft.steps.map((step, index) => <div key={`${index}-${step}`}>{index + 1}. {step}</div>)}</div>
              </div>
            )}
          </>
        ) : (
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-medium text-gray-700 dark:text-gray-200">管理技能显示与排序</div>
                <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">概念抽取、提示词优化为固定入口，不可隐藏。</div>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">共 {orderedActions.length} 个技能</div>
            </div>
            <div className="max-h-80 space-y-1 overflow-auto pr-1">
              {orderedActions.map((action, index) => {
                const isCustom = isCustomAssistantSkill(action)
                const fixed = isCoreVisibleAction(action)
                const visible = fixed || (isCustom ? action.enabled !== false : !hidden.has(action.id))
                return (
                  <div key={action.id} className="rounded-xl border border-gray-100 bg-white/60 p-2 dark:border-white/[0.08] dark:bg-white/[0.03]">
                    {editingId === action.id && isCustom ? (
                      <div className="space-y-2">
                        <input value={editName} onChange={(event) => setEditName(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-800 outline-none dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100" />
                        <div className="flex flex-wrap gap-1.5">
                          {TRIGGER_OPTIONS.map((option) => (
                            <button key={option.value} type="button" onClick={() => setEditTrigger(option.value)} className={`rounded-lg border px-2.5 py-1 text-xs ${editTrigger === option.value ? 'border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300' : 'border-gray-200 text-gray-500 dark:border-white/[0.08] dark:text-gray-400'}`}>
                              {option.label}
                            </button>
                          ))}
                        </div>
                        <div className="space-y-1.5">
                          <SkillToggleRow label="是否广告投放技能" hint="开启后套用渠道 / 卖点 / 测试计划包装" value={editAdContext} onChange={setEditAdContext} />
                          <SkillToggleRow label="是否允许生成变量词条" hint="关闭则技能不输出 {{变量}} 与词条" value={editWordEntries} onChange={setEditWordEntries} />
                          <SkillToggleRow label="是否允许扩展新卖点" hint="关闭则强制锁定用户输入的卖点" value={editExplore} onChange={setEditExplore} />
                        </div>
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-500 dark:border-white/[0.08] dark:text-gray-400">取消</button>
                          <button type="button" onClick={saveEdit} className="rounded-lg bg-blue-500 px-2.5 py-1 text-xs font-medium text-white">保存</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <ActionIcon icon={action.icon} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-xs font-medium text-gray-800 dark:text-gray-100">{action.name}</span>
                            <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-400">{isCustom ? getTriggerLabel(action.trigger ?? 'always') : '内置'}</span>
                            {fixed && <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">固定</span>}
                          </div>
                        </div>
                        <button type="button" onClick={() => moveAction(action.id, -1)} disabled={index === 0} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-white/[0.06]"><ArrowUp className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => moveAction(action.id, 1)} disabled={index === orderedActions.length - 1} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-white/[0.06]"><ArrowDown className="h-3.5 w-3.5" /></button>
                        {fixed ? (
                          <span className="rounded-lg bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">始终显示</span>
                        ) : (
                          <button type="button" onClick={() => setActionVisible(action, !visible)} className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${visible ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/20' : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-400 dark:hover:bg-white/[0.1]'}`}>{visible ? '显示' : '隐藏'}</button>
                        )}
                        {isCustom && <button type="button" onClick={() => beginEdit(action)} className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.06]">编辑</button>}
                        {isCustom && <button type="button" onClick={() => deleteCustomSkill(action.id)} className="rounded-lg p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /></button>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const TRIGGER_OPTIONS: Array<{ value: AssistantSkillTrigger; label: string }> = [
  { value: 'always', label: '通用' },
  { value: 'image', label: '图片' },
  { value: 'text', label: '文字' },
  { value: 'image_text', label: '图片+文字' },
]

function getTriggerLabel(trigger: AssistantSkillTrigger) {
  return TRIGGER_OPTIONS.find((option) => option.value === trigger)?.label ?? '通用'
}

function SkillToggleRow({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (next: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)} className="flex w-full items-start justify-between gap-3 rounded-lg border border-gray-200/70 bg-white px-2.5 py-1.5 text-left dark:border-white/[0.08] dark:bg-white/[0.03]">
      <span className="min-w-0">
        <span className="block text-xs font-medium text-gray-800 dark:text-gray-100">{label}</span>
        <span className="block text-[11px] text-gray-400">{hint}</span>
      </span>
      <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${value ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500 dark:bg-white/[0.08] dark:text-gray-400'}`}>{value ? '开' : '关'}</span>
    </button>
  )
}

function getOrderedManageActions(preferences: AssistantActionPreferences): AssistantAction[] {
  const manualOrder = new Map(preferences.actionOrder.map((id, index) => [id, index]))
  return [...BUILT_IN_ASSISTANT_ACTIONS, ...preferences.customSkills].sort((a, b) => {
    const aManual = manualOrder.get(a.id)
    const bManual = manualOrder.get(b.id)
    if (aManual != null && bManual != null && aManual !== bManual) return aManual - bManual
    if (aManual != null) return -1
    if (bManual != null) return 1
    return b.priority - a.priority
  })
}

function isCustomAssistantSkill(action: AssistantAction): action is AssistantCustomSkill {
  return 'isCustom' in action && action.isCustom === true
}

function extractPlaceholderNames(value: string): string[] {
  const matches = [...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
  return matches.map((match) => String(match[1] ?? '').trim()).filter(Boolean)
}
