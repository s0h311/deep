import { z } from 'zod'
import { runAgent } from '~/src/infrastructure/agent/client.ts'
import { chatModel } from '~/src/infrastructure/agent/model.ts'
import { structuredResponse } from '~/src/infrastructure/agent/scripted-chat-model.ts'

type Step = 'grilling' | 'create_catalogue' | 'retrieval' | `draft_${number}` | `review_${number}` | 'done' | 'fail'

type Update =
  | {
      type: 'step'
      value: Step
    }
  | {
      id: string
      message: string
    }

export type WriterFn = (update: Update) => Promise<void>

type ResearchConfig = {
  question: string
  // TODO make create_catalogue optional by accepting a catalogue as input
  // TODO make grilling optional, or maybe not
  writerFn: WriterFn
}

const MAX_REVIEW_ROUNDS = 3

export async function research(config: ResearchConfig): Promise<void> {
  const { question, writerFn } = config

  writerFn({ type: 'step', value: 'grilling' })
  const topicName = await grill(config)

  writerFn({ type: 'step', value: 'create_catalogue' })
  await createCatalogue(question)

  writerFn({ type: 'step', value: 'retrieval' })
  await retrieveInformation(question, topicName)

  let reviewRounds = 0
  let reviewPassed: boolean = false

  while (reviewRounds < MAX_REVIEW_ROUNDS && !reviewPassed) {
    reviewRounds++

    writerFn({ type: 'step', value: `draft_${reviewRounds}` })
    await draft(topicName)

    writerFn({ type: 'step', value: `review_${reviewRounds}` })
    reviewPassed = await review(topicName)
  }

  if (!reviewPassed) {
    writerFn({ type: 'step', value: 'fail' })

    return
  }

  writerFn({ type: 'step', value: 'done' })
}

const grillingTurn = z.object({
  message: z.string(),
  topic: z.string(),
})

async function grill({ question, writerFn }: ResearchConfig): Promise<string> {
  const systemPrompt = `The user wants to conduct research about a topic. Before anything we have to clarify the scope and the goal of the research.
Respond with your message to the user and the name of the topic, e.g. Arabica_Beans.`

  const { message, topic } = await runAgent({
    model: chatModel(() => structuredResponse({ message: 'What is the goal of the research?', topic: 'research' })),
    systemPrompt,
    message: question,
    responseFormat: grillingTurn,
  })

  await writerFn({
    id: crypto.randomUUID(),
    message,
  })

  return topic
}

async function createCatalogue(question: ResearchConfig['question']): Promise<void> {}

async function retrieveInformation(question: ResearchConfig['question'], topicName: string): Promise<void> {}

async function draft(topicName: string): Promise<void> {}

async function review(topicName: string): Promise<boolean> {
  return true
}
