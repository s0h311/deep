import { z } from 'zod'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runAgent } from '../../infrastructure/agent/client.ts'
import { chatModel } from '../../infrastructure/agent/model.ts'
import { structuredResponse } from '../../infrastructure/agent/scripted-chat-model.ts'
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

type GrillingTurn = { question: string; recommendedAnswer: string; answer?: string }

/** Working file of the Grilling Step, kept until the Grilling Protocol exists. */
type GrillingTranscript = { question: string; turns: GrillingTurn[] }

const GRILLING_TRANSCRIPT = 'grilling_transcript.json'

const grillingQuestion = z.object({
  question: z.string(),
  recommendedAnswer: z.string(),
})

const GRILLING_SYSTEM_PROMPT = `You run the Grilling Step of a Research: interview the researcher about the scope, goal and audience of their Research, following the grilling skill.
You are given the researcher's question and the interview so far. Respond with your next question and your recommended answer to it.`

const fakeScript = () =>
  structuredResponse({
    question: 'Who is the audience of the Report?',
    recommendedAnswer: 'Yourself: someone curious but new to the topic.',
  })

export function createResearch({
  model = chatModel(fakeScript),
  root = researchDirectory(),
}: ResearchConfig = {}): Research {
  async function grill(transcript: GrillingTranscript, emit: Emit): Promise<void> {
    await emit({ type: 'step', step: 'grilling' })

    const turn = await runAgent({
      model,
      systemPrompt: GRILLING_SYSTEM_PROMPT,
      message: renderTranscript(transcript),
      responseFormat: grillingQuestion,
      skill: appSkill('grilling'),
    })
    transcript.turns.push(turn)

    await mkdir(root, { recursive: true })
    await writeFile(join(root, GRILLING_TRANSCRIPT), JSON.stringify(transcript, null, 2))

    await emit({ type: 'text', text: renderQuestion(turn, transcript.turns.length) })
    await emit({ type: 'step', step: 'awaiting_answer' })
  }

  /** The Research's state, derived solely from which Artifacts exist: empty, or Grilling with its transcript. */
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
