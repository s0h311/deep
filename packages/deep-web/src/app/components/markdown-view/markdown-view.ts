import { afterRenderEffect, Component, computed, ElementRef, inject, input, output } from '@angular/core'
import { Marked, TokenizerAndRendererExtension, Tokens } from 'marked'

/** A citation of one or more Findings by ID, such as `[F3]` or `[F1, F2]`. */
const CITATION = /^\[(F\d+(?:\s*,\s*F\d+)*)\]/

/** Turns each cited Finding ID into a link to `#<ID>`, keeping the brackets and commas as text. */
const citations: TokenizerAndRendererExtension = {
  name: 'citation',
  level: 'inline',
  start: (source) => source.match(/\[F\d/)?.index,
  tokenizer(source) {
    const [raw, ids] = source.match(CITATION) ?? []
    return raw && ids ? { type: 'citation', raw, ids: ids.split(/\s*,\s*/) } : undefined
  },
  renderer: (token: Tokens.Generic) =>
    `[${(token['ids'] as string[]).map((id) => `<a href="#${id}">${id}</a>`).join(', ')}]`,
}

const plain = new Marked()
const cited = new Marked({ extensions: [citations] })

/**
 * An Artifact rendered from Markdown; Angular sanitises the HTML, so markup in the Artifact can't run scripts.
 * With `citations`, `[Fn]` links to that Finding; following it emits the Finding's ID instead of navigating.
 */
@Component({
  selector: 'app-markdown-view',
  template: '<article class="markdown" [innerHTML]="html()" (click)="follow($event)"></article>',
})
export class MarkdownView {
  readonly markdown = input.required<string>()
  /** Whether `[Fn]` citations link to the Finding they cite, as in Drafts and the Report. */
  readonly citations = input(false)
  /** The ID of the Finding to scroll to, whose `## Fn` heading this Artifact has. */
  readonly finding = input<string>()
  /** Emits the ID of the Finding whose citation the user followed. */
  readonly citationFollowed = output<string>()

  protected readonly html = computed(() => (this.citations() ? cited : plain).parse(this.markdown(), { async: false }))

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef)

    // After render, as the heading exists only once the Markdown is in the page.
    afterRenderEffect(() => {
      const finding = this.finding()
      this.html()
      const headings = [...host.nativeElement.querySelectorAll('h2')]

      headings.find((heading) => finding && heading.textContent?.trim() === finding)?.scrollIntoView({ block: 'start' })
    })
  }

  protected follow(event: MouseEvent): void {
    const link = event.target instanceof Element ? event.target.closest('a') : null
    const finding = this.citations() ? link?.getAttribute('href')?.match(/^#(F\d+)$/)?.[1] : undefined

    if (finding) {
      event.preventDefault()
      this.citationFollowed.emit(finding)
    }
  }
}
