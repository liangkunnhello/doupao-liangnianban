import type { InputImage, ReverseSopControllerMeta, ReverseSopStage, TaskRecord } from '../../../types'
import { generateSopFromStore } from './storeSopGeneration'
import { ensureImageCached, submitTaskWithData, updateTaskInStore, useStore } from '../../../store'
import { parseVariablePrompt, renderVariablePromptBatch } from '../../../lib/variablePrompt'
import { APP_COPY_STRATEGY_SKILL_META_INSTRUCTION } from '../skillMetaInstructions'
import { resolveMetaInstructionForWorkspaceTab } from '../sopLibrary'
import { useRequirementPrototype } from '../../requirementPrototype/store'

const MAX_CONCURRENT_REVERSE_SOP_RUNS = 2
const MAX_VARIABLE_PROMPT_TEMPLATES = 5

const REVERSE_SOP_META_INSTRUCTION = `你是“变量提示词生成 SOP 编译器”。你只负责第一层：根据用户提供的参考图片，输出一份可独立运行的变量提示词生成 SOP；下游文本模型会执行该 SOP，生成多套变量提示词；系统再展开变量后生图。

最终 SOP 必须自包含，不得出现“参考图、原图、上图、保持一致”等依赖图片的表述。SOP 必须固定一个从参考图判定的画面比例，明确构图骨架、主体比例、空间关系、材质、光影、结构裂变矩阵、变量提示词格式和输出数量。下游结果必须是带“可变项：”定义块的变量提示词，不是直接生图提示词。

强制规则：忽略参考图中的 Logo、品牌标识、平台名称、水印、二维码、警示语、免责声明、风险提示、合规小字、角标与按钮；这些都不得进入 SOP、变量、文案 schema 或最终提示词。参考图中可确认的主体文案、标题和卖点作为固定常量逐字保留，不能做成变量；除这些指定文字外不得生成额外文字。必须屏蔽涉黄与涉政内容：只允许明确成年、着装得体的主体；禁止裸露、性暗示、低视角窥视、国旗、国徽、政治人物、政党符号、政治口号、地图争议元素、天安门及相关建筑。每条下游变量提示词都必须保留无黑白边、无相框、无额外文字/Logo/水印/警示语的排除项。

变量规则：变量提示词主体文案默认固定，不得将主体文案做成变量；每套变量提示词至少有 10 个有语义、可自由组合的视觉变量，每个变量至少 10 个真实差异选项。不同变量提示词之间先改变空间拓扑、承载或包围关系、层级、外轮廓、视角或版式结构，禁止只换颜色和材质。所有变量替换后必须是完整、独立、可直接提交的中文生图提示词。

只返回一个合法 JSON：{"name":"不超过6个汉字的SOP名称","description":"一至两句话说明","sop":"完整的变量提示词生成 SOP"}。不要输出分析过程、变量提示词实例或具体生图提示词。`

const controllers = new Map<string, AbortController>()
const queuedTaskIds: string[] = []
let activeRuns = 0

function getControllerTask(taskId: string) {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  return task?.reverseSop?.role === 'controller' ? task : null
}

function isTerminal(stage: ReverseSopStage) {
  return stage === 'completed' || stage === 'error' || stage === 'stopped'
}

function createArtifactId(prefix: string, index: number) {
  return `${prefix}-${Date.now().toString(36)}-${index + 1}`
}

function getTemplatePromptCount(totalTemplates: number, templateIndex: number, totalPrompts: number) {
  const normalizedTemplates = Math.max(1, totalTemplates)
  const baseCount = Math.floor(totalPrompts / normalizedTemplates)
  const remainder = totalPrompts % normalizedTemplates
  return baseCount + (templateIndex < remainder ? 1 : 0)
}

function getTaskMetaInstruction(meta: ReverseSopControllerMeta) {
  const state = useRequirementPrototype.getState()
  const stored = meta.metaInstructionId
    ? state.sopMetaInstructions.find((item) => item.id === meta.metaInstructionId)
    : undefined
  return stored
    ?? resolveMetaInstructionForWorkspaceTab(meta.workspaceTabName, state.sopGroups, state.sopLibrary, state.sopMetaInstructions)
}

function assertReverseVariablePromptContract(content: string) {
  const parsed = parseVariablePrompt(content)
  if (!parsed.enabled) throw new Error(`变量提示词格式无效：${parsed.errors[0] ?? '无法解析变量定义'}`)
  if (parsed.variables.length < 10) throw new Error(`变量提示词需要至少 10 个可变项，当前只有 ${parsed.variables.length} 个`)
  const underfilled = parsed.variables.find((variable) => variable.options.length < 10)
  if (underfilled) throw new Error(`变量“${underfilled.name}”需要至少 10 个可用选项，当前只有 ${underfilled.options.length} 个`)
}

function updateController(taskId: string, patch: Partial<ReverseSopControllerMeta>, taskPatch: Partial<TaskRecord> = {}) {
  const task = getControllerTask(taskId)
  if (!task?.reverseSop || task.reverseSop.role !== 'controller') return
  const reverseSop: ReverseSopControllerMeta = { ...task.reverseSop, ...patch }
  void updateTaskInStore(taskId, {
    ...taskPatch,
    reverseSop,
    progressMessage: reverseSop.stageMessage,
    progressUpdatedAt: Date.now(),
  })
}

function setStage(taskId: string, stage: ReverseSopStage, message: string) {
  updateController(taskId, { stage, stageMessage: message }, { progressStage: stage === 'error' ? 'failed' : stage === 'stopped' ? 'stopped' : 'queued' })
}

async function loadInputImages(meta: ReverseSopControllerMeta): Promise<InputImage[]> {
  const images = await Promise.all(meta.sourceImageIds.map(async (id) => {
    const dataUrl = await ensureImageCached(id)
    return dataUrl ? { id, dataUrl } : null
  }))
  const valid = images.filter((image): image is InputImage => Boolean(image))
  if (valid.length !== meta.sourceImageIds.length) throw new Error('有参考图已不存在，无法继续反推 SOP')
  return valid
}

/**
 * Materialize one variable template and submit its image children immediately.
 * Image execution is already fire-and-forget inside submitTaskWithData; this
 * function only waits for task records to be persisted before the next text
 * template is requested, so the text and image pipelines overlap.
 */
async function materializeAndSubmitVariablePrompt(options: {
  taskId: string
  meta: ReverseSopControllerMeta
  variablePrompt: ReverseSopControllerMeta['variablePrompts'][number]
  templateIndex: number
  templateCount: number
  sourceImages: InputImage[]
  parentTask: TaskRecord
  targetTabId: string | null
  signal: AbortSignal
}) {
  const { taskId, meta, variablePrompt, templateIndex, templateCount, sourceImages, parentTask, targetTabId, signal } = options
  signal.throwIfAborted()
  const promptQuota = getTemplatePromptCount(templateCount, templateIndex, meta.promptCount)
  let current = getControllerTask(taskId)
  if (!current?.reverseSop || current.reverseSop.role !== 'controller') return

  let concretePrompts = current.reverseSop.concretePrompts.filter((item) => item.variablePromptId !== variablePrompt.id)
  const existingForTemplate = current.reverseSop.concretePrompts
    .filter((item) => item.variablePromptId === variablePrompt.id)
    .slice(0, promptQuota)
  if (existingForTemplate.length < promptQuota) {
    const rendered = renderVariablePromptBatch(
      variablePrompt.content,
      promptQuota,
      `${meta.runId}:${templateIndex}:${variablePrompt.name}`,
    )
    if (rendered.length < promptQuota) {
      throw new Error(`变量提示词“${variablePrompt.name}”展开不足：需要 ${promptQuota} 条，得到 ${rendered.length} 条`)
    }
    const generatedForTemplate = rendered.slice(0, promptQuota).map((text, index) => ({
      id: `${variablePrompt.id}-prompt-${index + 1}`,
      variablePromptId: variablePrompt.id,
      text,
    }))
    concretePrompts = [
      ...concretePrompts,
      ...generatedForTemplate,
    ]
  } else {
    concretePrompts = [
      ...concretePrompts,
      ...existingForTemplate,
    ]
  }
  // Keep a deterministic order: template order, then rendered prompt order.
  const variableOrder = new Map(current.reverseSop.variablePrompts.map((item, index) => [item.id, index]))
  concretePrompts.sort((left, right) => {
    const order = (variableOrder.get(left.variablePromptId) ?? 0) - (variableOrder.get(right.variablePromptId) ?? 0)
    return order || left.id.localeCompare(right.id)
  })
  updateController(taskId, { concretePrompts })

  current = getControllerTask(taskId)
  if (!current?.reverseSop || current.reverseSop.role !== 'controller') return
  const latestMeta = current.reverseSop
  const existingChildren = useStore.getState().tasks.filter((item) => item.reverseSop?.role === 'image' && item.reverseSop.runId === latestMeta.runId)
  const imageTaskIds = latestMeta.imageTaskIds.filter((id) => existingChildren.some((item) => item.id === id && (
    item.status === 'running' || item.falRecoverable || item.customRecoverable || item.outputImages.length > 0
  )))

  const templatePrompts = concretePrompts.filter((item) => item.variablePromptId === variablePrompt.id)
  for (const concretePrompt of templatePrompts) {
    signal.throwIfAborted()
    const existing = existingChildren.find((item) => item.reverseSop?.role === 'image' && item.reverseSop.concretePromptId === concretePrompt.id)
    if (existing && (existing.status === 'running' || existing.falRecoverable || existing.customRecoverable || existing.outputImages.length > 0)) {
      if (!imageTaskIds.includes(existing.id)) imageTaskIds.push(existing.id)
      continue
    }
    const imageTaskId = await submitTaskWithData({
      prompt: concretePrompt.text,
      inputImages: latestMeta.useReferenceImages ? sourceImages : [],
      inputImageFolder: null,
      params: { ...parentTask.params, n: latestMeta.imagesPerPrompt },
      maskDraft: null,
      targetTabId,
      scheduledOutputPath: parentTask.scheduledOutputPath,
      scheduledOutputSubFolder: parentTask.scheduledOutputSubFolder,
      reverseSop: {
        role: 'image',
        runId: latestMeta.runId,
        controllerTaskId: taskId,
        concretePromptId: concretePrompt.id,
        promptIndex: latestMeta.concretePrompts.findIndex((item) => item.id === concretePrompt.id) + 1,
      },
    }, { silentSuccess: true })
    if (!imageTaskId) throw new Error('生图任务提交失败，请检查图片 API 配置')
    imageTaskIds.push(imageTaskId)
    updateController(taskId, { imageTaskIds: [...imageTaskIds] })
  }
  updateController(taskId, {
    stageMessage: `已生成变量提示词 ${templateIndex + 1}/${templateCount}，已提交 ${imageTaskIds.length} 条生图任务，继续生成其余模板`,
  })
}

async function runReverseSopTask(taskId: string) {
  const controller = new AbortController()
  controllers.set(taskId, controller)
  try {
    let task = getControllerTask(taskId)
    if (!task?.reverseSop || task.reverseSop.role !== 'controller' || isTerminal(task.reverseSop.stage)) return
    const sourceImages = await loadInputImages(task.reverseSop)
    controller.signal.throwIfAborted()

    let meta = task.reverseSop
    if (!meta.sop) {
      setStage(taskId, 'reverse-sop', '正在分析参考图并反推变量提示词 SOP')
      const generated = await generateSopFromStore(
        meta.brief,
        { materialType: '参考图反推变量提示词 SOP', generationMode: 'reverse-sop' },
        sourceImages.map((image, index) => ({ name: `参考图 ${index + 1}`, dataUrl: image.dataUrl })),
        'general',
        REVERSE_SOP_META_INSTRUCTION,
        {
          signal: controller.signal,
          onProgress: (progress) => setStage(taskId, 'reverse-sop', progress.message),
        },
      )
      updateController(taskId, {
        sop: { name: generated.name, description: generated.description, content: generated.content },
      })
      task = getControllerTask(taskId)
      if (!task?.reverseSop || task.reverseSop.role !== 'controller') return
      meta = task.reverseSop
    }

    const templateCount = Math.min(MAX_VARIABLE_PROMPT_TEMPLATES, meta.promptCount)
    const parentTask = getControllerTask(taskId)
    if (!parentTask) return
    const currentState = useStore.getState()
    const targetTabId = currentState.workspaceTabs.find((tab) => tab.tasks.some((item) => item.id === taskId))?.id ?? currentState.activeWorkspaceTabId
    const selectedMetaInstruction = getTaskMetaInstruction(meta)
    const selectedMetaInstructionText = selectedMetaInstruction?.instruction?.trim() || APP_COPY_STRATEGY_SKILL_META_INSTRUCTION
    const selectedMetaInstructionName = selectedMetaInstruction?.name ?? '默认 APP 元指令'

    if (meta.variablePrompts.length < templateCount) {
      const variablePrompts = [...meta.variablePrompts]
      for (let index = variablePrompts.length; index < templateCount; index += 1) {
        controller.signal.throwIfAborted()
        setStage(taskId, 'generate-variable-prompts', `正在按「${selectedMetaInstructionName}」生成变量提示词 ${index + 1}/${templateCount}`)
        const existing = variablePrompts.map((item) => item.content).join('\n\n---\n\n')
        const generated = await generateSopFromStore(
          `${meta.brief}\n\n本次必须生成第 ${index + 1}/${templateCount} 套变量提示词。${existing ? '它必须与以下已有模板在固定结构骨架上明显不同：\n' + existing : ''}`,
          { materialType: '变量提示词模板', generationMode: 'reverse-sop-variable-prompt' },
          sourceImages.map((image, imageIndex) => ({ name: `参考图 ${imageIndex + 1}`, dataUrl: image.dataUrl })),
          'variable-prompt-skill',
          `${selectedMetaInstructionText}\n\n本次覆盖规则：主体、人物情境和已确认的主标题/副标题/卖点文案保持固定，不得生成 {{主体文案包}} 或其他文案变量；Logo、品牌资产、警示语、水印、二维码和合规小字继续忽略。\n\n必须严格执行以下已编译的反推 SOP：\n${meta.sop!.content}`,
          { signal: controller.signal, excludeText: false },
        )
        assertReverseVariablePromptContract(generated.content)
        const variablePrompt = {
          id: createArtifactId('variable', index),
          name: generated.name,
          description: generated.description,
          content: generated.content,
        }
        variablePrompts.push(variablePrompt)
        updateController(taskId, {
          variablePrompts: [...variablePrompts],
          metaInstructionId: selectedMetaInstruction?.id ?? meta.metaInstructionId,
          metaInstructionName: selectedMetaInstructionName,
        })
        // Do not wait for the remaining text templates. The image request is
        // queued by submitTaskWithData and starts independently in the store.
        await materializeAndSubmitVariablePrompt({
          taskId,
          meta: { ...meta, variablePrompts: [...variablePrompts] },
          variablePrompt,
          templateIndex: index,
          templateCount,
          sourceImages,
          parentTask,
          targetTabId,
          signal: controller.signal,
        })
        task = getControllerTask(taskId)
        if (!task?.reverseSop || task.reverseSop.role !== 'controller') return
        meta = task.reverseSop
      }
    }

    task = getControllerTask(taskId)
    if (!task?.reverseSop || task.reverseSop.role !== 'controller') return
    meta = task.reverseSop
    // Reconcile persisted runs (including runs created by the previous
    // all-at-once implementation) and submit any missing child tasks.
    for (let index = 0; index < meta.variablePrompts.length; index += 1) {
      controller.signal.throwIfAborted()
      const latest = getControllerTask(taskId)
      if (!latest?.reverseSop || latest.reverseSop.role !== 'controller') return
      await materializeAndSubmitVariablePrompt({
        taskId,
        meta: latest.reverseSop,
        variablePrompt: latest.reverseSop.variablePrompts[index],
        templateIndex: index,
        templateCount,
        sourceImages,
        parentTask,
        targetTabId,
        signal: controller.signal,
      })
    }
    task = getControllerTask(taskId)
    if (!task?.reverseSop || task.reverseSop.role !== 'controller') return
    meta = task.reverseSop
    setStage(taskId, 'generate-images', `变量提示词已全部生成，已提交 ${meta.imageTaskIds.length} 条生图任务，正在等待图片完成`)

    let completedTask = getControllerTask(taskId)
    if (!completedTask?.reverseSop || completedTask.reverseSop.role !== 'controller') return
    setStage(taskId, 'generate-images', `已提交 ${completedTask.reverseSop.imageTaskIds.length} 条提示词，正在等待图片完成`)
    while (true) {
      controller.signal.throwIfAborted()
      const latest = getControllerTask(taskId)
      if (!latest?.reverseSop || latest.reverseSop.role !== 'controller') return
      const latestMeta = latest.reverseSop
      const children = useStore.getState().tasks.filter((item) => latestMeta.imageTaskIds.includes(item.id))
      const outputImages = children.flatMap((item) => item.outputImages)
      updateController(taskId, { stageMessage: `图片生成中 ${outputImages.length}/${latestMeta.imageTaskIds.length * latestMeta.imagesPerPrompt}` })
      const pending = children.some((item) => item.status === 'running' || item.falRecoverable || item.customRecoverable)
      if (!pending && children.length >= latestMeta.imageTaskIds.length) {
        const failures = children.filter((item) => item.status === 'error' && item.outputImages.length === 0)
        if (failures.length > 0) throw new Error(`有 ${failures.length} 个生图子任务失败，请在任务卡中重试`)
        completedTask = getControllerTask(taskId)
        if (!completedTask?.reverseSop || completedTask.reverseSop.role !== 'controller') return
        setStage(taskId, 'completed', `流程完成，共生成 ${outputImages.length} 张图片`)
        updateController(taskId, {}, { status: 'done', error: null, finishedAt: Date.now(), elapsed: Date.now() - completedTask.createdAt })
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  } catch (error) {
    const current = getControllerTask(taskId)
    if (!current?.reverseSop || current.reverseSop.role !== 'controller') return
    if (controller.signal.aborted) {
      updateController(taskId, { stage: 'stopped', stageMessage: '任务已停止', stoppedAt: Date.now() }, {
        status: 'error', error: null, progressStage: 'stopped', finishedAt: Date.now(), elapsed: Date.now() - current.createdAt,
      })
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    updateController(taskId, { stage: 'error', failedStage: current.reverseSop.stage, stageMessage: message }, {
      status: 'error', error: message, progressStage: 'failed', finishedAt: Date.now(), elapsed: Date.now() - current.createdAt,
    })
  } finally {
    controllers.delete(taskId)
  }
}

function drainQueue() {
  while (activeRuns < MAX_CONCURRENT_REVERSE_SOP_RUNS && queuedTaskIds.length > 0) {
    const taskId = queuedTaskIds.shift()!
    if (controllers.has(taskId)) continue
    const task = getControllerTask(taskId)
    if (!task?.reverseSop || task.reverseSop.role !== 'controller' || isTerminal(task.reverseSop.stage)) continue
    activeRuns += 1
    void runReverseSopTask(taskId).finally(() => {
      activeRuns -= 1
      drainQueue()
    })
  }
}

export function startReverseSopTask(taskId: string) {
  if (!queuedTaskIds.includes(taskId) && !controllers.has(taskId)) queuedTaskIds.push(taskId)
  drainQueue()
}

export function stopReverseSopTask(taskId: string) {
  const queuedIndex = queuedTaskIds.indexOf(taskId)
  if (queuedIndex >= 0) queuedTaskIds.splice(queuedIndex, 1)
  const controller = controllers.get(taskId)
  if (controller) controller.abort(new DOMException('任务已停止', 'AbortError'))
  else {
    const task = getControllerTask(taskId)
    if (task?.reverseSop?.role === 'controller') {
      updateController(taskId, { stage: 'stopped', stageMessage: '任务已停止', stoppedAt: Date.now() }, {
        status: 'error', error: null, progressStage: 'stopped', finishedAt: Date.now(), elapsed: Date.now() - task.createdAt,
      })
    }
  }
}

export function retryReverseSopTask(taskId: string) {
  const task = getControllerTask(taskId)
  if (!task?.reverseSop || task.reverseSop.role !== 'controller') return
  const meta = task.reverseSop
  const failedStage = meta.failedStage ?? (meta.stage === 'error' ? 'reverse-sop' : meta.stage)
  const reset: Partial<ReverseSopControllerMeta> = failedStage === 'reverse-sop'
    ? { sop: undefined, variablePrompts: [], concretePrompts: [], imageTaskIds: [] }
    : failedStage === 'generate-variable-prompts'
      ? { variablePrompts: [], concretePrompts: [], imageTaskIds: [] }
      : failedStage === 'expand-variable-prompts'
        ? { concretePrompts: [], imageTaskIds: [] }
        : { imageTaskIds: [] }
  updateController(taskId, { ...reset, stage: 'queued', failedStage: undefined, stageMessage: '正在重新排队' }, {
    status: 'running', error: null, finishedAt: null, elapsed: null, progressStage: 'queued',
  })
  startReverseSopTask(taskId)
}

export function resumeReverseSopTasks() {
  const tasks = useStore.getState().tasks
  tasks.forEach((task) => {
    if (task.reverseSop?.role !== 'controller' || isTerminal(task.reverseSop.stage)) return
    if (task.reverseSop.stage === 'generate-images' && task.reverseSop.imageTaskIds.length > 0) {
      const children = tasks.filter((item) => task.reverseSop?.role === 'controller'
        ? task.reverseSop.imageTaskIds.includes(item.id)
        : false)
      // OpenAI image requests cannot be resumed after a renderer restart. The
      // parent keeps all prompt artifacts and safely recreates only failed
      // children, leaving successful children untouched.
      if (children.some((child) => child.status === 'error' && child.outputImages.length === 0)) {
        updateController(task.id, { imageTaskIds: [], stage: 'queued', stageMessage: '已恢复提示词，正在重新提交失败的图片任务' }, {
          status: 'running', error: null, finishedAt: null, elapsed: null,
        })
      }
    }
    startReverseSopTask(task.id)
  })
}
