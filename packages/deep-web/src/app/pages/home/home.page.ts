import { Component, inject } from '@angular/core'
import { Stepper } from '../../components/stepper/stepper'
import { ResearchApi } from '../../services/research-api'

@Component({
  imports: [Stepper],
  templateUrl: 'home.page.html',
})
export class HomePage {
  protected readonly research = inject(ResearchApi)
}
