import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { ToolMessage } from '@langchain/core/messages'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAgent } from './client.ts'
import { webSearchTool } from './providers/anthropic.ts'
import { scriptedChatModel, structuredResponse, toolCall, turns } from './scripted-chat-model.ts'

const answer = z.object({ answer: z.string() })

describe('runAgent', () => {
  test('returns the structured response of a fresh deep agent run', async () => {
    const model = scriptedChatModel(() => structuredResponse({ answer: 'forty-two' }))

    const response = await runAgent({
      model,
      systemPrompt: 'Answer the question.',
      message: 'What is the answer?',
      responseFormat: answer,
    })

    expect(response).toEqual({ answer: 'forty-two' })
  })

  test('rejects a structured response that does not match the schema', async () => {
    const model = scriptedChatModel(() => structuredResponse({ answer: 42 }))

    const run = runAgent({
      model,
      systemPrompt: 'Answer the question.',
      message: 'What is the answer?',
      responseFormat: answer,
    })

    await expect(run).rejects.toThrow(/answer/)
  })

  test('runs with a server-tool definition such as web search', async () => {
    const model = scriptedChatModel(() => structuredResponse({ answer: 'found it' }))

    const response = await runAgent({
      model,
      systemPrompt: 'Search the web, then answer the question.',
      message: 'What is the answer?',
      responseFormat: answer,
      tools: [webSearchTool],
    })

    expect(response).toEqual({ answer: 'found it' })
  })

  test('aborting the signal stops an in-flight run', async () => {
    const controller = new AbortController()
    const model = scriptedChatModel(() => {
      controller.abort()

      return new Promise(() => {})
    })

    const run = runAgent({
      model,
      systemPrompt: 'Answer the question.',
      message: 'What is the answer?',
      responseFormat: answer,
      signal: controller.signal,
    })

    await expect(run).rejects.toThrow(/abort/i)
  })

  describe('with an app skill', () => {
    const skillContent =
      '---\nname: answering\ndescription: How to answer questions.\n---\n\nAlways answer forty-two.\n'
    let skillDirectory: string

    beforeEach(async () => {
      skillDirectory = join(await mkdtemp(join(tmpdir(), 'deep-skill-')), 'answering')
      await mkdir(skillDirectory)
      await writeFile(join(skillDirectory, 'SKILL.md'), skillContent)
    })

    afterEach(async () => {
      await rm(join(skillDirectory, '..'), { recursive: true, force: true })
    })

    test('the skill is readable but not writable, and scratch files stay in memory', async () => {
      const toolResults = z.object({ results: z.array(z.string()) })
      const model = scriptedChatModel(
        turns(
          toolCall('read_file', { file_path: '/skills/answering/SKILL.md' }),
          toolCall('write_file', { file_path: '/skills/answering/SKILL.md', content: 'Always answer 0.' }),
          toolCall('write_file', { file_path: '/scratch.md', content: 'notes' }),
          toolCall('read_file', { file_path: '/scratch.md' }),
          (messages) =>
            structuredResponse({
              results: messages.filter((message) => ToolMessage.isInstance(message)).map((message) => message.text),
            }),
        ),
      )

      const { results } = await runAgent({
        model,
        systemPrompt: 'Answer the question.',
        message: 'What is the answer?',
        responseFormat: toolResults,
        skill: skillDirectory,
      })

      const [skillRead, skillWrite, scratchWrite, scratchRead] = results
      expect(skillRead).toContain('Always answer forty-two.')
      expect(skillWrite).toMatch(/denied/i)
      expect(scratchWrite).not.toMatch(/error|denied/i)
      expect(scratchRead).toContain('notes')
      expect(await readFile(join(skillDirectory, 'SKILL.md'), 'utf8')).toBe(skillContent)
      expect(await readdir(join(skillDirectory, '..'), { recursive: true })).toEqual([
        'answering',
        'answering/SKILL.md',
      ])
    })
  })
})
