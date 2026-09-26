import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { TestBed } from '@angular/core/testing'
import { GrillingTranscript } from '../../models/grilling-transcript'
import { ResearchState } from '../../models/research-state'
import { stubFailedSend, stubStream } from '../../../testing/fake-stream'
import { HomePage } from './home.page'

const ARTIFACT_URL = '/api/research/artifacts/'
const GRILLING_TRANSCRIPT_URL = `${ARTIFACT_URL}grilling_transcript.json`
const SOURCE_CATALOGUE = 'heat_pumps_source_catalogue.json'
/** Every Artifact of a Research whose second Round passed Review, as the server lists them: sorted by name. */
const ALL_ARTIFACTS = [
  'grilling_transcript.json',
  'heat_pumps_draft_1.md',
  'heat_pumps_draft_2.md',
  'heat_pumps_findings.md',
  'heat_pumps_grilling_protocol.md',
  'heat_pumps_report.md',
  'heat_pumps_review_1.md',
  'heat_pumps_review_2.md',
  SOURCE_CATALOGUE,
]
const FINDINGS = `# Findings

## F1

Heat pumps move heat.

URL: https://energy.gov/heat-pumps

> A heat pump moves heat rather than generating it.

## F2

They cut energy use.

URL: https://energy.gov/savings

> Heat pumps can reduce electricity use for heating by about 50%.
`

/** A Grilling Transcript whose first question is still unanswered. */
const FIRST_QUESTION: GrillingTranscript = {
  question: 'How do heat pumps work?',
  turns: [{ question: 'Who is the audience?', recommendedAnswer: 'Homeowners considering one.' }],
}

/** The faked API's Research: its state and Artifacts. */
type FakeResearch = {
  state?: ResearchState
  artifacts?: string[]
  transcript?: GrillingTranscript
  sources?: string[]
  /** The content of Markdown Artifacts, by name. */
  contents?: Record<string, string>
}

/** The Research the faked API serves in the current test. */
let research: FakeResearch = {}

async function renderPage(api: FakeResearch) {
  research = api
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] })
  const fixture = TestBed.createComponent(HomePage)
  const http = TestBed.inject(HttpTestingController)
  TestBed.tick()
  http.expectOne({ method: 'GET', url: '/api/research' }).flush(api.state ?? { status: 'none' })
  http.expectOne({ method: 'GET', url: '/api/research/artifacts' }).flush(api.artifacts ?? [])
  await settle()
  await answerArtifactReads()
  await fixture.whenStable()
  http.verify()
  return fixture.nativeElement as HTMLElement
}

/** Answers every read of a single Artifact the page makes, including reads that follow from earlier answers. */
async function answerArtifactReads(): Promise<void> {
  const api = research
  const http = TestBed.inject(HttpTestingController)
  let requests = http.match((request) => request.method === 'GET' && request.url.startsWith(ARTIFACT_URL))

  while (requests.length) {
    for (const request of requests) {
      const name = decodeURIComponent(request.request.url.slice(ARTIFACT_URL.length))

      if (name === 'grilling_transcript.json') {
        // The Grilling Transcript builds the chat thread.
        request.flush(api.transcript ?? FIRST_QUESTION)
      } else if (name === SOURCE_CATALOGUE) {
        // The Source Catalogue fills its panel.
        request.flush({ sources: api.sources ?? [] })
      } else {
        request.flush(api.contents?.[name] ?? `# ${name}`)
      }
    }

    await settle()
    requests = http.match((request) => request.method === 'GET' && request.url.startsWith(ARTIFACT_URL))
  }
}

/**
 * Lets the page read what the faked stream or API has sent so far, then re-renders.
 * Not `whenStable`: that would wait for requests the test hasn't answered yet.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve))
  TestBed.tick()
}

/** The message input, if the page shows one. */
function messageInput(page: HTMLElement): HTMLTextAreaElement | null {
  return page.querySelector<HTMLTextAreaElement>('textarea[name="message"]')
}

/** What the page offers below the thread in place of a message input, as its text: empty if nothing. */
function composer(page: HTMLElement): string | undefined {
  const footer = page.querySelector('footer')
  return footer ? text(footer) : undefined
}

/** Types a message into the message input, returning the input. */
function type(page: HTMLElement, message: string): HTMLTextAreaElement {
  const input = messageInput(page)

  if (!input) {
    throw new Error('The page has no message input.')
  }

  input.value = message
  input.dispatchEvent(new Event('input'))
  return input
}

/** Types a message into the message input and sends it. */
function send(page: HTMLElement, message: string): void {
  type(page, message)
  page.querySelector<HTMLButtonElement>('button[type="submit"]')?.click()
}

/** The chat thread's messages, in order, each as its text. */
function thread(page: HTMLElement): string[] {
  return [...page.querySelectorAll('app-grilling-thread li')].map(text)
}

/** The element's lines of text joined by single spaces. */
function text(element: Element): string {
  const texts: string[] = []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)

  while (walker.nextNode()) {
    texts.push(walker.currentNode.textContent ?? '')
  }

  return texts.join(' ').replace(/\s+/g, ' ').trim()
}

/** The notice of how the Research ended at the end of the thread, as its text, if the page shows one. */
function outcome(page: HTMLElement): string | undefined {
  const notice = page.querySelector('[role="status"]')
  return notice ? text(notice) : undefined
}

/** The "Use recommendation" button, if the page shows one. */
function useRecommendation(page: HTMLElement): HTMLButtonElement | undefined {
  return [...page.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Use recommendation')
}

/** The page's button with the given label, if it shows one. */
function button(page: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...page.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)
}

/** The page's icon button with the given accessible label, if it shows one. */
function iconButton(page: HTMLElement, label: string): HTMLButtonElement | null {
  return page.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
}

/** The Source Catalogue panel's Sources, each as its text and link target, if it links. */
function sources(page: HTMLElement): { text: string; href?: string }[] {
  return [...page.querySelectorAll('app-source-catalogue-panel li')].map((item) => ({
    text: item.textContent?.trim() ?? '',
    href: item.querySelector('a')?.getAttribute('href') ?? undefined,
  }))
}

/** The Artifact list's entries, in order, each as its label and any badge. */
function artifactList(page: HTMLElement): string[] {
  return [...page.querySelectorAll('app-artifact-list li')].map(text)
}

/** Opens the drawer on its Sources tab. */
async function openSources(page: HTMLElement): Promise<void> {
  await openDrawer(page)
  button(page, 'Sources')?.click()
  await settle()
}

/** Opens the Artifact with the given label from the drawer's Artifact list. */
async function open(page: HTMLElement, label: string): Promise<void> {
  await openDrawer(page)
  const entry = [...page.querySelectorAll<HTMLButtonElement>('app-artifact-list button')].find((item) =>
    item.textContent?.trim().startsWith(label),
  )

  if (!entry) {
    throw new Error(`The Artifact list has no ${label}.`)
  }

  entry.click()
  await settle()
  await answerArtifactReads()
}

/** The drawer holding the Artifacts and Sources, if it is open. */
function drawer(page: HTMLElement): HTMLElement | null {
  return page.querySelector('aside')
}

/** The header button that opens and closes the drawer, labelled with the Artifact count. */
function artifactsButton(page: HTMLElement): HTMLButtonElement | undefined {
  return [...page.querySelectorAll<HTMLButtonElement>('header button')].find((item) =>
    item.textContent?.trim().startsWith('Artifacts'),
  )
}

/** The header button's label with the Artifact count, if the page shows it. */
function artifactsLabel(page: HTMLElement): string | undefined {
  const toggle = artifactsButton(page)
  return toggle ? text(toggle) : undefined
}

/** Opens the drawer from the header. */
async function openDrawer(page: HTMLElement): Promise<void> {
  if (!drawer(page)) {
    artifactsButton(page)?.click()
    await settle()
    await answerArtifactReads()
  }
}

/** The label of the Artifact the drawer's reader shows, if it shows one. */
function readerTitle(page: HTMLElement): string | undefined {
  return drawer(page)?.querySelector('header > span')?.textContent?.trim()
}

/** The Artifact viewer, showing the open Artifact as rendered Markdown. */
function viewer(page: HTMLElement): HTMLElement | null {
  return page.querySelector('app-markdown-view')
}

/** The Report ready card at the end of the thread, as its text, if the page shows one. */
function reportCard(page: HTMLElement): string | undefined {
  const card = page.querySelector('[aria-label="Report ready"]')
  return card ? text(card) : undefined
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
      expect(messageInput(page)?.placeholder).toBe('Type your own answer…')
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
      expect(outcome(page)).toContain('The Grilling agent failed twice.')
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

    it.each<ResearchState>([
      { status: 'running', step: 'retrieval' },
      { status: 'interrupted', step: 'draft', round: 1 },
      { status: 'failed', reason: 'The Draft failed Review in every Round.' },
    ])('keeps the question and the whole Grilling Q&A in the thread after Grilling, when $status', async (state) => {
      const page = await renderPage({
        state,
        artifacts: ['grilling_transcript.json', 'heat_pumps_grilling_protocol.md'],
        transcript: {
          question: 'How do heat pumps work?',
          turns: [{ question: 'Who is the audience?', recommendedAnswer: 'Homeowners.', answer: 'Installers.' }],
        },
      })

      expect(thread(page)).toEqual([
        'How do heat pumps work?',
        'Q1 Who is the audience? Recommended answer: Homeowners.',
        'Installers.',
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

      send(page, '  Installers in cold climates\n')

      expect(fetch).toHaveBeenCalledWith(
        '/api/research',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ message: '  Installers in cold climates\n' }),
        }),
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

  describe('drawer', () => {
    it('is closed on first load and toggles from the header button, which counts the Artifacts but not the Grilling Transcript', async () => {
      const page = await renderPage({
        state: { status: 'running', step: 'review', round: 2 },
        artifacts: ALL_ARTIFACTS,
      })

      expect(drawer(page)).toBeNull()
      expect(artifactsLabel(page)).toBe('Artifacts 8')

      await openDrawer(page)
      expect(drawer(page)).not.toBeNull()
      expect(artifactsButton(page)?.getAttribute('aria-expanded')).toBe('true')

      artifactsButton(page)?.click()
      await settle()
      expect(drawer(page)).toBeNull()
      expect(artifactsButton(page)?.getAttribute('aria-expanded')).toBe('false')
    })
  })

  describe('Sources tab', () => {
    it('lists every Source, linking concrete hosts and showing wildcard patterns as text', async () => {
      const page = await renderPage({
        state: { status: 'running', step: 'retrieval' },
        artifacts: ['heat_pumps_grilling_protocol.md', SOURCE_CATALOGUE],
        sources: ['energy.gov', '*.europa.eu'],
      })

      await openSources(page)

      expect(sources(page)).toEqual([
        { text: 'energy.gov', href: 'https://energy.gov' },
        { text: '*.europa.eu', href: undefined },
      ])
    })

    it('says there is no Source Catalogue before its Step writes it', async () => {
      const page = await renderPage({ state: { status: 'running', step: 'source_catalogue' } })

      await openSources(page)

      expect(drawer(page)?.textContent).toContain('No Source Catalogue yet.')
    })

    it('says when the Source Catalogue is empty', async () => {
      const page = await renderPage({
        state: { status: 'failed', reason: 'No Primary Sources were found.' },
        artifacts: ['heat_pumps_grilling_protocol.md', SOURCE_CATALOGUE],
        sources: [],
      })

      await openSources(page)

      expect(drawer(page)?.textContent).toContain('The Source Catalogue is empty.')
    })

    it('shows the Source Catalogue once its Step has written it, without a reload', async () => {
      const page = await renderPage({
        state: { status: 'interrupted', step: 'source_catalogue' },
        artifacts: ['heat_pumps_grilling_protocol.md'],
      })
      await openSources(page)
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

  describe('Artifacts', () => {
    it('lists the Artifacts in Step order with readable labels, without the Grilling Transcript', async () => {
      const page = await renderPage({ state: { status: 'interrupted', step: 'retrieval' }, artifacts: ALL_ARTIFACTS })

      await openDrawer(page)

      expect(artifactList(page)).toEqual([
        'Grilling Protocol',
        'Source Catalogue',
        'Findings',
        'Round 1 · Draft',
        'Round 1 · Review',
        'Round 2 · Draft',
        'Round 2 · Review',
        'Report',
      ])
    })

    it("shows each Review's verdict as a pass or fail badge", async () => {
      const page = await renderPage({
        state: { status: 'completed' },
        artifacts: ALL_ARTIFACTS,
        contents: {
          'heat_pumps_review_1.md': '---\nverdict: fail\n---\n\n# Review 1\n',
          'heat_pumps_review_2.md': '---\nverdict: pass\n---\n\n# Review 2\n',
        },
      })
      await openDrawer(page)
      iconButton(page, 'All Artifacts')?.click()
      await settle()

      expect(artifactList(page)).toContain('Round 1 · Review Fail')
      expect(artifactList(page)).toContain('Round 2 · Review Pass')
      expect(artifactList(page)).toContain('Round 2 · Draft')
    })

    it('adds the Artifact a Step writes to the list, without a reload', async () => {
      const artifacts = ['grilling_transcript.json', 'heat_pumps_grilling_protocol.md', SOURCE_CATALOGUE]
      const page = await renderPage({ state: { status: 'interrupted', step: 'retrieval' }, artifacts })
      await openDrawer(page)
      const stream = stubStream()

      button(page, 'Resume')?.click()
      stream.push({ type: 'step', step: 'retrieval' })
      await settle()
      TestBed.inject(HttpTestingController)
        .expectOne({ method: 'GET', url: '/api/research/artifacts' })
        .flush(artifacts)
      stream.push({ type: 'step', step: 'draft', round: 1 })
      await settle()
      TestBed.inject(HttpTestingController)
        .expectOne({ method: 'GET', url: '/api/research/artifacts' })
        .flush([...artifacts, 'heat_pumps_findings.md'])
      await settle()

      expect(artifactList(page)).toEqual(['Grilling Protocol', 'Source Catalogue', 'Findings'])
    })

    it('renders an opened Artifact as sanitised Markdown, also while a Step is running', async () => {
      const api: FakeResearch = {
        state: { status: 'running', step: 'retrieval' },
        artifacts: ['grilling_transcript.json', 'heat_pumps_grilling_protocol.md'],
        contents: {
          'heat_pumps_grilling_protocol.md':
            '# Grilling Protocol\n\n## Audience\n\n**Homeowners** in *Europe*.\n\n<img src="x.png" onerror="alert(1)"><script>alert(2)</script>',
        },
      }
      const page = await renderPage(api)

      await open(page, 'Grilling Protocol')

      expect(viewer(page)?.querySelector('h1')?.textContent).toBe('Grilling Protocol')
      expect(viewer(page)?.querySelector('h2')?.textContent).toBe('Audience')
      expect(viewer(page)?.querySelector('strong')?.textContent).toBe('Homeowners')
      expect(viewer(page)?.querySelector('script')).toBeNull()
      expect(viewer(page)?.querySelector('img')?.getAttribute('onerror')).toBeNull()
    })

    it('says when there are no Artifacts yet', async () => {
      const page = await renderPage({ state: { status: 'awaiting_answer' }, artifacts: ['grilling_transcript.json'] })

      await openDrawer(page)

      expect(artifactsLabel(page)).toBe('Artifacts 0')
      expect(artifactList(page)).toEqual(['No Artifacts yet.'])
    })

    it('opens an Artifact in the drawer, leaving the conversation in the centre', async () => {
      const page = await renderPage({
        state: { status: 'interrupted', step: 'draft', round: 1 },
        artifacts: ['grilling_transcript.json', 'heat_pumps_grilling_protocol.md'],
        transcript: {
          question: 'How do heat pumps work?',
          turns: [{ question: 'Who is the audience?', recommendedAnswer: 'Homeowners.', answer: 'Installers.' }],
        },
      })

      await open(page, 'Grilling Protocol')

      expect(readerTitle(page)).toBe('Grilling Protocol')
      expect(drawer(page)?.querySelector('app-markdown-view h1')?.textContent).toBe('heat_pumps_grilling_protocol.md')
      expect(page.querySelector('main app-markdown-view')).toBeNull()
      expect(thread(page)).toEqual([
        'How do heat pumps work?',
        'Q1 Who is the audience? Recommended answer: Homeowners.',
        'Installers.',
      ])
      expect(button(page, 'Resume')).toBeDefined()
    })

    it('goes back from an opened Artifact to the list', async () => {
      const page = await renderPage({ state: { status: 'running', step: 'retrieval' }, artifacts: ALL_ARTIFACTS })
      await open(page, 'Grilling Protocol')

      iconButton(page, 'All Artifacts')?.click()
      await settle()

      expect(viewer(page)).toBeNull()
      expect(artifactList(page)).toContain('Grilling Protocol')
    })

    it('closes the drawer from an opened Artifact', async () => {
      const page = await renderPage({ state: { status: 'running', step: 'retrieval' }, artifacts: ALL_ARTIFACTS })
      await open(page, 'Grilling Protocol')

      iconButton(page, 'Close')?.click()
      await settle()

      expect(drawer(page)).toBeNull()
      expect(viewer(page)).toBeNull()
    })

    it('shows a Review without the front matter its verdict badge comes from', async () => {
      const api: FakeResearch = {
        state: { status: 'running', step: 'draft', round: 2 },
        artifacts: ['heat_pumps_review_1.md'],
        contents: {
          'heat_pumps_review_1.md': '---\nverdict: fail\n---\n\n# Review 1\n\n## Offending Claims\n\nNone.\n',
        },
      }
      const page = await renderPage(api)

      await open(page, 'Round 1 · Review')

      expect(viewer(page)?.querySelector('h1')?.textContent).toBe('Review 1')
      expect(viewer(page)?.textContent).not.toContain('verdict')
      expect(viewer(page)?.querySelector('hr')).toBeNull()
    })

    it('opens the drawer of a Completed Research on the Artifact list', async () => {
      const page = await renderPage({ state: { status: 'completed' }, artifacts: ALL_ARTIFACTS })

      await openDrawer(page)

      expect(readerTitle(page)).toBeUndefined()
      expect(artifactList(page)).toContain('Report')
    })

    it('shows a JSON Artifact as its JSON', async () => {
      const api: FakeResearch = {
        state: { status: 'running', step: 'retrieval' },
        artifacts: [SOURCE_CATALOGUE],
        sources: ['energy.gov'],
      }
      const page = await renderPage(api)

      await open(page, 'Source Catalogue')

      expect(JSON.parse(viewer(page)?.querySelector('pre')?.textContent ?? '')).toEqual({ sources: ['energy.gov'] })
    })

    describe('[Fn] citations', () => {
      const api: FakeResearch = {
        state: { status: 'running', step: 'review', round: 1 },
        artifacts: [
          'heat_pumps_draft_1.md',
          'heat_pumps_findings.md',
          'heat_pumps_grilling_protocol.md',
          'heat_pumps_review_1.md',
        ],
        contents: {
          'heat_pumps_draft_1.md':
            '# Report\n\n## Summary\n\nHeat pumps move heat [F1] and cut energy use [F1, F2].\n\n## Sources\n\n- [F2] https://energy.gov/savings\n',
          'heat_pumps_findings.md': FINDINGS,
          'heat_pumps_review_1.md':
            '---\nverdict: fail\n---\n\n# Review 1\n\n## Offending Claims\n\n- They cut energy use by 90% [F2].\n',
        },
      }

      // jsdom doesn't scroll, so a test that follows a citation stubs it.
      afterEach(() => delete (Element.prototype as Partial<Element>).scrollIntoView)

      /** The open Artifact's links, each as its text and target. */
      function links(page: HTMLElement): { text: string; href: string | null }[] {
        return [...(viewer(page)?.querySelectorAll('a') ?? [])].map((link) => ({
          text: link.textContent ?? '',
          href: link.getAttribute('href'),
        }))
      }

      it('link each Finding a Draft cites', async () => {
        const page = await renderPage(api)

        await open(page, 'Round 1 · Draft')

        expect(links(page)).toEqual([
          { text: 'F1', href: '#F1' },
          { text: 'F1', href: '#F1' },
          { text: 'F2', href: '#F2' },
          { text: 'F2', href: '#F2' },
          { text: 'https://energy.gov/savings', href: 'https://energy.gov/savings' },
        ])
        expect(viewer(page)?.textContent).toContain('Heat pumps move heat [F1] and cut energy use [F1, F2].')
      })

      it('open the Findings scrolled to the cited Finding', async () => {
        const scrolled = vi.fn<(this: Element) => void>(function (this: Element) {})
        Element.prototype.scrollIntoView = scrolled
        const page = await renderPage(api)
        await open(page, 'Round 1 · Draft')

        viewer(page)
          ?.querySelectorAll('a')[2]
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await settle()
        await answerArtifactReads()

        expect(viewer(page)?.querySelector('h1')?.textContent).toBe('Findings')
        expect(readerTitle(page)).toBe('Findings')
        expect(scrolled.mock.contexts.map((heading) => heading.textContent)).toEqual(['F2'])
      })

      it('leave citations in other Artifacts as text', async () => {
        const page = await renderPage(api)

        await open(page, 'Round 1 · Review')

        expect(viewer(page)?.textContent).toContain('They cut energy use by 90% [F2].')
        expect(links(page)).toEqual([])
      })
    })
  })

  describe('Report ready', () => {
    const REPORT =
      '# Report\n\n## Summary\n\nHeat pumps move heat [F1] and cut energy use [F1, F2].\nThey work in cold climates [F3].\n\n## Key facts\n\n- Fact [F1]\n'

    it("ends the thread of a Completed Research with the Summary's first line, without citations, and leaves the drawer closed", async () => {
      const page = await renderPage({
        state: { status: 'completed' },
        artifacts: ALL_ARTIFACTS,
        contents: { 'heat_pumps_report.md': REPORT },
      })

      expect(reportCard(page)).toBe('Report ready Heat pumps move heat and cut energy use. Read the Report')
      expect(page.querySelector('main > div')?.lastElementChild?.getAttribute('aria-label')).toBe('Report ready')
      expect(drawer(page)).toBeNull()
    })

    it('is not shown before the Research is Completed', async () => {
      const page = await renderPage({
        state: { status: 'running', step: 'review', round: 2 },
        artifacts: ALL_ARTIFACTS,
        contents: { 'heat_pumps_report.md': REPORT },
      })

      expect(reportCard(page)).toBeUndefined()
    })

    it('opens the Report in the drawer with Read the Report', async () => {
      const page = await renderPage({
        state: { status: 'completed' },
        artifacts: ALL_ARTIFACTS,
        contents: { 'heat_pumps_report.md': REPORT },
      })

      button(page, 'Read the Report')?.click()
      await settle()
      await answerArtifactReads()

      expect(readerTitle(page)).toBe('Report')
      expect(viewer(page)?.querySelector('h2')?.textContent).toBe('Summary')
    })

    it('opens the drawer on the Report by itself, once, when this page watches the Research complete', async () => {
      const artifacts = ALL_ARTIFACTS.filter((name) => name !== 'heat_pumps_report.md')
      const page = await renderPage({
        state: { status: 'interrupted', step: 'review', round: 2 },
        artifacts,
        contents: { 'heat_pumps_report.md': REPORT },
      })
      const http = TestBed.inject(HttpTestingController)
      const stream = stubStream()

      button(page, 'Resume')?.click()
      stream.push({ type: 'step', step: 'review', round: 2 })
      await settle()
      http.expectOne({ method: 'GET', url: '/api/research/artifacts' }).flush(artifacts)
      stream.push({ type: 'step', step: 'completed' })
      stream.close()
      await settle()
      http.expectOne({ method: 'GET', url: '/api/research/artifacts' }).flush(ALL_ARTIFACTS)
      await settle()
      await answerArtifactReads()

      expect(readerTitle(page)).toBe('Report')
      expect(viewer(page)?.querySelector('h1')?.textContent).toBe('Report')
      expect(reportCard(page)).toContain('Heat pumps move heat and cut energy use.')

      iconButton(page, 'Close')?.click()
      await settle()
      await openDrawer(page)

      expect(readerTitle(page)).toBeUndefined()
    })
  })

  describe('message input', () => {
    it.each<[ResearchState, string]>([
      [{ status: 'running', step: 'grilling' }, 'Thinking about the next question…'],
      [{ status: 'running', step: 'source_catalogue' }, 'Picking Primary Sources…'],
      [{ status: 'running', step: 'retrieval' }, 'Gathering Findings from the Sources…'],
      [{ status: 'running', step: 'draft', round: 2 }, 'Round 2 · Writing the Draft…'],
      [{ status: 'running', step: 'review', round: 3 }, 'Round 3 · Reviewing the Draft…'],
    ])('is disabled while a Step is running and says what it is doing, when %o', async (state, placeholder) => {
      const page = await renderPage({ state })

      expect(messageInput(page)?.disabled).toBe(true)
      expect(messageInput(page)?.placeholder).toBe(placeholder)
      expect(page.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
    })

    it('asks what to research when there is no Research', async () => {
      const page = await renderPage({ state: { status: 'none' } })

      expect(messageInput(page)?.placeholder).toBe('What do you want to research?')
    })

    it('invites an answer of your own while Awaiting Answer', async () => {
      const page = await renderPage({ state: { status: 'awaiting_answer' }, transcript: FIRST_QUESTION })

      expect(messageInput(page)?.placeholder).toBe('Type your own answer…')
      expect(messageInput(page)?.disabled).toBe(false)
    })

    it('sends with Enter', async () => {
      const page = await renderPage({ state: { status: 'none' } })
      stubStream()

      type(page, 'How do heat pumps work?').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
      )

      expect(fetch).toHaveBeenCalledWith(
        '/api/research',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ message: 'How do heat pumps work?' }) }),
      )
    })

    it('adds a new line with Shift+Enter instead of sending', async () => {
      const page = await renderPage({ state: { status: 'none' } })
      const fetched = vi.spyOn(globalThis, 'fetch')
      const enter = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true })

      type(page, 'How do heat pumps work?').dispatchEvent(enter)

      expect(fetched).not.toHaveBeenCalled()
      expect(enter.defaultPrevented).toBe(false)
    })

    it.each<ResearchState>([
      { status: 'completed' },
      { status: 'failed', reason: 'The Draft failed Review in every Round.' },
    ])('gives way to a New research button when the Research is $status', async (state) => {
      const page = await renderPage({ state })

      expect(messageInput(page)).toBeNull()
      expect(page.querySelector('button[type="submit"]')).toBeNull()
      expect(composer(page)).toBe('New research')
    })

    it.each<ResearchState>([
      { status: 'interrupted', step: 'grilling' },
      { status: 'interrupted', step: 'draft', round: 2, reason: 'The Draft agent failed twice.' },
    ])('is not offered on an Interrupted Research, which continues with Resume, when %o', async (state) => {
      const page = await renderPage({ state })

      expect(messageInput(page)).toBeNull()
      expect(composer(page)).toBeUndefined()
    })
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
      expect(currentStep(page)).toContain('Review · 1/3')

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

    it('keeps showing the running Step and polling when a poll fails', async () => {
      const page = await renderPage({ state: { status: 'running', step: 'draft', round: 1 } })
      const http = TestBed.inject(HttpTestingController)

      await vi.advanceTimersByTimeAsync(2000)
      TestBed.tick()
      http
        .expectOne({ method: 'GET', url: '/api/research' })
        .flush('', { status: 500, statusText: 'Internal Server Error' })
      await vi.advanceTimersByTimeAsync(0)
      TestBed.tick()

      expect(currentStep(page)).toContain('Draft')
      expect(page.textContent).not.toContain('What do you want to research?')

      await vi.advanceTimersByTimeAsync(2000)
      TestBed.tick()
      http.expectOne({ method: 'GET', url: '/api/research' }).flush({ status: 'running', step: 'review', round: 1 })
      await vi.advanceTimersByTimeAsync(0)
      TestBed.tick()

      expect(currentStep(page)).toContain('Review')
    })

    it('opens the drawer on the Report when a poll finds the Research Completed', async () => {
      const artifacts = ALL_ARTIFACTS.filter((name) => name !== 'heat_pumps_report.md')
      const page = await renderPage({ state: { status: 'running', step: 'review', round: 2 }, artifacts })
      const http = TestBed.inject(HttpTestingController)

      await vi.advanceTimersByTimeAsync(2000)
      TestBed.tick()
      http.expectOne({ method: 'GET', url: '/api/research' }).flush({ status: 'completed' })
      await vi.advanceTimersByTimeAsync(0)
      TestBed.tick()
      http.expectOne({ method: 'GET', url: '/api/research/artifacts' }).flush(ALL_ARTIFACTS)
      await settle()
      await answerArtifactReads()

      expect(readerTitle(page)).toBe('Report')
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

  describe('outcome notices', () => {
    it('end the thread with the reason of a Failed Research', async () => {
      const page = await renderPage({
        state: { status: 'failed', reason: 'The Draft failed Review in every Round.' },
        artifacts: ['grilling_transcript.json'],
      })

      expect(outcome(page)).toBe('The Research failed The Draft failed Review in every Round.')
    })

    it('end the thread with the reason of an Interrupted Research and offer Resume', async () => {
      const page = await renderPage({
        state: { status: 'interrupted', step: 'review', round: 3, reason: 'The Review agent failed twice.' },
      })

      expect(outcome(page)).toBe('The Research was interrupted The Review agent failed twice. Resume')
    })

    it('say an Interrupted Research with no known reason was interrupted', async () => {
      const page = await renderPage({ state: { status: 'interrupted', step: 'source_catalogue' } })

      expect(outcome(page)).toBe('The Research was interrupted The Research was interrupted. Resume')
    })

    it.each<ResearchState>([
      { status: 'none' },
      { status: 'running', step: 'retrieval' },
      { status: 'awaiting_answer' },
    ])('are not shown when the Research is $status', async (state) => {
      const page = await renderPage({ state })

      expect(outcome(page)).toBeUndefined()
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
    it('is offered as New research in the header, also while a Step is running', async () => {
      const page = await renderPage({ state: { status: 'running', step: 'retrieval' } })

      expect(page.querySelector('header')?.textContent).toContain('New research')
      expect(button(page, 'New research')?.disabled).toBe(false)
    })

    it('is not offered when there is no Research', async () => {
      const page = await renderPage({ state: { status: 'none' } })

      expect(button(page, 'New research')).toBeUndefined()
    })

    it('asks for confirmation and deletes nothing when cancelled', async () => {
      const page = await renderPage({ state: { status: 'completed' }, artifacts: ['q.report.md'] })

      button(page, 'New research')?.click()
      TestBed.tick()

      expect(page.querySelector('[role="alertdialog"]')?.textContent).toContain('This deletes every Artifact.')

      button(page, 'Cancel')?.click()
      TestBed.tick()

      expect(page.querySelector('[role="alertdialog"]')).toBeNull()
      TestBed.inject(HttpTestingController).expectNone({ method: 'DELETE', url: '/api/research' })
      expect(artifactsLabel(page)).toBe('Artifacts 1')
    })

    it('deletes the Research once confirmed and shows the empty state', async () => {
      const page = await renderPage({ state: { status: 'completed' }, artifacts: ['q.report.md'] })

      button(page, 'New research')?.click()
      TestBed.tick()
      button(page, 'Delete and start over')?.click()
      TestBed.inject(HttpTestingController)
        .expectOne({ method: 'DELETE', url: '/api/research' })
        .flush(null, { status: 204, statusText: 'No Content' })
      await settle()

      expect(page.textContent).toContain('What do you want to research?')
      expect(artifactsButton(page)).toBeUndefined()
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

      button(page, 'New research')?.click()
      TestBed.tick()
      button(page, 'Delete and start over')?.click()
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

      button(page, 'New research')?.click()
      TestBed.tick()
      button(page, 'Delete and start over')?.click()
      http
        .expectOne({ method: 'DELETE', url: '/api/research' })
        .flush('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
      await settle()
      http.expectOne({ method: 'GET', url: '/api/research' }).flush({ status: 'completed' })
      http.expectOne({ method: 'GET', url: '/api/research/artifacts' }).flush(['q.report.md'])
      await settle()

      expect(page.querySelector('app-stepper')?.textContent).toContain('Completed')
      expect(artifactsLabel(page)).toBe('Artifacts 1')
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

      expect(currentStep(page)).toContain('Draft · 2/3')
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
    })

    it('shows an Interrupted Research at its Step and Round', async () => {
      const page = await renderPage({
        state: { status: 'interrupted', step: 'review', round: 3, reason: 'The Review agent failed twice.' },
      })

      expect(currentStep(page)).toContain('Review · 3/3')
      expect(currentStep(page)).not.toContain('Running')
    })

    it('marks no Step as current once the Research Failed', async () => {
      const page = await renderPage({
        state: { status: 'failed', reason: 'The Draft failed Review in every Round.' },
      })

      expect(currentStep(page)).toBeUndefined()
    })

    it('marks every Step as done once the Research is Completed', async () => {
      const page = await renderPage({ state: { status: 'completed' } })

      expect(currentStep(page)).toBeUndefined()
      for (const label of ['Grilling', 'Source Catalogue', 'Retrieval', 'Draft', 'Review']) {
        expect(step(page, label)).toContain('Done')
      }
      expect(page.querySelector('app-stepper')?.textContent).toContain('Completed')
    })

    it('is not shown when there is no Research', async () => {
      const page = await renderPage({ state: { status: 'none' } })

      expect(page.querySelector('app-stepper')).toBeNull()
    })

    it.each<[ResearchState, string]>([
      [{ status: 'running', step: 'retrieval' }, 'Retrieval'],
      [{ status: 'interrupted', step: 'review', round: 2 }, 'Review · 2/3'],
      [{ status: 'completed' }, 'Completed'],
    ])('collapses for narrow screens to dots and the current Step, when %o', async (state, summary) => {
      const page = await renderPage({ state })

      expect(page.querySelectorAll('app-stepper [data-dot]')).toHaveLength(5)
      expect(page.querySelector('app-stepper p')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(summary)
    })
  })
})
