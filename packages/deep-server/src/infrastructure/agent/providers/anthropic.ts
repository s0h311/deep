import type { Model, Tool } from '../types'

export const claudeHaiku45: Model = 'anthropic:claude-haiku-4-5'

const webSearch = { type: 'web_search_20260318', name: 'web_search', allowed_callers: ['direct'] }

export const webSearchTool: Tool = webSearch

/**
 * Web search and web fetch, both restricted to the given hosts. Claude's server tools reject wildcards but include
 * subdomains automatically.
 */
export function webToolsFor(hosts: string[]): Tool[] {
  return [
    { ...webSearch, allowed_domains: hosts },
    { type: 'web_fetch_20260318', name: 'web_fetch', allowed_callers: ['direct'], allowed_domains: hosts },
  ]
}
