import type { AgentConversation, SopBatchSnapshot, TaskRecord, StoredCompositeAsset, StoredImage, StoredImageThumbnail, WordGenerationBatch, WordLibraryEntry, WordLibraryGroup } from '../types'
import { deleteRawCacheImages, isElectron, saveRawCacheImageToLocal } from './localSave'
import type { MigrationJournal } from './migrations/registry'

const DB_NAME = 'gpt-image-playground'
const DB_VERSION = 7
const STORE_TASKS = 'tasks'
const STORE_IMAGES = 'images'
const STORE_THUMBNAILS = 'thumbnails'
const STORE_AGENT_CONVERSATIONS = 'agentConversations'
const STORE_WORD_LIBRARY = 'wordLibrary'
const STORE_COMPOSITE_ASSETS = 'compositeAssets'
const STORE_META = 'meta'
const STORE_SOP_BATCH_SNAPSHOTS = 'sopBatchSnapshots'
const THUMBNAIL_MAX_SIZE = 512
const THUMBNAIL_QUALITY = 0.82
const THUMBNAIL_VERSION = 3

export const CURRENT_THUMBNAIL_VERSION = THUMBNAIL_VERSION

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_TASKS)) {
        db.createObjectStore(STORE_TASKS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_THUMBNAILS)) {
        db.createObjectStore(STORE_THUMBNAILS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_AGENT_CONVERSATIONS)) {
        db.createObjectStore(STORE_AGENT_CONVERSATIONS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_WORD_LIBRARY)) {
        db.createObjectStore(STORE_WORD_LIBRARY, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_COMPOSITE_ASSETS)) {
        db.createObjectStore(STORE_COMPOSITE_ASSETS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_SOP_BATCH_SNAPSHOTS)) {
        db.createObjectStore(STORE_SOP_BATCH_SNAPSHOTS, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function dbTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode)
        const store = tx.objectStore(storeName)
        const req = fn(store)
        if (mode === 'readonly') {
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
          return
        }

        let result: T
        req.onsuccess = () => {
          result = req.result
        }
        req.onerror = () => reject(req.error)
        tx.oncomplete = () => resolve(result)
        tx.onerror = () => reject(tx.error ?? req.error)
        tx.onabort = () => reject(tx.error ?? req.error ?? new Error('IndexedDB transaction aborted'))
      }),
  )
}

export function getMigrationJournal(id: string): Promise<MigrationJournal | undefined> {
  return dbTransaction(STORE_META, 'readonly', (store) => store.get(id))
}

export async function putMigrationJournal(record: MigrationJournal): Promise<void> {
  await dbTransaction(STORE_META, 'readwrite', (store) => store.put(record))
}

// ===== Tasks =====

export function getAllTasks(): Promise<TaskRecord[]> {
  return dbTransaction(STORE_TASKS, 'readonly', (s) => s.getAll())
}

export function loadTasksIncrementally(
  migrate: (task: TaskRecord) => TaskRecord,
): Promise<TaskRecord[]> {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TASKS, 'readwrite')
    const request = tx.objectStore(STORE_TASKS).openCursor()
    const tasks: TaskRecord[] = []
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const original = cursor.value as TaskRecord
      const migrated = migrate(original)
      tasks.push(migrated)
      if (migrated !== original) cursor.update(migrated)
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => resolve(tasks)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB task migration aborted'))
  }))
}

export function putTask(task: TaskRecord): Promise<IDBValidKey> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.put(task))
}

export function deleteTask(id: string): Promise<undefined> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.delete(id))
}

export function clearTasks(): Promise<undefined> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.clear())
}

// ===== SOP batch snapshots =====

export function getSopBatchSnapshot(id: string): Promise<SopBatchSnapshot | undefined> {
  return dbTransaction(STORE_SOP_BATCH_SNAPSHOTS, 'readonly', (store) => store.get(id))
}

export function getAllSopBatchSnapshots(): Promise<SopBatchSnapshot[]> {
  return dbTransaction(STORE_SOP_BATCH_SNAPSHOTS, 'readonly', (store) => store.getAll())
}

export function putSopBatchSnapshot(snapshot: SopBatchSnapshot): Promise<IDBValidKey> {
  return dbTransaction(STORE_SOP_BATCH_SNAPSHOTS, 'readwrite', (store) => store.put(snapshot))
}

export function deleteSopBatchSnapshot(id: string): Promise<undefined> {
  return dbTransaction(STORE_SOP_BATCH_SNAPSHOTS, 'readwrite', (store) => store.delete(id))
}

export function clearSopBatchSnapshots(): Promise<undefined> {
  return dbTransaction(STORE_SOP_BATCH_SNAPSHOTS, 'readwrite', (store) => store.clear())
}

// ===== Agent conversations =====

export function getAllAgentConversations(): Promise<AgentConversation[]> {
  return dbTransaction(STORE_AGENT_CONVERSATIONS, 'readonly', (s) => s.getAll())
}

export function putAgentConversation(conversation: AgentConversation): Promise<IDBValidKey> {
  return dbTransaction(STORE_AGENT_CONVERSATIONS, 'readwrite', (s) => s.put(conversation))
}

export function deleteAgentConversation(id: string): Promise<undefined> {
  return dbTransaction(STORE_AGENT_CONVERSATIONS, 'readwrite', (s) => s.delete(id))
}

export function clearAgentConversations(): Promise<undefined> {
  return dbTransaction(STORE_AGENT_CONVERSATIONS, 'readwrite', (s) => s.clear())
}

export function replaceAgentConversations(conversations: AgentConversation[]): Promise<undefined> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_AGENT_CONVERSATIONS, 'readwrite')
        const store = tx.objectStore(STORE_AGENT_CONVERSATIONS)
        store.clear()
        for (const conversation of conversations) store.put(conversation)
        tx.oncomplete = () => resolve(undefined)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

// ===== Word library =====

export type StoredWordLibraryState = {
  id: 'word-library'
  groups: WordLibraryGroup[]
  entries: WordLibraryEntry[]
  batches?: WordGenerationBatch[]
  updatedAt: number
}

export function getWordLibraryState(): Promise<StoredWordLibraryState | undefined> {
  return dbTransaction(STORE_WORD_LIBRARY, 'readonly', (s) => s.get('word-library'))
}

export function putWordLibraryState(state: Omit<StoredWordLibraryState, 'id' | 'updatedAt'>): Promise<IDBValidKey> {
  return dbTransaction(STORE_WORD_LIBRARY, 'readwrite', (s) => s.put({
    id: 'word-library',
    groups: state.groups,
    entries: state.entries,
    batches: state.batches ?? [],
    updatedAt: Date.now(),
  }))
}

// ===== Composite assets =====

export function getCompositeAsset(id: string): Promise<StoredCompositeAsset | undefined> {
  return dbTransaction(STORE_COMPOSITE_ASSETS, 'readonly', (s) => s.get(id))
}

export function putCompositeAsset(asset: StoredCompositeAsset): Promise<IDBValidKey> {
  return dbTransaction(STORE_COMPOSITE_ASSETS, 'readwrite', (s) => s.put(asset))
}

export function deleteCompositeAsset(id: string): Promise<undefined> {
  return dbTransaction(STORE_COMPOSITE_ASSETS, 'readwrite', (s) => s.delete(id))
}

export function batchGetCompositeAssets(ids: string[]): Promise<Map<string, StoredCompositeAsset>> {
  if (ids.length === 0) return Promise.resolve(new Map())
  const uniqueIds = Array.from(new Set(ids))
  return openDB().then((db) => new Promise((resolve, reject) => {
    const store = db.transaction(STORE_COMPOSITE_ASSETS, 'readonly').objectStore(STORE_COMPOSITE_ASSETS)
    const result = new Map<string, StoredCompositeAsset>()
    let pending = uniqueIds.length
    for (const id of uniqueIds) {
      const req = store.get(id)
      req.onsuccess = () => {
        if (req.result) result.set(id, req.result as StoredCompositeAsset)
        if (--pending === 0) resolve(result)
      }
      req.onerror = () => reject(req.error)
    }
  }))
}

export function putCompositeAssets(assets: StoredCompositeAsset[]): Promise<void> {
  if (assets.length === 0) return Promise.resolve()
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_COMPOSITE_ASSETS, 'readwrite')
    const store = tx.objectStore(STORE_COMPOSITE_ASSETS)
    for (const asset of assets) store.put(asset)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  }))
}

// ===== Images =====

export function getImage(id: string): Promise<StoredImage | undefined> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.get(id))
}

export function getStoredImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  return dbTransaction(STORE_THUMBNAILS, 'readonly', (s) => s.get(id))
}

export async function getStoredFreshImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  const thumbnail = await getStoredImageThumbnail(id)
  return thumbnail?.thumbnailVersion === THUMBNAIL_VERSION ? thumbnail : undefined
}

export function putImageThumbnail(thumbnail: StoredImageThumbnail): Promise<IDBValidKey> {
  return dbTransaction(STORE_THUMBNAILS, 'readwrite', (s) => s.put(thumbnail))
}

export async function getImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  const existingThumbnail = await getStoredImageThumbnail(id)
  if (existingThumbnail?.thumbnailVersion === THUMBNAIL_VERSION) {
    const image = await getImage(id)
    if (image && (!image.width || !image.height) && existingThumbnail.width && existingThumbnail.height) {
      await putImage({ ...image, width: existingThumbnail.width, height: existingThumbnail.height })
    }
    return existingThumbnail
  }

  const image = await getImage(id)
  if (!image) return undefined
  const legacyImage = image as StoredImage & Partial<StoredImageThumbnail>
  if (legacyImage.thumbnailDataUrl && legacyImage.thumbnailVersion === THUMBNAIL_VERSION) {
    const thumbnail: StoredImageThumbnail = {
      id,
      thumbnailDataUrl: legacyImage.thumbnailDataUrl,
      width: legacyImage.width,
      height: legacyImage.height,
      thumbnailVersion: THUMBNAIL_VERSION,
    }
    await putImageThumbnail(thumbnail)
    if ((!image.width || !image.height) && thumbnail.width && thumbnail.height) {
      await putImage({ ...image, width: thumbnail.width, height: thumbnail.height })
    }
    return thumbnail
  }

  // Fallback to reading actual image data if localPath is used instead of dataUrl
  let dataUrlToHash = image.dataUrl
  if (!dataUrlToHash && image.localPath && isElectron()) {
    try {
      const fileResult = await window.electronAPI?.readFileBuffer(image.localPath)
      if (fileResult) {
        const mime = fileResult.name.endsWith('webp') ? 'image/webp' : fileResult.name.endsWith('jpg') || fileResult.name.endsWith('jpeg') ? 'image/jpeg' : 'image/png'
        const blob = new Blob([fileResult.data], { type: mime })
        dataUrlToHash = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.readAsDataURL(blob)
        })
      }
    } catch (e) {
      console.error('Failed to read local file for thumbnail generation:', e)
    }
  }

  if (!dataUrlToHash) return undefined

  const metadata = await safeCreateImageThumbnail(dataUrlToHash)
  if (!metadata.thumbnailDataUrl) return undefined
  const thumbnail: StoredImageThumbnail = {
    id,
    thumbnailDataUrl: metadata.thumbnailDataUrl,
    width: metadata.width,
    height: metadata.height,
    thumbnailVersion: THUMBNAIL_VERSION,
  }
  await putImageThumbnail(thumbnail)
  if (metadata.width && metadata.height && (image.width !== metadata.width || image.height !== metadata.height)) {
    await putImage({ ...image, width: metadata.width, height: metadata.height })
  }
  return thumbnail
}

export function getAllImages(): Promise<StoredImage[]> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.getAll())
}

export function getAllImageIds(): Promise<string[]> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.getAllKeys()).then((keys) =>
    keys.map(String),
  )
}

export function getLegacyImageBatch(limit: number): Promise<StoredImage[]> {
  if (limit <= 0) return Promise.resolve([])
  return openDB().then((db) => new Promise((resolve, reject) => {
    const request = db.transaction(STORE_IMAGES, 'readonly').objectStore(STORE_IMAGES).openCursor()
    const images: StoredImage[] = []
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve(images)
        return
      }
      const image = cursor.value as StoredImage
      if (image.dataUrl && !image.localPath) images.push(image)
      if (images.length >= limit) resolve(images)
      else cursor.continue()
    }
    request.onerror = () => reject(request.error)
  }))
}

export function putImage(image: StoredImage): Promise<IDBValidKey> {
  return dbTransaction(STORE_IMAGES, 'readwrite', (s) => s.put(image))
}

export async function deleteImage(id: string): Promise<undefined> {
  const image = await getImage(id)
  await openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_IMAGES, STORE_THUMBNAILS], 'readwrite')
        tx.objectStore(STORE_IMAGES).delete(id)
        tx.objectStore(STORE_THUMBNAILS).delete(id)
        tx.oncomplete = () => resolve(undefined)
        tx.onerror = () => reject(tx.error)
      }),
  )
  if (image?.localPath) await deleteRawCacheImages([image.localPath])
  return undefined
}

export async function clearImages(): Promise<undefined> {
  const localPaths = await getAllLocalImagePaths()
  await openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_IMAGES, STORE_THUMBNAILS], 'readwrite')
        tx.objectStore(STORE_IMAGES).clear()
        tx.objectStore(STORE_THUMBNAILS).clear()
        tx.oncomplete = () => resolve(undefined)
        tx.onerror = () => reject(tx.error)
      }),
  )
  await deleteRawCacheImages(localPaths)
  return undefined
}

export function getAllLocalImagePaths(): Promise<string[]> {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const request = db.transaction(STORE_IMAGES, 'readonly').objectStore(STORE_IMAGES).openCursor()
    const paths: string[] = []
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return resolve(paths)
      const localPath = (cursor.value as StoredImage).localPath
      if (localPath) paths.push(localPath)
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
  }))
}

// ===== Image hashing & dedup =====

export async function hashDataUrl(dataUrl: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return hashDataUrlFallback(dataUrl)
  }

  const data = new TextEncoder().encode(dataUrl)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hashDataUrlFallback(dataUrl: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193

  for (let i = 0; i < dataUrl.length; i++) {
    const code = dataUrl.charCodeAt(i)
    h1 ^= code
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= code
    h2 = Math.imul(h2, 0x27d4eb2d)
  }

  return `fallback-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * 存储图片，若已存在（按 hash 去重）则跳过。
 * 返回 image id。
 */
export async function storeImage(dataUrl: string, source: NonNullable<StoredImage['source']> = 'upload'): Promise<string> {
  const id = await hashDataUrl(dataUrl)
  const existing = await getImage(id)
  
  let localPath: string | undefined
  if (isElectron()) {
    localPath = await saveRawCacheImageToLocal(id, dataUrl) || undefined
  }

  if (!existing) {
    const thumbnail = await safeCreateImageThumbnail(dataUrl)
    await putImage({
      id,
      dataUrl: localPath ? undefined : dataUrl,
      localPath,
      createdAt: Date.now(),
      source,
      width: thumbnail.width,
      height: thumbnail.height,
    })
    if (thumbnail.thumbnailDataUrl) {
      await putImageThumbnail({
        id,
        thumbnailDataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailVersion: THUMBNAIL_VERSION,
      })
    }
  } else if ((await getStoredImageThumbnail(id))?.thumbnailVersion !== THUMBNAIL_VERSION || (!existing.localPath && localPath)) {
    const thumbnail = await safeCreateImageThumbnail(dataUrl)
    const updates: Partial<StoredImage> = {}
    if (thumbnail.width && thumbnail.height && (existing.width !== thumbnail.width || existing.height !== thumbnail.height)) {
      updates.width = thumbnail.width
      updates.height = thumbnail.height
    }
    if (!existing.localPath && localPath) {
      updates.localPath = localPath
      updates.dataUrl = undefined // Clear dataUrl from DB if we successfully saved to localPath
    }
    if (Object.keys(updates).length > 0) {
      await putImage({ ...existing, ...updates })
    }
    if (thumbnail.thumbnailDataUrl) {
      await putImageThumbnail({
        id,
        thumbnailDataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailVersion: THUMBNAIL_VERSION,
      })
    }
  }
  return id
}

export async function batchDeleteImages(ids: string[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve()
  const images = await batchGetImages(ids)
  await openDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_IMAGES, STORE_THUMBNAILS], 'readwrite')
        const imageStore = tx.objectStore(STORE_IMAGES)
        const thumbStore = tx.objectStore(STORE_THUMBNAILS)
        for (const id of ids) {
          imageStore.delete(id)
          thumbStore.delete(id)
        }
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
  await deleteRawCacheImages([...images.values()].flatMap((image) => image.localPath ? [image.localPath] : []))
}

export function batchGetImages(ids: string[]): Promise<Map<string, StoredImage>> {
  if (ids.length === 0) return Promise.resolve(new Map())
  const uniqueIds = Array.from(new Set(ids))
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_IMAGES, 'readonly')
        const store = tx.objectStore(STORE_IMAGES)
        const map = new Map<string, StoredImage>()
        let pending = uniqueIds.length

        const finishOne = () => {
          pending--
          if (pending === 0) resolve(map)
        }

        for (const id of uniqueIds) {
          const req = store.get(id)
          req.onsuccess = () => {
            const image = req.result as StoredImage | undefined
            if (image) map.set(id, image)
            finishOne()
          }
          req.onerror = () => reject(req.error)
        }
      }),
  )
}

export function batchPutTasks(tasks: TaskRecord[]): Promise<void> {
  if (tasks.length === 0) return Promise.resolve()
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_TASKS, 'readwrite')
        const store = tx.objectStore(STORE_TASKS)
        for (const task of tasks) store.put(task)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

export async function getStorageRecordCounts() {
  const [tasks, images, thumbnails, conversations, compositeAssets] = await Promise.all([
    dbTransaction<number>(STORE_TASKS, 'readonly', (store) => store.count()),
    dbTransaction<number>(STORE_IMAGES, 'readonly', (store) => store.count()),
    dbTransaction<number>(STORE_THUMBNAILS, 'readonly', (store) => store.count()),
    dbTransaction<number>(STORE_AGENT_CONVERSATIONS, 'readonly', (store) => store.count()),
    dbTransaction<number>(STORE_COMPOSITE_ASSETS, 'readonly', (store) => store.count()),
  ])
  return { tasks, images, thumbnails, conversations, compositeAssets }
}

export function commitImportedRecords(records: {
  images: StoredImage[]
  thumbnails: StoredImageThumbnail[]
  tasks: TaskRecord[]
  replaceTasks?: boolean
}): Promise<void> {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_IMAGES, STORE_THUMBNAILS, STORE_TASKS], 'readwrite')
    const imageStore = tx.objectStore(STORE_IMAGES)
    const thumbnailStore = tx.objectStore(STORE_THUMBNAILS)
    const taskStore = tx.objectStore(STORE_TASKS)
    if (records.replaceTasks) taskStore.clear()
    for (const image of records.images) imageStore.put(image)
    for (const thumbnail of records.thumbnails) thumbnailStore.put(thumbnail)
    for (const task of records.tasks) taskStore.put(task)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB import transaction aborted'))
  }))
}

export function updateImageLocalPaths(mappings: Array<{ from: string; to: string }>): Promise<void> {
  if (mappings.length === 0) return Promise.resolve()
  const bySource = new Map(mappings.map((mapping) => [mapping.from, mapping.to]))
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readwrite')
    const store = tx.objectStore(STORE_IMAGES)
    const request = store.openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const image = cursor.value as StoredImage
      const localPath = image.localPath ? bySource.get(image.localPath) : undefined
      if (localPath) cursor.update({ ...image, localPath })
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB path migration aborted'))
  }))
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = dataUrl
  })
}

async function createImageThumbnail(dataUrl: string): Promise<Omit<StoredImageThumbnail, 'id'>> {
  const image = await loadImage(dataUrl)
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (width <= 0 || height <= 0) throw new Error('图片尺寸无效')

  const scale = Math.min(1, THUMBNAIL_MAX_SIZE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

  return {
    thumbnailDataUrl: canvas.toDataURL('image/webp', THUMBNAIL_QUALITY),
    width,
    height,
    thumbnailVersion: THUMBNAIL_VERSION,
  }
}

async function safeCreateImageThumbnail(dataUrl: string): Promise<Partial<Omit<StoredImageThumbnail, 'id'>>> {
  try {
    return await createImageThumbnail(dataUrl)
  } catch {
    return {}
  }
}
