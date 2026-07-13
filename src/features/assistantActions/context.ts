import { stripImageMentionMarkers } from '../../lib/promptImageMentions'
import type { InputImage } from '../../types'
import type { AssistantInputContext } from './types'

export function buildAssistantInputContext(prompt: string, inputImages: InputImage[]): AssistantInputContext {
  const text = stripImageMentionMarkers(prompt).trim()
  return {
    text,
    hasText: text.length > 0,
    images: inputImages,
    hasImage: inputImages.length > 0,
    imageCount: inputImages.length,
  }
}

export function getAssistantContextLabel(context: AssistantInputContext) {
  if (context.hasImage && context.hasText) return '图片+提示词'
  if (context.hasImage) return context.imageCount > 1 ? `${context.imageCount} 张图片` : '图片'
  if (context.hasText) return '提示词'
  return '灵感'
}
