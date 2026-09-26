import { z } from 'zod'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runAgent } from '../../infrastructure/agent/client.ts'
import { chatModel } from '../../infrastructure/agent/model.ts'
import { webSearchTool, webToolsFor } from '../../infrastructure/agent/providers/anthropic.ts'
import { type Script, structuredResponse } from '../../infrastructure/agent/scripted-chat-model.ts'
import type { Model } from '../../infrastructure/agent/types.ts'
import { defined } from '../../infrastructure/utils/utils.ts'
import { appSkill, researchDirectory } from './paths.ts'

export type ResearchEvent =
  | { type: 'step'; step: 'grilling' | 'awaiting_answer' | 'source_catalogue' | 'retrieval' | 'completed' }
  | { type: 'step'; step: 'draft' | 'review'; round: number }
  | { type: 'step'; step: 'failed'; reason: string }
  | { type: 'text'; text: string }

/** A message the Research can't take in its state, e.g. one sent to a Failed Research. */
export class ResearchConflict extends Error {
  override name = 'ResearchConflict'
}

export type Emit = (event: ResearchEvent) => void | Promise<void>

export type Research = {
  /** Advances the Research according to its state, emitting progress until a terminal step value. */
  send(message: string, emit: Emit): Promise<void>
}

type ResearchConfig = {
  model?: Model
  /** The directory holding the Research's Artifacts. */
  root?: string
}

type GrillingProtocol = z.infer<typeof grillingProtocol>

type SourceCatalogue = z.infer<typeof sourceCatalogue>

type Finding = z.infer<typeof finding>

type Draft = z.infer<typeof draft>

type Review = z.infer<typeof review>

type Verdict = Review['verdict']

/** One Draft followed by its Review, numbered from 1. */
type Round = { topic: string; round: number }

type GrillingTurn = { question: string; recommendedAnswer: string; answer?: string }

/** Working file of the Grilling Step, kept until the Grilling Protocol exists. */
type GrillingTranscript = { question: string; turns: GrillingTurn[] }

const GRILLING_TRANSCRIPT = 'grilling_transcript.json'
const GRILLING_PROTOCOL_SUFFIX = '_grilling_protocol.md'
const SOURCE_CATALOGUE_SUFFIX = '_source_catalogue.json'
const FINDINGS_SUFFIX = '_findings.md'
const REPORT_SUFFIX = '_report.md'
/** The heading of the first Finding; a Findings file without it has no entries. */
const FIRST_FINDING = /^## F1$/m
const MAX_TOPIC_SLUG_LENGTH = 50
/** For a Topic with no ASCII letters or digits to keep. */
const FALLBACK_TOPIC_SLUG = 'research'

const grillingProtocol = z.object({
  scope: z.string(),
  goal: z.string(),
  audience: z.string(),
  openAssumptions: z.array(z.string()),
})

const grillingQuestion = z.object({
  question: z.string(),
  recommendedAnswer: z.string(),
})

const grillingConclusion = z.object({
  done: z.literal(true),
  topic: z.string(),
  protocol: grillingProtocol,
})

/** Either a question or a conclusion, flattened into one object as the model's tool input must be an object. */
const grillingResponse = z.object({
  question: z.string().optional().describe('Your next question, while scope, goal or audience are still open.'),
  recommendedAnswer: z.string().optional().describe('Your recommended answer to the question.'),
  done: z.boolean().optional().describe('true once scope, goal and audience are settled.'),
  topic: z.string().optional().describe('A short name for the Research, a few words long.'),
  protocol: grillingProtocol.optional().describe('The agreed scope, goal and audience, plus any open assumptions.'),
})

const grillingOutcome = z.union([grillingConclusion, grillingQuestion])

const sourceCatalogue = z.object({
  sources: z.array(z.string()).describe('Bare hosts of the Primary Sources, e.g. "ecb.europa.eu".'),
})

const finding = z.object({
  statement: z.string().describe('What the source states, in your own words.'),
  url: z.string().describe('The exact URL of the page the quote is taken from.'),
  quote: z.string().describe('The passage backing the statement, quoted verbatim from the page.'),
})

const retrieval = z.object({
  findings: z.array(finding).describe('Every Finding you gathered, each from a host in the Source Catalogue.'),
})

const draft = z.object({
  summary: z.string().describe('A short answer to the Research question, citing Findings inline as [Fn].'),
  keyFacts: z.array(z.string()).describe('The key facts, each citing the Findings backing it inline as [Fn].'),
  gaps: z.array(z.string()).describe('What the Research wanted to know but no Finding backs.'),
  followUpQuestions: z.array(z.string()).describe('Questions worth researching next.'),
})

const review = z.object({
  verdict: z.enum(['pass', 'fail']).describe('pass only if every Claim cites a Finding that supports it.'),
  offendingClaims: z
    .array(
      z.object({
        claim: z.string().describe('The Claim, quoted from the Draft.'),
        reason: z.string().describe('Why it fails: no citation, or a cited Finding that does not support it.'),
      }),
    )
    .describe('Every Claim that fails; empty on pass.'),
})

const GRILLING_SYSTEM_PROMPT = `You run the Grilling Step of a Research: interview the researcher about the scope, goal and audience of their Research, following the grilling skill.
You are given the researcher's question and the interview so far. Respond with either your next question and your recommended answer to it, or, once scope, goal and audience are settled, conclude with a Topic and the Grilling Protocol.`

const SOURCE_CATALOGUE_SYSTEM_PROMPT = `You run the Source Catalogue Step of a Research: find the Primary Sources relevant to it, following the source-catalogue skill.
You are given the Grilling Protocol of the Research. Search the web as much as you need, then respond with the bare hosts of the Primary Sources.`

const RETRIEVAL_SYSTEM_PROMPT = `You run the Retrieval Step of a Research: gather raw, quoted Findings from its Primary Sources, following the retrieval skill.
You are given the Grilling Protocol and the Source Catalogue of the Research. Search and read only the hosts in the Source Catalogue, then respond with every Finding you gathered.`

const DRAFT_SYSTEM_PROMPT = `You run the Draft Step of a Research: write the Report from its Findings, following the draft skill.
You are given the Grilling Protocol and the Findings of the Research, and from the second Round on, the previous Draft and its failing Review. Respond with the summary, key facts, Gaps and follow-up questions, citing the Finding behind every Claim inline as [Fn].`

const REVIEW_SYSTEM_PROMPT = `You run the Review Step of a Research: check that every Claim in a Draft cites a Finding that supports it, following the review skill.
You are given the Draft and the Findings of the Research. Respond with your verdict and every offending Claim.`

const NO_PRIMARY_SOURCES = 'No Primary Source could be identified for the Research.'
const NO_FINDINGS = 'Retrieval found no Findings on the Primary Sources of the Research.'
const ALL_ROUNDS_FAILED = 'The Draft failed Review in every Round.'
const RESET_FIRST = 'The Research has ended; reset first to start a new one.'

const MAX_GRILLING_QUESTIONS = 5
const MAX_ROUNDS = 3

const CONCLUDE_INSTRUCTION = `You have asked ${MAX_GRILLING_QUESTIONS} questions, the maximum. Conclude now with a Topic and the Grilling Protocol, recording every unresolved point as an open assumption.`

/**
 * Grilling asks one question, then concludes once it is answered; the Source Catalogue lists two central banks,
 * Retrieval finds one Finding on each, and the Draft citing both passes Review.
 */
const fakeScript: Script = (messages) => {
  const system = messages.find((message) => SystemMessage.isInstance(message))?.text ?? ''

  if (system.includes(SOURCE_CATALOGUE_SYSTEM_PROMPT)) {
    return structuredResponse({ sources: ['ecb.europa.eu', 'federalreserve.gov'] })
  }

  if (system.includes(DRAFT_SYSTEM_PROMPT)) {
    return structuredResponse({
      summary: 'The ECB [F1] and the Fed [F2] each set their own policy rates.',
      keyFacts: ['The ECB sets three key interest rates for the euro area [F1].'],
      gaps: ['How the two central banks coordinate, if at all.'],
      followUpQuestions: ['How have both policy rates moved since 2020?'],
    })
  }

  if (system.includes(REVIEW_SYSTEM_PROMPT)) {
    return structuredResponse({ verdict: 'pass', offendingClaims: [] })
  }

  if (system.includes(RETRIEVAL_SYSTEM_PROMPT)) {
    return structuredResponse({
      findings: [
        {
          statement: 'The ECB sets three key interest rates for the euro area.',
          url: 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.en.html',
          quote: 'The Governing Council of the ECB sets the key interest rates for the euro area',
        },
        {
          statement: 'The FOMC sets a target range for the federal funds rate.',
          url: 'https://www.federalreserve.gov/monetarypolicy/openmarket.htm',
          quote: 'The FOMC sets a target range for the federal funds rate',
        },
      ],
    })
  }

  return messages.some((message) => HumanMessage.isInstance(message) && message.text.includes('\nAnswer: '))
    ? structuredResponse({
        done: true,
        topic: 'Fake Research',
        protocol: {
          scope: 'Whatever the question asks, as of today.',
          goal: 'A first overview.',
          audience: 'Someone curious but new to the topic.',
          openAssumptions: ['No particular geography or time frame.'],
        },
      })
    : structuredResponse({
        question: 'Who is the audience of the Report?',
        recommendedAnswer: 'Yourself: someone curious but new to the topic.',
      })
}

export function createResearch({
  model = chatModel(fakeScript),
  root = researchDirectory(),
}: ResearchConfig = {}): Research {
  /** Runs one Grilling turn, returning the Topic once Grilling concludes. */
  async function grill(transcript: GrillingTranscript, emit: Emit): Promise<string | undefined> {
    await emit({ type: 'step', step: 'grilling' })

    // At the cap, the agent is told to conclude, and only a conclusion is accepted.
    const mustConclude = transcript.turns.length >= MAX_GRILLING_QUESTIONS
    const outcome = (mustConclude ? grillingConclusion : grillingOutcome).parse(
      await runAgent({
        model,
        systemPrompt: GRILLING_SYSTEM_PROMPT,
        message: [renderTranscript(transcript), ...(mustConclude ? [CONCLUDE_INSTRUCTION] : [])].join('\n\n'),
        responseFormat: mustConclude ? grillingConclusion : grillingResponse,
        skill: appSkill('grilling'),
      }),
    )

    await mkdir(root, { recursive: true })

    if ('done' in outcome) {
      const topic = slugify(outcome.topic)

      await writeFile(
        join(root, `${topic}${GRILLING_PROTOCOL_SUFFIX}`),
        renderProtocol(transcript.question, outcome.protocol),
      )
      await rm(join(root, GRILLING_TRANSCRIPT), { force: true })

      return topic
    }

    transcript.turns.push(outcome)

    await writeFile(join(root, GRILLING_TRANSCRIPT), JSON.stringify(transcript, null, 2))

    await emit({ type: 'text', text: renderQuestion(outcome, transcript.turns.length) })
    await emit({ type: 'step', step: 'awaiting_answer' })

    return undefined
  }

  /** Runs the Source Catalogue Step, returning whether the Research goes on. */
  async function catalogueSources(topic: string, emit: Emit): Promise<boolean> {
    await emit({ type: 'step', step: 'source_catalogue' })

    const { sources } = await runAgent({
      model,
      systemPrompt: SOURCE_CATALOGUE_SYSTEM_PROMPT,
      message: await readFile(join(root, `${topic}${GRILLING_PROTOCOL_SUFFIX}`), 'utf8'),
      responseFormat: sourceCatalogue,
      tools: [webSearchTool],
      skill: appSkill('source-catalogue'),
    })

    const hosts = normaliseHosts(sources)

    // An empty Source Catalogue is kept: it records that the Research failed.
    await writeFile(join(root, `${topic}${SOURCE_CATALOGUE_SUFFIX}`), JSON.stringify({ sources: hosts }, null, 2))

    if (!hosts.length) {
      await emit({ type: 'step', step: 'failed', reason: NO_PRIMARY_SOURCES })
    }

    return hosts.length > 0
  }

  /** Runs the Retrieval Step, returning whether the Research goes on. */
  async function retrieve(topic: string, emit: Emit): Promise<boolean> {
    await emit({ type: 'step', step: 'retrieval' })

    const { sources } = await readSourceCatalogue(topic)
    const { findings } = await runAgent({
      model,
      systemPrompt: RETRIEVAL_SYSTEM_PROMPT,
      message: [
        await readFile(join(root, `${topic}${GRILLING_PROTOCOL_SUFFIX}`), 'utf8'),
        renderSourceCatalogue(sources),
      ].join('\n\n'),
      responseFormat: retrieval,
      tools: webToolsFor(sources),
      skill: appSkill('retrieval'),
    })

    const valid = findings.filter(({ url }) => isOnSource(url, sources))

    // A Findings file with no entries is kept: it records that the Research failed.
    await writeFile(join(root, `${topic}${FINDINGS_SUFFIX}`), renderFindings(valid))

    if (!valid.length) {
      await emit({ type: 'step', step: 'failed', reason: NO_FINDINGS })
    }

    return valid.length > 0
  }

  /** Runs the Draft Step of the Round. */
  async function writeDraft({ topic, round }: Round, emit: Emit): Promise<void> {
    await emit({ type: 'step', step: 'draft', round })

    const findings = await readFile(join(root, `${topic}${FINDINGS_SUFFIX}`), 'utf8')
    // From Round 2, the agent revises the previous Draft against its failing Review.
    const previous =
      round > 1
        ? [
            await readFile(join(root, draftName(topic, round - 1)), 'utf8'),
            await readFile(join(root, reviewName(topic, round - 1)), 'utf8'),
          ]
        : []
    const response = await runAgent({
      model,
      systemPrompt: DRAFT_SYSTEM_PROMPT,
      message: [await readFile(join(root, `${topic}${GRILLING_PROTOCOL_SUFFIX}`), 'utf8'), findings, ...previous].join(
        '\n\n',
      ),
      responseFormat: draft,
      skill: appSkill('draft'),
    })

    await writeFile(join(root, draftName(topic, round)), renderDraft(response, parseFindingUrls(findings)))
  }

  /** Runs the Review Step of the Round, returning its verdict. */
  async function reviewDraft({ topic, round }: Round, emit: Emit): Promise<Verdict> {
    await emit({ type: 'step', step: 'review', round })

    const response = await runAgent({
      model,
      systemPrompt: REVIEW_SYSTEM_PROMPT,
      message: [
        await readFile(join(root, draftName(topic, round)), 'utf8'),
        await readFile(join(root, `${topic}${FINDINGS_SUFFIX}`), 'utf8'),
      ].join('\n\n'),
      responseFormat: review,
      skill: appSkill('review'),
    })

    await writeFile(join(root, reviewName(topic, round)), renderReview(response, round))

    return response.verdict
  }

  async function readVerdict({ topic, round }: Round): Promise<Verdict> {
    const verdict = (await readFile(join(root, reviewName(topic, round)), 'utf8')).match(/^---\nverdict: (\w+)\n/)?.[1]

    return review.shape.verdict.parse(verdict)
  }

  async function hasFindings(topic: string): Promise<boolean> {
    return FIRST_FINDING.test(await readFile(join(root, `${topic}${FINDINGS_SUFFIX}`), 'utf8'))
  }

  async function readSourceCatalogue(topic: string): Promise<SourceCatalogue> {
    return sourceCatalogue.parse(JSON.parse(await readFile(join(root, `${topic}${SOURCE_CATALOGUE_SUFFIX}`), 'utf8')))
  }

  /** The names of all Artifacts and working files. */
  async function artifactNames(): Promise<string[]> {
    try {
      return await readdir(root)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }

      throw error
    }
  }

  /** The Grilling transcript, if Grilling has started. */
  async function readTranscript(): Promise<GrillingTranscript | undefined> {
    try {
      return JSON.parse(await readFile(join(root, GRILLING_TRANSCRIPT), 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined
      }

      throw error
    }
  }

  return {
    async send(message, emit) {
      const names = await artifactNames()
      const protocol = names.find((name) => name.endsWith(GRILLING_PROTOCOL_SUFFIX))
      let topic = protocol?.slice(0, -GRILLING_PROTOCOL_SUFFIX.length)

      if (topic === undefined) {
        const transcript = await readTranscript()

        if (transcript) {
          defined(transcript.turns.at(-1)).answer = message
        }

        topic = await grill(transcript ?? { question: message, turns: [] }, emit)

        if (topic === undefined) {
          return
        }
      }

      if (!names.includes(`${topic}${SOURCE_CATALOGUE_SUFFIX}`)) {
        if (!(await catalogueSources(topic, emit))) {
          return
        }
      } else if (!(await readSourceCatalogue(topic)).sources.length) {
        // An empty Source Catalogue means Failed.
        throw new ResearchConflict(RESET_FIRST)
      }

      if (!names.includes(`${topic}${FINDINGS_SUFFIX}`)) {
        if (!(await retrieve(topic, emit))) {
          return
        }
      } else if (!(await hasFindings(topic))) {
        // A Findings file with no entries means Failed.
        throw new ResearchConflict(RESET_FIRST)
      }

      if (names.includes(`${topic}${REPORT_SUFFIX}`)) {
        throw new ResearchConflict(RESET_FIRST)
      }

      let round = Math.max(1, lastRound(topic, names))
      let verdict = names.includes(reviewName(topic, round)) ? await readVerdict({ topic, round }) : undefined

      if (verdict === 'fail' && round === MAX_ROUNDS) {
        // A failed last Round means Failed.
        throw new ResearchConflict(RESET_FIRST)
      }

      while (verdict !== 'pass') {
        if (verdict === 'fail') {
          if (round === MAX_ROUNDS) {
            await emit({ type: 'step', step: 'failed', reason: ALL_ROUNDS_FAILED })

            return
          }

          round += 1
        }

        // A Draft without its Review is reviewed, not drafted again.
        if (!names.includes(draftName(topic, round))) {
          await writeDraft({ topic, round }, emit)
        }

        verdict = await reviewDraft({ topic, round }, emit)
      }

      await copyFile(join(root, draftName(topic, round)), join(root, `${topic}${REPORT_SUFFIX}`))
      await emit({ type: 'step', step: 'completed' })
    },
  }
}

function draftName(topic: string, round: number): string {
  return `${topic}_draft_${round}.md`
}

function reviewName(topic: string, round: number): string {
  return `${topic}_review_${round}.md`
}

/** The number of the latest Round with a Draft, 0 before the first. */
function lastRound(topic: string, names: string[]): number {
  const rounds = names.flatMap((name) => {
    const [, prefix, round] = name.match(/^(.+)_draft_(\d+)\.md$/) ?? []

    return prefix === topic ? [Number(round)] : []
  })

  return Math.max(0, ...rounds)
}

/** The URL of each Finding in a rendered Findings file, by its ID. */
function parseFindingUrls(findings: string): Map<string, string> {
  return new Map(
    findings
      .split(/^## /m)
      .slice(1)
      .flatMap((entry) => {
        const id = entry.match(/^F\d+$/m)?.[0]
        const url = entry.match(/^URL: (.+)$/m)?.[1]

        return id && url ? [[id, url] as const] : []
      }),
  )
}

/** The Draft with a Sources section listing only the Findings it cites, grouped by host. */
function renderDraft({ summary, keyFacts, gaps, followUpQuestions }: Draft, findingUrls: Map<string, string>): string {
  const list = (items: string[]) => (items.length ? items.map((item) => `- ${item}`).join('\n') : 'None.')

  return `# Report

## Summary

${summary}

## Key facts

${list(keyFacts)}

## Gaps

${list(gaps)}

## Follow-up questions

${list(followUpQuestions)}

## Sources

${renderSources([summary, ...keyFacts, ...gaps, ...followUpQuestions].join('\n'), findingUrls)}
`
}

/** The cited Findings' URLs grouped by host, hosts in order of first citation; citations of unknown IDs are ignored. */
function renderSources(text: string, findingUrls: Map<string, string>): string {
  const cited = [
    ...new Set([...text.matchAll(/\[(F\d+(?:\s*,\s*F\d+)*)\]/g)].flatMap(([, ids]) => ids.split(/\s*,\s*/))),
  ]
    .filter((id) => findingUrls.has(id))
    .toSorted((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
  const byHost = Map.groupBy(cited, (id) => new URL(defined(findingUrls.get(id))).hostname)

  if (!byHost.size) {
    return 'None.'
  }

  return [...byHost]
    .map(([host, ids]) => `### ${host}\n\n${ids.map((id) => `- [${id}] ${findingUrls.get(id)}`).join('\n')}`)
    .join('\n\n')
}

function renderReview({ verdict, offendingClaims }: Review, round: number): string {
  const offending = offendingClaims.length
    ? offendingClaims.map(({ claim, reason }) => `- ${claim}\n  - ${reason}`).join('\n')
    : 'None.'

  return `---
verdict: ${verdict}
---

# Review ${round}

## Offending Claims

${offending}
`
}

function renderTranscript({ question, turns }: GrillingTranscript): string {
  const interview = turns.map(
    (turn, index) =>
      `Q${index + 1}: ${turn.question}\nRecommended answer: ${turn.recommendedAnswer}\nAnswer: ${turn.answer}`,
  )

  return [`Research question: ${question}`, ...interview].join('\n\n')
}

function renderQuestion({ question, recommendedAnswer }: GrillingTurn, number: number): string {
  return `❓ **Q${number}**: ${question}\n\n➡️ ${recommendedAnswer}`
}

function renderProtocol(question: string, { scope, goal, audience, openAssumptions }: GrillingProtocol): string {
  const assumptions = openAssumptions.length
    ? openAssumptions.map((assumption) => `- ${assumption}`).join('\n')
    : 'None.'

  return `# Grilling Protocol

## Question

${question}

## Scope

${scope}

## Goal

${goal}

## Audience

${audience}

## Open assumptions

${assumptions}
`
}

/** Whether the URL's host is one of the Sources or a subdomain of one; a malformed URL is on none. */
function isOnSource(url: string, sources: string[]): boolean {
  if (!URL.canParse(url)) {
    return false
  }

  const { hostname } = new URL(url)

  return sources.some((source) => hostname === source || hostname.endsWith(`.${source}`))
}

function renderSourceCatalogue(sources: string[]): string {
  return `# Source Catalogue\n\n${sources.map((source) => `- ${source}`).join('\n')}\n`
}

/** The Findings with their IDs F1…Fn, each showing the statement, the URL and the verbatim quote. */
function renderFindings(findings: Finding[]): string {
  const entries = findings.map(
    ({ statement, url, quote }, index) =>
      `## F${index + 1}\n\n${statement}\n\nURL: ${url}\n\n${quote
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')}\n`,
  )

  return ['# Findings\n', ...(entries.length ? entries : ['None.\n'])].join('\n')
}

/**
 * The agent's Sources as bare, lowercase, unique hosts. A leading `*.` is dropped, as a host covers its subdomains
 * anyway; entries with a scheme, path, port, other wildcard or whitespace are rejected.
 */
function normaliseHosts(sources: string[]): string[] {
  const hosts = sources
    .map((source) => source.trim().toLowerCase().replace(/^\*\./, ''))
    .filter((host) => /^[^\s/:*?#@]+$/.test(host))

  return [...new Set(hosts)]
}

/** The Topic as a snake_case `[a-z0-9_]` file name prefix: diacritics dropped, other characters collapsed to `_`. */
function slugify(topic: string): string {
  const slug = topic
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, MAX_TOPIC_SLUG_LENGTH)
    .replace(/^_+|_+$/g, '')

  return slug || FALLBACK_TOPIC_SLUG
}
