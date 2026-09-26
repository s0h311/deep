import { Component, computed, input } from '@angular/core'

/** The Source Catalogue's Sources, linking each concrete host to its site; wildcard patterns name no single site. */
@Component({
  selector: 'app-source-catalogue-panel',
  templateUrl: 'source-catalogue-panel.html',
})
export class SourceCataloguePanel {
  /** The Source Catalogue's Sources, or undefined before its Step writes it. */
  readonly sources = input<string[]>()

  protected readonly entries = computed(() =>
    this.sources()?.map((source) => ({ source, href: source.includes('*') ? undefined : `https://${source}` })),
  )
}
