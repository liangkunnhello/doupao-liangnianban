import { parseVariablePrompt } from '../../lib/variablePrompt'
import { getSopExecutionMode, type SopLibraryItem } from './types'

export type GalleryLibraryApplication =
  | { mode: 'prompt-generator'; sopId: string }
  | { mode: 'variable-prompt'; prompt: string }

export function resolveGalleryLibraryApplication(item: SopLibraryItem): GalleryLibraryApplication {
  if (getSopExecutionMode(item) === 'prompt-generator') {
    return { mode: 'prompt-generator', sopId: item.id }
  }

  const parsed = parseVariablePrompt(item.content)
  if (!parsed.enabled) {
    throw new Error(`变量提示词格式有误：${parsed.errors[0] ?? '未识别到有效变量'}`)
  }
  return { mode: 'variable-prompt', prompt: item.content }
}
