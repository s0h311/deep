import { isPlatformBrowser } from '@angular/common'
import { HttpClient, httpResource } from '@angular/common/http'
import {
  computed,
  effect,
  inject,
  Injectable,
  linkedSignal,
  PLATFORM_ID,
  resource,
  signal,
  untracked,
} from '@angular/core'
import { firstValueFrom } from 'rxjs'
import { Artifact, GRILLING_TRANSCRIPT, inStepOrder, ListedArtifact, Verdict } from '../models/artifact'
import { GrillingTranscript } from '../models/grilling-transcript'
import { ResearchState } from '../models/research-state'
import { SourceCatalogue } from '../models/source-catalogue'

/** How often a page that isn't reading a stream re-fetches a Running Research's state. */
const POLL_INTERVAL = 2000
/** The front matter a Review keeps its verdict in. */
const FRONT_MATTER = /^---\n[\s\S]*?\n---\n/

/** An event on the stream of `POST /api/research`. */
type ResearchEvent =
  | { type: 'step'; step: 'grilling' | 'awaiting_answer' | 'source_catalogue' | 'retrieval' | 'completed' }
  | { type: 'step'; step: 'draft' | 'review'; round: number }
  | { type: 'step'; step: 'failed'; reason: string }
  | { type: 'text'; text: string }

@Injectable({ providedIn: 'root' })
export class ResearchApi {
  private readonly researchState = httpResource<ResearchState>(() => '/api/research')
  private readonly artifactNames = httpResource<string[]>(() => '/api/research/artifacts')
  /** Whether there is a Research, and so a Grilling Transcript that holds its chat thread. */
  private readonly started = computed(() => this.state().status !== 'none')
  private readonly transcript = httpResource<GrillingTranscript>(() =>
    this.started() ? artifactUrl(GRILLING_TRANSCRIPT) : undefined,
  )
  private readonly catalogueName = computed(() => this.ordered().find(({ kind }) => kind === 'source_catalogue')?.name)
  private readonly catalogue = httpResource<SourceCatalogue>(() => {
    const name = this.catalogueName()
    return name ? artifactUrl(name) : undefined
  })
  private readonly ordered = computed(() => inStepOrder(this.artifacts()))
  /** The Reviews' names, unchanged by a reload that brings no new Review, so their verdicts aren't read again. */
  private readonly reviewNames = computed(
    () => this.ordered().flatMap(({ kind, name }) => (kind === 'review' ? [name] : [])),
    { equal: (a, b) => a.join('/') === b.join('/') },
  )
  /** Each Review's verdict, by the Review's name. */
  private readonly verdicts = resource({
    params: () => (this.reviewNames().length ? this.reviewNames() : undefined),
    loader: async ({ params }) =>
      new Map(
        await Promise.all(
          params.map(
            async (name) =>
              [
                name,
                verdict(await firstValueFrom(this.http.get(artifactUrl(name), { responseType: 'text' }))),
              ] as const,
          ),
        ),
      ),
  })
  /** The Report's name once the Research is Completed. */
  private readonly report = computed(() =>
    this.state().status === 'completed' ? this.ordered().find(({ kind }) => kind === 'report')?.name : undefined,
  )
  /** The name of the Artifact the user opened, and the Finding to scroll to if it is the Findings. The Report opens on its own once the Research is Completed. */
  private readonly selection = linkedSignal<{ name: string; finding?: string } | undefined>(() => {
    const report = this.report()
    return report ? { name: report } : undefined
  })
  private readonly content = httpResource.text(() => {
    // The Grilling Transcript opens as the chat thread.
    const artifact = this.opened()
    return artifact && artifact.kind !== 'grilling_transcript' ? artifactUrl(artifact.name) : undefined
  })
  /** A key for where the loaded Research stands, ignoring any reason, so a poll that finds it unchanged is no change. */
  private readonly stepKey = computed(() => {
    if (!this.researchState.hasValue()) {
      return undefined
    }

    const state = this.researchState.value()
    return [state.status, 'step' in state ? state.step : '', 'round' in state ? state.round : ''].join(' ')
  })
  private readonly streaming = signal(false)
  /** Cancels the stream this page is reading, if any. */
  private stream?: AbortController
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID))
  private readonly http = inject(HttpClient)
  /** The last state read, kept while a re-read fails, so a dropped connection doesn't look like no Research. */
  private readonly lastState = linkedSignal<ResearchState | undefined, ResearchState>({
    source: () => (this.researchState.hasValue() ? this.researchState.value() : undefined),
    computation: (state, previous) => state ?? previous?.value ?? { status: 'none' },
  })

  readonly state = this.lastState.asReadonly()
  readonly artifacts = computed(() => (this.artifactNames.hasValue() ? this.artifactNames.value() : []))
  /** The Artifacts in Step order, each Review with its verdict once read. */
  readonly artifactList = computed<ListedArtifact[]>(() => {
    const verdicts = this.verdicts.hasValue() ? this.verdicts.value() : undefined

    return this.ordered().map((artifact) => ({ ...artifact, verdict: verdicts?.get(artifact.name) }))
  })
  /** The open Artifact, if it still exists, with the Finding to scroll to if it is the Findings. */
  readonly opened = computed<(Artifact & { finding?: string }) | undefined>(() => {
    const selection = this.selection()
    const artifact = this.ordered().find(({ name }) => name === selection?.name)

    return artifact && { ...artifact, finding: selection?.finding }
  })
  /** The open Artifact as Markdown, once read: a JSON Artifact as a code block, and without any front matter. */
  readonly openedMarkdown = computed(() => {
    const name = this.opened()?.name

    if (!name || !this.content.hasValue()) {
      return undefined
    }

    const content = this.content.value()
    return name.endsWith('.json') ? `\`\`\`json\n${content.trimEnd()}\n\`\`\`` : content.replace(FRONT_MATTER, '')
  })
  /** The Grilling interview of the whole Research, once read. */
  readonly grillingTranscript = computed(() => (this.transcript.hasValue() ? this.transcript.value() : undefined))
  /** The Source Catalogue's Sources, once its Step has written it. */
  readonly sources = computed(() => (this.catalogue.hasValue() ? this.catalogue.value().sources : undefined))
  /** Whether the Research would reject a message now. */
  readonly busy = computed(() => this.streaming() || this.state().status === 'running')

  constructor() {
    // A Step started by another tab, or before a reload, has no stream here, so it is followed by polling.
    // Each read ending, even in an error, re-runs this effect, which schedules the next poll while the Research still runs.
    effect((onCleanup) => {
      if (!this.browser || this.streaming() || this.state().status !== 'running' || this.researchState.isLoading()) {
        return
      }

      const poll = setTimeout(() => this.researchState.reload(), POLL_INTERVAL)
      onCleanup(() => clearTimeout(poll))
    })

    // Awaiting Answer means the Research has just saved a new question to the Grilling Transcript, whether this page's
    // stream, polling or a 409 reported it. No-op while the Grilling Transcript is still loading for the first time.
    effect(() => {
      if (this.state().status === 'awaiting_answer') {
        untracked(() => this.transcript.reload())
      }
    })

    // A Step writes its Artifacts before the next one starts, so every change of Step may bring new ones. The first
    // loaded state is skipped, as the Artifact names were read along with it, and so is a reset, which leaves none.
    let seen: string | undefined
    effect(() => {
      const key = this.stepKey()

      if (key === undefined) {
        return
      }

      if (seen !== undefined && key !== seen && this.state().status !== 'none') {
        untracked(() => this.artifactNames.reload())
      }

      seen = key
    })
  }

  /** Opens the Artifact with the given name. */
  open(name: string): void {
    this.selection.set({ name })
  }

  /** Closes the open Artifact, going back to the chat thread. */
  close(): void {
    this.selection.set(undefined)
  }

  /** Opens the Findings scrolled to the Finding with the given ID. */
  openFinding(finding: string): void {
    const findings = this.ordered().find(({ kind }) => kind === 'findings')

    if (findings) {
      this.selection.set({ name: findings.name, finding })
    }
  }

  /** Sends a message to the Research and follows the Steps it runs until its stream ends. */
  async send(message: string): Promise<void> {
    const transcript = this.grillingTranscript()

    if (this.state().status === 'awaiting_answer' && transcript) {
      // The answer shows in the thread now; the Grilling Transcript has it only once the Research saves it.
      this.transcript.set(answered(transcript, message))
    }

    const stream = new AbortController()
    this.stream = stream
    this.streaming.set(true)

    try {
      const response = await fetch('/api/research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: stream.signal,
      })

      if (!response.ok || !response.body) {
        // A 409 means another send is running: show the state that send left instead.
        this.researchState.reload()
        return
      }

      for await (const event of events(response.body)) {
        this.follow(event)
      }
    } catch {
      // A reset cancelled the stream and set the state itself.
      if (stream.signal.aborted) {
        return
      }

      // The connection dropped; the Step may still be running on the server, which polling then follows.
      this.researchState.reload()
    } finally {
      this.streaming.set(false)
    }
  }

  /** Deletes the Research with every Artifact, leaving no Research. */
  async reset(): Promise<void> {
    // Cancelled first, so the `failed` step a reset ends the stream with isn't followed.
    this.stream?.abort()

    try {
      await firstValueFrom(this.http.delete('/api/research'))
      this.researchState.set({ status: 'none' })
      this.artifactNames.set([])
      this.selection.set(undefined)
    } catch {
      // The Research may be partly deleted: show what is left of it.
      this.researchState.reload()
      this.artifactNames.reload()
    }
  }

  /** Moves the state along with a streamed Step. `text` events are Grilling questions, also kept in the Grilling Transcript. */
  private follow(event: ResearchEvent): void {
    if (event.type !== 'step') {
      return
    }

    if (event.step === 'failed') {
      // The stream says `failed` for both Failed and Interrupted; only the state tells them apart.
      this.researchState.reload()
      return
    }

    this.researchState.set(stateAt(event))
  }
}

function artifactUrl(name: string): string {
  return `/api/research/artifacts/${encodeURIComponent(name)}`
}

/** A Review's verdict, from its front matter. */
function verdict(review: string): Verdict | undefined {
  return review.match(/^---\nverdict: (pass|fail)\n/)?.[1] as Verdict | undefined
}

/** The Grilling Transcript with its last question answered, if that question was still unanswered. */
function answered(transcript: GrillingTranscript, answer: string): GrillingTranscript {
  const last = transcript.turns.at(-1)

  return last && last.answer === undefined
    ? { ...transcript, turns: [...transcript.turns.slice(0, -1), { ...last, answer }] }
    : transcript
}

/** The state a streamed Step puts the Research in. */
function stateAt(event: Exclude<ResearchEvent, { type: 'text' } | { step: 'failed' }>): ResearchState {
  switch (event.step) {
    case 'awaiting_answer':
      return { status: 'awaiting_answer' }
    case 'completed':
      return { status: 'completed' }
    case 'draft':
    case 'review':
      return { status: 'running', step: event.step, round: event.round }
    default:
      return { status: 'running', step: event.step }
  }
}

/** The events of a `text/event-stream` body, one per `data:` message. */
async function* events(body: ReadableStream<Uint8Array<ArrayBuffer>>): AsyncGenerator<ResearchEvent> {
  let buffer = ''

  for await (const chunk of body.pipeThrough(new TextDecoderStream())) {
    buffer += chunk
    const messages = buffer.split('\n\n')
    buffer = messages.pop() ?? ''

    for (const message of messages) {
      const data = message
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice('data: '.length))
        .join('\n')

      if (data) {
        yield JSON.parse(data) as ResearchEvent
      }
    }
  }
}
