import { z } from 'zod'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { domainToASCII } from 'node:url'
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

/** A name that is no Artifact of the Research. */
export class ArtifactNotFound extends Error {
  override name = 'ArtifactNotFound'
}

/** A Step whose agent failed on every attempt, leaving the Research Interrupted. */
class StepInterrupted extends Error {
  override name = 'StepInterrupted'
}

export type Emit = (event: ResearchEvent) => void | Promise<void>

/** What a running send hands each Step: where its progress goes, and the signal that aborts its agent calls. */
type StepContext = { emit: Emit; signal: AbortSignal }

export type Research = {
  /** Advances the Research according to its state, emitting progress until a terminal step value. */
  send(message: string, emit: Emit): Promise<void>
  /** The names of the Artifacts produced so far, including any Grilling Transcript, sorted. */
  listArtifacts(): Promise<string[]>
  /** The content of the Artifact with the given name. */
  readArtifact(name: string): Promise<string>
  /** Aborts any running Step, then deletes every Artifact, so the next message starts a new Research. */
  reset(): Promise<void>
  /** Where the Research stands: derived from its Artifacts, plus whether a send is running and why the last one was interrupted. */
  state(): Promise<ResearchState>
}

export type ResearchState =
  | { status: 'none' }
  | ({ status: 'running' } & ActiveStep)
  | { status: 'awaiting_answer' }
  | ({ status: 'interrupted'; reason?: string } & ActiveStep)
  | { status: 'failed'; reason: string }
  | { status: 'completed' }

/** A Step as a send announces it: Draft and Review with their Round. */
type ActiveStep = { step: 'grilling' | 'source_catalogue' | 'retrieval' } | { step: 'draft' | 'review'; round: number }

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

/**
 * Where the Research stands, derived from its Artifacts alone: the Step (and Round) that runs next, or Failed with
 * its reason, or Completed. A Completed Research whose Report isn't published yet has its passing Round to publish.
 */
type NextStep =
  | { step: 'grilling' }
  | { step: 'source_catalogue' | 'retrieval'; topic: string }
  | ({ step: 'draft' | 'review' } & Round)
  | ({ step: 'completed'; published: boolean } & Round)
  | { step: 'failed'; reason: string }

type GrillingTurn = { question: string; recommendedAnswer: string; answer?: string }

/** The record of the Grilling interview, kept after the Grilling Protocol is written; advancing then ignores it. */
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
const MAX_HOSTNAME_LENGTH = 253
/** A DNS label: 1–63 letters, digits or hyphens, not starting or ending with a hyphen. */
const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
/** A top-level label: letters only, or punycode; this rules out IP addresses. */
const TOP_LEVEL_LABEL = /^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/

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
const RESET = 'The Research was reset.'
const STEP_RUNNING = 'A Step is running; wait for it to finish or reset.'

const MAX_GRILLING_QUESTIONS = 5
const MAX_ROUNDS = 3
/** A Step's agent gets one retry after an error or schema-invalid output. */
const STEP_ATTEMPTS = 2

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
  /** The content of the Artifact with the given name. */
  async function read(name: string): Promise<string> {
    return await readFile(join(root, name), 'utf8')
  }

  /** Runs one Grilling turn, returning whether Grilling concluded. */
  async function grill(transcript: GrillingTranscript, context: StepContext): Promise<boolean> {
    await context.emit({ type: 'step', step: 'grilling' })

    // At the cap, the agent is told to conclude, and only a conclusion is accepted.
    const mustConclude = transcript.turns.length >= MAX_GRILLING_QUESTIONS
    // Saved before the agent runs, so an Interrupted Grilling keeps the question and the latest answer.
    await saveTranscript(transcript)

    const outcome = await retried({ step: 'Grilling', signal: context.signal }, async () =>
      (mustConclude ? grillingConclusion : grillingOutcome).parse(
        await runAgent({
          model,
          systemPrompt: GRILLING_SYSTEM_PROMPT,
          message: [renderTranscript(transcript), ...(mustConclude ? [CONCLUDE_INSTRUCTION] : [])].join('\n\n'),
          responseFormat: mustConclude ? grillingConclusion : grillingResponse,
          skill: appSkill('grilling'),
          signal: context.signal,
        }),
      ),
    )

    if ('done' in outcome) {
      const topic = slugify(outcome.topic)

      await writeFile(join(root, protocolName(topic)), renderProtocol(transcript.question, outcome.protocol))

      return true
    }

    transcript.turns.push(outcome)

    await saveTranscript(transcript)

    await context.emit({ type: 'text', text: renderQuestion(outcome, transcript.turns.length) })
    await context.emit({ type: 'step', step: 'awaiting_answer' })

    return false
  }

  /** Runs the Source Catalogue Step. */
  async function catalogueSources(topic: string, context: StepContext): Promise<void> {
    await context.emit({ type: 'step', step: 'source_catalogue' })

    const message = await read(protocolName(topic))
    const { sources } = await retried({ step: 'Source Catalogue', signal: context.signal }, () =>
      runAgent({
        model,
        systemPrompt: SOURCE_CATALOGUE_SYSTEM_PROMPT,
        message,
        responseFormat: sourceCatalogue,
        tools: [webSearchTool],
        skill: appSkill('source-catalogue'),
        signal: context.signal,
      }),
    )

    const hosts = normaliseHosts(sources)

    // An empty Source Catalogue is kept: it records that the Research failed.
    await writeFile(join(root, catalogueName(topic)), JSON.stringify({ sources: hosts }, null, 2))
  }

  /** Runs the Retrieval Step. */
  async function retrieve(topic: string, context: StepContext): Promise<void> {
    await context.emit({ type: 'step', step: 'retrieval' })

    const { sources } = await readSourceCatalogue(topic)
    const message = [await read(protocolName(topic)), renderSourceCatalogue(sources)].join('\n\n')
    const { findings } = await retried({ step: 'Retrieval', signal: context.signal }, () =>
      runAgent({
        model,
        systemPrompt: RETRIEVAL_SYSTEM_PROMPT,
        message,
        responseFormat: retrieval,
        tools: webToolsFor(sources),
        skill: appSkill('retrieval'),
        signal: context.signal,
      }),
    )

    const valid = findings.filter(({ url }) => isOnSource(url, sources))

    // A Findings file with no entries is kept: it records that the Research failed.
    await writeFile(join(root, findingsName(topic)), renderFindings(valid))
  }

  /** Runs the Draft Step of the Round. */
  async function writeDraft({ topic, round }: Round, context: StepContext): Promise<void> {
    await context.emit({ type: 'step', step: 'draft', round })

    const findings = await read(findingsName(topic))
    // From Round 2, the agent revises the previous Draft against its failing Review.
    const previous =
      round > 1 ? [await read(draftName(topic, round - 1)), await read(reviewName(topic, round - 1))] : []
    const message = [await read(protocolName(topic)), findings, ...previous].join('\n\n')
    const response = await retried({ step: 'Draft', signal: context.signal }, () =>
      runAgent({
        model,
        systemPrompt: DRAFT_SYSTEM_PROMPT,
        message,
        responseFormat: draft,
        skill: appSkill('draft'),
        signal: context.signal,
      }),
    )

    await writeFile(join(root, draftName(topic, round)), renderDraft(response, parseFindingUrls(findings)))
  }

  /** Runs the Review Step of the Round. */
  async function reviewDraft({ topic, round }: Round, context: StepContext): Promise<void> {
    await context.emit({ type: 'step', step: 'review', round })

    const message = [await read(draftName(topic, round)), await read(findingsName(topic))].join('\n\n')
    const response = await retried({ step: 'Review', signal: context.signal }, () =>
      runAgent({
        model,
        systemPrompt: REVIEW_SYSTEM_PROMPT,
        message,
        responseFormat: review,
        skill: appSkill('review'),
        signal: context.signal,
      }),
    )

    await writeFile(join(root, reviewName(topic, round)), renderReview(response, round))
  }

  async function readVerdict({ topic, round }: Round): Promise<Verdict> {
    const verdict = (await read(reviewName(topic, round))).match(/^---\nverdict: (\w+)\n/)?.[1]

    return review.shape.verdict.parse(verdict)
  }

  async function hasFindings(topic: string): Promise<boolean> {
    return FIRST_FINDING.test(await read(findingsName(topic)))
  }

  async function readSourceCatalogue(topic: string): Promise<SourceCatalogue> {
    return sourceCatalogue.parse(JSON.parse(await read(catalogueName(topic))))
  }

  /** The names of all Artifacts, including any Grilling Transcript. */
  async function artifactNames(): Promise<string[]> {
    return (await ifExists(readdir(root))) ?? []
  }

  /** The Grilling transcript, if Grilling has started. */
  async function readTranscript(): Promise<GrillingTranscript | undefined> {
    const transcript = await ifExists(read(GRILLING_TRANSCRIPT))

    return transcript === undefined ? undefined : JSON.parse(transcript)
  }

  async function saveTranscript(transcript: GrillingTranscript): Promise<void> {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, GRILLING_TRANSCRIPT), JSON.stringify(transcript, null, 2))
  }

  /** Which Step runs next, or whether the Research has Failed or Completed, from its Artifacts alone. */
  async function nextStep(): Promise<NextStep> {
    const names = await artifactNames()
    // The Topic comes from the Grilling Protocol; without one, Grilling runs. Once it exists, the Grilling Transcript is ignored.
    const topic = names
      .find((name) => name.endsWith(GRILLING_PROTOCOL_SUFFIX))
      ?.slice(0, -GRILLING_PROTOCOL_SUFFIX.length)

    if (topic === undefined) {
      return { step: 'grilling' }
    }

    if (!names.includes(catalogueName(topic))) {
      return { step: 'source_catalogue', topic }
    }

    // An empty Source Catalogue is kept to record that the Research failed.
    if (!(await readSourceCatalogue(topic)).sources.length) {
      return { step: 'failed', reason: NO_PRIMARY_SOURCES }
    }

    if (!names.includes(findingsName(topic))) {
      return { step: 'retrieval', topic }
    }

    // As is a Findings file with no entries.
    if (!(await hasFindings(topic))) {
      return { step: 'failed', reason: NO_FINDINGS }
    }

    const round = Math.max(1, lastRound(topic, names))

    if (names.includes(reportName(topic))) {
      return { step: 'completed', published: true, topic, round }
    }

    if (!names.includes(draftName(topic, round))) {
      return { step: 'draft', topic, round }
    }

    // A Draft without its Review is reviewed, not drafted again.
    if (!names.includes(reviewName(topic, round))) {
      return { step: 'review', topic, round }
    }

    if ((await readVerdict({ topic, round })) === 'pass') {
      return { step: 'completed', published: false, topic, round }
    }

    return round < MAX_ROUNDS
      ? { step: 'draft', topic, round: round + 1 }
      : { step: 'failed', reason: ALL_ROUNDS_FAILED }
  }

  /** Advances the Research Step by Step from where its Artifacts say it stands, until it awaits an answer or ends. */
  async function advance(message: string, context: StepContext): Promise<void> {
    for (let first = true; ; first = false) {
      const next = await nextStep()

      switch (next.step) {
        case 'grilling': {
          const transcript = (await readTranscript()) ?? { question: message, turns: [] }
          const last = transcript.turns.at(-1)

          // Only an unanswered question takes the message; otherwise Grilling was Interrupted and the message is ignored.
          if (last && last.answer === undefined) {
            last.answer = message
          }

          if (!(await grill(transcript, context))) {
            return
          }

          break
        }
        case 'source_catalogue':
          await catalogueSources(next.topic, context)
          break
        case 'retrieval':
          await retrieve(next.topic, context)
          break
        case 'draft':
          await writeDraft(next, context)
          break
        case 'review':
          await reviewDraft(next, context)
          break
        case 'completed':
          // A message to an ended Research is rejected.
          if (next.published) {
            throw new ResearchConflict(RESET_FIRST)
          }

          await copyFile(join(root, draftName(next.topic, next.round)), join(root, reportName(next.topic)))
          await context.emit({ type: 'step', step: 'completed' })

          return
        case 'failed':
          // A message to an ended Research is rejected; one that just failed reports why.
          if (first) {
            throw new ResearchConflict(RESET_FIRST)
          }

          await context.emit({ type: 'step', step: 'failed', reason: next.reason })

          return
      }
    }
  }

  /** The running send, with the Step it last announced. */
  let running: { announced?: ActiveStep } | undefined
  /** Why the latest send was Interrupted, if it was; lost on restart. */
  let interruption: string | undefined

  /** The send or reset in progress, whose controller aborts its agent calls. */
  let current: { controller: AbortController; settled: Promise<void> } | undefined

  /** Runs the task as the one in progress until it settles. */
  async function exclusively(task: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const controller = new AbortController()
    const run = task(controller.signal)
    current = { controller, settled: run.catch(() => {}) }

    try {
      await run
    } finally {
      if (current.controller === controller) {
        current = undefined
      }
    }
  }

  return {
    async send(message, emit) {
      if (current) {
        throw new ResearchConflict(STEP_RUNNING)
      }

      const sending: { announced?: ActiveStep } = {}
      running = sending
      interruption = undefined

      // Each Step the send announces is recorded before it goes out, so state() reports it from then on.
      const announcing: Emit = async (event) => {
        sending.announced = announced(event) ?? sending.announced
        await emit(event)
      }

      await exclusively(async (signal) => {
        try {
          await advance(message, { emit: announcing, signal })
        } catch (error) {
          if (signal.aborted) {
            await emit({ type: 'step', step: 'failed', reason: RESET })

            return
          }

          if (!(error instanceof StepInterrupted)) {
            throw error
          }

          interruption = error.message
          await emit({ type: 'step', step: 'failed', reason: error.message })
        } finally {
          running = undefined
        }
      })
    },

    async reset() {
      const previous = current
      previous?.controller.abort()

      // The aborted run settles before the wipe, so none of its writes outlive it.
      await exclusively(async () => {
        await previous?.settled
        await rm(root, { recursive: true, force: true })
      })
    },

    async state() {
      if (running?.announced) {
        return { status: 'running', ...running.announced }
      }

      const next = await nextStep()
      const reason = interruption === undefined ? {} : { reason: interruption }

      switch (next.step) {
        case 'grilling': {
          const transcript = await readTranscript()

          if (transcript === undefined) {
            return { status: 'none' }
          }

          const last = transcript.turns.at(-1)

          // Only an unanswered question awaits an answer; otherwise Grilling was Interrupted.
          return last && last.answer === undefined
            ? { status: 'awaiting_answer' }
            : { status: 'interrupted', step: 'grilling', ...reason }
        }
        case 'source_catalogue':
        case 'retrieval':
          return { status: 'interrupted', step: next.step, ...reason }
        case 'draft':
        case 'review':
          return { status: 'interrupted', step: next.step, round: next.round, ...reason }
        case 'failed':
          return { status: 'failed', reason: next.reason }
        case 'completed':
          // A passing Round whose Report isn't published yet is Interrupted after its Review; the next send publishes it.
          return next.published
            ? { status: 'completed' }
            : { status: 'interrupted', step: 'review', round: next.round, ...reason }
      }
    },

    async listArtifacts() {
      return (await artifactNames()).toSorted()
    },

    async readArtifact(name) {
      if (!(await artifactNames()).includes(name)) {
        throw new ArtifactNotFound(`No Artifact named ${name}.`)
      }

      return await read(name)
    },
  }
}

/** The Step the event announces, if it announces one that runs. */
function announced(event: ResearchEvent): ActiveStep | undefined {
  if (event.type !== 'step') {
    return undefined
  }

  switch (event.step) {
    case 'grilling':
    case 'source_catalogue':
    case 'retrieval':
      return { step: event.step }
    case 'draft':
    case 'review':
      return { step: event.step, round: event.round }
    default:
      return undefined
  }
}

/**
 * Runs a Step's agent call, retrying it after an error or schema-invalid output; once the attempts run out, the
 * Step is interrupted.
 */
async function retried<Response>(
  { step, signal }: { step: string; signal: AbortSignal },
  run: () => Promise<Response>,
): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      // An aborted Step is not retried.
      if (signal.aborted) {
        throw error
      }

      if (attempt >= STEP_ATTEMPTS) {
        throw new StepInterrupted(
          `The ${step} Step failed ${STEP_ATTEMPTS} times (${error instanceof Error ? error.message : String(error)}); send a message to resume.`,
          { cause: error },
        )
      }
    }
  }
}

/** The promise's value, or undefined if it rejects because the file or directory doesn't exist. */
async function ifExists<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }

    throw error
  }
}

function protocolName(topic: string): string {
  return `${topic}${GRILLING_PROTOCOL_SUFFIX}`
}

function catalogueName(topic: string): string {
  return `${topic}${SOURCE_CATALOGUE_SUFFIX}`
}

function findingsName(topic: string): string {
  return `${topic}${FINDINGS_SUFFIX}`
}

function reportName(topic: string): string {
  return `${topic}${REPORT_SUFFIX}`
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
  return `# Report

## Summary

${summary}

## Key facts

${bulletList(keyFacts)}

## Gaps

${bulletList(gaps)}

## Follow-up questions

${bulletList(followUpQuestions)}

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
  return `---
verdict: ${verdict}
---

# Review ${round}

## Offending Claims

${bulletList(offendingClaims.map(({ claim, reason }) => `${claim}\n  - ${reason}`))}
`
}

/** The items as a Markdown list, or `None.` if there are none. */
function bulletList(items: string[]): string {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : 'None.'
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

${bulletList(openAssumptions)}
`
}

/** Whether the URL's host is one of the Sources or a subdomain of one; a malformed URL is on none. */
function isOnSource(url: string, sources: string[]): boolean {
  if (!URL.canParse(url)) {
    return false
  }

  const hostname = new URL(url).hostname.replace(/\.$/, '')

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
 * The agent's Sources as bare, lowercase, unique ASCII hosts, so they match URL hostnames. A leading `*.` is dropped,
 * as a host covers its subdomains anyway, as is a trailing `.`; an internationalised host is punycoded. Entries
 * with a scheme, path, port, other wildcard or whitespace are rejected, as is anything that isn't a public hostname:
 * empty or malformed labels, a single label such as `localhost`, or an IP address.
 */
function normaliseHosts(sources: string[]): string[] {
  const hosts = sources
    .map((source) => source.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, ''))
    .filter((host) => /^[^\s/:*?#@]+$/.test(host))
    .map((host) => domainToASCII(host))
    .filter(isHostname)

  return [...new Set(hosts)]
}

/** Whether the ASCII host is a hostname with at least two labels and a top-level label that isn't numeric. */
function isHostname(host: string): boolean {
  const labels = host.split('.')

  return (
    host.length <= MAX_HOSTNAME_LENGTH &&
    labels.length > 1 &&
    labels.every((label) => HOSTNAME_LABEL.test(label)) &&
    TOP_LEVEL_LABEL.test(labels.at(-1) ?? '')
  )
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
