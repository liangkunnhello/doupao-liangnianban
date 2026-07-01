import { describe, expect, it } from 'vitest'
import configFactory from './vite.config'

describe('development server origin', () => {
  it('pins port 5173 and refuses automatic fallback', () => {
    const config = (configFactory as Function)({ command: 'serve', mode: 'test' })
    expect(config.server?.port).toBe(5173)
    expect(config.server?.strictPort).toBe(true)
  })
})
