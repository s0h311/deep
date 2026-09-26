import { isPlatformBrowser } from '@angular/common'
import { httpResource } from '@angular/common/http'
import { computed, effect, inject, Injectable, PLATFORM_ID, signal } from '@angular/core'
import { ResearchState } from '../models/research-state'

/** How often a page that isn't reading a stream re-fetches a Running Research's state. */
const POLL_INTERVAL = 2000

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
  private readonly streaming = signal(false)
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID))

  readonly state = computed<ResearchState>(() =>
    this.researchState.hasValue() ? this.researchState.value() : { status: 'none' },
  )
  readonly artifacts = computed(() => (this.artifactNames.hasValue() ? this.artifactNames.value() : []))
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
  }

  /** Sends a message to the Research and follows the Steps it runs until its stream ends. */
  async send(message: string): Promise<void> {
    this.streaming.set(true)

    try {
      const response = await fetch('/api/research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
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
      // The connection dropped; the Step may still be running on the server, which polling then follows.
      this.researchState.reload()
    } finally {
      this.streaming.set(false)
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
