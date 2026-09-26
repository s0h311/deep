import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createResearch, type ResearchEvent } from './index.ts'
import { scriptedChatModel, structuredResponse } from '../../infrastructure/agent/scripted-chat-model.ts'

describe('Research', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'deep-research-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function send(research: ReturnType<typeof createResearch>, message: string): Promise<ResearchEvent[]> {
    const events: ResearchEvent[] = []
    await research.send(message, (event) => {
      events.push(event)
    })

    return events
  }

  test('the first message starts Grilling with a numbered question and a recommended answer, then awaits the answer', async () => {
    const model = scriptedChatModel(() =>
      structuredResponse({ question: 'Who is the audience?', recommendedAnswer: 'Retail investors' }),
    )

    const events = await send(createResearch({ model, root }), 'How do central banks set interest rates?')

    expect(events).toEqual([
      { type: 'step', step: 'grilling' },
      { type: 'text', text: expect.stringMatching(/Q1[\s\S]*Who is the audience\?[\s\S]*Retail investors/) },
      { type: 'step', step: 'awaiting_answer' },
    ])
  })

  test('the Grilling transcript is kept as a working file', async () => {
    const model = scriptedChatModel(() =>
      structuredResponse({ question: 'Who is the audience?', recommendedAnswer: 'Retail investors' }),
    )

    await send(createResearch({ model, root }), 'How do central banks set interest rates?')

    expect(await readdir(root)).toEqual(['grilling_transcript.json'])
  })

  test('the next message answers the Grilling question, and the next question builds on the transcript', async () => {
    const model = scriptedChatModel((messages) =>
      messages.some((message) => HumanMessage.isInstance(message) && message.text.includes('Pension fund trustees'))
        ? structuredResponse({ question: 'Which central banks?', recommendedAnswer: 'The ECB and the Fed' })
        : structuredResponse({ question: 'Who is the audience?', recommendedAnswer: 'Retail investors' }),
    )
    await send(createResearch({ model, root }), 'How do central banks set interest rates?')

    const events = await send(createResearch({ model, root }), 'Pension fund trustees')

    expect(events).toEqual([
      { type: 'step', step: 'grilling' },
      { type: 'text', text: expect.stringMatching(/Q2[\s\S]*Which central banks\?[\s\S]*The ECB and the Fed/) },
      { type: 'step', step: 'awaiting_answer' },
    ])
  })
})
