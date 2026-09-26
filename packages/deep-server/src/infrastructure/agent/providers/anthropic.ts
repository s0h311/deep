import type { Model, Tool } from '../types'

export const claudeHaiku45: Model = 'anthropic:claude-haiku-4-5'

export const webSearchTool: Tool = { type: 'web_search_20260318', name: 'web_search', allowed_callers: ['direct'] }
