import {createDeepAgent, type DeepAgent, type DeepAgentRunStream, FilesystemBackend, type SubAgent} from 'deepagents'
import {type AgentMiddleware} from 'langchain'
import {MemorySaver} from '@langchain/langgraph'
import type {Model} from '~/src/features/harness/types.ts'
import type {Tool} from './types.ts'
import {join} from 'node:path'

export type AgentConfig = {
  model: Model
  tools: Tool[]
  systemPrompt: string
  middleware?: AgentMiddleware[]
  rootDir: string
  subagents?: SubAgent[]
  skills: string[]
}

export type StreamAgentParams = {
  message: string
  threadId: string
  agentConfig: AgentConfig
}

const AGENT_GENERATION_RECURSION_LIMIT = 200

const checkpointer = new MemorySaver()
const agents = new Map<string, DeepAgent>()

export function streamAgent({ message, threadId, agentConfig }: StreamAgentParams): Promise<DeepAgentRunStream> {
  return getAgent(threadId, agentConfig).streamEvents(
    {
      messages: [{ role: 'human', content: message }],
    },
    {
      version: 'v3',
      configurable: { thread_id: threadId },
      recursionLimit: AGENT_GENERATION_RECURSION_LIMIT,
    },
  )
}

function getAgent(threadId: string, agentConfig: AgentConfig): DeepAgent {
  const currentAgent = agents.get(threadId)

  if (currentAgent) {
    return currentAgent
  }

  const agent = createAgent({
    ...agentConfig,
    rootDir: join(agentConfig.rootDir, threadId),
  })

  agents.set(threadId, agent)

  return agent
}

function createAgent({ model, tools, systemPrompt, middleware, rootDir, subagents, skills }: AgentConfig): DeepAgent {
  return createDeepAgent({
    model,
    tools,
    systemPrompt,
    middleware,
    backend: new FilesystemBackend({ rootDir, virtualMode: true }),
    checkpointer,
    subagents,
    skills,
  })
}
