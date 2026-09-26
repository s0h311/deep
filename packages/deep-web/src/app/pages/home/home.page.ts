import { Component, inject, signal } from '@angular/core'
import { GrillingThread } from '../../components/grilling-thread/grilling-thread'
import { Stepper } from '../../components/stepper/stepper'
import { ResearchApi } from '../../services/research-api'

@Component({
  imports: [GrillingThread, Stepper],
  templateUrl: 'home.page.html',
})
export class HomePage {
  protected readonly research = inject(ResearchApi)
  protected readonly message = signal('')

  protected sendTyped(event: SubmitEvent): void {
    event.preventDefault()
    const message = this.message().trim()

    if (!message || this.research.busy()) {
      return
    }

    this.message.set('')
    this.send(message)
  }

  protected send(message: string): void {
    void this.research.send(message)
  }
}
