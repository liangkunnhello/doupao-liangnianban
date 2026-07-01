type TemplateVars = {
  date: string
  channel: string
  size: string
  preset: string
  index: number
  source: string
  sourceDir: string
  custom: string
}

type BuildPathInput = TemplateVars & {
  namingTemplate: string
  filenameTemplate: string
  customVariables?: Record<string, string>
  preserveSourceDir: boolean
}

const RESERVED_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export function sanitizePathSegment(value: string): string {
  const sanitized = value
    .replace(RESERVED_CHARS, '_')
    .trim()
    .replace(/[. ]+$/g, (match) => '_'.repeat(match.length)) || '_'
  const stem = sanitized.split('.')[0] ?? sanitized
  return WINDOWS_RESERVED_NAMES.test(stem) ? `_${sanitized}` : sanitized
}

function replaceTemplate(template: string, vars: TemplateVars): string {
  let result = template
    .replaceAll('{date}', vars.date)
    .replaceAll('{channel}', vars.channel)
    .replaceAll('{size}', vars.size)
    .replaceAll('{preset}', vars.preset)
    .replaceAll('{index}', String(vars.index))
    .replaceAll('{source}', vars.source)
    .replaceAll('{sourceDir}', vars.sourceDir)
    .replaceAll('{custom}', vars.custom)
  for (const [name, value] of Object.entries((vars as BuildPathInput).customVariables ?? {})) {
    result = result.replaceAll(`{${name}}`, value)
  }
  return result
}

function splitTemplatePath(value: string): string[] {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => sanitizePathSegment(/^\.+$/.test(part) ? '_' : part))
}

export function buildCompositeOutputPathParts(input: BuildPathInput) {
  const subfolders = splitTemplatePath(replaceTemplate(input.namingTemplate, input))
  if (input.preserveSourceDir && input.sourceDir) {
    subfolders.push(...splitTemplatePath(input.sourceDir))
  }
  const filenameStem = sanitizePathSegment(replaceTemplate(input.filenameTemplate, input))
  return {
    subfolders,
    filename: `${filenameStem}.jpg`,
  }
}

export function withCollisionSuffix(filename: string, suffix: number): string {
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return `${filename}-${suffix}`
  return `${filename.slice(0, dot)}-${suffix}${filename.slice(dot)}`
}
