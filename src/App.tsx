import React, { useEffect, useRef } from 'react'
import { initStore, exportDataToPath } from './store'
import { useStore } from './store'
import { buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { mergeImportedSettings } from './lib/apiProfiles'
import { getCustomProviderConfigUrl, loadCustomProviderSettingsFromUrl } from './lib/customProviderConfigUrl'
import { isElectron as isElectronEnv, getDesktopPath, getBackupList, restoreFromBackupFile, checkBackupHasData } from './lib/localSave'
import { applyThemeMode } from './lib/theme'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import ConfirmDialog from './components/ConfirmDialog'
import PromptInputDialog from './components/PromptInputDialog'
import Toast from './components/Toast'
import ImageContextMenu from './components/ImageContextMenu'
import WordLibrarySidebar from './components/WordLibrarySidebar'
import ErrorBoundary from './components/ErrorBoundary'
import VarEntryEditor from './components/VarEntryEditor'
import WorkspaceTabBar from './components/WorkspaceTabBar'
const AgentWorkspace = React.lazy(() => import('./components/AgentWorkspace'))
const PostprocessWorkspace = React.lazy(() => import('./components/PostprocessWorkspace'))
const DetailModal = React.lazy(() => import('./components/DetailModal'))
const Lightbox = React.lazy(() => import('./components/Lightbox'))
const SettingsModal = React.lazy(() => import('./components/SettingsModal'))
const MaskEditorModal = React.lazy(() => import('./components/MaskEditorModal'))
const SupportPromptModal = React.lazy(() => import('./components/SupportPromptModal'))
const FavoriteCollectionPickerModal = React.lazy(() => import('./components/FavoriteCollections').then(m => ({ default: m.FavoriteCollectionPickerModal })))
const FavoriteCollectionsView = React.lazy(() => import('./components/FavoriteCollections').then(m => ({ default: m.FavoriteCollectionsView })))
const ManageCollectionsModal = React.lazy(() => import('./components/FavoriteCollections').then(m => ({ default: m.ManageCollectionsModal })))
const RandomPromptModal = React.lazy(() => import('./components/RandomPromptModal'))
const ScheduleModal = React.lazy(() => import('./components/ScheduleModal'))
const ScheduleRunner = React.lazy(() => import('./components/ScheduleRunner'))
const WorkspaceTabManagerModal = React.lazy(() => import('./components/WorkspaceTabManagerModal'))
const UpdateReleaseNotesModal = React.lazy(() => import('./components/UpdateReleaseNotesModal'))
import { useGlobalClickSuppression } from './lib/clickSuppression'

let customProviderConfigUrlImportStarted = false

export default function App() {
  const appMode = useStore((s) => s.appMode)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const themeMode = useStore((s) => s.settings.themeMode)
  const themeAppliedRef = useRef(false)
  useGlobalClickSuppression()

  useEffect(() => {
    applyThemeMode(themeMode, document.documentElement, { transition: themeAppliedRef.current })
    themeAppliedRef.current = true
  }, [themeMode])

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const nextSettings = buildSettingsFromUrlParams(useStore.getState().settings, searchParams)

    useStore.getState().setSettings(nextSettings)

    if (hasUrlSettingParams(searchParams)) {
      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    const customProviderConfigUrl = getCustomProviderConfigUrl()
    if (customProviderConfigUrl && !customProviderConfigUrlImportStarted) {
      customProviderConfigUrlImportStarted = true
      void loadCustomProviderSettingsFromUrl(customProviderConfigUrl)
        .then((importedSettings) => {
          if (!importedSettings) return
          const state = useStore.getState()
          state.setSettings(mergeImportedSettings(state.settings, importedSettings))
        })
        .catch((error) => {
          console.warn('Failed to import custom provider config URL:', error)
        })
    }

    // Guard against double invocation in StrictMode or hot reload
    if (!(window as unknown as Record<string, unknown>).__storeInitialized) {
      (window as unknown as Record<string, unknown>).__storeInitialized = true
      initStore().catch((error) => {
        console.error('Store initialization failed:', error)
        useStore.getState().showToast(`启动数据加载失败：${error instanceof Error ? error.message : String(error)}`, 'error')
      })
    }

    // 首次使用备份提醒
    const state = useStore.getState()
    const MAX_BACKUP_REMINDERS = 3
    if (isElectronEnv() && !state.firstBackupReminderShown && state.backupReminderCount < MAX_BACKUP_REMINDERS && state.tasks.length === 0 && state.agentConversations.length === 0) {
      getBackupList().then(async (backups) => {
        let hasUsableBackup = false
        let usableBackupPath = ''
        for (const bp of backups) {
          if (await checkBackupHasData(bp)) {
            hasUsableBackup = true
            usableBackupPath = bp
            break
          }
        }
        if (hasUsableBackup) {
          const fileName = usableBackupPath.split(/[\\/]/).pop() || usableBackupPath
          const match = fileName.match(/-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-\d+\.json$/)
          const displayDate = match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}` : fileName
          useStore.getState().setConfirmDialog({
            title: '检测到备份',
            message: `应用数据为空，检测到可用的自动备份（${displayDate}）。是否从该备份恢复？`,
            confirmText: '恢复',
            cancelText: '忽略',
            action: async () => {
              const success = await restoreFromBackupFile(usableBackupPath)
              if (success) {
                useStore.getState().setFirstBackupReminderShown(true)
                useStore.getState().showToast('备份已恢复，请刷新页面以生效', 'success')
              } else {
                useStore.getState().showToast('恢复备份失败', 'error')
                const nextCount = useStore.getState().backupReminderCount + 1
                useStore.getState().setBackupReminderCount(nextCount)
                if (nextCount >= MAX_BACKUP_REMINDERS) {
                  useStore.getState().setFirstBackupReminderShown(true)
                }
              }
            },
          })
        } else {
          const nextCount = useStore.getState().backupReminderCount + 1
          useStore.getState().setBackupReminderCount(nextCount)
          if (nextCount >= MAX_BACKUP_REMINDERS) {
            useStore.getState().setFirstBackupReminderShown(true)
          }
          useStore.getState().setConfirmDialog({
            title: '建议备份',
            message: '首次使用建议立即备份数据，以便在需要时恢复。是否现在备份到桌面？',
            confirmText: '备份到桌面',
            cancelText: '稍后再说',
            action: async () => {
              const desktop = await getDesktopPath()
              if (!desktop) {
                useStore.getState().showToast('无法获取桌面路径', 'error')
                return
              }
              const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
              const bkFileName = `doupao_backup_${ts}.zip`
              const filePath = desktop.replace(/\\/g, '/') + '/' + bkFileName
              useStore.getState().showToast('正在生成备份...', 'info')
              const success = await exportDataToPath(filePath, { exportConfig: true, exportTasks: true, exportWordLibrary: true })
              if (success) {
                useStore.getState().showToast(`备份已保存到桌面：${bkFileName}`, 'success')
              } else {
                useStore.getState().showToast('备份保存失败', 'error')
              }
            },
          })
        }
      })
    }

    // 每周自动备份
    if (isElectronEnv()) {
      const lastBackup = state.lastAutoBackupAt
      const oneWeek = 7 * 24 * 60 * 60 * 1000
      if (Date.now() - lastBackup >= oneWeek) {
        getDesktopPath().then((desktop) => {
          if (!desktop) return
          const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
          const fileName = `doupao_backup_${ts}.zip`
          const filePath = desktop.replace(/\\/g, '/') + '/' + fileName
          exportDataToPath(filePath, { exportConfig: true, exportTasks: true, exportWordLibrary: true }).then((success) => {
            if (success) {
              useStore.getState().setLastAutoBackupAt(Date.now())
              useStore.getState().showToast('每周自动备份已保存到桌面', 'success')
            }
          })
        })
      }
    }
  }, [])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  return (
    <ErrorBoundary>
      <WorkspaceTabBar />
      <div className={appMode === 'postprocess' ? '' : 'app-shell-with-docked-panels'}>
        <Header />
        {appMode === 'agent' ? (
          <React.Suspense fallback={null}><AgentWorkspace /></React.Suspense>
        ) : appMode === 'postprocess' ? (
          <React.Suspense fallback={null}><PostprocessWorkspace /></React.Suspense>
        ) : (
          <main data-home-main data-drag-select-surface className="pb-48">
            <div className="safe-area-x max-w-7xl mx-auto">
              <SearchBar />
              {filterFavorite && <FavoriteCollectionsView />}
              <TaskGrid />
            </div>
          </main>
        )}
        {appMode !== 'postprocess' && <InputBar />}
      <React.Suspense fallback={null}>
      <DetailModal />
      <Lightbox />
      <SettingsModal />
      <ConfirmDialog />
      <PromptInputDialog />
      <SupportPromptModal />
      <FavoriteCollectionPickerModal />
      <ManageCollectionsModal />
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
      {appMode !== 'postprocess' && <WordLibrarySidebar />}
      <VarEntryEditor />
      <RandomPromptModal />
      <ScheduleModal />
      <ScheduleRunner />
      <WorkspaceTabManagerModal />
      <UpdateReleaseNotesModal />
      </React.Suspense>
      </div>
    </ErrorBoundary>
  )
}
