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
  subfolderTemplate: string
  filenameTemplate: string
  preserveSourceDir: boolean
}

const RESERVED_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g

export function sanitizePathSegment(value: string): string {
  return value.replace(RESERVED_CHARS, '_').trim() || '_'
}

function replaceTemplate(template: string, vars: TemplateVars): string {
  return template
    .replaceAll('{date}', vars.date)
    .replaceAll('{channel}', vars.channel)
    .replaceAll('{size}', vars.size)
    .replaceAll('{preset}', vars.preset)
    .replaceAll('{index}', String(vars.index))
    .replaceAll('{source}', vars.source)
    .replaceAll('{sourceDir}', vars.sourceDir)
    .replaceAll('{custom}', vars.custom)
}

function splitTemplatePath(value: string): string[] {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => sanitizePathSegment(part))
}

export function buildCompositeOutputPathParts(input: BuildPathInput) {
  const subfolders = splitTemplatePath(replaceTemplate(input.subfolderTemplate, input))
  if (input.preserveSourceDir && input.sourceDir) {
    subfolders.push(...splitTemplatePath(input.sourceDir))
  }
  const filenameStem = sanitizePathSegment(replaceTemplate(input.filenameTemplate, input))
  return {
    dateFolder: sanitizePathSegment(input.date),
    subfolders,
    filename: `${filenameStem}.jpg`,
  }
}

export function withCollisionSuffix(filename: string, suffix: number): string {
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return `${filename}-${suffix}`
  return `${filename.slice(0, dot)}-${suffix}${filename.slice(dot)}`
}
