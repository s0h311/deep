import { CompositeBackend, createDeepAgent, FilesystemBackend, StateBackend } from 'deepagents'
import { basename } from 'node:path'
import { toolStrategy } from 'langchain'
import type { z } from 'zod'
import type { Model, Tool } from './types.ts'
import { STRUCTURED_RESPONSE_TOOL } from './scripted-chat-model.ts'

export type RunAgentParams<Response extends z.ZodObject> = {
  model: Model
  systemPrompt: string
  message: string
  responseFormat: Response
  tools?: Tool[]
  /** Absolute path of the one app skill directory the agent may read. */
  skill?: string
  signal?: AbortSignal
}

const AGENT_GENERATION_RECURSION_LIMIT = 200
const SKILLS_ROUTE = '/skills/'

/**
 * Runs a fresh, single-message deep agent on a new thread and returns its schema-validated structured response.
 */
export async function runAgent<Response extends z.ZodObject>({
  model,
  systemPrompt,
  message,
  responseFormat,
  tools = [],
  skill,
  signal,
}: RunAgentParams<Response>): Promise<z.infer<Response>> {
  // Widened so the agent's state type resolves; the response is re-parsed with the precise schema below.
  const format: z.ZodObject = responseFormat.meta({ title: STRUCTURED_RESPONSE_TOOL })
  const skillRoute = skill && `${SKILLS_ROUTE}${basename(skill)}/`

  const agent = createDeepAgent({
    model,
    tools,
    systemPrompt,
    // Scratch space lives in agent state; the skill is the only thing on disk the agent can see.
    backend: new CompositeBackend(
      new StateBackend(),
      skillRoute ? { [skillRoute]: new FilesystemBackend({ rootDir: skill, virtualMode: true }) } : {},
    ),
    skills: skillRoute ? [skillRoute] : [],
    permissions: [{ operations: ['write'], paths: [`${SKILLS_ROUTE}**`], mode: 'deny' }],
    responseFormat: toolStrategy(format, { handleError: false }),
  })

  const { structuredResponse } = await agent.invoke(
    { messages: [{ role: 'human', content: message }] },
    { signal, recursionLimit: AGENT_GENERATION_RECURSION_LIMIT },
  )

  return responseFormat.parse(structuredResponse)
}
