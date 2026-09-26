import { defineHandler } from 'nitro'
import { research } from '../../../features/research/instance.ts'

export default defineHandler(async () => await research.listArtifacts())
