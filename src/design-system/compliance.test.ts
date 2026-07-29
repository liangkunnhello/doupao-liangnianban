import { describe, it, expect } from 'vitest'

// 全仓 UI 合规回归测试：锁定规范明确禁止的模式，防止再次分叉。
// 覆盖：MASTER 6.1（不使用 transition: all）、MASTER 4.8（禁止任意数字 z-index，tooltip 为最高层）。

const sources: Record<string, string> = {
  ...import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../**/*.ts', { query: '?raw', import: 'default', eager: true }),
}

const entries = Object.entries(sources).filter(([path]) => !path.includes('/design-system/'))

describe('UI 合规回归', () => {
  it('不使用 transition-all（MASTER 6.1：只声明实际变化的属性）', () => {
    const violations = entries
      .filter(([, src]) => /\btransition-all\b/.test(src))
      .map(([path]) => path.replace(/^\.\.\//, ''))
    expect(violations).toEqual([])
  })

  it('不使用任意数字 z-index（MASTER 4.8：禁止 z-[...]，改用 --ds-z-* token）', () => {
    const violations = entries
      .filter(([, src]) => /z-\[(?!var)[0-9]/.test(src))
      .map(([path]) => path.replace(/^\.\.\//, ''))
    expect(violations).toEqual([])
  })
})
