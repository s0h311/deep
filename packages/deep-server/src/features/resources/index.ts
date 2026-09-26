import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

// `nitro dev` runs inside packages/deep-server, the directory lives at the repo root
export const RUN_DIR = process.env.RUN_DIR ?? resolve(process.cwd(), '../../.run')

export async function listResources(): Promise<string[]> {
  const entries = await readdir(RUN_DIR, { recursive: true, withFileTypes: true }).catch(() => [])

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(RUN_DIR, join(entry.parentPath, entry.name)))
    .toSorted()
}

export async function readResource(path: string): Promise<string | undefined> {
  const file = resolve(RUN_DIR, path)

  // Prevent path traversal out of the resource directory
  if (!file.startsWith(RUN_DIR + sep)) {
    return undefined
  }

  return await readFile(file, 'utf-8').catch(() => undefined)
}
