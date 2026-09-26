import { httpResource } from '@angular/common/http'
import { computed, Injectable } from '@angular/core'

@Injectable({ providedIn: 'root' })
export class ResearchApi {
  private readonly artifactNames = httpResource<string[]>(() => '/api/research/artifacts')

  readonly artifacts = computed(() => (this.artifactNames.hasValue() ? this.artifactNames.value() : []))
}
