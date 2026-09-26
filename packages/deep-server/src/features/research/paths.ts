import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const WORKSPACE_MARKER = 'pnpm-workspace.yaml'

/** The nearest directory at or above `start` holding the workspace marker. */
function findUp(start: string): string | undefined {
  let directory = start

  while (!existsSync(join(directory, WORKSPACE_MARKER))) {
    const parent = dirname(directory)

    if (parent === directory) {
      return undefined
    }

    directory = parent
  }

  return directory
}

/**
 * The repo root, found by walking up from this module's location so it resolves independently of the dev server's
 * cwd. Falls back to walking up from the cwd when the module lives outside the repo (e.g. a bundled build).
 */
function repoRoot(): string {
  const root = findUp(dirname(fileURLToPath(import.meta.url))) ?? findUp(process.cwd())

  if (!root) {
    throw new Error(`no ${WORKSPACE_MARKER} above ${fileURLToPath(import.meta.url)} or ${process.cwd()}`)
  }

  return root
}

/** Where the Research's Artifacts live: `.research` at the repo root, overridable by `DEEP_RESEARCH_DIR`. */
export function researchDirectory(): string {
  return process.env.DEEP_RESEARCH_DIR ? resolve(process.env.DEEP_RESEARCH_DIR) : join(repoRoot(), '.research')
}

/** Absolute path of a Step's app skill, shipped with the server package. */
export function appSkill(name: string): string {
  return join(repoRoot(), 'packages/deep-server/src/features/research/skills', name)
}
