import { afterEach, describe, expect, it, vi } from 'vitest'
import { getApiErrorMessage, getImageMimeFromDataUrl, normalizeBase64Image, retryTransientRequest } from './imageApiShared'

describe('retryTransientRequest', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries transient failures with exponential backoff', async () => {
    vi.useFakeTimers()
    const handler = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP 503'))
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValue('ok')

    const result = retryTransientRequest(handler, { maxRetries: 3 })
    await vi.runAllTimersAsync()

    await expect(result).resolves.toBe('ok')
    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('does not retry a non-transient failure', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('invalid request'))

    await expect(retryTransientRequest(handler, { maxRetries: 3 })).rejects.toThrow('invalid request')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('preserves the HTTP status when the API returns a JSON error message', async () => {
    const message = await getApiErrorMessage(new Response(JSON.stringify({
      error: { message: 'upstream overloaded' },
    }), { status: 503 }))

    expect(message).toBe('HTTP 503: upstream overloaded')
  })
})

describe('image MIME normalization', () => {
  it('uses the actual PNG signature when a provider labels it as JPEG', () => {
    const mislabeled = 'data:image/jpeg;base64,iVBORw0KGgo='

    expect(normalizeBase64Image(mislabeled, 'image/jpeg')).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(getImageMimeFromDataUrl(mislabeled)).toBe('image/png')
  })

  it('keeps valid JPEG payloads marked as JPEG', () => {
    const jpeg = 'data:image/jpeg;base64,/9j/4AAQ'

    expect(normalizeBase64Image(jpeg, 'image/png')).toBe(jpeg)
    expect(getImageMimeFromDataUrl(jpeg)).toBe('image/jpeg')
  })
})
