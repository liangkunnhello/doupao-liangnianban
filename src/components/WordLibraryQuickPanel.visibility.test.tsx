/* @vitest-environment jsdom */

import { renderToStaticMarkup } from 'react-dom/server'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../design-system'
import type { WordLibraryEntry, WordLibraryGroup } from '../types'
import { WordLibraryQuickPanel } from './WordLibraryQuickPanel'

const group: WordLibraryGroup = {
  id: 'group-a',
  name: '场景',
  sortOrder: 0,
}

const entry: WordLibraryEntry = {
  id: 'entry-a',
  groupId: group.id,
  key: '产品摄影',
  label: '产品摄影',
  entries: ['棚拍', '自然光'],
  draw_count: 1,
  sortOrder: 0,
  isPinned: false,
  isFavorite: false,
  tags: [],
  deletedAt: null,
  createdAt: 1,
  updatedAt: 1,
  usageCount: 0,
}

describe('WordLibraryQuickPanel AI derivative entry', () => {
  it('keeps the AI derivative action visible beside the primary prompt action', () => {
    const html = renderToStaticMarkup(
      <WordLibraryQuickPanel
        entries={[entry]}
        groups={[group]}
        query=""
        view="all"
        groupId="__all__"
        activeEntryId={entry.id}
        hasPromptSelection={false}
        onQueryChange={vi.fn()}
        onViewChange={vi.fn()}
        onGroupChange={vi.fn()}
        onSelect={vi.fn()}
        onInvoke={vi.fn()}
        onSaveEntries={vi.fn()}
        onToggleFavorite={vi.fn()}
        onManage={vi.fn()}
      />,
    )

    expect(html).toContain('AI 衍生')
    expect(html).toContain('插入到提示词')
  })

  it('expands AI derivative controls inside the sidebar without opening management', () => {
    const onManage = vi.fn()
    let renderer: ReturnType<typeof create>
    act(() => {
      renderer = create(
        <WordLibraryQuickPanel
          entries={[entry]}
          groups={[group]}
          query=""
          view="all"
          groupId="__all__"
          activeEntryId={entry.id}
          hasPromptSelection={false}
          onQueryChange={vi.fn()}
          onViewChange={vi.fn()}
          onGroupChange={vi.fn()}
          onSelect={vi.fn()}
          onInvoke={vi.fn()}
          onSaveEntries={vi.fn()}
          onToggleFavorite={vi.fn()}
          onManage={onManage}
        />,
      )
    })

    const aiButton = renderer!.root.findAllByType(Button).find((node) => node.props['aria-expanded'] === false)
    expect(aiButton).toBeDefined()
    act(() => aiButton!.props.onClick())

    expect(renderer!.root.findByProps({ 'data-testid': 'word-library-ai-derivative' })).toBeDefined()
    expect(onManage).not.toHaveBeenCalled()
  })
})
