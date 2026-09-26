import type { Model } from './types.ts'
import { claudeHaiku45 } from './providers/anthropic.ts'
import { type Script, scriptedChatModel } from './scripted-chat-model.ts'

/**
 * The one model every Step's agent runs on. `DEEP_FAKE_MODEL=true` swaps in a scripted fake answering with the
 * given canned script, so a Research runs without an API key.
 */
export function chatModel(fakeScript: Script): Model {
  return process.env.DEEP_FAKE_MODEL === 'true' ? scriptedChatModel(fakeScript) : claudeHaiku45
}
