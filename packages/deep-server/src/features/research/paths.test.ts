import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { appSkill, researchDirectory } from './paths.ts'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..')

describe('paths', () => {
  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue(tmpdir())
    vi.stubEnv('DEEP_RESEARCH_DIR', '')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  test('puts the Research directory at the repo root whatever the cwd', () => {
    expect(researchDirectory()).toBe(join(REPO_ROOT, '.research'))
  })

  test('finds the app skills whatever the cwd', () => {
    expect(existsSync(join(appSkill('grilling'), 'SKILL.md'))).toBe(true)
  })
})
