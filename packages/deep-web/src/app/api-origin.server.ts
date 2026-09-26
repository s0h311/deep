import { FetchBackend, HttpRequest } from '@angular/common/http'
import { Injectable } from '@angular/core'

const API_ORIGIN = process.env['API_ORIGIN'] ?? 'http://localhost:3000'

/**
 * The browser reaches the API through the dev proxy with relative `/api` URLs; SSR has no proxy,
 * so this sends them to `API_ORIGIN` instead. It rewrites at the backend, after the HTTP transfer
 * cache has keyed the request by its relative URL, so the browser finds the SSR responses.
 */
@Injectable()
export class ApiOriginFetchBackend extends FetchBackend {
  override handle(request: HttpRequest<unknown>) {
    const url = new URL(request.url, API_ORIGIN)
    if (!url.pathname.startsWith('/api/')) return super.handle(request)
    return super.handle(request.clone({ url: new URL(url.pathname + url.search, API_ORIGIN).href }))
  }
}
