import { Component, computed, input } from '@angular/core'
import { ResearchState, Step } from '../../models/research-state'

/** The most Rounds a Research gets. */
const MAX_ROUNDS = 3

const STEPS: { step: Step; label: string }[] = [
  { step: 'grilling', label: 'Grilling' },
  { step: 'source_catalogue', label: 'Source Catalogue' },
  { step: 'retrieval', label: 'Retrieval' },
  { step: 'draft', label: 'Draft' },
  { step: 'review', label: 'Review' },
]

/** Where a Step stands, as a screen reader announces it. */
type Progress = 'Done' | 'Running' | 'Current' | 'Upcoming'

/** The Research's Steps in order, marking each as done, current or upcoming; on a narrow screen, dots and the current Step. */
@Component({
  selector: 'app-stepper',
  templateUrl: 'stepper.html',
})
export class Stepper {
  readonly state = input.required<ResearchState>()

  protected readonly steps = computed(() => {
    const state = this.state()
    // A Completed Research is past its last Step.
    const current = {
      index: state.status === 'completed' ? STEPS.length : STEPS.findIndex(({ step }) => step === currentStep(state)),
      running: state.status === 'running',
    }
    const round = 'round' in state ? `${state.round}/${MAX_ROUNDS}` : undefined

    return STEPS.map(({ label }, index) => ({
      label,
      progress: progress(index, current),
      round: index === current.index ? round : undefined,
    }))
  })

  /** The current Step with its Round, or that the Research Completed: all the stepper shows on a narrow screen. */
  protected readonly summary = computed(() => {
    const current = this.steps().find(({ progress }) => progress === 'Current' || progress === 'Running')

    if (current) {
      return current.round ? `${current.label} · ${current.round}` : current.label
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

/** The progress of the Step at `index`, given the current Step's index (-1 for none) and whether it is running. */
function progress(index: number, current: { index: number; running: boolean }): Progress {
  if (index < current.index) {
    return 'Done'
  }

  if (index > current.index || current.index === -1) {
    return 'Upcoming'
  }

  return current.running ? 'Running' : 'Current'
}
