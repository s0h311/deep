import { Component, input, output } from '@angular/core'
import { ListedArtifact } from '../../models/artifact'

/** The Research's Artifacts in Step order, each opening in the drawer's reader; a Review shows whether its Draft passed. */
@Component({
  selector: 'app-artifact-list',
  templateUrl: 'artifact-list.html',
})
export class ArtifactList {
  readonly artifacts = input.required<ListedArtifact[]>()
  /** Emits the name of the Artifact the user opens. */
  readonly opened = output<string>()
}
