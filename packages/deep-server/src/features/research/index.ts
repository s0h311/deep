import { z } from 'zod'
import { HumanMessage } from '@langchain/core/messages'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runAgent } from '../../infrastructure/agent/client.ts'
import { chatModel } from '../../infrastructure/agent/model.ts'
import { type Script, structuredResponse } from '../../infrastructure/agent/scripted-chat-model.ts'
import type { Model } from '../../infrastructure/agent/types.ts'
import { defined } from '../../infrastructure/utils/utils.ts'
import { appSkill, researchDirectory } from './paths.ts'

export type ResearchEvent =
  | { type: 'step'; step: 'grilling' | 'awaiting_answer' }
  | { type: 'step'; step: 'failed'; reason: string }
  | { type: 'text'; text: string }

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

type GrillingTurn = { question: string; recommendedAnswer: string; answer?: string }

/** Working file of the Grilling Step, kept until the Grilling Protocol exists. */
type GrillingTranscript = { question: string; turns: GrillingTurn[] }

const GRILLING_TRANSCRIPT = 'grilling_transcript.json'
const GRILLING_PROTOCOL_SUFFIX = '_grilling_protocol.md'
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

const GRILLING_SYSTEM_PROMPT = `You run the Grilling Step of a Research: interview the researcher about the scope, goal and audience of their Research, following the grilling skill.
You are given the researcher's question and the interview so far. Respond with either your next question and your recommended answer to it, or, once scope, goal and audience are settled, conclude with a Topic and the Grilling Protocol.`

const MAX_GRILLING_QUESTIONS = 5

const CONCLUDE_INSTRUCTION = `You have asked ${MAX_GRILLING_QUESTIONS} questions, the maximum. Conclude now with a Topic and the Grilling Protocol, recording every unresolved point as an open assumption.`

/** Asks one question, then concludes once it is answered. */
const fakeScript: Script = (messages) =>
  messages.some((message) => HumanMessage.isInstance(message) && message.text.includes('\nAnswer: '))
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

export function createResearch({
  model = chatModel(fakeScript),
  root = researchDirectory(),
}: ResearchConfig = {}): Research {
  async function grill(transcript: GrillingTranscript, emit: Emit): Promise<void> {
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
      await writeFile(
        join(root, `${slugify(outcome.topic)}${GRILLING_PROTOCOL_SUFFIX}`),
        renderProtocol(transcript.question, outcome.protocol),
      )
      await rm(join(root, GRILLING_TRANSCRIPT), { force: true })

      return
    }

    transcript.turns.push(outcome)

    await writeFile(join(root, GRILLING_TRANSCRIPT), JSON.stringify(transcript, null, 2))

    await emit({ type: 'text', text: renderQuestion(outcome, transcript.turns.length) })
    await emit({ type: 'step', step: 'awaiting_answer' })
  }

  async function hasGrillingProtocol(): Promise<boolean> {
    try {
      return (await readdir(root)).some((name) => name.endsWith(GRILLING_PROTOCOL_SUFFIX))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
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
      // Until the Source Catalogue Step exists, the Research stops once the Grilling Protocol is written.
      if (await hasGrillingProtocol()) {
        return
      }

      const transcript = await readTranscript()

      if (transcript) {
        defined(transcript.turns.at(-1)).answer = message
      }

      await grill(transcript ?? { question: message, turns: [] }, emit)
    },
  }
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
