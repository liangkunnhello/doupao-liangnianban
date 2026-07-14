import { useEffect, useMemo, useRef, useState } from 'react'
import type { WheelEvent } from 'react'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Image as ImageIcon,
  Loader2,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Settings as SettingsIcon,
  Sparkles,
  Tags,
  ThumbsUp,
  Trash2,
  Type,
  Wand2,
  X,
} from 'lucide-react'
import { buildAssistantInputContext } from './context'
import {
  buildCustomSkillFromDraft,
  buildCustomSkillContract,
  getRecommendedAssistantActions,
  getMoreAssistantActions,
  getWhenByTrigger,
  isAssistantActionRunnable,
  normalizeAssistantActionPreferences,
  resolveWordEntryApplySettings,
  updateBuiltInSkillSettings,
} from './matcher'
import { createAssistantSkillDraft, runAssistantAction } from './runner'
import type { AssistantRunnerProgressUpdate, AssistantSkillDraft } from './runner'
import type { ApiProfile, AppSettings, InputImage, TaskParams, WordLibraryGroup } from '../../types'
import type {
  AssistantAction,
  AssistantActionIcon,
  AssistantActionPreferences,
  AssistantActionResult,
  AssistantCustomSkill,
  AssistantInputContext,
  AssistantWordEntryGroup,
  VisualIdentity,
  WordDeriveActionSettings,
  WordDeriveSaveStrategy,
  WordEntryConfig,
  WordEntryStrategy,
  VisualInputMode,
  VisualSkillFormValue,
  VisualSkillIntensity,
} from './types'
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
  /** Per-save decision from the save dialog; overrides targetGroupMode when set. */
  saveStrategy?: WordDeriveSaveStrategy
}

const iconMap: Record<AssistantActionIcon, typeof Sparkles> = {
  image: ImageIcon,
  wand: Wand2,
  sparkles: Sparkles,
  palette: Palette,
  tags: Tags,
  'thumbs-up': ThumbsUp,
}

const SUPER_DERIVE_CATEGORIES = [
  '主视觉主体',
  '视觉符号',
  '动作状态',
  '情绪氛围',
  '材质表现',
  '光影效果',
  '背景环境',
  '商业构图',
]

function isCustomAssistantSkill(action: AssistantAction): action is AssistantCustomSkill {
  return (action as AssistantCustomSkill).isCustom === true
}

function getSkillIcon(action: AssistantAction) {
  return iconMap[action.icon] ?? Sparkles
}

function phase(id: string, label: string, detail: string, indeterminate = false): AssistantActionProgressPhase {
  return { id, label, detail, indeterminate }
}

function getAssistantProgressPhases(action: AssistantAction): AssistantActionProgressPhase[] {
  const phases = [
    phase('prepare-input', '准备输入', '读取当前提示词、参考图和技能设置。'),
    phase('request-model', '等待模型返回', '请求已发送，模型生成阶段无法提供精确百分比。', true),
    phase('parse-response', '解析结果', '解析模型返回的 JSON 或普通文本。'),
    phase('validate-result', '校验内容', '校验最终提示词与变量词条完整性。'),
    phase('organize-result', '整理结果', '整理可应用的提示词与词条。'),
  ]
  if (!isVariableResultAction(action)) return phases
  return [
    ...phases.slice(0, 4),
    phase('repair-variables', '补全变量词条', '当变量数量不足或提示词缺少占位符时自动修复。'),
    phases[4],
  ]
}

function isVariableResultAction(action: AssistantAction): boolean {
  if (action.id === 'super-derive' || action.id === 'wild-derive') return true
  return isCustomAssistantSkill(action) && Boolean(action.wordEntries?.enabled)
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

function formatAssistantElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function emptyFormValue(): VisualSkillFormValue {
  return {
    name: '',
    icon: 'sparkles',
    instruction: '',
    inputMode: 'either',
    intensity: 'controlled',
    wordEntries: { enabled: false, count: 8, categories: [...SUPER_DERIVE_CATEGORIES], strategy: 'atomic' },
  }
}

function formValueFromSkill(skill: AssistantCustomSkill): VisualSkillFormValue {
  return {
    name: skill.name,
    icon: skill.icon,
    instruction: skill.instruction,
    inputMode: skill.inputMode ?? 'either',
    intensity: skill.intensity ?? 'controlled',
    wordEntries: skill.wordEntries ?? { enabled: false, count: 8, categories: [...SUPER_DERIVE_CATEGORIES], strategy: 'atomic' },
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
  const recommendedActions = useMemo(() => getRecommendedAssistantActions(context, normalizedPreferences), [context, normalizedPreferences])
  const moreActions = useMemo(() => getMoreAssistantActions(context, normalizedPreferences), [context, normalizedPreferences])
  const visibleActions = recommendedActions
  const [contextAction, setContextAction] = useState<PositionedAction | null>(null)
  const [settingsAction, setSettingsAction] = useState<AssistantAction | null>(null)
  const [editorState, setEditorState] = useState<{ mode: 'create' | 'edit'; skill: AssistantCustomSkill | null } | null>(null)
  const [hoveredSkill, setHoveredSkill] = useState<{ action: AssistantAction; rect: DOMRect } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const runningControllerRef = useRef<AbortController | null>(null)

  const runningActionId = feedback.type === 'loading' ? feedback.action.id : null
  const isBusy = runningActionId != null
  const elapsedLabel = feedback.type === 'loading' ? formatAssistantElapsed(now - feedback.startedAt) : null
  const updatePreferences = (next: AssistantActionPreferences) => onUpdatePreferences?.(next)

  useEffect(() => {
    if (feedback.type !== 'loading') return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [feedback.type, feedback.type === 'loading' ? feedback.startedAt : null])

  useEffect(() => () => {
    runningControllerRef.current?.abort(new DOMException('技能运行已取消', 'AbortError'))
  }, [])

  if (!normalizedPreferences.enabled) return null

  const runActionWithSettings = async (action: AssistantAction) => {
    if (isBusy || !isAssistantActionRunnable(action, context)) return
    setContextAction(null)
    setHoveredSkill(null)
    const controller = new AbortController()
    runningControllerRef.current = controller
    let loadingFeedback = createAssistantLoadingFeedback(action)
    onFeedbackChange(loadingFeedback)
    try {
      const result = await runAssistantAction(action.id, context, {
        settings,
        profile,
        params,
        customSkill: isCustomAssistantSkill(action) ? action : undefined,
        skill: action,
        preferences: normalizedPreferences,
        signal: controller.signal,
        onProgress: (update) => {
          if (controller.signal.aborted) return
          loadingFeedback = applyAssistantProgress(loadingFeedback, update)
          onFeedbackChange(loadingFeedback)
        },
      })
      if (controller.signal.aborted) return
      if (!result.prompt.trim()) {
        onFeedbackChange({ type: 'error', action, message: '没有生成可用内容，请稍后重试。' })
        return
      }
      onFeedbackChange({ type: 'success', action, result })
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        onFeedbackChange({ type: 'idle' })
        return
      }
      onFeedbackChange({ type: 'error', action, message: error instanceof Error ? error.message : String(error) })
    } finally {
      if (runningControllerRef.current === controller) runningControllerRef.current = null
    }
  }

  const runAction = (action: AssistantAction) => void runActionWithSettings(action)
  const cancelRunningAction = () => {
    runningControllerRef.current?.abort(new DOMException('技能运行已取消', 'AbortError'))
    onFeedbackChange({ type: 'idle' })
  }

  const openSettings = (action: AssistantAction) => setSettingsAction(action)
  const closeSettings = () => setSettingsAction(null)

  const removeCustomSkill = (id: string) => {
    updatePreferences({
      ...normalizedPreferences,
      customSkills: normalizedPreferences.customSkills.filter((skill) => skill.id !== id),
    })
  }

  const duplicateAsCustom = (action: AssistantAction) => {
    const draft: { name: string; icon: AssistantActionIcon; contract?: undefined } = {
      name: `${action.name}副本`,
      icon: action.icon,
    }
    const form: VisualSkillFormValue = {
      name: `${action.name}副本`,
      icon: action.icon,
      instruction: action.instruction ?? '',
      inputMode: action.inputMode ?? 'either',
      intensity: action.intensity ?? 'controlled',
      wordEntries: action.wordEntries ?? { enabled: false, count: 8, categories: [...SUPER_DERIVE_CATEGORIES], strategy: 'atomic' },
    }
    const skill = buildCustomSkillFromDraft(draft, form)
    updatePreferences({
      ...normalizedPreferences,
      customSkills: [...normalizedPreferences.customSkills, skill],
    })
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 overflow-x-auto pb-1" onWheel={(event: WheelEvent) => { event.stopPropagation() }}>
        {visibleActions.map((action) => {
          const Icon = getSkillIcon(action)
          const isRunning = runningActionId === action.id
          return (
            <div
              key={action.id}
              className="relative shrink-0"
              onMouseEnter={(event) => setHoveredSkill({ action, rect: (event.currentTarget as HTMLElement).getBoundingClientRect() })}
              onMouseLeave={() => setHoveredSkill(null)}
            >
              <button
                type="button"
                disabled={(!isRunning && isBusy) || !isAssistantActionRunnable(action, context)}
                onClick={() => isRunning ? cancelRunningAction() : runAction(action)}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-medium transition ${
                  isRunning
                    ? 'border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-500/40 dark:bg-blue-950 dark:text-blue-200'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
                }`}
                title={!isAssistantActionRunnable(action, context) ? '当前输入不满足该技能要求' : (action.instruction || action.name)}
              >
                {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                {action.name}
                {isRunning && elapsedLabel && <span className="ml-1 rounded-full bg-white px-1.5 py-0.5 text-[11px] font-mono text-blue-600 dark:bg-blue-900 dark:text-blue-100">{elapsedLabel}</span>}
                {isRunning && <X className="ml-0.5 h-3.5 w-3.5" />}
              </button>
              {hoveredSkill?.action.id === action.id && !isBusy && (
                <div
                  className="absolute left-0 top-full z-20 mt-1 w-40 rounded-xl border border-gray-200 bg-white p-1 text-xs shadow-lg dark:border-white/[0.08] dark:bg-gray-900"
                >
                  <button
                    type="button"
                    className="block w-full rounded-lg px-2 py-1.5 text-left text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]"
                    onClick={() => openSettings(action)}
                  >
                    设置
                  </button>
                  {isCustomAssistantSkill(action) ? (
                    <>
                      <button
                        type="button"
                        className="block w-full rounded-lg px-2 py-1.5 text-left text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]"
                        onClick={() => setEditorState({ mode: 'edit', skill: action })}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="block w-full rounded-lg px-2 py-1.5 text-left text-red-500 hover:bg-gray-50 dark:hover:bg-white/[0.06]"
                        onClick={() => removeCustomSkill(action.id)}
                      >
                        删除
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]"
                      onClick={() => duplicateAsCustom(action)}
                    >
                      复制为自定义技能
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
        <button
          type="button"
          disabled={isBusy}
          onClick={() => setEditorState({ mode: 'create', skill: null })}
          className="flex shrink-0 items-center gap-1 rounded-xl border border-dashed border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-50 dark:border-white/[0.12] dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800"
          title="添加自定义技能"
        >
          <Plus className="h-4 w-4" />
          添加技能
        </button>
      </div>

      {recommendedActions.length === 0 && moreActions.length === 0 && (
        <p className="mt-1 text-xs text-gray-400">当前输入暂无可运行的技能。</p>
      )}

      {settingsAction && (
        <AssistantActionSettingsPanel
          action={settingsAction}
          preferences={normalizedPreferences}
          wordLibraryGroups={wordLibraryGroups}
          onChange={(next) => updatePreferences(next)}
          onClose={closeSettings}
        />
      )}

      {editorState && (
        <AssistantSkillEditor
          mode={editorState.mode}
          editing={editorState.skill}
          preferences={normalizedPreferences}
          settings={settings}
          profile={profile}
          params={params}
          onChange={(next) => updatePreferences(next)}
          onCreateWordGroup={onCreateWordGroup}
          onClose={() => setEditorState(null)}
        />
      )}

      {feedback.type === 'loading' && <AssistantLoadingPanel feedback={feedback} elapsedLabel={elapsedLabel ?? '0s'} onCancel={cancelRunningAction} />}
      {feedback.type === 'error' && (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{feedback.message}</span>
        </div>
      )}
      {feedback.type === 'success' && (
        <AssistantResultPanel
          action={feedback.action}
          result={feedback.result}
          preferences={normalizedPreferences}
          onInsert={onInsert}
          onSaveWordEntries={onSaveWordEntries}
          onApplyWordPrompt={onApplyWordPrompt}
          onRegenerate={() => runAction(feedback.action)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings panel: dispatched per skill (spec §三.6)
// ---------------------------------------------------------------------------

function AssistantActionSettingsPanel({
  action,
  preferences,
  wordLibraryGroups,
  onChange,
  onClose,
}: {
  action: AssistantAction
  preferences: AssistantActionPreferences
  wordLibraryGroups: WordLibraryGroup[]
  onChange: (next: AssistantActionPreferences) => void
  onClose: () => void
}) {
  switch (action.id) {
    case 'super-derive':
      return (
        <SuperDeriveSettingsPanel
          preferences={preferences}
          wordLibraryGroups={wordLibraryGroups}
          onChange={onChange}
          onClose={onClose}
        />
      )
    case 'wild-derive':
      return (
        <WildDeriveSettingsPanel
          preferences={preferences}
          wordLibraryGroups={wordLibraryGroups}
          onChange={onChange}
          onClose={onClose}
        />
      )
    case 'prompt-optimize':
    case 'image-describe':
      return <ReadOnlySkillInfo action={action} onClose={onClose} />
    default:
      return (
        <CustomSkillSettingsPanel action={action} preferences={preferences} onChange={onChange} onClose={onClose} />
      )
  }
}

function SettingsPanelShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="mt-2 rounded-2xl border border-gray-200 bg-white p-3 text-sm shadow-sm dark:border-white/[0.08] dark:bg-gray-900">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-gray-700 dark:text-gray-200">{title} · 设置</span>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.06]">
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  )
}

function SuperDeriveSettingsPanel({
  preferences,
  wordLibraryGroups,
  onChange,
  onClose,
}: {
  preferences: AssistantActionPreferences
  wordLibraryGroups: WordLibraryGroup[]
  onChange: (next: AssistantActionPreferences) => void
  onClose: () => void
}) {
  const settings = preferences.builtInSkillSettings['super-derive']
  const update = (patch: Partial<typeof settings>) => onChange(updateBuiltInSkillSettings(preferences, 'super-derive', patch))
  return (
    <SettingsPanelShell title="超级衍生" onClose={onClose}>
      <div className="space-y-3">
        <Field label="每类词条数量">
          <SegmentedControl
            value={String(settings.wordEntries.count)}
            options={['4', '8', '12']}
            onChange={(value) => update({ wordEntries: { ...settings.wordEntries, count: Number(value) } })}
          />
        </Field>
        <Field label="词条分类">
          <CategoryEditor
            categories={settings.wordEntries.categories}
            onChange={(categories) => update({ wordEntries: { ...settings.wordEntries, categories } })}
          />
        </Field>
        <SkillToggleRow label="自动保存词条" value={settings.autoSave} onChange={(autoSave) => update({ autoSave })} />
        <SaveLocationField
          targetGroupMode={settings.targetGroupMode}
          targetGroupId={settings.targetGroupId}
          wordLibraryGroups={wordLibraryGroups}
          onChange={(patch) => update(patch)}
        />
      </div>
    </SettingsPanelShell>
  )
}

function WildDeriveSettingsPanel({
  preferences,
  wordLibraryGroups,
  onChange,
  onClose,
}: {
  preferences: AssistantActionPreferences
  wordLibraryGroups: WordLibraryGroup[]
  onChange: (next: AssistantActionPreferences) => void
  onClose: () => void
}) {
  const settings = preferences.builtInSkillSettings['wild-derive']
  const update = (patch: Partial<typeof settings>) => onChange(updateBuiltInSkillSettings(preferences, 'wild-derive', patch))
  return (
    <SettingsPanelShell title="赌狗模式" onClose={onClose}>
      <div className="space-y-3">
        <Field label="创意方向数量">
          <SegmentedControl
            value={String(settings.wordEntries.count)}
            options={['8', '12', '20']}
            onChange={(value) => update({ wordEntries: { ...settings.wordEntries, count: Number(value) } })}
          />
        </Field>
        <Field label="创意方向分类">
          <div className="text-xs text-gray-400">固定为「创意方向」，采用方向套装策略。</div>
        </Field>
        <SkillToggleRow label="自动保存词条" value={settings.autoSave} onChange={(autoSave) => update({ autoSave })} />
        <SaveLocationField
          targetGroupMode={settings.targetGroupMode}
          targetGroupId={settings.targetGroupId}
          wordLibraryGroups={wordLibraryGroups}
          onChange={(patch) => update(patch)}
        />
      </div>
    </SettingsPanelShell>
  )
}

function ReadOnlySkillInfo({ action, onClose }: { action: AssistantAction; onClose: () => void }) {
  const info =
    action.id === 'prompt-optimize'
      ? [
          ['输入', '文字，可附参考图片'],
          ['变化强度', '受控'],
          ['词条', '关闭'],
        ]
      : [
          ['输入', '图片，可附补充文字'],
          ['变化强度', '忠实'],
          ['词条', '关闭'],
        ]
  return (
    <SettingsPanelShell title={action.name} onClose={onClose}>
      <ul className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
        {info.map(([label, value]) => (
          <li key={label}>
            <span className="text-gray-400">{label}：</span>
            {value}
          </li>
        ))}
      </ul>
    </SettingsPanelShell>
  )
}

function CustomSkillSettingsPanel({
  action,
  preferences,
  onChange,
  onClose,
}: {
  action: AssistantAction
  preferences: AssistantActionPreferences
  onChange: (next: AssistantActionPreferences) => void
  onClose: () => void
}) {
  if (!isCustomAssistantSkill(action)) return null
  const update = (next: AssistantCustomSkill) => {
    onChange({
      ...preferences,
      customSkills: preferences.customSkills.map((skill) => (skill.id === next.id ? next : skill)),
    })
  }
  return (
    <SettingsPanelShell title={action.name} onClose={onClose}>
      <VisualSkillForm
        value={formValueFromSkill(action)}
        onChange={(form) => update(buildCustomSkillFromDraft({
          id: action.id,
          name: form.name,
          icon: form.icon,
          contract: action.contract,
          enabled: action.enabled,
          priority: action.priority,
        }, form))}
      />
    </SettingsPanelShell>
  )
}

// ---------------------------------------------------------------------------
// Shared form controls
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">{label}</div>
      {children}
    </div>
  )
}

function SegmentedControl({
  value,
  options,
  onChange,
}: {
  value: string
  options: Array<string | { value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const optionValue = typeof option === 'string' ? option : option.value
        const optionLabel = typeof option === 'string' ? option : option.label
        const active = value === optionValue
        return (
          <button
            key={optionValue}
            type="button"
            onClick={() => onChange(optionValue)}
            className={`rounded-lg border px-2.5 py-1 text-xs ${
              active
                ? 'border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300'
                : 'border-gray-200 text-gray-500 dark:border-white/[0.08] dark:text-gray-400'
            }`}
          >
            {optionLabel}
          </button>
        )
      })}
    </div>
  )
}

function SkillToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between rounded-xl border border-gray-200 px-3 py-2 text-left text-xs dark:border-white/[0.08]"
    >
      <span>
        <span className="font-medium text-gray-700 dark:text-gray-200">{label}</span>
        {hint && <span className="ml-2 text-gray-400">{hint}</span>}
      </span>
      <span className={`flex h-4 w-7 items-center rounded-full px-0.5 ${value ? 'bg-blue-500' : 'bg-gray-300 dark:bg-white/20'}`}>
        <span className={`h-3 w-3 rounded-full bg-white transition ${value ? 'translate-x-3' : ''}`} />
      </span>
    </button>
  )
}

function CategoryEditor({ categories, onChange }: { categories: string[]; onChange: (categories: string[]) => void }) {
  const [draft, setDraft] = useState('')
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {categories.map((category) => (
          <span
            key={category}
            className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:bg-white/[0.06] dark:text-gray-300"
          >
            {category}
            <button type="button" onClick={() => onChange(categories.filter((item) => item !== category))} className="text-gray-400 hover:text-red-500">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="新增分类"
          className="flex-1 rounded-lg border border-gray-200 px-2 py-1 text-xs dark:border-white/[0.08] dark:bg-transparent"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) {
              onChange([...categories, draft.trim()])
              setDraft('')
            }
          }}
        />
        <button
          type="button"
          onClick={() => {
            if (draft.trim()) {
              onChange([...categories, draft.trim()])
              setDraft('')
            }
          }}
          className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 dark:border-white/[0.08]"
        >
          添加
        </button>
      </div>
    </div>
  )
}

function SaveLocationField({
  targetGroupMode,
  targetGroupId,
  wordLibraryGroups,
  onChange,
}: {
  targetGroupMode: 'new' | 'selected'
  targetGroupId: string | null
  wordLibraryGroups: WordLibraryGroup[]
  onChange: (patch: { targetGroupMode: 'new' | 'selected'; targetGroupId: string | null }) => void
}) {
  return (
    <Field label="保存位置">
      <SegmentedControl
        value={targetGroupMode}
        options={[
          { value: 'new', label: '每次新建' },
          { value: 'selected', label: '指定分组' },
        ]}
        onChange={(value) => onChange({ targetGroupMode: value as 'new' | 'selected', targetGroupId: value === 'selected' ? targetGroupId : null })}
      />
      {targetGroupMode === 'selected' && (
        <div className="mt-1.5">
          <Select
            value={targetGroupId ?? ''}
            onChange={(value) => onChange({ targetGroupMode, targetGroupId: value || null })}
            options={wordLibraryGroups
              .filter((group) => group.archivedAt == null)
              .map((group) => ({ value: group.id, label: group.name }))}
          />
        </div>
      )}
    </Field>
  )
}

// ---------------------------------------------------------------------------
// Custom skill editor (create / edit) with AI draft + V2 form (spec §四)
// ---------------------------------------------------------------------------

function AssistantSkillEditor({
  mode,
  editing,
  preferences,
  settings,
  profile,
  params,
  onChange,
  onCreateWordGroup,
  onClose,
}: {
  mode: 'create' | 'edit'
  editing: AssistantCustomSkill | null
  preferences: AssistantActionPreferences
  settings: AppSettings
  profile: ApiProfile
  params: TaskParams
  onChange: (next: AssistantActionPreferences) => void
  onCreateWordGroup?: (name: string) => string
  onClose: () => void
}) {
  const [form, setForm] = useState<VisualSkillFormValue>(editing ? formValueFromSkill(editing) : emptyFormValue())
  const [draftContract, setDraftContract] = useState<AssistantSkillDraft['contract']>(editing?.contract)
  const [description, setDescription] = useState('')
  const [drafting, setDrafting] = useState(false)

  const startDraft = async () => {
    if (!description.trim() || !profile.apiKey?.trim()) return
    setDrafting(true)
    try {
      const draft = await createAssistantSkillDraft(description, { settings, profile, params })
      setForm({
        name: draft.name,
        icon: draft.icon,
        instruction: draft.instruction,
        inputMode: draft.inputMode,
        intensity: draft.intensity,
        wordEntries: draft.wordEntries,
      })
      setDraftContract(draft.contract)
    } finally {
      setDrafting(false)
    }
  }

  const save = () => {
    if (!form.name.trim()) return
    const built = buildCustomSkillFromDraft({
      id: editing?.id,
      name: form.name,
      icon: form.icon,
      contract: draftContract,
      enabled: editing?.enabled,
      priority: editing?.priority,
    }, form)
    onChange({
      ...preferences,
      customSkills: mode === 'edit' && editing
        ? preferences.customSkills.map((skill) => (skill.id === editing.id ? built : skill))
        : [...preferences.customSkills, built],
    })
    onClose()
  }

  return (
    <div className="mt-2 rounded-2xl border border-gray-200 bg-white p-3 text-sm shadow-sm dark:border-white/[0.08] dark:bg-gray-900">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-gray-700 dark:text-gray-200">{mode === 'edit' ? '编辑自定义技能' : '新建自定义技能'}</span>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.06]">
          <X className="h-4 w-4" />
        </button>
      </div>

      {mode === 'create' && (
        <div className="mb-3 rounded-xl border border-gray-200 p-2 dark:border-white/[0.08]">
          <div className="mb-1 text-xs text-gray-400">用自然语言描述技能，AI 生成草稿后可审阅修改。</div>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="例如：把产品图变成蒸汽朋克风格，生成可替换词条"
            className="h-16 w-full resize-none rounded-lg border border-gray-200 px-2 py-1 text-xs dark:border-white/[0.08] dark:bg-transparent"
          />
          <button
            type="button"
            disabled={drafting || !description.trim()}
            onClick={startDraft}
            className="mt-1.5 rounded-lg bg-blue-500 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {drafting ? '生成草稿中…' : 'AI 生成草稿'}
          </button>
        </div>
      )}

      <VisualSkillForm value={form} onChange={setForm} />

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 dark:border-white/[0.08]">
          取消
        </button>
        <button
          type="button"
          disabled={!form.name.trim()}
          onClick={save}
          className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {mode === 'edit' ? '保存修改' : '添加技能'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Unified V2 skill form (spec §四.1)
// ---------------------------------------------------------------------------

function VisualSkillForm({ value, onChange }: { value: VisualSkillFormValue; onChange: (value: VisualSkillFormValue) => void }) {
  const update = (patch: Partial<VisualSkillFormValue>) => onChange({ ...value, ...patch })
  const updateWordEntries = (patch: Partial<WordEntryConfig>) => onChange({ ...value, wordEntries: { ...value.wordEntries, ...patch } })
  const inputModes: Array<{ value: VisualInputMode; label: string }> = [
    { value: 'text', label: '仅文字' },
    { value: 'image', label: '仅图片' },
    { value: 'either', label: '文字或图片' },
    { value: 'both', label: '图片和文字都需要' },
  ]
  const intensities: Array<{ value: VisualSkillIntensity; label: string }> = [
    { value: 'faithful', label: '忠实' },
    { value: 'controlled', label: '受控' },
    { value: 'high', label: '高衍生' },
    { value: 'maximum', label: '最大探索' },
  ]
  const icons: AssistantActionIcon[] = ['image', 'wand', 'sparkles', 'palette', 'tags', 'thumbs-up']

  return (
    <div className="space-y-3">
      <Field label="基础信息">
        <div className="space-y-2">
          <input
            value={value.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="技能名称"
            className="w-full rounded-lg border border-gray-200 px-2 py-1 text-xs dark:border-white/[0.08] dark:bg-transparent"
          />
          <div className="flex flex-wrap gap-1.5">
            {icons.map((icon) => {
              const Icon = iconMap[icon]
              return (
                <button
                  key={icon}
                  type="button"
                  onClick={() => update({ icon })}
                  className={`rounded-lg border p-1.5 ${value.icon === icon ? 'border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300' : 'border-gray-200 text-gray-500 dark:border-white/[0.08]'}`}
                >
                  <Icon className="h-4 w-4" />
                </button>
              )
            })}
          </div>
          <textarea
            value={value.instruction}
            onChange={(event) => update({ instruction: event.target.value })}
            placeholder="技能说明：给模型执行的完整中文指令"
            className="h-20 w-full resize-none rounded-lg border border-gray-200 px-2 py-1 text-xs dark:border-white/[0.08] dark:bg-transparent"
          />
        </div>
      </Field>

      <Field label="输入模式">
        <SegmentedControl
          value={value.inputMode}
          options={inputModes}
          onChange={(inputMode) => update({ inputMode: inputMode as VisualInputMode })}
        />
      </Field>

      <Field label="变化强度">
        <SegmentedControl
          value={value.intensity}
          options={intensities}
          onChange={(intensity) => update({ intensity: intensity as VisualSkillIntensity })}
        />
      </Field>

      <Field label="词条">
        <div className="space-y-2">
          <SkillToggleRow
            label="生成词条"
            hint="关闭则技能不输出 {{变量}} 与词条"
            value={value.wordEntries.enabled}
            onChange={(enabled) => updateWordEntries({ enabled })}
          />
          {value.wordEntries.enabled && (
            <>
              <Field label="词条策略">
                <SegmentedControl
                  value={value.wordEntries.strategy}
                  options={[
                    { value: 'atomic', label: '独立词条' },
                    { value: 'direction-pack', label: '方向套装' },
                  ]}
                  onChange={(strategy) => updateWordEntries({ strategy: strategy as WordEntryStrategy })}
                />
              </Field>
              <Field label="每类数量">
                <SegmentedControl
                  value={String(value.wordEntries.count)}
                  options={['4', '8', '12']}
                  onChange={(count) => updateWordEntries({ count: Number(count) })}
                />
              </Field>
              <Field label="分类列表">
                <CategoryEditor categories={value.wordEntries.categories} onChange={(categories) => updateWordEntries({ categories })} />
              </Field>
            </>
          )}
        </div>
      </Field>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Loading + result panels (spec §六)
// ---------------------------------------------------------------------------

function AssistantLoadingPanel({
  feedback,
  elapsedLabel,
  onCancel,
}: {
  feedback: Extract<AssistantActionFeedbackState, { type: 'loading' }>
  elapsedLabel: string
  onCancel: () => void
}) {
  const phase = feedback.phases[feedback.phaseIndex] ?? feedback.phases[feedback.phases.length - 1]
  return (
    <div className="mt-2 rounded-2xl border border-gray-200 bg-white p-3 text-sm dark:border-white/[0.08] dark:bg-gray-900">
      <div className="mb-2 flex items-center justify-between gap-3 text-gray-600 dark:text-gray-300">
        <div className="flex min-w-0 items-center gap-2">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span className="truncate font-medium">{feedback.action.name}</span>
          <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-500 dark:bg-white/[0.06] dark:text-gray-300">{elapsedLabel}</span>
          <span className="truncate text-xs text-gray-400">{phase?.label}</span>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.06]"
        >
          取消
        </button>
      </div>
      {feedback.detail && <p className="text-xs text-gray-400">{feedback.detail}</p>}
    </div>
  )
}

function AssistantResultPanel({
  action,
  result,
  preferences,
  onInsert,
  onSaveWordEntries,
  onApplyWordPrompt,
  onRegenerate,
}: {
  action: AssistantAction
  result: AssistantActionResult
  preferences: AssistantActionPreferences
  onInsert: (text: string, mode: 'replace' | 'append') => void
  onSaveWordEntries?: (groups: AssistantWordEntryGroup[], options: AssistantWordEntryApplyOptions) => void
  onApplyWordPrompt?: (groups: AssistantWordEntryGroup[], prompt: string, options: AssistantWordEntryApplyOptions) => void
  onRegenerate: () => void
}) {
  const [wordOpen, setWordOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const mainPrompt = result.prompt
  const wordEntries = result.wordEntries
  const applyOptions: AssistantWordEntryApplyOptions = {
    ...resolveWordEntryApplySettings(action, preferences),
    actionName: action.name,
  }

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(mainPrompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* ignore */
    }
  }

  const totalEntries = wordEntries?.reduce((sum, group) => sum + group.entries.length, 0) ?? 0

  return (
    <div className="mt-2 rounded-2xl border border-gray-200 bg-white p-3 text-sm shadow-sm dark:border-white/[0.08] dark:bg-gray-900">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700 dark:text-gray-200">{action.name}</span>
          {result.qualityState === 'repaired' && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-600 dark:bg-amber-500/15 dark:text-amber-300">已修复</span>
          )}
          {result.qualityState === 'insufficient-data' && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">信息不足</span>
          )}
        </div>
        <button type="button" onClick={onRegenerate} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 dark:border-white/[0.08] dark:hover:bg-white/[0.06]">
          <RotateCcw className="h-3.5 w-3.5" />
          重新生成
        </button>
      </div>

      {result.qualityNote && <p className="mb-2 text-xs text-amber-500">{result.qualityNote}</p>}

      <pre className="whitespace-pre-wrap rounded-xl bg-gray-50 p-2 text-xs leading-relaxed text-gray-700 dark:bg-white/[0.04] dark:text-gray-200">{mainPrompt}</pre>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => {
          if (wordEntries?.length && onApplyWordPrompt) onApplyWordPrompt(wordEntries, mainPrompt, { ...applyOptions, promptMode: 'replace' })
          else onInsert(mainPrompt, 'replace')
        }} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.06]">
          <ArrowUp className="h-3.5 w-3.5" />
          替换
        </button>
        <button type="button" onClick={() => {
          if (wordEntries?.length && onApplyWordPrompt) onApplyWordPrompt(wordEntries, mainPrompt, { ...applyOptions, promptMode: 'append' })
          else onInsert(mainPrompt, 'append')
        }} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.06]">
          <ArrowDown className="h-3.5 w-3.5" />
          追加
        </button>
        <button type="button" onClick={copyPrompt} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.06]">
          <Copy className="h-3.5 w-3.5" />
          {copied ? '已复制' : '复制'}
        </button>
      </div>

      {wordEntries && wordEntries.length > 0 && (
        <div className="mt-3 rounded-xl border border-gray-200 p-2 dark:border-white/[0.08]">
          <button
            type="button"
            onClick={() => setWordOpen((open) => !open)}
            className="flex w-full items-center justify-between text-xs font-medium text-gray-600 dark:text-gray-300"
          >
            <span>变量词条：{wordEntries.length}类 / {totalEntries}条</span>
            <span className="text-gray-400">{wordOpen ? '收起' : '展开'}</span>
          </button>
          {wordOpen && (
            <ul className="mt-2 space-y-1.5">
              {wordEntries.map((group) => (
                <li key={group.category}>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{group.category}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {group.entries.map((entry) => (
                      <span key={entry} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">{entry}</span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {onSaveWordEntries && (
            <button
              type="button"
              onClick={() => onSaveWordEntries(wordEntries, applyOptions)}
              className="mt-2 rounded-lg bg-blue-500 px-3 py-1 text-xs font-medium text-white"
            >
              保存词条
            </button>
          )}
        </div>
      )}
    </div>
  )
}
