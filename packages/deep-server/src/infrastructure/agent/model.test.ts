import { afterEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'
import { chatModel } from './model.ts'
import { runAgent } from './client.ts'
import { structuredResponse } from './scripted-chat-model.ts'

describe('chatModel', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('is Claude Haiku 4.5 without the fake model switch', () => {
    vi.stubEnv('DEEP_FAKE_MODEL', undefined)

    expect(chatModel(() => structuredResponse({}))).toBe('anthropic:claude-haiku-4-5')
  })

  test('is the scripted fake with the fake model switch', async () => {
    vi.stubEnv('DEEP_FAKE_MODEL', 'true')

    const response = await runAgent({
      model: chatModel(() => structuredResponse({ answer: 'canned' })),
      systemPrompt: 'Answer the question.',
      message: 'What is the answer?',
      responseFormat: z.object({ answer: z.string() }),
    })

    expect(response).toEqual({ answer: 'canned' })
  })
})
