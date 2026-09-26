import { Component, inject } from '@angular/core'
import { ResearchApi } from '../../services/research-api'

@Component({
  imports: [],
  templateUrl: 'home.page.html',
})
export class HomePage {
  protected readonly research = inject(ResearchApi)
}
