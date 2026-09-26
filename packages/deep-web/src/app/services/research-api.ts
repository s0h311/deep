import { isPlatformBrowser } from '@angular/common'
import { HttpClient, httpResource } from '@angular/common/http'
import { computed, effect, inject, Injectable, PLATFORM_ID, signal, untracked } from '@angular/core'
import { firstValueFrom } from 'rxjs'
import { GrillingTranscript } from '../models/grilling-transcript'
import { ResearchState } from '../models/research-state'
import { SourceCatalogue } from '../models/source-catalogue'

/** How often a page that isn't reading a stream re-fetches a Running Research's state. */
const POLL_INTERVAL = 2000
/** The Source Catalogue Artifact's name after the Topic prefix. */
const SOURCE_CATALOGUE_SUFFIX = '_source_catalogue.json'

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
  /** Whether the Research is in the Grilling Step, so the Grilling Transcript holds its chat thread. */
  private readonly grilling = computed(() => inGrilling(this.state()))
  private readonly transcript = httpResource<GrillingTranscript>(() =>
    this.grilling() ? '/api/research/artifacts/grilling_transcript.json' : undefined,
  )
  private readonly catalogueName = computed(() =>
    this.artifacts().find((name) => name.endsWith(SOURCE_CATALOGUE_SUFFIX)),
  )
  private readonly catalogue = httpResource<SourceCatalogue>(() => {
    const name = this.catalogueName()
    return name ? `/api/research/artifacts/${encodeURIComponent(name)}` : undefined
  })
  /** Where the loaded Research stands, ignoring any reason, so a poll that finds it unchanged is no change. */
  private readonly step = computed(() => {
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

  readonly state = computed<ResearchState>(() =>
    this.researchState.hasValue() ? this.researchState.value() : { status: 'none' },
  )
  readonly artifacts = computed(() => (this.artifactNames.hasValue() ? this.artifactNames.value() : []))
  /** The Grilling interview while the Research is in the Grilling Step. */
  readonly grillingTranscript = computed(() => (this.transcript.hasValue() ? this.transcript.value() : undefined))
  /** The Source Catalogue's Sources, once its Step has written it. */
  readonly sources = computed(() => (this.catalogue.hasValue() ? this.catalogue.value().sources : undefined))
  /** Whether the Research would reject a message now. */
  readonly busy = computed(() => this.streaming() || this.state().status === 'running')

  constructor() {
    // A Step started by another tab, or before a reload, has no stream here, so it is followed by polling.
    // A new state value re-runs this effect, which schedules the next poll while the Research still runs.
    effect((onCleanup) => {
      if (!this.browser || this.streaming() || this.state().status !== 'running') {
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
      const step = this.step()

      if (step === undefined) {
        return
      }

      if (seen !== undefined && step !== seen && this.state().status !== 'none') {
        untracked(() => this.artifactNames.reload())
      }

      seen = step
    })
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

/** The Grilling Transcript with its last question answered, if that question was still unanswered. */
function answered(transcript: GrillingTranscript, answer: string): GrillingTranscript {
  const last = transcript.turns.at(-1)

  return last && last.answer === undefined
    ? { ...transcript, turns: [...transcript.turns.slice(0, -1), { ...last, answer }] }
    : transcript
}

function inGrilling(state: ResearchState): boolean {
  return state.status === 'awaiting_answer' || ('step' in state && state.step === 'grilling')
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
