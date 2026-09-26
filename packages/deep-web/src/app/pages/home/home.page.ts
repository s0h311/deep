import { Component, inject, signal } from '@angular/core'
import { Stepper } from '../../components/stepper/stepper'
import { ResearchApi } from '../../services/research-api'

@Component({
  imports: [Stepper],
  templateUrl: 'home.page.html',
})
export class HomePage {
  protected readonly research = inject(ResearchApi)
  protected readonly message = signal('')

  protected send(event: SubmitEvent): void {
    event.preventDefault()
    const message = this.message().trim()

    if (!message || this.research.busy()) {
      return
    }

    this.message.set('')
    void this.research.send(message)
  }
}
