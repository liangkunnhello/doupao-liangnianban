import { create } from 'zustand'

type RuntimeStore = {
  streamPreviews: Record<string, string>
  streamPreviewSlots: Record<string, Record<string, string>>
  setTaskStreamPreview(taskId: string, image?: string, requestIndex?: number): void
  agentStreamingTexts: Record<string, string>
  setAgentStreamingText(conversationId: string, messageId: string, text: string): void
  clearAgentStreamingText(conversationId: string, messageId?: string): void
}

export const useRuntimeStore = create<RuntimeStore>()((set) => ({
  streamPreviews: {},
  streamPreviewSlots: {},
  setTaskStreamPreview: (taskId, image, requestIndex = 0) => set((state) => {
    if (image) {
      const slotKey = String(requestIndex)
      const currentSlots = state.streamPreviewSlots[taskId] ?? {}
      if (state.streamPreviews[taskId] === image && currentSlots[slotKey] === image) return state
      return {
        streamPreviews: { ...state.streamPreviews, [taskId]: image },
        streamPreviewSlots: {
          ...state.streamPreviewSlots,
          [taskId]: { ...currentSlots, [slotKey]: image },
        },
      }
    }

    if (!(taskId in state.streamPreviews) && !(taskId in state.streamPreviewSlots)) return state
    const streamPreviews = { ...state.streamPreviews }
    const streamPreviewSlots = { ...state.streamPreviewSlots }
    delete streamPreviews[taskId]
    delete streamPreviewSlots[taskId]
    return { streamPreviews, streamPreviewSlots }
  }),
  agentStreamingTexts: {},
  setAgentStreamingText: (conversationId, messageId, text) => set((state) => ({
    agentStreamingTexts: {
      ...state.agentStreamingTexts,
      [`${conversationId}:${messageId}`]: text,
    },
  })),
  clearAgentStreamingText: (conversationId, messageId) => set((state) => {
    const keyPrefix = messageId ? `${conversationId}:${messageId}` : `${conversationId}:`
    const agentStreamingTexts = { ...state.agentStreamingTexts }
    if (messageId) {
      delete agentStreamingTexts[`${conversationId}:${messageId}`]
    } else {
      for (const key of Object.keys(agentStreamingTexts)) {
        if (key.startsWith(keyPrefix)) delete agentStreamingTexts[key]
      }
    }
    return { agentStreamingTexts }
  }),
}))
