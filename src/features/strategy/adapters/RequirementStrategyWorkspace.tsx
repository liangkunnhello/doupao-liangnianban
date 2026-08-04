import { useEffect, useMemo, useState } from 'react'
import {
  BookOpenCheckIcon as BookOpenCheck,
  CloseIcon as X,
  PlusIcon as Plus,
  Settings2Icon as Settings2,
  TrashIcon as Trash2,
} from '../../../design-system/icons'
import '../styles.css'
import { cacheImage, useStore } from '../../../store'
import { storeImage } from '../../../lib/db'
import { useRequirementPrototype } from '../../requirementPrototype/store'
import type {
  StrategyAsset,
  StrategyPreset,
  StrategyPresetType,
} from '../types'
import { normalizeStrategyAsset, presetLabel, strategyId } from '../model'
import StrategyEditor from '../StrategyEditor'
import StrategyGrid from '../StrategyGrid'
import StrategyTree, { type StrategyTreeSelection } from '../StrategyTree'
import SopManagementCenter from '../SopManagementCenter'
import StoreStrategyImage from './StoreStrategyImage'
import { generateSopFromStore } from './storeSopGeneration'
import { isModalBackdropEvent } from '../../../lib/modalBackdrop'

function PresetManager({
  presets,
  onSave,
  onArchive,
  onClose,
}: {
  presets: StrategyPreset[]
  onSave: (preset: StrategyPreset) => void
  onArchive: (presetId: string) => void
  onClose: () => void
}) {
  const sessionUserId = useRequirementPrototype((state) => state.sessionUserId)
  const [name, setName] = useState('')
  const [type, setType] = useState<StrategyPresetType>('export')
  const [description, setDescription] = useState('')
  const [value, setValue] = useState('')

  return (
    <div className="fixed inset-0 z-[var(--ds-z-overlay)] flex items-center justify-center bg-[hsl(var(--ds-color-scrim)/0.48)] p-4 animate-overlay-in" role="dialog" aria-modal="true" aria-label="全局策略预设管理" onMouseDown={(event) => {
      if (isModalBackdropEvent(event)) onClose()
    }}>
      <div className="ds-modal-surface animate-modal-in flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[hsl(var(--ds-color-border))]">
        <div className="flex items-center justify-between border-b border-[hsl(var(--ds-color-border))] px-5 py-4">
          <div>
            <h2 className="font-semibold">全局策略预设</h2>
            <p className="mt-1 text-xs text-gray-500">管理员添加后，所有策略师和用户都可使用。</p>
          </div>
          <button onClick={onClose} aria-label="关闭预设管理" className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg transition hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ds-color-focus))] dark:hover:bg-gray-800"><X size={17} /></button>
        </div>
        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1fr_360px] lg:overflow-hidden">
          <div className="min-h-0 overflow-y-auto p-5">
            <div className="space-y-2">
              {presets.filter((preset) => !preset.archived).map((preset) => (
                <div key={preset.id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><h3 className="truncate text-sm font-semibold">{preset.name}</h3><span className="rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{presetLabel(preset.type)}</span></div>
                      <p className="mt-1 text-xs leading-5 text-gray-500">{preset.description}</p>
                      <p className="mt-2 line-clamp-2 rounded-lg bg-gray-50 p-2 text-xs leading-4 text-gray-500 dark:bg-gray-950">{preset.value}</p>
                    </div>
                    <button onClick={() => onArchive(preset.id)} aria-label={`删除预设${preset.name}`} title="删除预设" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-gray-400 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-950/30"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-gray-200 bg-gray-50/70 p-5 dark:border-white/[0.08] dark:bg-black/20 lg:border-l lg:border-t-0">
            <h3 className="text-sm font-semibold">新增预设</h3>
            <div className="mt-4 space-y-3">
              <label className="block"><span className="mb-1 block text-xs text-gray-600 dark:text-gray-300">预设类型</span><select value={type} onChange={(event) => setType(event.target.value as StrategyPresetType)} className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900"><option value="export">渠道导出</option><option value="allocation">输出分配</option></select></label>
              <label className="block"><span className="mb-1 block text-xs text-gray-600 dark:text-gray-300">名称</span><input value={name} onChange={(event) => setName(event.target.value)} className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-blue-950" /></label>
              <label className="block"><span className="mb-1 block text-xs text-gray-600 dark:text-gray-300">说明</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-20 w-full rounded-lg border border-gray-300 bg-white p-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-blue-950" /></label>
              <label className="block"><span className="mb-1 block text-xs text-gray-600 dark:text-gray-300">预设内容</span><textarea value={value} onChange={(event) => setValue(event.target.value)} className="min-h-36 w-full rounded-lg border border-gray-300 bg-white p-3 text-sm leading-6 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-blue-950" /></label>
              <button
                disabled={!name.trim() || !value.trim()}
                onClick={() => {
                  onSave({
                    id: strategyId('preset'),
                    name: name.trim(),
                    type,
                    description: description.trim(),
                    value: value.trim(),
                    global: true,
                    createdBy: sessionUserId ?? 'user-admin',
                    createdAt: Date.now(),
                  })
                  setName('')
                  setDescription('')
                  setValue('')
                }}
                className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
              >
                <Plus size={15} />添加全局预设
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function StrategyWorkspace() {
  const sessionUserId = useRequirementPrototype((state) => state.sessionUserId)
  const users = useRequirementPrototype((state) => state.users)
  const catalog = useRequirementPrototype((state) => state.catalog)
  const storedStrategies = useRequirementPrototype((state) => state.strategyAssets)
  const presets = useRequirementPrototype((state) => state.strategyPresets)
  const sopGroups = useRequirementPrototype((state) => state.sopGroups)
  const sopLibrary = useRequirementPrototype((state) => state.sopLibrary)
  const sopMetaInstructions = useRequirementPrototype((state) => state.sopMetaInstructions)
  const strategyVersions = useRequirementPrototype((state) => state.strategyAssetVersions)
  const knowledgeBatches = useRequirementPrototype((state) => state.knowledgeBatches)
  const knowledgeInsights = useRequirementPrototype((state) => state.knowledgeInsights)
  const orders = useRequirementPrototype((state) => state.orders)
  const saveProduct = useRequirementPrototype((state) => state.saveProduct)
  const saveMaterialType = useRequirementPrototype((state) => state.saveMaterialType)
  const saveStrategy = useRequirementPrototype((state) => state.saveStrategyAsset)
  const createStrategy = useRequirementPrototype((state) => state.createStrategyAsset)
  const duplicateStrategy = useRequirementPrototype((state) => state.duplicateStrategyAsset)
  const moveStrategy = useRequirementPrototype((state) => state.moveStrategyAsset)
  const archiveStrategy = useRequirementPrototype((state) => state.archiveStrategyAsset)
  const rollbackStrategy = useRequirementPrototype((state) => state.rollbackStrategyAsset)
  const createTest = useRequirementPrototype((state) => state.createStrategyWorkflowTest)
  const savePreset = useRequirementPrototype((state) => state.saveStrategyPreset)
  const archivePreset = useRequirementPrototype((state) => state.archiveStrategyPreset)
  const saveSopGroup = useRequirementPrototype((state) => state.saveSopGroup)
  const duplicateSopGroup = useRequirementPrototype((state) => state.duplicateSopGroup)
  const deleteSopGroup = useRequirementPrototype((state) => state.deleteSopGroup)
  const saveSopItem = useRequirementPrototype((state) => state.saveSopItem)
  const duplicateSopItem = useRequirementPrototype((state) => state.duplicateSopItem)
  const deleteSopItem = useRequirementPrototype((state) => state.deleteSopItem)
  const saveSopMetaInstruction = useRequirementPrototype((state) => state.saveSopMetaInstruction)
  const duplicateSopMetaInstruction = useRequirementPrototype((state) => state.duplicateSopMetaInstruction)
  const deleteSopMetaInstruction = useRequirementPrototype((state) => state.deleteSopMetaInstruction)
  const tasks = useStore((state) => state.tasks)
  const user = users.find((item) => item.id === sessionUserId)
  const strategies = useMemo(() => storedStrategies.map((strategy) => normalizeStrategyAsset(strategy)), [storedStrategies])
  const activeStrategies = strategies.filter((item) => !item.archived)
  const firstStrategy = activeStrategies[0]
  const [selection, setSelection] = useState<StrategyTreeSelection>(() => firstStrategy ? {
    kind: 'strategy',
    productId: firstStrategy.productId,
    materialTypeId: firstStrategy.materialTypeId,
    strategyId: firstStrategy.id,
  } : { kind: 'all' })
  const [clipboardStrategyId, setClipboardStrategyId] = useState('')
  const [showPresetManager, setShowPresetManager] = useState(false)
  const [showSopCenter, setShowSopCenter] = useState(false)

  const selectedStrategyId = selection.kind === 'strategy' ? selection.strategyId : undefined
  const selectedStrategy = activeStrategies.find((item) => item.id === selectedStrategyId)
  const visibleStrategies = activeStrategies.filter((strategy) => {
    if (selection.kind === 'all') return true
    if (selection.kind === 'product') return strategy.productId === selection.productId
    if (selection.kind === 'type') return strategy.productId === selection.productId && strategy.materialTypeId === selection.materialTypeId
    return strategy.productId === selection.productId && strategy.materialTypeId === selection.materialTypeId
  })
  const testOrders = orders
    .filter((order) => order.isTest && order.strategyId === selectedStrategyId && (user?.role === 'admin' || order.createdBy === sessionUserId))
    .sort((left, right) => right.createdAt - left.createdAt)
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const generatedImageIds = testOrders.flatMap((order) => order.units.flatMap((unit) => unit.taskId ? taskById.get(unit.taskId)?.outputImages ?? [] : []))

  const targetHierarchy = () => {
    if (selection.kind === 'type' || selection.kind === 'strategy') return { productId: selection.productId, materialTypeId: selection.materialTypeId }
    if (selection.kind === 'product') return { productId: selection.productId, materialTypeId: catalog.materialTypes.find((item) => !item.archived)?.id ?? '' }
    return {
      productId: catalog.products.find((item) => !item.archived)?.id ?? '',
      materialTypeId: catalog.materialTypes.find((item) => !item.archived)?.id ?? '',
    }
  }
  const handleCreate = () => {
    const target = targetHierarchy()
    if (!target.productId || !target.materialTypeId) return
    const createdId = createStrategy(target.productId, target.materialTypeId)
    if (createdId) setSelection({ kind: 'strategy', ...target, strategyId: createdId })
  }
  const handlePaste = () => {
    if (!clipboardStrategyId) return
    const target = targetHierarchy()
    const createdId = duplicateStrategy(clipboardStrategyId, target.productId, target.materialTypeId)
    if (createdId) setSelection({ kind: 'strategy', ...target, strategyId: createdId })
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'c' && selectedStrategyId) {
        event.preventDefault()
        setClipboardStrategyId(selectedStrategyId)
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'v' && clipboardStrategyId) {
        event.preventDefault()
        handlePaste()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [clipboardStrategyId, selectedStrategyId, selection])

  const importLocalImages = async (multiple = false) => {
    const api = window.electronAPI
    if (!api?.readImageFile) return []
    const paths = multiple
      ? await api.selectFiles?.([{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }])
      : [await api.selectFile?.([{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }])]
    const validPaths = (paths ?? []).filter((path): path is string => Boolean(path))
    const imageIds: string[] = []
    for (const path of validPaths) {
      const image = await api.readImageFile(path)
      if (!image) continue
      const imageId = await storeImage(image.dataUrl, 'upload')
      cacheImage(imageId, image.dataUrl)
      imageIds.push(imageId)
    }
    return imageIds
  }

  const pickKnowledgeMaterial = async (batchId: string) => {
    const batch = knowledgeBatches.find((item) => item.id === batchId)
    const api = window.electronAPI
    if (!batch || !api?.readImageFile) return []
    const files = api.listCompositeBackgroundFiles
      ? await api.listCompositeBackgroundFiles(batch.folderPath, true)
      : await api.listImageFiles(batch.folderPath)
    const imageIds: string[] = []
    for (const file of files.slice(0, 4)) {
      const image = await api.readImageFile(file.path)
      if (!image) continue
      const imageId = await storeImage(image.dataUrl, 'upload')
      cacheImage(imageId, image.dataUrl)
      imageIds.push(imageId)
    }
    return imageIds
  }

  return (
    <div className="relative h-[calc(100vh-64px)] min-h-[620px] w-full overflow-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="strategy-workspace-grid grid h-full min-h-0 w-full">
        <StrategyTree
          catalog={catalog}
          strategies={activeStrategies}
          selection={selection}
          onSelect={setSelection}
          onRenameProduct={(id, name) => {
            const product = catalog.products.find((item) => item.id === id)
            if (product) saveProduct({ ...product, name, version: product.version + 1 })
          }}
          onRenameType={(id, name) => {
            const materialType = catalog.materialTypes.find((item) => item.id === id)
            if (materialType) saveMaterialType({ ...materialType, name, version: materialType.version + 1 })
          }}
          onRenameStrategy={(id, name) => {
            const strategy = activeStrategies.find((item) => item.id === id)
            if (strategy) saveStrategy({ ...strategy, name })
          }}
          onCreateStrategy={(productId, materialTypeId) => {
            const createdId = createStrategy(productId, materialTypeId)
            if (createdId) setSelection({ kind: 'strategy', productId, materialTypeId, strategyId: createdId })
          }}
          onMoveStrategy={(strategyIdToMove, productId, materialTypeId) => {
            moveStrategy(strategyIdToMove, productId, materialTypeId)
            setSelection({ kind: 'strategy', productId, materialTypeId, strategyId: strategyIdToMove })
          }}
        />
        <div className="relative min-w-0">
          <StrategyGrid
            catalog={catalog}
            strategies={visibleStrategies}
            selectedStrategyId={selectedStrategyId}
            orders={orders.filter((order) => user?.role === 'admin' || order.createdBy === sessionUserId)}
            tasks={tasks}
            ImageComponent={StoreStrategyImage}
            canPaste={Boolean(clipboardStrategyId)}
            headerActions={<>
              <button
                type="button"
                onClick={() => setShowSopCenter(true)}
                className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-gray-200/80 bg-white px-3 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]"
              >
                <BookOpenCheck size={14} className="text-violet-500" />SOP 库
              </button>
              {user?.role === 'admin' && (
                <button
                  type="button"
                  onClick={() => setShowPresetManager(true)}
                  className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-gray-200/80 bg-white px-3 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.08]"
                >
                  <Settings2 size={14} />输出预设
                </button>
              )}
            </>}
            onSelectStrategy={(strategyIdToSelect) => {
              const strategy = activeStrategies.find((item) => item.id === strategyIdToSelect)
              if (strategy) setSelection({ kind: 'strategy', productId: strategy.productId, materialTypeId: strategy.materialTypeId, strategyId: strategy.id })
            }}
            onCreate={handleCreate}
            onRename={(id, name) => {
              const strategy = activeStrategies.find((item) => item.id === id)
              if (strategy) saveStrategy({ ...strategy, name })
            }}
            onCopy={setClipboardStrategyId}
            onPaste={handlePaste}
            onArchive={(id) => {
              archiveStrategy(id)
              if (id === selectedStrategyId) setSelection({ kind: 'all' })
            }}
            onChangeCover={(id, imageId) => {
              const strategy = activeStrategies.find((item) => item.id === id)
              if (strategy) saveStrategy({ ...strategy, coverImageId: imageId })
            }}
            onPickLocalCover={async (id) => {
              const [imageId] = await importLocalImages(false)
              const strategy = activeStrategies.find((item) => item.id === id)
              if (strategy && imageId) saveStrategy({ ...strategy, coverImageId: imageId })
            }}
            onSavePromptOverride={(id, imageId, prompt) => {
              const strategy = activeStrategies.find((item) => item.id === id)
              if (strategy) saveStrategy({ ...strategy, resultPromptOverrides: { ...strategy.resultPromptOverrides, [imageId]: prompt } })
            }}
            onReusePrompt={(id, prompt) => {
              const strategy = activeStrategies.find((item) => item.id === id)
              if (strategy) {
                saveStrategy({ ...strategy, workflow: { ...strategy.workflow, instruction: prompt }, status: 'draft' })
                setSelection({ kind: 'strategy', productId: strategy.productId, materialTypeId: strategy.materialTypeId, strategyId: strategy.id })
              }
            }}
          />
        </div>
        <StrategyEditor
          strategy={selectedStrategy}
          catalog={catalog}
          presets={presets}
          sopItems={sopLibrary}
          sopGroups={sopGroups}
          versions={selectedStrategyId ? strategyVersions[selectedStrategyId] ?? [] : []}
          knowledgeBatches={knowledgeBatches}
          knowledgeInsights={knowledgeInsights}
          generatedImageIds={generatedImageIds}
          testOrders={testOrders}
          role={user?.role ?? 'strategist'}
          onSave={saveStrategy}
          onTest={(strategyIdToTest, quantity) => createTest(strategyIdToTest, quantity)}
          onPickLocalReference={() => importLocalImages(true)}
          onPickKnowledgeMaterial={pickKnowledgeMaterial}
          onRollback={(version) => selectedStrategyId && rollbackStrategy(selectedStrategyId, version)}
        />
      </div>
      {showPresetManager && <PresetManager presets={presets.filter((preset) => preset.type !== 'sop')} onSave={savePreset} onArchive={archivePreset} onClose={() => setShowPresetManager(false)} />}
      {showSopCenter && <SopManagementCenter
        groups={sopGroups}
        items={sopLibrary}
        tasks={tasks}
        metaInstructions={sopMetaInstructions}
        currentUserId={sessionUserId ?? 'user-admin'}
        onSaveGroup={saveSopGroup}
        onDuplicateGroup={duplicateSopGroup}
        onDeleteGroup={deleteSopGroup}
        onSaveItem={saveSopItem}
        onDuplicateItem={duplicateSopItem}
        onDeleteItem={deleteSopItem}
        onSaveMetaInstruction={saveSopMetaInstruction}
        onDuplicateMetaInstruction={duplicateSopMetaInstruction}
        onDeleteMetaInstruction={deleteSopMetaInstruction}
        onGenerateSop={generateSopFromStore}
        onClose={() => setShowSopCenter(false)}
      />}
    </div>
  )
}
