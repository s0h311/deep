import { FetchBackend } from '@angular/common/http'
import { mergeApplicationConfig, ApplicationConfig } from '@angular/core'
import { provideServerRendering, withRoutes } from '@angular/ssr'
import { ApiOriginFetchBackend } from './api-origin.server'
import { appConfig } from './app.config'
import { serverRoutes } from './app.routes.server'

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    { provide: FetchBackend, useClass: ApiOriginFetchBackend },
  ],
}

export const config = mergeApplicationConfig(appConfig, serverConfig)
