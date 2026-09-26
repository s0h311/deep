import { Component, computed, inject, signal } from '@angular/core'
import { ArtifactList } from '../../components/artifact-list/artifact-list'
import { GrillingThread } from '../../components/grilling-thread/grilling-thread'
import { MarkdownView } from '../../components/markdown-view/markdown-view'
import { SourceCataloguePanel } from '../../components/source-catalogue-panel/source-catalogue-panel'
import { Stepper } from '../../components/stepper/stepper'
import { ResearchState } from '../../models/research-state'
import { ResearchApi } from '../../services/research-api'

@Component({
  imports: [ArtifactList, GrillingThread, MarkdownView, SourceCataloguePanel, Stepper],
  templateUrl: 'home.page.html',
})
export class HomePage {
  protected readonly research = inject(ResearchApi)
  protected readonly message = signal('')
  /** Whether the page is asking the user to confirm a reset. */
  protected readonly confirmingReset = signal(false)
  /**
   * Whether the page offers the message input: to start a Research, answer a Grilling question, or wait for a running
   * Step. A Failed or Completed Research rejects a message and an Interrupted one ignores it, so they get none.
   */
  protected readonly messageable = computed(() =>
    ['none', 'awaiting_answer', 'running'].includes(this.research.state().status),
  )
  /** What the message input asks for, or what the running Step is doing while the input is disabled. */
  protected readonly placeholder = computed(() => {
    const state = this.research.state()

    if (state.status === 'none') {
      return 'What do you want to research?'
    }

    return this.research.busy() ? (activity(state) ?? '') : 'Type your own answer…'
  })
  /** How the Research ended, if it Failed or was Interrupted: shown at the end of the thread. */
  protected readonly outcome = computed(() => {
    const state = this.research.state()

    switch (state.status) {
      case 'failed':
        return { title: 'The Research failed', reason: state.reason, resumable: false }
      case 'interrupted':
        // The reason lives in the server's memory only, so it is gone after a restart.
        return {
          title: 'The Research was interrupted',
          reason: state.reason ?? 'The Research was interrupted.',
          resumable: true,
        }
      default:
        return undefined
    }
  })

  /** Enter sends the message; Shift+Enter leaves the textarea to add a new line. */
  protected keydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      this.sendTyped(event)
    }
  }

  protected sendTyped(event: Event): void {
    event.preventDefault()
    const message = this.message()

    if (!message.trim() || this.research.busy()) {
      return
    }

    this.message.set('')
    // An answer goes exactly as typed; only the question that starts the Research is trimmed.
    this.send(this.research.state().status === 'none' ? message.trim() : message)
  }

  /** Continues an Interrupted Research: outside Awaiting Answer the Research ignores the message. */
  protected resume(): void {
    this.send('')
  }

  protected reset(): void {
    this.confirmingReset.set(false)
    void this.research.reset()
  }

  protected send(message: string): void {
    void this.research.send(message)
  }
}

/** What the running Step is doing, in words. */
function activity(state: ResearchState): string | undefined {
  if (state.status !== 'running') {
    return undefined
  }

  switch (state.step) {
    case 'grilling':
      return 'Thinking about the next question…'
    case 'source_catalogue':
      return 'Picking Primary Sources…'
    case 'retrieval':
      return 'Gathering Findings from the Sources…'
    case 'draft':
      return `Round ${state.round} · Writing the Draft…`
    case 'review':
      return `Round ${state.round} · Reviewing the Draft…`
  }
}
