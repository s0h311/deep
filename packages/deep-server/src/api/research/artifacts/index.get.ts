import { defineHandler } from 'nitro'
import { createResearch } from '../../../features/research/index.ts'

const research = createResearch()

export default defineHandler(async () => await research.listArtifacts())
