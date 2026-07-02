import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  batchGetCompositeAssets,
  batchGetImages,
  getCompositeAsset,
  getLegacyImageBatch,
  putCompositeAssets,
} from './db'

describe('batchGetImages', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads only requested image keys instead of loading the entire image store', async () => {
    const getCalls: string[] = []
    const getAll = vi.fn()
    const records = new Map([
      ['image-a', { id: 'image-a', dataUrl: 'data:image/png;base64,a' }],
      ['image-b', { id: 'image-b', dataUrl: 'data:image/png;base64,b' }],
      ['image-c', { id: 'image-c', dataUrl: 'data:image/png;base64,c' }],
    ])
    const store = {
      get: (id: string) => {
        getCalls.push(id)
        return requestWithResult(records.get(id))
      },
      getAll,
    }
    const db = {
      transaction: () => ({
        objectStore: () => store,
      }),
    }
    const indexedDB = {
      open: vi.fn(() => requestWithResult(db)),
    }
    vi.stubGlobal('indexedDB', indexedDB)

    const result = await batchGetImages(['image-a', 'image-c'])

    expect([...result.keys()]).toEqual(['image-a', 'image-c'])
    expect(getCalls).toEqual(['image-a', 'image-c'])
    expect(getAll).not.toHaveBeenCalled()
  })
})

describe('getLegacyImageBatch', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns a bounded batch and skips migrated records', async () => {
    const values = [
      { id: 'migrated', localPath: '/cache/a.png' },
      { id: 'legacy-a', dataUrl: 'data:image/png;base64,YQ==' },
      { id: 'metadata-only' },
      { id: 'legacy-b', dataUrl: 'data:image/png;base64,Yg==' },
      { id: 'legacy-c', dataUrl: 'data:image/png;base64,Yw==' },
    ]
    let index = 0
    const request: any = {}
    const cursor = {
      get value() { return values[index] },
      continue() {
        index++
        queueMicrotask(() => {
          request.result = index < values.length ? cursor : null
          request.onsuccess?.()
        })
      },
    }
    const store = {
      openCursor: () => {
        queueMicrotask(() => {
          request.result = cursor
          request.onsuccess?.()
        })
        return request
      },
    }
    vi.stubGlobal('indexedDB', {
      open: () => requestWithResult({ transaction: () => ({ objectStore: () => store }) }),
    })

    const result = await getLegacyImageBatch(2)
    expect(result.map((image) => image.id)).toEqual(['legacy-a', 'legacy-b'])
  })
})

describe('composite assets', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads one composite asset by id', async () => {
    const asset = { id: 'asset-a', blob: new Blob(['a']), createdAt: 1 }
    const get = vi.fn(() => requestWithResult(asset))
    vi.stubGlobal('indexedDB', {
      open: () => requestWithResult({
        transaction: (name: string, mode: string) => ({
          objectStore: () => ({ get }),
        }),
      }),
    })

    await expect(getCompositeAsset('asset-a')).resolves.toEqual(asset)
    expect(get).toHaveBeenCalledWith('asset-a')
  })

  it('reads only requested composite asset keys', async () => {
    const records = new Map([
      ['asset-a', { id: 'asset-a', blob: new Blob(['a']), createdAt: 1 }],
      ['asset-b', { id: 'asset-b', blob: new Blob(['b']), createdAt: 2 }],
    ])
    const get = vi.fn((id: string) => requestWithResult(records.get(id)))
    vi.stubGlobal('indexedDB', {
      open: () => requestWithResult({
        transaction: () => ({ objectStore: () => ({ get }) }),
      }),
    })

    const result = await batchGetCompositeAssets(['asset-a', 'asset-b'])
    expect([...result.keys()]).toEqual(['asset-a', 'asset-b'])
  })

  it('writes a composite asset batch in one transaction', async () => {
    const put = vi.fn()
    let complete: (() => void) | undefined
    const tx = {
      objectStore: () => ({ put }),
      set oncomplete(value: (() => void) | null) {
        complete = value ?? undefined
        queueMicrotask(() => complete?.())
      },
      onerror: null,
      onabort: null,
    }
    const transaction = vi.fn(() => tx)
    vi.stubGlobal('indexedDB', {
      open: () => requestWithResult({ transaction }),
    })
    const assets = [
      { id: 'asset-a', blob: new Blob(['a']), createdAt: 1 },
      { id: 'asset-b', blob: new Blob(['b']), createdAt: 2 },
    ]

    await putCompositeAssets(assets)

    expect(transaction).toHaveBeenCalledWith('compositeAssets', 'readwrite')
    expect(put.mock.calls.map(([asset]) => asset.id)).toEqual(['asset-a', 'asset-b'])
  })
})

function requestWithResult<T>(result: T) {
  const request: {
    result?: T
    error?: Error
    onsuccess?: () => void
    onerror?: () => void
  } = {}
  queueMicrotask(() => {
    request.result = result
    request.onsuccess?.()
  })
  return request
}
