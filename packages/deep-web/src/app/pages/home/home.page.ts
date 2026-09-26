import { Component, inject, signal } from '@angular/core'
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

  protected sendTyped(event: SubmitEvent): void {
    event.preventDefault()
    const message = this.message().trim()

    if (!message || this.research.busy()) {
      return
    }

    this.message.set('')
    this.send(message)
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
