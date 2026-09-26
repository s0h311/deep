import { ChatGoogle } from '@langchain/google'
import type { Model, Tool } from '../types'

const GCP_LOCATION_FRANKFURT = 'europe-west3'

export const gemini38Flash: Model = new ChatGoogle('gemini-3.8-flash', {
  platformType: 'gcp',
  location: GCP_LOCATION_FRANKFURT,
})

export const webSearchTool: Tool = { googleSearch: {} }
