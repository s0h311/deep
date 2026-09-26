import { type AgentConfig, streamAgent } from '~/src/infrastructure/agent/client.ts'
import { claudeHaiku45, webSearchTool } from '~/src/infrastructure/agent/providers/anthropic.ts'

const SKILLS: string[] = ['.agents/skills/grilling']
const RESEARCH_ROOT_DIRECTORY = '.research'

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

type ResearchConfig = {
  question: string
  // TODO make create_catalogue optional by accepting a catalogue as input
  // TODO make grilling optional, or maybe not
  writerFn: (step: Update) => Promise<void>
}

const MAX_REVIEW_ROUNDS = 3

export async function research(config: ResearchConfig): Promise<void> {
  const { question, writerFn } = config

  const threadId = crypto.randomUUID()

  writerFn({ type: 'step', value: 'grilling' })
  const topicName = await grill(threadId, config)

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

const agentConfig: AgentConfig = {
  model: claudeHaiku45,
  tools: [webSearchTool],
  systemPrompt: '',
  middleware: [
    // TODO maybe use this: todoListMiddleware
  ],
  rootDir: RESEARCH_ROOT_DIRECTORY,
  skills: SKILLS,
}

async function grill(threadId: string, { question, writerFn }: ResearchConfig): Promise<string> {
  const systemPrompt = `The user wants to conduct research about a topic. Before anything we have to clarify the scope and the goal of the research.
Use /grilling skill to start a grilling session. When every gap is closed. Save the protocol of the grilling session
in <topic-name>_grilling_protocol.md. Also return the name of the topic in XML Tags. Example: <topic-name>Arabica_Beans</topic-name>.`

  const agentConfig: AgentConfig = {
    model: claudeHaiku45,
    tools: [webSearchTool],
    systemPrompt,
    rootDir: RESEARCH_ROOT_DIRECTORY,
    skills: SKILLS,
  }

  const stream = await streamAgent({
    message: question,
    threadId,
    agentConfig,
  })

  let name: string = ''

  for await (const message of stream.messages) {
    const text = await message.text

    const matches = text.match(/<topic-name>(.*)<\/topic-name>/) ?? []
    if (matches.length >= 2) {
      name = matches[1]
    }

    await writerFn({
      id: crypto.randomUUID(),
      message: text,
    })
  }

  return name
}

async function createCatalogue(question: ResearchConfig['question']): Promise<void> {}

async function retrieveInformation(question: ResearchConfig['question'], topicName: string): Promise<void> {}

async function draft(topicName: string): Promise<void> {}

async function review(topicName: string): Promise<boolean> {
  return true
}
