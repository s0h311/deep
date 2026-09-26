import { Component, input, output } from '@angular/core'
import { GrillingTranscript } from '../../models/grilling-transcript'

/** The Grilling interview as a chat thread: the question, then each numbered Grilling question and its answer. */
@Component({
  selector: 'app-grilling-thread',
  templateUrl: 'grilling-thread.html',
})
export class GrillingThread {
  readonly transcript = input.required<GrillingTranscript>()
  /** Whether the last question awaits an answer, offering "Use recommendation". Read-only otherwise. */
  readonly answerable = input(false)
  /** Whether answering is disabled, as while a Step is running. */
  readonly disabled = input(false)
  /** Emits the last question's recommended answer when the user accepts it. */
  readonly recommendationUsed = output<string>()
}
