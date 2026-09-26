import type {CreateDeepAgentParams} from 'deepagents'

export type Model = CreateDeepAgentParams['model']

export type Tool = NonNullable<CreateDeepAgentParams['tools']>[number]
