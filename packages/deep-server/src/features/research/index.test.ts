import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { type BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createResearch, ResearchConflict, type ResearchEvent } from './index.ts'
import { type Script, scriptedChatModel, structuredResponse } from '../../infrastructure/agent/scripted-chat-model.ts'
import { defined } from '../../infrastructure/utils/utils.ts'

/** Answers the Source Catalogue agent with the given hosts, and every other agent with the Grilling script. */
function researchModel(grilling: Script, sources: string[] = ['ecb.europa.eu']) {
  return scriptedChatModel((messages) =>
    messages.some((message) => SystemMessage.isInstance(message) && message.text.includes('Source Catalogue Step'))
      ? structuredResponse({ sources })
      : grilling(messages),
  )
}

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

  describe('when Grilling concludes', () => {
    const protocol = {
      scope: 'The ECB and the Fed, 2015 to 2025',
      goal: 'Understand how policy rates are decided',
      audience: 'Pension fund trustees',
      openAssumptions: [],
    }

    function answered(messages: BaseMessage[], answer: string): boolean {
      return messages.some((message) => HumanMessage.isInstance(message) && message.text.includes(answer))
    }

    test('a multi-turn Grilling ends in a Grilling Protocol named after the Topic', async () => {
      const model = researchModel((messages) => {
        if (answered(messages, 'The ECB and the Fed')) {
          return structuredResponse({ done: true, topic: 'Central bank rate setting', protocol })
        }

        if (answered(messages, 'Pension fund trustees')) {
          return structuredResponse({ question: 'Which central banks?', recommendedAnswer: 'The ECB and the Fed' })
        }

        return structuredResponse({ question: 'Who is the audience?', recommendedAnswer: 'Retail investors' })
      })
      const research = createResearch({ model, root })

      const events = [
        await send(research, 'How do central banks set interest rates?'),
        await send(research, 'Pension fund trustees'),
        await send(research, 'The ECB and the Fed'),
      ]

      expect(events.map((turn) => turn.at(-1))).toEqual([
        { type: 'step', step: 'awaiting_answer' },
        { type: 'step', step: 'awaiting_answer' },
        { type: 'step', step: 'source_catalogue' },
      ])
      expect(await readdir(root)).toContain('central_bank_rate_setting_grilling_protocol.md')
      expect(await readdir(root)).not.toContain('grilling_transcript.json')
      expect(await readFile(join(root, 'central_bank_rate_setting_grilling_protocol.md'), 'utf8')).toMatch(
        /How do central banks set interest rates\?[\s\S]*The ECB and the Fed, 2015 to 2025[\s\S]*Understand how policy rates are decided[\s\S]*Pension fund trustees/,
      )
    })

    describe('after 5 answered questions', () => {
      const answers = ['Retail investors', 'The ECB', '2020 to 2025', 'Policy rates only', 'A one-page summary']
      const question = structuredResponse({ question: 'What else?', recommendedAnswer: 'Nothing' })

      async function grillFiveTurns(research: ReturnType<typeof createResearch>): Promise<ResearchEvent[][]> {
        const events = [await send(research, 'How do central banks set interest rates?')]

        for (const answer of answers.slice(0, -1)) {
          events.push(await send(research, answer))
        }

        return events
      }

      test('Grilling is told to conclude, recording unresolved points as open assumptions in the GP', async () => {
        const model = researchModel((messages) =>
          messages.some((message) => HumanMessage.isInstance(message) && /conclude/i.test(message.text))
            ? structuredResponse({
                done: true,
                topic: 'Central bank rate setting',
                protocol: { ...protocol, openAssumptions: ['Only the ECB is in scope'] },
              })
            : question,
        )
        const research = createResearch({ model, root })

        const questions = await grillFiveTurns(research)
        await send(research, defined(answers.at(-1)))

        expect(questions.map((turn) => turn.at(-1))).toEqual(
          answers.map(() => ({ type: 'step', step: 'awaiting_answer' })),
        )
        expect(await readFile(join(root, 'central_bank_rate_setting_grilling_protocol.md'), 'utf8')).toMatch(
          /Open assumptions[\s\S]*Only the ECB is in scope/,
        )
      })

      test('no 6th question is asked, even by a model that keeps asking', async () => {
        const model = scriptedChatModel(() => question)
        const research = createResearch({ model, root })
        await grillFiveTurns(research)

        const events: ResearchEvent[] = []
        await research
          .send(defined(answers.at(-1)), (event) => {
            events.push(event)
          })
          .catch(() => {})

        expect(events).not.toContainEqual({ type: 'step', step: 'awaiting_answer' })
      })
    })

    test.each([
      { kind: 'spaces and case', topic: 'Central Bank Rate Setting', slug: 'central_bank_rate_setting' },
      {
        kind: 'punctuation',
        topic: '  ECB vs. Fed: rate-setting (2015–2025)!  ',
        slug: 'ecb_vs_fed_rate_setting_2015_2025',
      },
      {
        kind: 'non-ASCII letters',
        topic: 'Zürich Mietpreisbremse, São Paulo',
        slug: 'zurich_mietpreisbremse_sao_paulo',
      },
      { kind: 'non-ASCII only', topic: '日本の金利', slug: 'research' },
      {
        kind: 'length',
        topic: 'An extremely long Topic about the monetary policy of the European Central Bank',
        slug: 'an_extremely_long_topic_about_the_monetary_policy',
      },
    ])('the Topic is slugified into a safe snake_case file name: $kind', async ({ topic, slug }) => {
      const model = researchModel(() => structuredResponse({ done: true, topic, protocol }))

      await send(createResearch({ model, root }), 'How do central banks set interest rates?')

      expect(await readdir(root)).toContain(`${slug}_grilling_protocol.md`)
    })
  })

  describe('Source Catalogue', () => {
    const conclusion = structuredResponse({
      done: true,
      topic: 'Central bank rate setting',
      protocol: {
        scope: 'The ECB and the Fed, 2015 to 2025',
        goal: 'Understand how policy rates are decided',
        audience: 'Pension fund trustees',
        openAssumptions: [],
      },
    })

    async function catalogue(sources: string[]): Promise<{ events: ResearchEvent[]; catalogue: unknown }> {
      const model = researchModel(() => conclusion, sources)

      const events = await send(createResearch({ model, root }), 'How do central banks set interest rates?')

      return {
        events,
        catalogue: JSON.parse(await readFile(join(root, 'central_bank_rate_setting_source_catalogue.json'), 'utf8')),
      }
    }

    test('once Grilling concludes, the Source Catalogue is written from the hosts the agent found', async () => {
      const { events, catalogue: written } = await catalogue(['ecb.europa.eu', 'federalreserve.gov'])

      expect(events).toEqual([
        { type: 'step', step: 'grilling' },
        { type: 'step', step: 'source_catalogue' },
      ])
      expect(written).toEqual({ sources: ['ecb.europa.eu', 'federalreserve.gov'] })
    })

    test('hosts are normalised: a leading wildcard is stripped and duplicates removed', async () => {
      const { catalogue: written } = await catalogue([
        '*.ecb.europa.eu',
        'ecb.europa.eu',
        ' FederalReserve.gov ',
        'federalreserve.gov',
      ])

      expect(written).toEqual({ sources: ['ecb.europa.eu', 'federalreserve.gov'] })
    })

    test.each([
      { kind: 'a scheme', entry: 'https://bis.org' },
      { kind: 'a path', entry: 'bis.org/statistics' },
      { kind: 'an inner wildcard', entry: 'stats.*.org' },
      { kind: 'a trailing wildcard', entry: 'bis.*' },
      { kind: 'a port', entry: 'bis.org:443' },
      { kind: 'whitespace', entry: 'bis org' },
      { kind: 'nothing', entry: '' },
    ])('an entry with $kind is rejected', async ({ entry }) => {
      const { catalogue: written } = await catalogue(['ecb.europa.eu', entry])

      expect(written).toEqual({ sources: ['ecb.europa.eu'] })
    })

    test('an empty Source Catalogue ends the Research as Failed, with a reason', async () => {
      const { events, catalogue: written } = await catalogue(['https://en.wikipedia.org/wiki/Interest_rate'])

      expect(written).toEqual({ sources: [] })
      expect(events.at(-1)).toEqual({ type: 'step', step: 'failed', reason: expect.stringMatching(/Primary Source/) })
    })

    test('a message to a Failed Research is rejected as a conflict: reset first', async () => {
      const model = researchModel(() => conclusion, [])
      const research = createResearch({ model, root })
      await send(research, 'How do central banks set interest rates?')

      const error = await send(research, 'How do tides work?').catch((error: unknown) => error)

      expect(error).toBeInstanceOf(ResearchConflict)
      expect(error).toHaveProperty('message', expect.stringMatching(/reset first/))
    })

    test('the Research stops once a non-empty Source Catalogue is written', async () => {
      const research = createResearch({ model: researchModel(() => conclusion), root })
      await send(research, 'How do central banks set interest rates?')

      const events = await send(research, 'How do tides work?')

      expect(events).toEqual([])
    })
  })
})
