export const GALLERY_SOP_PROMPT_RUN_REQUEST_EVENT = 'doupao:gallery-sop-prompt-run-request'

export interface GallerySopPromptRunRequest {
  sopId: string
  quantity: number
  imagesPerPrompt?: number
}

export function requestGallerySopPromptRun(detail: GallerySopPromptRunRequest) {
  window.dispatchEvent(new CustomEvent<GallerySopPromptRunRequest>(
    GALLERY_SOP_PROMPT_RUN_REQUEST_EVENT,
    { detail },
  ))
}
