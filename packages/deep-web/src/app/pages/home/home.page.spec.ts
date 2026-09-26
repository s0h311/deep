import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { TestBed } from '@angular/core/testing'
import { ResearchState } from '../../models/research-state'
import { stubFailedSend, stubStream } from '../../../testing/fake-stream'
import { HomePage } from './home.page'

async function renderPage(api: { state?: ResearchState; artifacts?: string[] }) {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] })
  const fixture = TestBed.createComponent(HomePage)
  const http = TestBed.inject(HttpTestingController)
  TestBed.tick()
  http.expectOne({ method: 'GET', url: '/api/research' }).flush(api.state ?? { status: 'none' })
  http.expectOne({ method: 'GET', url: '/api/research/artifacts' }).flush(api.artifacts ?? [])
  await fixture.whenStable()
  http.verify()
  return fixture.nativeElement as HTMLElement
}

/**
 * Lets the page read what the faked stream or API has sent so far, then re-renders.
 * Not `whenStable`: that would wait for requests the test hasn't answered yet.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve))
  TestBed.tick()
}

/** Types a message into the message input and sends it. */
function send(page: HTMLElement, message: string): void {
  const input = page.querySelector<HTMLTextAreaElement>('textarea[name="message"]')
  const button = page.querySelector<HTMLButtonElement>('button[type="submit"]')

  if (!input || !button) {
    throw new Error('The page has no message input.')
  }

  input.value = message
  input.dispatchEvent(new Event('input'))
  button.click()
}

/** The stepper's current Step, the one marked aria-current. */
function currentStep(page: HTMLElement): string | undefined {
  return page.querySelector('[aria-current="step"]')?.textContent?.replace(/\s+/g, ' ').trim()
}

/** The stepper's entry for a Step, by its label. */
function step(page: HTMLElement, label: string): string | undefined {
  return [...page.querySelectorAll('app-stepper li')]
    .map((item) => item.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .find((text) => text.includes(label))
}

describe('HomePage', () => {
  afterEach(() => vi.restoreAllMocks())

  describe('starting a Research', () => {
    it('asks what to research when there is no Research', async () => {
      const page = await renderPage({ state: { status: 'none' } })

      expect(page.textContent).toContain('What do you want to research?')
    })

    it('starts the Research with the first message and follows its streamed Steps', async () => {
      const page = await renderPage({ state: { status: 'none' } })
      const stream = stubStream()

      send(page, 'How do heat pumps work?')
      stream.push({ type: 'step', step: 'grilling' })
      await settle()

      expect(fetch).toHaveBeenCalledWith(
        '/api/research',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ message: 'How do heat pumps work?' }) }),
      )
      expect(currentStep(page)).toContain('Grilling')
      expect(currentStep(page)).toContain('Running')

      stream.push({ type: 'text', text: 'Q1: Who is the audience?' })
      stream.push({ type: 'step', step: 'awaiting_answer' })
      stream.close()
      await settle()

      expect(currentStep(page)).not.toContain('Running')
      expect(page.querySelector('app-stepper')?.textContent).toContain('Your turn')
    })

    it('asks the Research whether a failed Step failed or interrupted it', async () => {
      const page = await renderPage({ state: { status: 'none' } })
      const stream = stubStream()

      send(page, 'How do heat pumps work?')
      stream.push({ type: 'step', step: 'grilling' })
      stream.push({ type: 'step', step: 'failed', reason: 'The Grilling agent failed twice.' })
      stream.close()
      await settle()
      TestBed.inject(HttpTestingController)
        .expectOne({ method: 'GET', url: '/api/research' })
        .flush({ status: 'interrupted', step: 'grilling', reason: 'The Grilling agent failed twice.' })
      await settle()

      expect(currentStep(page)).toContain('Grilling')
      expect(currentStep(page)).not.toContain('Running')
      expect(page.querySelector('app-stepper')?.textContent).toContain('The Grilling agent failed twice.')
    })

    it('shows the current state when the send conflicts with a running Step', async () => {
      const page = await renderPage({ state: { status: 'none' } })
      stubFailedSend(409)

      send(page, 'How do heat pumps work?')
      await settle()
      TestBed.inject(HttpTestingController)
        .expectOne({ method: 'GET', url: '/api/research' })
        .flush({ status: 'running', step: 'source_catalogue' })
      await settle()

      expect(currentStep(page)).toContain('Source Catalogue')
      expect(currentStep(page)).toContain('Running')
    })
  })

  it("shows the names of the Research's Artifacts", async () => {
    const page = await renderPage({ artifacts: ['q.gp.md', 'q.sc.json'] })

    expect(page.textContent).toContain('q.gp.md')
    expect(page.textContent).toContain('q.sc.json')
  })

  it('disables the message input while a Step is running', async () => {
    const page = await renderPage({ state: { status: 'running', step: 'retrieval' } })

    expect(page.querySelector<HTMLTextAreaElement>('textarea[name="message"]')?.disabled).toBe(true)
    expect(page.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
  })

  describe('following a Step this page did not start', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
    afterEach(() => vi.useRealTimers())

    it('polls the state about every 2 seconds until the Research stops running', async () => {
      const page = await renderPage({ state: { status: 'running', step: 'draft', round: 1 } })
      const http = TestBed.inject(HttpTestingController)

      await vi.advanceTimersByTimeAsync(2000)
      TestBed.tick()
      http.expectOne({ method: 'GET', url: '/api/research' }).flush({ status: 'running', step: 'review', round: 1 })
      await vi.advanceTimersByTimeAsync(0)
      TestBed.tick()

      expect(currentStep(page)).toContain('Review')
      expect(currentStep(page)).toContain('Round 1 / 3')

      await vi.advanceTimersByTimeAsync(2000)
      TestBed.tick()
      http.expectOne({ method: 'GET', url: '/api/research' }).flush({ status: 'completed' })
      await vi.advanceTimersByTimeAsync(0)
      TestBed.tick()

      expect(page.querySelector('app-stepper')?.textContent).toContain('Completed')

      await vi.advanceTimersByTimeAsync(10_000)
      TestBed.tick()
      http.expectNone({ method: 'GET', url: '/api/research' })
    })
  })

  describe('stepper', () => {
    it('marks the running Step as current with a running indicator', async () => {
      const page = await renderPage({ state: { status: 'running', step: 'retrieval' } })

      expect(currentStep(page)).toContain('Retrieval')
      expect(currentStep(page)).toContain('Running')
    })

    it('shows the Round of a running Draft', async () => {
      const page = await renderPage({ state: { status: 'running', step: 'draft', round: 2 } })

      expect(currentStep(page)).toContain('Draft')
      expect(currentStep(page)).toContain('Round 2 / 3')
    })

    it('marks the Steps before the current one as done and the ones after it as upcoming', async () => {
      const page = await renderPage({ state: { status: 'running', step: 'retrieval' } })

      expect(step(page, 'Grilling')).toContain('Done')
      expect(step(page, 'Source Catalogue')).toContain('Done')
      expect(step(page, 'Draft')).toContain('Upcoming')
      expect(step(page, 'Review')).toContain('Upcoming')
    })

    it("shows Awaiting Answer as the user's turn in Grilling", async () => {
      const page = await renderPage({ state: { status: 'awaiting_answer' } })

      expect(currentStep(page)).toContain('Grilling')
      expect(currentStep(page)).not.toContain('Running')
      expect(page.querySelector('app-stepper')?.textContent).toContain('Your turn')
    })

    it('shows an Interrupted Research at its Step and Round with its reason', async () => {
      const page = await renderPage({
        state: { status: 'interrupted', step: 'review', round: 3, reason: 'The Review agent failed twice.' },
      })

      expect(currentStep(page)).toContain('Review')
      expect(currentStep(page)).toContain('Round 3 / 3')
      expect(currentStep(page)).not.toContain('Running')
      expect(page.querySelector('app-stepper')?.textContent).toContain('The Review agent failed twice.')
    })

    it('says an Interrupted Research with no known reason was interrupted', async () => {
      const page = await renderPage({ state: { status: 'interrupted', step: 'source_catalogue' } })

      expect(currentStep(page)).toContain('Source Catalogue')
      expect(page.querySelector('app-stepper')?.textContent).toContain('The Research was interrupted')
    })

    it('shows the reason of a Failed Research', async () => {
      const page = await renderPage({
        state: { status: 'failed', reason: 'The Draft failed Review in every Round.' },
      })

      expect(currentStep(page)).toBeUndefined()
      expect(page.querySelector('app-stepper')?.textContent).toContain('The Draft failed Review in every Round.')
    })

    it('marks every Step as done once the Research is Completed', async () => {
      const page = await renderPage({ state: { status: 'completed' } })

      expect(currentStep(page)).toBeUndefined()
      for (const label of ['Grilling', 'Source Catalogue', 'Retrieval', 'Draft', 'Review']) {
        expect(step(page, label)).toContain('Done')
      }
      expect(page.querySelector('app-stepper')?.textContent).toContain('Completed')
    })

    it('marks every Step as upcoming when there is no Research', async () => {
      const page = await renderPage({ state: { status: 'none' } })

      expect(currentStep(page)).toBeUndefined()
      for (const label of ['Grilling', 'Source Catalogue', 'Retrieval', 'Draft', 'Review']) {
        expect(step(page, label)).toContain('Upcoming')
      }
    })
  })
})
