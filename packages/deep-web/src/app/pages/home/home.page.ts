import { Component, computed, inject, signal } from '@angular/core'
import { ArtifactList } from '../../components/artifact-list/artifact-list'
import { GrillingThread } from '../../components/grilling-thread/grilling-thread'
import { MarkdownView } from '../../components/markdown-view/markdown-view'
import { SourceCataloguePanel } from '../../components/source-catalogue-panel/source-catalogue-panel'
import { Stepper } from '../../components/stepper/stepper'
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

  protected sendTyped(event: SubmitEvent): void {
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
