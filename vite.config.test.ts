import { describe, expect, it } from 'vitest'
import configFactory from './vite.config'

describe('development server origin', () => {
  it('pins a project-specific loopback origin and refuses automatic fallback', () => {
    const config = (configFactory as Function)({ command: 'serve', mode: 'test' })
    expect(config.server?.host).toBe('127.0.0.1')
    expect(config.server?.port).toBe(41731)
    expect(config.server?.strictPort).toBe(true)
  })
})
