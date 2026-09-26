import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const WORKSPACE_MARKER = 'pnpm-workspace.yaml'

/**
 * The repo root, found by walking up from the cwd so the dev server resolves it whether started from the root or
 * the package.
 */
function repoRoot(): string {
  let directory = process.cwd()

  while (!existsSync(join(directory, WORKSPACE_MARKER))) {
    const parent = dirname(directory)

    if (parent === directory) {
      throw new Error(`no ${WORKSPACE_MARKER} above ${process.cwd()}`)
    }

    directory = parent
  }

  return directory
}

/** Where the Research's Artifacts live: `.research` at the repo root, overridable by `DEEP_RESEARCH_DIR`. */
export function researchDirectory(): string {
  return process.env.DEEP_RESEARCH_DIR ? resolve(process.env.DEEP_RESEARCH_DIR) : join(repoRoot(), '.research')
}

/** Absolute path of a Step's app skill, shipped with the server package. */
export function appSkill(name: string): string {
  return join(repoRoot(), 'packages/deep-server/src/features/research/skills', name)
}
