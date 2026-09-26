import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

/** Imports a fresh copy of the module, the resource directory is read from the env on import. */
async function resourcesIn(dir: string) {
  vi.stubEnv('RUN_DIR', dir)
  vi.resetModules()
  const resources = await import('./index')
  vi.unstubAllEnvs()

  return resources
}

describe('resources', () => {
  let root: string
  let resources: Awaited<ReturnType<typeof resourcesIn>>

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'deep-resources-'))
    await mkdir(join(root, 'resource', 'research-findings'), { recursive: true })
    await writeFile(join(root, 'resource', 'topic.md'), '# Topic')
    await writeFile(join(root, 'resource', 'research-findings', 'topic-findings.md'), '- fact 1')
    await writeFile(join(root, 'resource', 'a-draft.md'), 'draft')
    await writeFile(join(root, 'secret.txt'), 'outside')
    await mkdir(join(root, 'resource-other'))
    await writeFile(join(root, 'resource-other', 'x.md'), 'outside')

    resources = await resourcesIn(join(root, 'resource'))
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('lists all files, nested ones by their relative path, sorted', async () => {
    expect(await resources.listResources()).toEqual([
      'a-draft.md',
      join('research-findings', 'topic-findings.md'),
      'topic.md',
    ])
  })

  test('lists nothing when the resource directory does not exist', async () => {
    const missing = await resourcesIn(join(root, 'missing'))

    expect(await missing.listResources()).toEqual([])
  })

  test('reads a listed file', async () => {
    expect(await resources.readResource('research-findings/topic-findings.md')).toBe('- fact 1')
  })

  test('reads nothing for a file that does not exist', async () => {
    expect(await resources.readResource('nope.md')).toBeUndefined()
  })

  test('reads nothing for a directory', async () => {
    expect(await resources.readResource('research-findings')).toBeUndefined()
  })

  test.each([
    ['a relative path', '../secret.txt'],
    ['a nested relative path', 'research-findings/../../secret.txt'],
    ['an absolute path', '/etc/hostname'],
    ['a sibling directory sharing the prefix', '../resource-other/x.md'],
  ])('reads nothing outside the resource directory through %s', async (_, path) => {
    expect(await resources.readResource(path)).toBeUndefined()
  })

  test('reads nothing for the resource directory itself', async () => {
    expect(await resources.readResource('.')).toBeUndefined()
  })
})
