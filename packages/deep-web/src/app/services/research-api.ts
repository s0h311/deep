import { httpResource } from '@angular/common/http'
import { computed, Injectable } from '@angular/core'
import { ResearchState } from '../models/research-state'

@Injectable({ providedIn: 'root' })
export class ResearchApi {
  private readonly researchState = httpResource<ResearchState>(() => '/api/research')
  private readonly artifactNames = httpResource<string[]>(() => '/api/research/artifacts')

  readonly state = computed<ResearchState>(() =>
    this.researchState.hasValue() ? this.researchState.value() : { status: 'none' },
  )
  readonly artifacts = computed(() => (this.artifactNames.hasValue() ? this.artifactNames.value() : []))
}
