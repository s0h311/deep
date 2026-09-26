import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { TestBed } from '@angular/core/testing'
import { ResearchState } from '../../models/research-state'
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
  it("shows the names of the Research's Artifacts", async () => {
    const page = await renderPage({ artifacts: ['q.gp.md', 'q.sc.json'] })

    expect(page.textContent).toContain('q.gp.md')
    expect(page.textContent).toContain('q.sc.json')
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
