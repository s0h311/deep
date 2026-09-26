/** A faked `text/event-stream` response to `POST /api/research`: the test pushes events and closes it. */
export type FakeStream = {
  /** Sends one event, as the server's `EventStream` frames it. */
  push(event: unknown): void
  /** Ends the stream, as the server does after a terminal step value. */
  close(): void
  /** Whether the page cancelled its request, which ends its read of the stream as a real `fetch` does. */
  readonly cancelled: boolean
}

/** Answers the next `fetch` with a faked event stream the test drives. */
export function stubStream(): FakeStream {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) })
  let cancelled = false

  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async (_input, init) => {
    init?.signal?.addEventListener('abort', () => {
      cancelled = true
      controller.error(new DOMException('The request was cancelled.', 'AbortError'))
    })

    return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  })

  return {
    push: (event) => cancelled || controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)),
    close: () => cancelled || controller.close(),
    get cancelled() {
      return cancelled
    },
  }
}

/** Answers the next `fetch` with an HTTP error, such as the 409 of a send that conflicts with a running one. */
export function stubFailedSend(status: number): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status }))
}
