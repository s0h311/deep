import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { type BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { ArtifactNotFound, createResearch, ResearchConflict, type ResearchEvent } from './index.ts'
import { type Script, scriptedChatModel, structuredResponse } from '../../infrastructure/agent/scripted-chat-model.ts'
import { defined } from '../../infrastructure/utils/utils.ts'

type Finding = { statement: string; url: string; quote: string }

type Draft = { summary: string; keyFacts: string[]; gaps: string[]; followUpQuestions: string[] }

type Review = { verdict: 'pass' | 'fail'; offendingClaims: Array<{ claim: string; reason: string }> }

const ecbFinding: Finding = {
  statement: 'The ECB kept its deposit facility rate at 2.00%.',
  url: 'https://www.ecb.europa.eu/press/pr/date/2025/html/ecb.mp250724.en.html',
  quote: 'the interest rates on the deposit facility [...] will remain unchanged at 2.00%',
}

const ecbDraft: Draft = {
  summary: 'The ECB left its deposit facility rate unchanged at 2.00% in July 2025 [F1].',
  keyFacts: ['The deposit facility rate stayed at 2.00% [F1].'],
  gaps: ['How the Fed weighs inflation expectations.'],
  followUpQuestions: ['How did the ECB rate path compare with the Fed?'],
}

const passingReview: Review = { verdict: 'pass', offendingClaims: [] }

const failingReview: Review = {
  verdict: 'fail',
  offendingClaims: [{ claim: 'The ECB cut rates in July 2025.', reason: 'F1 says the rates stayed unchanged.' }],
}

/** Throws on its first `times` calls, then returns the response. */
function flaky<Response>(times: number, response: Response): () => Response {
  let calls = 0

  return () => {
    calls += 1

    if (calls <= times) {
      throw new Error('overloaded')
    }

    return response
  }
}

/**
 * Answers the Source Catalogue agent with the given hosts, the Retrieval agent with the given Findings, the Draft and
 * Review agents with the given Draft and Review, and every other agent with the Grilling script.
 */
function researchModel(
  grilling: Script,
  {
    sources = ['ecb.europa.eu'],
    findings = [ecbFinding],
    draft = () => ecbDraft,
    review = () => passingReview,
  }: {
    sources?: string[]
    findings?: Finding[]
    draft?: (messages: BaseMessage[]) => Draft | Promise<Draft>
    review?: () => Review
  } = {},
) {
  return scriptedChatModel(async (messages) => {
    const system = messages.find((message) => SystemMessage.isInstance(message))?.text ?? ''

    if (system.includes('Draft Step')) {
      return structuredResponse(await draft(messages))
    }

    if (system.includes('Review Step')) {
      return structuredResponse(review())
    }

    if (system.includes('Retrieval Step')) {
      return structuredResponse({ findings })
    }

    return system.includes('Source Catalogue Step') ? structuredResponse({ sources }) : grilling(messages)
  })
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
        { type: 'step', step: 'completed' },
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
      const model = researchModel(() => conclusion, { sources })

      const events = await send(createResearch({ model, root }), 'How do central banks set interest rates?')

      return {
        events,
        catalogue: JSON.parse(await readFile(join(root, 'central_bank_rate_setting_source_catalogue.json'), 'utf8')),
      }
    }

    test('once Grilling concludes, the Source Catalogue is written from the hosts the agent found', async () => {
      const { events, catalogue: written } = await catalogue(['ecb.europa.eu', 'federalreserve.gov'])

      expect(events.slice(0, 2)).toEqual([
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
      const model = researchModel(() => conclusion, { sources: [] })
      const research = createResearch({ model, root })
      await send(research, 'How do central banks set interest rates?')

      const error = await send(research, 'How do tides work?').catch((error: unknown) => error)

      expect(error).toBeInstanceOf(ResearchConflict)
      expect(error).toHaveProperty('message', expect.stringMatching(/reset first/))
    })
  })

  describe('Retrieval', () => {
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

    async function retrieve(
      findings: Finding[],
      sources = ['ecb.europa.eu', 'federalreserve.gov'],
    ): Promise<{ events: ResearchEvent[]; written: string }> {
      const model = researchModel(() => conclusion, { sources, findings })

      const events = await send(createResearch({ model, root }), 'How do central banks set interest rates?')

      return { events, written: await readFile(join(root, 'central_bank_rate_setting_findings.md'), 'utf8') }
    }

    const fedFinding: Finding = {
      statement: 'The FOMC decided to maintain the target range for the federal funds rate.',
      url: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20250730a.htm',
      quote: 'the Committee decided to maintain the target range for the federal funds rate at 4-1/4 to 4-1/2 percent',
    }

    test('once the Source Catalogue is written, Findings are written with IDs F1…Fn, each with statement, URL and quote', async () => {
      const { events, written } = await retrieve([ecbFinding, fedFinding])

      expect(events.slice(0, 3)).toEqual([
        { type: 'step', step: 'grilling' },
        { type: 'step', step: 'source_catalogue' },
        { type: 'step', step: 'retrieval' },
      ])
      expect(written).toMatch(
        /F1[\s\S]*deposit facility rate at 2\.00%[\s\S]*ecb\.mp250724\.en\.html[\s\S]*will remain unchanged at 2\.00%[\s\S]*F2[\s\S]*maintain the target range[\s\S]*monetary20250730a\.htm[\s\S]*4-1\/4 to 4-1\/2 percent/,
      )
    })

    test('Findings from hosts outside the Source Catalogue are dropped; subdomains of its hosts are kept', async () => {
      const finding = (url: string, statement: string): Finding => ({ statement, url, quote: `Quoted: ${statement}` })

      const { written } = await retrieve([
        finding('https://en.wikipedia.org/wiki/European_Central_Bank', 'From Wikipedia'),
        finding('https://www.ecb.europa.eu/mopo/html/index.en.html', 'From an ECB subdomain'),
        finding('https://ecb.europa.eu.example.com/rates', 'From a lookalike host'),
        finding('https://notfederalreserve.gov/rates', 'From a host sharing a suffix'),
        finding('federalreserve.gov rates page', 'From a malformed URL'),
        finding('https://federalreserve.gov/monetarypolicy.htm', 'From the Fed itself'),
      ])

      expect(written).toMatch(/F1[\s\S]*From an ECB subdomain[\s\S]*F2[\s\S]*From the Fed itself/)
      expect(written).not.toMatch(/Wikipedia|lookalike|sharing a suffix|malformed|F3/)
    })

    test('zero valid Findings end the Research as Failed, with a reason, recorded by a Findings file with no entries', async () => {
      const { events, written } = await retrieve([
        { ...ecbFinding, url: 'https://en.wikipedia.org/wiki/European_Central_Bank' },
      ])

      expect(events.at(-1)).toEqual({ type: 'step', step: 'failed', reason: expect.stringMatching(/Findings/) })
      expect(written).not.toMatch(/F1/)
    })

    test('a message to a Research that Failed in Retrieval is rejected as a conflict: reset first', async () => {
      const research = createResearch({ model: researchModel(() => conclusion, { findings: [] }), root })
      await send(research, 'How do central banks set interest rates?')

      const error = await send(research, 'How do tides work?').catch((error: unknown) => error)

      expect(error).toBeInstanceOf(ResearchConflict)
      expect(error).toHaveProperty('message', expect.stringMatching(/reset first/))
    })
  })

  describe('Draft and Review', () => {
    const protocol = {
      scope: 'The ECB, 2025',
      goal: 'Understand the latest rate decision',
      audience: 'Pension fund trustees',
      openAssumptions: [],
    }
    const conclusion = structuredResponse({ done: true, topic: 'ECB rates', protocol })

    test('a question goes through a multi-turn Grilling to a Completed Research with a Report', async () => {
      const model = researchModel((messages) =>
        messages.some((message) => HumanMessage.isInstance(message) && message.text.includes('Pension fund trustees'))
          ? conclusion
          : structuredResponse({ question: 'Who is the audience?', recommendedAnswer: 'Retail investors' }),
      )
      const research = createResearch({ model, root })
      await send(research, 'What did the ECB decide on rates in July 2025?')

      const events = await send(research, 'Pension fund trustees')

      expect(events).toEqual([
        { type: 'step', step: 'grilling' },
        { type: 'step', step: 'source_catalogue' },
        { type: 'step', step: 'retrieval' },
        { type: 'step', step: 'draft', round: 1 },
        { type: 'step', step: 'review', round: 1 },
        { type: 'step', step: 'completed' },
      ])
      expect(await readFile(join(root, 'ecb_rates_report.md'), 'utf8')).toMatch(
        /deposit facility rate unchanged at 2\.00% in July 2025 \[F1\][\s\S]*stayed at 2\.00% \[F1\][\s\S]*weighs inflation expectations[\s\S]*compare with the Fed\?/,
      )
    })

    test('the Sources section lists only the cited Findings, grouped by host', async () => {
      const finding = (url: string): Finding => ({ statement: `Stated at ${url}`, url, quote: 'Quoted.' })
      const findings = [
        finding('https://www.ecb.europa.eu/press/pr/date/2025/html/ecb.mp250724.en.html'),
        finding('https://www.federalreserve.gov/newsevents/pressreleases/monetary20250730a.htm'),
        finding('https://www.ecb.europa.eu/press/pr/date/2025/html/ecb.mp250605.en.html'),
        finding('https://www.federalreserve.gov/monetarypolicy/openmarket.htm'),
      ]
      const model = researchModel(() => conclusion, {
        sources: ['ecb.europa.eu', 'federalreserve.gov'],
        findings,
        draft: () => ({
          summary: 'The Fed held [F2]; the ECB held in July [F3] and in June [F1].',
          keyFacts: ['Both central banks held their rates [F1, F2].'],
          gaps: [],
          followUpQuestions: [],
        }),
      })

      await send(createResearch({ model, root }), 'What did the ECB and the Fed decide in summer 2025?')

      expect(await readFile(join(root, 'ecb_rates_draft_1.md'), 'utf8')).toMatch(
        /## Sources\n\n### www\.ecb\.europa\.eu\n\n- \[F1\] https:\/\/www\.ecb\.europa\.eu\/press\/pr\/date\/2025\/html\/ecb\.mp250724\.en\.html\n- \[F3\] https:\/\/www\.ecb\.europa\.eu\/press\/pr\/date\/2025\/html\/ecb\.mp250605\.en\.html\n\n### www\.federalreserve\.gov\n\n- \[F2\] https:\/\/www\.federalreserve\.gov\/newsevents\/pressreleases\/monetary20250730a\.htm\n$/,
      )
    })

    test.each([passingReview, failingReview])(
      'the Review Artifact carries the verdict in front-matter: $verdict',
      async (response) => {
        const model = researchModel(() => conclusion, { review: () => response })

        await send(createResearch({ model, root }), 'What did the ECB decide on rates in July 2025?')

        const written = await readFile(join(root, 'ecb_rates_review_1.md'), 'utf8')
        expect(written).toMatch(new RegExp(`^---\\nverdict: ${response.verdict}\\n---\\n`))
        for (const { claim, reason } of response.offendingClaims) {
          expect(written).toContain(claim)
          expect(written).toContain(reason)
        }
      },
    )

    test('a message to a Completed Research is rejected as a conflict: reset first', async () => {
      const research = createResearch({ model: researchModel(() => conclusion), root })
      await send(research, 'What did the ECB decide on rates in July 2025?')

      const error = await send(research, 'How do tides work?').catch((error: unknown) => error)

      expect(error).toBeInstanceOf(ResearchConflict)
      expect(error).toHaveProperty('message', expect.stringMatching(/reset first/))
    })

    test('a Draft without its Review is reviewed next, without drafting again', async () => {
      const model = researchModel(() => conclusion, { review: flaky(2, passingReview) })
      const research = createResearch({ model, root })
      await send(research, 'What did the ECB decide on rates in July 2025?')

      const events = await send(research, 'Go on')

      expect(events).toEqual([
        { type: 'step', step: 'review', round: 1 },
        { type: 'step', step: 'completed' },
      ])
      expect(await readdir(root)).toContain('ecb_rates_report.md')
    })
  })

  describe('Rounds', () => {
    const conclusion = structuredResponse({
      done: true,
      topic: 'ECB rates',
      protocol: {
        scope: 'The ECB, 2025',
        goal: 'Understand the latest rate decision',
        audience: 'Pension fund trustees',
        openAssumptions: [],
      },
    })

    /** The n-th Draft, told apart by its summary. */
    function nthDraft(n: number): Draft {
      return { ...ecbDraft, summary: `Draft ${n}: the ECB held its deposit facility rate at 2.00% [F1].` }
    }

    function humanText(messages: BaseMessage[]): string {
      return messages
        .filter((message) => HumanMessage.isInstance(message))
        .map((message) => message.text)
        .join('\n')
    }

    test('a failing Review leads to the next Draft, whose agent sees the previous Draft and its Review', async () => {
      const draftInputs: string[] = []
      const reviews = [failingReview, passingReview]
      const model = researchModel(() => conclusion, {
        draft: (messages) => {
          draftInputs.push(humanText(messages))

          return nthDraft(draftInputs.length)
        },
        review: () => defined(reviews.shift()),
      })

      const events = await send(createResearch({ model, root }), 'What did the ECB decide on rates in July 2025?')

      expect(events.slice(3)).toEqual([
        { type: 'step', step: 'draft', round: 1 },
        { type: 'step', step: 'review', round: 1 },
        { type: 'step', step: 'draft', round: 2 },
        { type: 'step', step: 'review', round: 2 },
        { type: 'step', step: 'completed' },
      ])
      expect(draftInputs[1]).toMatch(
        /Draft 1: the ECB held[\s\S]*The ECB cut rates in July 2025\.[\s\S]*F1 says the rates stayed unchanged/,
      )
    })

    test('fail, fail, pass: the Research is Completed with the Round 3 Draft as the Report', async () => {
      let drafts = 0
      const reviews = [failingReview, failingReview, passingReview]
      const model = researchModel(() => conclusion, {
        draft: () => nthDraft((drafts += 1)),
        review: () => defined(reviews.shift()),
      })

      const events = await send(createResearch({ model, root }), 'What did the ECB decide on rates in July 2025?')

      expect(events.at(-1)).toEqual({ type: 'step', step: 'completed' })
      expect(await readFile(join(root, 'ecb_rates_report.md'), 'utf8')).toMatch(/Draft 3: the ECB held/)
    })

    test('three failed Rounds end the Research as Failed, with a reason, keeping every Draft and Review', async () => {
      const model = researchModel(() => conclusion, { review: () => failingReview })

      const events = await send(createResearch({ model, root }), 'What did the ECB decide on rates in July 2025?')

      expect(events.slice(3)).toEqual([
        { type: 'step', step: 'draft', round: 1 },
        { type: 'step', step: 'review', round: 1 },
        { type: 'step', step: 'draft', round: 2 },
        { type: 'step', step: 'review', round: 2 },
        { type: 'step', step: 'draft', round: 3 },
        { type: 'step', step: 'review', round: 3 },
        { type: 'step', step: 'failed', reason: expect.stringMatching(/Review/) },
      ])
      expect(await readdir(root)).toEqual(
        expect.arrayContaining([
          'ecb_rates_draft_1.md',
          'ecb_rates_review_1.md',
          'ecb_rates_draft_2.md',
          'ecb_rates_review_2.md',
          'ecb_rates_draft_3.md',
          'ecb_rates_review_3.md',
        ]),
      )
      expect(await readdir(root)).not.toContain('ecb_rates_report.md')
    })

    test('a message to a Research whose three Rounds failed is rejected as a conflict: reset first', async () => {
      const research = createResearch({ model: researchModel(() => conclusion, { review: () => failingReview }), root })
      await send(research, 'What did the ECB decide on rates in July 2025?')

      const error = await send(research, 'How do tides work?').catch((error: unknown) => error)

      expect(error).toBeInstanceOf(ResearchConflict)
      expect(error).toHaveProperty('message', expect.stringMatching(/reset first/))
    })

    test('an Interrupted Research after a failed Review resumes with the next Draft', async () => {
      let drafts = 0
      let interruptions = 0
      const model = researchModel(() => conclusion, {
        draft: () => {
          if (drafts === 1 && interruptions < 2) {
            interruptions += 1
            throw new Error('overloaded')
          }

          return nthDraft((drafts += 1))
        },
        review: () => (drafts === 1 ? failingReview : passingReview),
      })
      const research = createResearch({ model, root })
      await send(research, 'What did the ECB decide on rates in July 2025?')

      const events = await send(research, 'Go on')

      expect(events).toEqual([
        { type: 'step', step: 'draft', round: 2 },
        { type: 'step', step: 'review', round: 2 },
        { type: 'step', step: 'completed' },
      ])
      expect(await readFile(join(root, 'ecb_rates_report.md'), 'utf8')).toMatch(/Draft 2: the ECB held/)
    })
  })

  describe('Interruptions', () => {
    const conclusion = structuredResponse({
      done: true,
      topic: 'ECB rates',
      protocol: {
        scope: 'The ECB, 2025',
        goal: 'Understand the latest rate decision',
        audience: 'Pension fund trustees',
        openAssumptions: [],
      },
    })

    test('a single agent error is retried transparently and the Research goes on', async () => {
      const model = researchModel(() => conclusion, { review: flaky(1, passingReview) })

      const events = await send(createResearch({ model, root }), 'What did the ECB decide on rates in July 2025?')

      expect(events.slice(3)).toEqual([
        { type: 'step', step: 'draft', round: 1 },
        { type: 'step', step: 'review', round: 1 },
        { type: 'step', step: 'completed' },
      ])
    })

    test('two consecutive agent errors end the stream with failed, with a reason, and leave no Artifact for the Step', async () => {
      const model = researchModel(() => conclusion, { draft: flaky(2, ecbDraft) })

      const events = await send(createResearch({ model, root }), 'What did the ECB decide on rates in July 2025?')

      expect(events.slice(3)).toEqual([
        { type: 'step', step: 'draft', round: 1 },
        { type: 'step', step: 'failed', reason: expect.stringMatching(/Draft[\s\S]*overloaded/) },
      ])
      expect(await readdir(root)).not.toContain('ecb_rates_draft_1.md')
    })

    test('schema-invalid output is retried like an error', async () => {
      const reviews = [{ verdict: 'maybe', offendingClaims: [] }, passingReview] as Review[]
      const model = researchModel(() => conclusion, { review: () => defined(reviews.shift()) })

      const events = await send(createResearch({ model, root }), 'What did the ECB decide on rates in July 2025?')

      expect(events.slice(3)).toEqual([
        { type: 'step', step: 'draft', round: 1 },
        { type: 'step', step: 'review', round: 1 },
        { type: 'step', step: 'completed' },
      ])
    })

    test('the next message resumes from the interrupted Step without running earlier Steps again', async () => {
      const model = researchModel(() => conclusion, { draft: flaky(2, ecbDraft) })
      const research = createResearch({ model, root })
      await send(research, 'What did the ECB decide on rates in July 2025?')

      const events = await send(research, 'Go on')

      expect(events).toEqual([
        { type: 'step', step: 'draft', round: 1 },
        { type: 'step', step: 'review', round: 1 },
        { type: 'step', step: 'completed' },
      ])
    })

    describe('during Grilling', () => {
      /** Asks one question, errors on the given calls, and concludes once the question is answered. */
      function interruptedGrilling(failingCalls: number[]): {
        model: ReturnType<typeof researchModel>
        seen: string[]
      } {
        const seen: string[] = []
        let calls = 0
        const model = researchModel((messages) => {
          calls += 1
          const message = defined(messages.find((message) => HumanMessage.isInstance(message))).text
          seen.push(message)

          if (failingCalls.includes(calls)) {
            throw new Error('overloaded')
          }

          return message.includes('\nAnswer: ')
            ? conclusion
            : structuredResponse({ question: 'Who is the audience?', recommendedAnswer: 'Retail investors' })
        })

        return { model, seen }
      }

      test('an interrupted answer is kept, and the next message resumes Grilling with it instead of answering', async () => {
        const { model, seen } = interruptedGrilling([2, 3])
        const research = createResearch({ model, root })
        await send(research, 'What did the ECB decide on rates in July 2025?')
        await send(research, 'Pension fund trustees')

        const events = await send(research, 'Go on')

        expect(events.slice(0, 2)).toEqual([
          { type: 'step', step: 'grilling' },
          { type: 'step', step: 'source_catalogue' },
        ])
        expect(seen.at(-1)).toContain('Answer: Pension fund trustees')
        expect(seen.at(-1)).not.toContain('Go on')
      })

      test('an interrupted first turn keeps the question, and the next message resumes Grilling with it', async () => {
        const { model } = interruptedGrilling([1, 2])
        const research = createResearch({ model, root })
        const interrupted = await send(research, 'What did the ECB decide on rates in July 2025?')

        const events = await send(research, 'Go on')

        expect(interrupted.at(-1)).toEqual({
          type: 'step',
          step: 'failed',
          reason: expect.stringMatching(/Grilling[\s\S]*overloaded/),
        })
        expect(events.at(-1)).toEqual({ type: 'step', step: 'awaiting_answer' })
        expect(JSON.parse(await research.readArtifact('grilling_transcript.json'))).toEqual({
          question: 'What did the ECB decide on rates in July 2025?',
          turns: [{ question: 'Who is the audience?', recommendedAnswer: 'Retail investors' }],
        })
      })
    })
  })

  describe('Artifacts', () => {
    const questionModel = () =>
      scriptedChatModel(() =>
        structuredResponse({ question: 'Who is the audience?', recommendedAnswer: 'Retail investors' }),
      )

    test('after a Grilling turn, the transcript is listed and can be read', async () => {
      const research = createResearch({ model: questionModel(), root })
      await send(research, 'How do central banks set interest rates?')

      expect(await research.listArtifacts()).toEqual(['grilling_transcript.json'])
      expect(JSON.parse(await research.readArtifact('grilling_transcript.json'))).toEqual({
        question: 'How do central banks set interest rates?',
        turns: [{ question: 'Who is the audience?', recommendedAnswer: 'Retail investors' }],
      })
    })

    test('reading an Artifact that does not exist is rejected as not found', async () => {
      const research = createResearch({ model: questionModel(), root })
      await send(research, 'How do central banks set interest rates?')

      await expect(research.readArtifact('fake_research_report.md')).rejects.toThrow(ArtifactNotFound)
    })

    test.each([
      ['a parent segment', () => `../${basename(root)}/grilling_transcript.json`],
      ['a current-directory segment', () => './grilling_transcript.json'],
      ['an absolute path', () => join(root, 'grilling_transcript.json')],
      ['encoded separators', () => `..%2F${basename(root)}%2Fgrilling_transcript.json`],
      ['the parent directory', () => '..'],
    ])('reading by %s is rejected as not found, even where it points at an Artifact', async (_, name) => {
      const research = createResearch({ model: questionModel(), root })
      await send(research, 'How do central banks set interest rates?')

      await expect(research.readArtifact(name())).rejects.toThrow(ArtifactNotFound)
    })
  })

  describe('Reset', () => {
    const conclusion = structuredResponse({
      done: true,
      topic: 'ECB rates',
      protocol: {
        scope: 'The ECB, 2025',
        goal: 'Understand the latest rate decision',
        audience: 'Pension fund trustees',
        openAssumptions: [],
      },
    })

    /** A model whose Draft agent never answers, signalling once the Draft Step is running. */
    function stuckInDraft(): { model: ReturnType<typeof researchModel>; drafting: Promise<void> } {
      const drafting = Promise.withResolvers<void>()
      const model = researchModel(() => conclusion, {
        draft: () => {
          drafting.resolve()

          return new Promise<Draft>(() => {})
        },
      })

      return { model, drafting: drafting.promise }
    }

    test('reset during a running Step aborts it, ending its stream with failed, and leaves no Artifacts', async () => {
      const { model, drafting } = stuckInDraft()
      const research = createResearch({ model, root })
      const events: ResearchEvent[] = []
      const running = research.send('What did the ECB decide on rates in July 2025?', (event) => {
        events.push(event)
      })
      await drafting

      await research.reset()
      await running

      expect(events.at(-1)).toEqual({ type: 'step', step: 'failed', reason: expect.stringMatching(/reset/) })
      expect(await research.listArtifacts()).toEqual([])
    })

    test('a message while a Step is running is rejected as a conflict', async () => {
      const { model, drafting } = stuckInDraft()
      const research = createResearch({ model, root })
      const running = research.send('What did the ECB decide on rates in July 2025?', () => {})
      await drafting

      const error = await send(research, 'How do tides work?').catch((error: unknown) => error)

      expect(error).toBeInstanceOf(ResearchConflict)
      expect(error).toHaveProperty('message', expect.stringMatching(/running/))
      await research.reset()
      await running
    })

    test('after a reset, the next message starts a new Research from Grilling', async () => {
      const model = researchModel((messages) =>
        messages.some((message) => HumanMessage.isInstance(message) && message.text.includes('How do tides work?'))
          ? structuredResponse({ question: 'Which coast?', recommendedAnswer: 'The North Sea' })
          : conclusion,
      )
      const research = createResearch({ model, root })
      await send(research, 'What did the ECB decide on rates in July 2025?')

      await research.reset()
      const events = await send(research, 'How do tides work?')

      expect(events).toEqual([
        { type: 'step', step: 'grilling' },
        { type: 'text', text: expect.stringMatching(/Q1[\s\S]*Which coast\?/) },
        { type: 'step', step: 'awaiting_answer' },
      ])
      expect(await research.listArtifacts()).toEqual(['grilling_transcript.json'])
    })
  })
})
