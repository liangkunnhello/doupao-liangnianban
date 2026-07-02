import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs'
import path from 'path'
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate'

export type StreamingZipEntry = {
  archivePath: string
  mtime?: number
} & (
  | { sourcePath: string; data?: never }
  | { sourcePath?: never; data: Uint8Array }
)

export type StreamingZipRequest = {
  destinationPath: string
  manifestJson: string
  entries: StreamingZipEntry[]
}

function validArchivePath(value: string) {
  return (value.startsWith('images/') || value.startsWith('composite-assets/'))
    && !value.includes('\\')
    && !value.split('/').includes('..')
}

export async function writeStreamingZip(request: StreamingZipRequest): Promise<{ success: boolean; error?: string }> {
  const partialPath = `${request.destinationPath}.partial`
  try {
    for (const entry of request.entries) {
      if (!validArchivePath(entry.archivePath)) throw new Error(`无效 ZIP 路径：${entry.archivePath}`)
      if ('sourcePath' in entry && (!existsSync(entry.sourcePath) || !statSync(entry.sourcePath).isFile())) {
        throw new Error(`源文件不存在：${entry.sourcePath}`)
      }
    }
    mkdirSync(path.dirname(request.destinationPath), { recursive: true })
    if (existsSync(partialPath)) unlinkSync(partialPath)

    await new Promise<void>(async (resolve, reject) => {
      const output = createWriteStream(partialPath)
      let active: ReturnType<typeof createReadStream> | null = null
      let settled = false
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        active?.destroy()
        output.destroy()
        reject(error)
      }
      output.on('error', fail)
      output.on('finish', () => {
        if (!settled) {
          settled = true
          resolve()
        }
      })
      output.on('drain', () => active?.resume())

      const zip = new Zip((error, chunk, final) => {
        if (error) return fail(error)
        if (!output.write(chunk)) active?.pause()
        if (final) output.end()
      })
      const manifest = new ZipDeflate('manifest.json', { level: 6 })
      zip.add(manifest)
      manifest.push(strToU8(request.manifestJson), true)

      try {
        for (const item of request.entries) {
          const entry = new ZipPassThrough(item.archivePath)
          if (item.mtime && item.mtime >= Date.UTC(1980, 0, 1) && item.mtime <= Date.UTC(2099, 11, 31)) {
            entry.mtime = new Date(item.mtime)
          }
          zip.add(entry)
          if ('data' in item) {
            entry.push(item.data, true)
            continue
          }
          await new Promise<void>((done, failed) => {
            active = createReadStream(item.sourcePath)
            active.on('data', (chunk) => entry.push(new Uint8Array(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)), false))
            active.on('end', () => {
              entry.push(new Uint8Array(0), true)
              active = null
              done()
            })
            active.on('error', failed)
          })
        }
        zip.end()
      } catch (error) {
        fail(error)
      }
    })

    if (existsSync(request.destinationPath)) unlinkSync(request.destinationPath)
    renameSync(partialPath, request.destinationPath)
    return { success: true }
  } catch (error) {
    if (existsSync(partialPath)) unlinkSync(partialPath)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}
