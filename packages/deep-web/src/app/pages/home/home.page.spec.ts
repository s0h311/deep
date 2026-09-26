import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { TestBed } from '@angular/core/testing'
import { HomePage } from './home.page'

async function renderPage(api: { artifacts: string[] }) {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] })
  const fixture = TestBed.createComponent(HomePage)
  const http = TestBed.inject(HttpTestingController)
  TestBed.tick()
  http.expectOne({ method: 'GET', url: '/api/research/artifacts' }).flush(api.artifacts)
  await fixture.whenStable()
  http.verify()
  return fixture.nativeElement as HTMLElement
}

describe('HomePage', () => {
  it("shows the names of the Research's Artifacts", async () => {
    const page = await renderPage({ artifacts: ['q.gp.md', 'q.sc.json'] })

    expect(page.textContent).toContain('q.gp.md')
    expect(page.textContent).toContain('q.sc.json')
  })
})
