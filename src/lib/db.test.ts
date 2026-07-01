import { afterEach, describe, expect, it, vi } from 'vitest'
import { batchGetImages, getLegacyImageBatch } from './db'

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
