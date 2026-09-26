import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { TestBed } from '@angular/core/testing'
import { GrillingTranscript } from '../../models/grilling-transcript'
import { ResearchState } from '../../models/research-state'
import { stubFailedSend, stubStream } from '../../../testing/fake-stream'
import { HomePage } from './home.page'

const GRILLING_TRANSCRIPT_URL = '/api/research/artifacts/grilling_transcript.json'
const SOURCE_CATALOGUE = 'heat_pumps_source_catalogue.json'

/** A Grilling Transcript whose first question is still unanswered. */
const FIRST_QUESTION: GrillingTranscript = {
  question: 'How do heat pumps work?',
  turns: [{ question: 'Who is the audience?', recommendedAnswer: 'Homeowners considering one.' }],
}

async function renderPage(api: {
  state?: ResearchState
  artifacts?: string[]
  transcript?: GrillingTranscript
  sources?: string[]
}) {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] })
  const fixture = TestBed.createComponent(HomePage)
  const http = TestBed.inject(HttpTestingController)
  TestBed.tick()
  http.expectOne({ method: 'GET', url: '/api/research' }).flush(api.state ?? { status: 'none' })
  http.expectOne({ method: 'GET', url: '/api/research/artifacts' }).flush(api.artifacts ?? [])
  await settle()
  // During Grilling the page reads the Grilling Transcript to build the chat thread.
  for (const request of http.match({ method: 'GET', url: GRILLING_TRANSCRIPT_URL })) {
    request.flush(api.transcript ?? FIRST_QUESTION)
  }
  // Once the Source Catalogue exists, the page reads it for its panel.
  for (const request of http.match({ method: 'GET', url: `/api/research/artifacts/${SOURCE_CATALOGUE}` })) {
    request.flush({ sources: api.sources ?? [] })
  }
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

/** The chat thread's messages, in order, each as its lines of text joined by single spaces. */
function thread(page: HTMLElement): string[] {
  return [...page.querySelectorAll('app-grilling-thread li')].map((item) => {
    const texts: string[] = []
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT)

    while (walker.nextNode()) {
      texts.push(walker.currentNode.textContent ?? '')
    }

    return texts.join(' ').replace(/\s+/g, ' ').trim()
  })
}

/** The "Use recommendation" button, if the page shows one. */
function useRecommendation(page: HTMLElement): HTMLButtonElement | undefined {
  return [...page.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Use recommendation')
}

/** The page's button with the given label, if it shows one. */
function button(page: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...page.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)
}

/** The Source Catalogue panel's Sources, each as its text and link target, if it links. */
function sources(page: HTMLElement): { text: string; href?: string }[] {
  return [...page.querySelectorAll('app-source-catalogue-panel li')].map((item) => ({
    text: item.textContent?.trim() ?? '',
    href: item.querySelector('a')?.getAttribute('href') ?? undefined,
  }))
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

  describe('Grilling chat', () => {
    it('shows the question, then each numbered Grilling question with its recommended answer and the answer given', async () => {
      const page = await renderPage({
        state: { status: 'awaiting_answer' },
        transcript: {
          question: 'How do heat pumps work?',
          turns: [
            { question: 'Who is the audience?', recommendedAnswer: 'Homeowners.', answer: 'Installers.' },
            { question: 'Which climate?', recommendedAnswer: 'Central Europe.' },
          ],
        },
      })

      expect(thread(page)).toEqual([
        'How do heat pumps work?',
        'Q1 Who is the audience? Recommended answer: Homeowners.',
        'Installers.',
        expect.stringContaining('Q2 Which climate? Recommended answer: Central Europe.'),
      ])
    })

    it('sends the recommended answer verbatim with "Use recommendation"', async () => {
      const page = await renderPage({ state: { status: 'awaiting_answer' }, transcript: FIRST_QUESTION })
      stubStream()

      useRecommendation(page)?.click()

      expect(fetch).toHaveBeenCalledWith(
        '/api/research',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ message: 'Homeowners considering one.' }) }),
      )
    })

    it('sends a typed answer as typed', async () => {
      const page = await renderPage({ state: { status: 'awaiting_answer' }, transcript: FIRST_QUESTION })
      stubStream()

      send(page, 'Installers in cold climates')

      expect(fetch).toHaveBeenCalledWith(
        '/api/research',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ message: 'Installers in cold climates' }) }),
      )
    })

    it('offers "Use recommendation" only while the Research is Awaiting Answer', async () => {
      const page = await renderPage({ state: { status: 'interrupted', step: 'grilling' }, transcript: FIRST_QUESTION })

      expect(thread(page)).toContain('Q1 Who is the audience? Recommended answer: Homeowners considering one.')
      expect(useRecommendation(page)).toBeUndefined()
    })

    it('disables the answer controls while the answer is being sent', async () => {
      const page = await renderPage({ state: { status: 'awaiting_answer' }, transcript: FIRST_QUESTION })
      const stream = stubStream()

      useRecommendation(page)?.click()
      stream.push({ type: 'step', step: 'grilling' })
      await settle()

      expect(useRecommendation(page)).toBeUndefined()
      expect(page.querySelector<HTMLTextAreaElement>('textarea[name="message"]')?.disabled).toBe(true)
    })

    it('shows the answer right away and the next question once the Research asks it', async () => {
      const page = await renderPage({ state: { status: 'awaiting_answer' }, transcript: FIRST_QUESTION })
      const stream = stubStream()

      send(page, 'Installers')
      stream.push({ type: 'step', step: 'grilling' })
      await settle()

      expect(thread(page).at(-1)).toBe('Installers')

      stream.push({ type: 'text', text: '❓ **Q2**: Which climate?\n\n➡️ Central Europe.' })
      stream.push({ type: 'step', step: 'awaiting_answer' })
      stream.close()
      await settle()
      TestBed.inject(HttpTestingController)
        .expectOne({ method: 'GET', url: GRILLING_TRANSCRIPT_URL })
        .flush({
          question: 'How do heat pumps work?',
          turns: [
            {
              question: 'Who is the audience?',
              recommendedAnswer: 'Homeowners considering one.',
              answer: 'Installers',
            },
            { question: 'Which climate?', recommendedAnswer: 'Central Europe.' },
          ],
        })
      await settle()

      expect(thread(page).at(-1)).toContain('Q2 Which climate? Recommended answer: Central Europe.')
      expect(useRecommendation(page)?.disabled).toBe(false)
    })
  })

  describe('Source Catalogue panel', () => {
    it('lists every Source, linking concrete hosts and showing wildcard patterns as text', async () => {
      const page = await renderPage({
        state: { status: 'running', step: 'retrieval' },
        artifacts: ['heat_pumps_grilling_protocol.md', SOURCE_CATALOGUE],
        sources: ['energy.gov', '*.europa.eu'],
      })

      expect(sources(page)).toEqual([
        { text: 'energy.gov', href: 'https://energy.gov' },
        { text: '*.europa.eu', href: undefined },
      ])
    })

    it('says there is no Source Catalogue before its Step writes it', async () => {
      const page = await renderPage({ state: { status: 'running', step: 'source_catalogue' } })

      expect(page.querySelector('app-source-catalogue-panel')?.textContent).toContain('No Source Catalogue yet.')
    })

    it('shows the Source Catalogue once its Step has written it, without a reload', async () => {
      const page = await renderPage({
        state: { status: 'interrupted', step: 'source_catalogue' },
        artifacts: ['heat_pumps_grilling_protocol.md'],
      })
      const http = TestBed.inject(HttpTestingController)
      const stream = stubStream()

      button(page, 'Resume')?.click()
      stream.push({ type: 'step', step: 'source_catalogue' })
      await settle()
      http.expectOne({ method: 'GET', url: '/api/research/artifacts' }).flush(['heat_pumps_grilling_protocol.md'])
      stream.push({ type: 'step', step: 'retrieval' })
      await settle()
      http
        .expectOne({ method: 'GET', url: '/api/research/artifacts' })
        .flush(['heat_pumps_grilling_protocol.md', SOURCE_CATALOGUE])
      await settle()
      http
        .expectOne({ method: 'GET', url: `/api/research/artifacts/${SOURCE_CATALOGUE}` })
        .flush({ sources: ['energy.gov'] })
      await settle()

      expect(sources(page)).toEqual([{ text: 'energy.gov', href: 'https://energy.gov' }])
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

    it('shows a Grilling question asked by a send this page did not start', async () => {
      const page = await renderPage({
        state: { status: 'running', step: 'grilling' },
        transcript: { question: 'How do heat pumps work?', turns: [] },
      })
      const http = TestBed.inject(HttpTestingController)

      await vi.advanceTimersByTimeAsync(2000)
      TestBed.tick()
      http.expectOne({ method: 'GET', url: '/api/research' }).flush({ status: 'awaiting_answer' })
      await vi.advanceTimersByTimeAsync(0)
      TestBed.tick()
      http.expectOne({ method: 'GET', url: GRILLING_TRANSCRIPT_URL }).flush(FIRST_QUESTION)
      await vi.advanceTimersByTimeAsync(0)
      TestBed.tick()

      expect(thread(page)).toEqual([
        'How do heat pumps work?',
        expect.stringContaining('Q1 Who is the audience? Recommended answer: Homeowners considering one.'),
      ])
      expect(useRecommendation(page)).toBeDefined()
    })
  })

  describe('Resume', () => {
    it('continues an Interrupted Research from its Artifacts and follows the resumed Steps', async () => {
      const page = await renderPage({
        state: { status: 'interrupted', step: 'retrieval', reason: 'The Retrieval agent failed twice.' },
      })
      const stream = stubStream()

      button(page, 'Resume')?.click()
      stream.push({ type: 'step', step: 'retrieval' })
      await settle()

      expect(fetch).toHaveBeenCalledWith(
        '/api/research',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ message: '' }) }),
      )
      expect(currentStep(page)).toContain('Retrieval')
      expect(currentStep(page)).toContain('Running')
      expect(button(page, 'Resume')).toBeUndefined()
    })

    it.each<ResearchState>([
      { status: 'none' },
      { status: 'running', step: 'draft', round: 1 },
      { status: 'awaiting_answer' },
      { status: 'failed', reason: 'The Draft failed Review in every Round.' },
      { status: 'completed' },
    ])('is not offered when the Research is $status', async (state) => {
      const page = await renderPage({ state })

      expect(button(page, 'Resume')).toBeUndefined()
    })
  })

  describe('Reset', () => {
    it('offers Reset while a Step is running', async () => {
      const page = await renderPage({ state: { status: 'running', step: 'retrieval' } })

      expect(button(page, 'Reset')?.disabled).toBe(false)
    })

    it('offers a Failed Research Reset and nothing else', async () => {
      const page = await renderPage({ state: { status: 'failed', reason: 'The Draft failed Review in every Round.' } })

      expect([...page.querySelectorAll('button')].map((item) => item.textContent?.trim())).toEqual(['Reset'])
      expect(page.querySelector('textarea[name="message"]')).toBeNull()
    })

    it('asks for confirmation and deletes nothing when cancelled', async () => {
      const page = await renderPage({ state: { status: 'completed' }, artifacts: ['q.report.md'] })

      button(page, 'Reset')?.click()
      TestBed.tick()

      expect(page.querySelector('[role="alertdialog"]')?.textContent).toContain('This deletes every Artifact.')

      button(page, 'Cancel')?.click()
      TestBed.tick()

      expect(page.querySelector('[role="alertdialog"]')).toBeNull()
      TestBed.inject(HttpTestingController).expectNone({ method: 'DELETE', url: '/api/research' })
      expect(page.textContent).toContain('q.report.md')
    })

    it('deletes the Research once confirmed and shows the empty state', async () => {
      const page = await renderPage({ state: { status: 'completed' }, artifacts: ['q.report.md'] })

      button(page, 'Reset')?.click()
      TestBed.tick()
      button(page, 'Delete')?.click()
      TestBed.inject(HttpTestingController)
        .expectOne({ method: 'DELETE', url: '/api/research' })
        .flush(null, { status: 204, statusText: 'No Content' })
      await settle()

      expect(page.textContent).toContain('What do you want to research?')
      expect(page.textContent).not.toContain('q.report.md')
      expect(page.querySelector('[role="alertdialog"]')).toBeNull()
    })

    it('cancels the stream the page is reading and shows the empty state', async () => {
      const page = await renderPage({ state: { status: 'none' } })
      const stream = stubStream()
      send(page, 'How do heat pumps work?')
      stream.push({ type: 'step', step: 'grilling' })
      await settle()
      const http = TestBed.inject(HttpTestingController)
      http.expectOne({ method: 'GET', url: '/api/research/artifacts' }).flush(['grilling_transcript.json'])
      http
        .expectOne({ method: 'GET', url: GRILLING_TRANSCRIPT_URL })
        .flush({ question: 'How do heat pumps work?', turns: [] })
      await settle()

      button(page, 'Reset')?.click()
      TestBed.tick()
      button(page, 'Delete')?.click()
      TestBed.inject(HttpTestingController)
        .expectOne({ method: 'DELETE', url: '/api/research' })
        .flush(null, { status: 204, statusText: 'No Content' })
      await settle()
      stream.push({ type: 'step', step: 'failed', reason: 'The Research was reset.' })
      await settle()

      expect(stream.cancelled).toBe(true)
      expect(page.textContent).toContain('What do you want to research?')
      expect(thread(page)).toEqual([])
      expect(currentStep(page)).toBeUndefined()
      expect(page.querySelector<HTMLTextAreaElement>('textarea[name="message"]')?.disabled).toBe(false)
      TestBed.inject(HttpTestingController).verify()
    })

    it('shows the Research as it is when the reset fails', async () => {
      const page = await renderPage({ state: { status: 'completed' }, artifacts: ['q.report.md'] })
      const http = TestBed.inject(HttpTestingController)

      button(page, 'Reset')?.click()
      TestBed.tick()
      button(page, 'Delete')?.click()
      http
        .expectOne({ method: 'DELETE', url: '/api/research' })
        .flush('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
      await settle()
      http.expectOne({ method: 'GET', url: '/api/research' }).flush({ status: 'completed' })
      http.expectOne({ method: 'GET', url: '/api/research/artifacts' }).flush(['q.report.md'])
      await settle()

      expect(page.querySelector('app-stepper')?.textContent).toContain('Completed')
      expect(page.textContent).toContain('q.report.md')
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
