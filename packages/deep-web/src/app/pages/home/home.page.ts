import {
  afterRenderEffect,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  linkedSignal,
  signal,
  untracked,
  viewChild,
} from '@angular/core'
import { ArtifactList } from '../../components/artifact-list/artifact-list'
import { GrillingThread } from '../../components/grilling-thread/grilling-thread'
import { Citation, MarkdownView } from '../../components/markdown-view/markdown-view'
import { SourceCataloguePanel } from '../../components/source-catalogue-panel/source-catalogue-panel'
import { Stepper } from '../../components/stepper/stepper'
import { ResearchState } from '../../models/research-state'
import { ResearchApi } from '../../services/research-api'

type DrawerTab = 'artifacts' | 'sources'

/** The ID of a cited Finding shown in a popover under its citation, and where in the reader the popover is. */
type CitationPopover = { finding: string; top: number; left: number }

/** The citation popover's width in pixels (`w-80`), which keeps it inside the reader. */
const POPOVER_WIDTH = 320

@Component({
  imports: [ArtifactList, GrillingThread, MarkdownView, SourceCataloguePanel, Stepper],
  templateUrl: 'home.page.html',
  host: {
    // A click on a citation opens its popover and marks the click handled; any other click outside the popover closes it.
    '(document:click)': 'dismissPopover($event)',
    '(document:keydown.escape)': 'popover.set(undefined)',
  },
})
export class HomePage {
  protected readonly research = inject(ResearchApi)
  protected readonly message = signal('')
  /** Whether the page is asking the user to confirm a reset. */
  protected readonly confirmingReset = signal(false)
  /** Whether the drawer with the Artifacts and Sources is open: closed until the user opens it. */
  protected readonly drawerOpen = signal(false)
  protected readonly drawerTab = signal<DrawerTab>('artifacts')
  protected readonly tabs: { key: DrawerTab; label: string }[] = [
    { key: 'artifacts', label: 'Artifacts' },
    { key: 'sources', label: 'Sources' },
  ]
  /** The drawer's reader, scrolling the open Artifact. */
  private readonly reader = viewChild<ElementRef<HTMLElement>>('reader')
  private readonly popoverElement = viewChild<ElementRef<HTMLElement>>('popover')
  /** The citation popover the user opened last; opening another Artifact closes it. */
  protected readonly popover = linkedSignal<string | undefined, CitationPopover | undefined>({
    source: () => this.research.opened()?.name,
    computation: () => undefined,
  })
  /** The Finding the popover shows: `null` if the Findings have no such Finding, `undefined` until they're read. */
  protected readonly citedFinding = computed(() => {
    const popover = this.popover()
    const findings = this.research.findings()

    return popover && findings ? (findings.get(popover.finding) ?? null) : undefined
  })
  /** Where the reader was scrolled in the Artifact the Findings were opened from. */
  private returnScroll = 0
  /** Where to scroll the reader once the Artifact gone back to is shown. */
  private pendingScroll?: number
  /**
   * Whether the page offers the message input: to start a Research, answer a Grilling question, or wait for a running
   * Step. A Failed or Completed Research rejects a message and an Interrupted one ignores it, so they get none.
   */
  protected readonly messageable = computed(() =>
    ['none', 'awaiting_answer', 'running'].includes(this.research.state().status),
  )
  /** What the message input asks for, or what the running Step is doing while the input is disabled. */
  protected readonly placeholder = computed(() => {
    const state = this.research.state()

    if (state.status === 'none') {
      return 'What do you want to research?'
    }

    return this.research.busy() ? (activity(state) ?? '') : 'Type your own answer…'
  })
  /** How the Research ended, if it Failed or was Interrupted: shown at the end of the thread. */
  protected readonly outcome = computed(() => {
    const state = this.research.state()

    switch (state.status) {
      case 'failed':
        return { title: 'The Research failed', reason: state.reason, resumable: false }
      case 'interrupted':
        // The reason lives in the server's memory only, so it is gone after a restart.
        return {
          title: 'The Research was interrupted',
          reason: state.reason ?? 'The Research was interrupted.',
          resumable: true,
        }
      default:
        return undefined
    }
  })

  constructor() {
    // Watching the Research complete opens the Report by itself, once; a Research loaded Completed only shows the card.
    effect(() => {
      if (this.research.reportDue()) {
        untracked(() => this.readReport())
      }
    })

    // After render, as the Artifact gone back to is read again and only scrolls once its Markdown is in the page.
    afterRenderEffect(() => {
      const reader = this.reader()?.nativeElement

      if (reader && this.research.openedMarkdown() !== undefined && this.pendingScroll !== undefined) {
        reader.scrollTop = this.pendingScroll
        this.pendingScroll = undefined
      }
    })
  }

  /** Enter sends the message; Shift+Enter leaves the textarea to add a new line. */
  protected keydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      this.sendTyped(event)
    }
  }

  protected sendTyped(event: Event): void {
    event.preventDefault()
    const message = this.message()

    if (!message.trim() || this.research.busy()) {
      return
    }

    this.message.set('')
    // An answer goes exactly as typed; only the question that starts the Research is trimmed.
    this.send(this.research.state().status === 'none' ? message.trim() : message)
  }

  /** Continues an Interrupted Research: outside Awaiting Answer the Research ignores the message. */
  protected resume(): void {
    this.send('')
  }

  /** Opens the drawer on the Report. */
  protected readReport(): void {
    this.drawerOpen.set(true)
    this.research.openReport()
  }

  /** Closes the drawer along with any Artifact open in it. */
  protected closeDrawer(): void {
    this.drawerOpen.set(false)
    this.research.close()
  }

  /** Opens the popover of a clicked citation under it, keeping it inside the reader. */
  protected showCitation({ finding, link }: Citation): void {
    const reader = this.reader()?.nativeElement

    if (!reader) {
      return
    }

    const box = reader.getBoundingClientRect()
    const at = link.getBoundingClientRect()
    this.popover.set({
      finding,
      top: at.bottom - box.top + reader.scrollTop + 6,
      left: Math.max(8, Math.min(at.left - box.left, box.width - POPOVER_WIDTH - 8)),
    })
  }

  protected dismissPopover(event: MouseEvent): void {
    const inside = event.target instanceof Node && this.popoverElement()?.nativeElement.contains(event.target)

    if (!event.defaultPrevented && !inside) {
      this.popover.set(undefined)
    }
  }

  /** Shows the Findings at the given Finding, remembering where the reader was to go back there. */
  protected openInFindings(finding: string): void {
    this.returnScroll = this.reader()?.nativeElement.scrollTop ?? 0
    this.research.openFinding(finding)
  }

  /** Goes back from the Findings to the Artifact they were opened from, scrolled where it was. */
  protected back(): void {
    this.pendingScroll = this.returnScroll
    this.research.back()
  }

  protected reset(): void {
    this.confirmingReset.set(false)
    this.drawerOpen.set(false)
    void this.research.reset()
  }

  protected send(message: string): void {
    void this.research.send(message)
  }
}

/** What the running Step is doing, in words. */
function activity(state: ResearchState): string | undefined {
  if (state.status !== 'running') {
    return undefined
  }

  switch (state.step) {
    case 'grilling':
      return 'Thinking about the next question…'
    case 'source_catalogue':
      return 'Picking Primary Sources…'
    case 'retrieval':
      return 'Gathering Findings from the Sources…'
    case 'draft':
      return `Round ${state.round} · Writing the Draft…`
    case 'review':
      return `Round ${state.round} · Reviewing the Draft…`
  }
}
