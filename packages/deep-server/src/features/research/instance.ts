import { createResearch } from './index.ts'

/** The server's one Research, shared by every handler so its lock holds across requests. */
export const research = createResearch()
