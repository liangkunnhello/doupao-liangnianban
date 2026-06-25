import { VAR_END, VAR_START } from './promptImageMentions'

export function replaceVariableNameInPrompt(prompt: string, previousName: string, nextName: string): string {
  if (previousName === nextName) return prompt
  const previousMarker = `${VAR_START}${previousName}${VAR_END}`
  const nextMarker = `${VAR_START}${nextName}${VAR_END}`
  return prompt.split(previousMarker).join(nextMarker)
}
