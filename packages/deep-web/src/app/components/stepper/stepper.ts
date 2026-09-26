import { Component, computed, input } from '@angular/core'
import { Artifact, ArtifactKind } from '../../models/artifact'
import { ResearchState, Step } from '../../models/research-state'

/** The most Rounds a Research gets. */
const MAX_ROUNDS = 3

/** Each Step with the kinds of Artifact it writes. */
const STEPS: { step: Step; label: string; kinds: ArtifactKind[] }[] = [
  { step: 'grilling', label: 'Grilling', kinds: ['grilling_transcript', 'grilling_protocol'] },
  { step: 'source_catalogue', label: 'Source Catalogue', kinds: ['source_catalogue'] },
  { step: 'retrieval', label: 'Retrieval', kinds: ['findings'] },
  { step: 'draft', label: 'Draft', kinds: ['draft'] },
  { step: 'review', label: 'Review', kinds: ['review'] },
]

/** Where a Step stands, as a screen reader announces it. */
type Progress = 'Done' | 'Running' | 'Current' | 'Failed' | 'Upcoming'

/** The circle before each Step's label. */
const CIRCLE: Record<Progress, string> = {
  Done: 'bg-accent text-white',
  Running: 'border-2 border-accent bg-bg',
  Current: 'border-2 border-accent bg-bg',
  Failed: 'border-2 border-accent bg-bg font-bold text-accent',
  Upcoming: 'border border-line bg-bg',
}

/** Each Step's dot on a narrow screen. */
const DOT: Record<Progress, string> = {
  Done: 'bg-accent',
  Running: 'animate-pulse bg-accent/50',
  Current: 'bg-accent/50',
  Failed: 'bg-accent/50',
  Upcoming: 'bg-line',
}

/** The Research's Steps in order, marking each as done, current, failed or upcoming; on a narrow screen, dots and the current Step. */
@Component({
  selector: 'app-stepper',
  templateUrl: 'stepper.html',
})
export class Stepper {
  readonly state = input.required<ResearchState>()
  /** The Artifacts in Step order: they tell how far a Failed Research got. */
  readonly artifacts = input<Artifact[]>([])

  protected readonly CIRCLE = CIRCLE
  protected readonly DOT = DOT

  protected readonly steps = computed(() => {
    const state = this.state()
    const reached = state.status === 'failed' ? lastReached(this.artifacts()) : undefined
    // A Completed Research is past its last Step; a Failed one stopped at the Step of its last Artifact.
    const current: { index: number; progress: Progress } = {
      index:
        state.status === 'completed'
          ? STEPS.length
          : (reached?.index ?? STEPS.findIndex(({ step }) => step === currentStep(state))),
      progress: state.status === 'running' ? 'Running' : state.status === 'failed' ? 'Failed' : 'Current',
    }
    const roundNumber = 'round' in state ? state.round : reached?.round
    const round = roundNumber === undefined ? undefined : `${roundNumber}/${MAX_ROUNDS}`

    return STEPS.map(({ label }, index) => {
      const stepProgress = progress(index, current)

      return {
        label,
        progress: stepProgress,
        current: stepProgress === 'Current' || stepProgress === 'Running' || stepProgress === 'Failed',
        round: index === current.index ? round : undefined,
      }
    })
  })

  /** The current Step with its Round, or that the Research Completed: all the stepper shows on a narrow screen. */
  protected readonly summary = computed(() => {
    const current = this.steps().find((step) => step.current)

    if (current) {
      const summary = current.round ? `${current.label} · ${current.round}` : current.label
      return current.progress === 'Failed' ? `${summary} · Failed` : summary
    }

    return this.state().status === 'completed' ? 'Completed' : undefined
  })
}

function currentStep(state: ResearchState): Step | undefined {
  if (state.status === 'awaiting_answer') {
    return 'grilling'
  }

  return 'step' in state ? state.step : undefined
}

/** The index of the Step that wrote the last of `artifacts`, with that Artifact's Round; undefined if no Step wrote any. */
function lastReached(artifacts: Artifact[]): { index: number; round?: number } | undefined {
  const artifact = artifacts.findLast(({ kind }) => STEPS.some(({ kinds }) => kinds.includes(kind)))

  return artifact && { index: STEPS.findIndex(({ kinds }) => kinds.includes(artifact.kind)), round: artifact.round }
}

/** The progress of the Step at `index`, given the current Step's index (-1 for none) and how it stands. */
function progress(index: number, current: { index: number; progress: Progress }): Progress {
  if (index < current.index) {
    return 'Done'
  }

  if (index > current.index || current.index === -1) {
    return 'Upcoming'
  }

  return current.progress
}
