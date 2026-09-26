/** The Research's status as `GET /api/research` reports it. */
export type ResearchState =
  | { status: 'none' }
  | ({ status: 'running' } & ActiveStep)
  | { status: 'awaiting_answer' }
  | ({ status: 'interrupted'; reason?: string } & ActiveStep)
  | { status: 'failed'; reason: string }
  | { status: 'completed' }

export type ActiveStep =
  | { step: 'grilling' | 'source_catalogue' | 'retrieval' }
  | { step: 'draft' | 'review'; round: number }

export type Step = ActiveStep['step']
