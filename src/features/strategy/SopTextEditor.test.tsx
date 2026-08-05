/* @vitest-environment jsdom */

import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import SopTextEditor from './SopTextEditor'

const storeMocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  useStore: vi.fn((selector: (state: unknown) => unknown) => selector({
    settings: {
      agentShareApiParameters: false,
      agentProfile: {
        id: 'agent-test',
        name: 'Agent 测试',
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
        model: 'gpt-agent-test',
        apiMode: 'responses',
      },
    },
    showToast: storeMocks.showToast,
  })),
}))

vi.mock('../../store', () => storeMocks)
vi.mock('../../lib/agentApi', () => ({ transformSopDocument: vi.fn() }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function textContent(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textContent(child)).join('')
}

describe('SopTextEditor search feedback', () => {
  it('shows the match total, current position, and an explicit empty result', () => {
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(
        <SopTextEditor
          documentId="sop-1"
          value={'步骤一\n步骤二\n再次执行步骤一'}
          onChange={vi.fn()}
        />,
      )
    })

    const searchInput = renderer.root.findByProps({ 'aria-label': '查找正文' })
    act(() => searchInput.props.onChange({ target: { value: '步骤' } }))
    expect(textContent(renderer.root.findByProps({ role: 'status' }))).toBe('3 处')

    act(() => renderer.root.findByProps({ 'aria-label': '查找下一处' }).props.onClick())
    expect(textContent(renderer.root.findByProps({ role: 'status' }))).toBe('1/3')

    act(() => searchInput.props.onChange({ target: { value: '不存在' } }))
    const emptyResult = renderer.root.findByProps({ role: 'status' })
    expect(textContent(emptyResult)).toBe('无匹配')
    expect(emptyResult.props['data-empty']).toBe(true)
  })
})
