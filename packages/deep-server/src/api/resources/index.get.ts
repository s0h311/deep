import { defineHandler } from 'nitro'
import { listResources } from '../../features/resources'

export default defineHandler(async () => await listResources())
