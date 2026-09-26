import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ChatResult } from '@langchain/core/outputs'
import { randomUUID } from 'node:crypto'

export const STRUCTURED_RESPONSE_TOOL = 'extract-structured_response'

export type Script = (messages: BaseMessage[]) => AIMessage | Promise<AIMessage>

/**
 * Stand-in for the real chat model: answers every model call with the AIMessage the script returns,
 * so the real deep agent wiring (prompts, skills, tools, response format) runs without an API key.
 */
export class ScriptedChatModel extends BaseChatModel {
  constructor(private readonly script: Script) {
    super({})
  }

  _llmType(): string {
    return 'scripted'
  }

  // Bound tools are accepted but ignored; the script decides which tools to call.
  override bindTools(): this {
    return this
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const message = await this.script(messages)

    return { generations: [{ text: message.text, message }] }
  }
}

export function scriptedChatModel(script: Script): ScriptedChatModel {
  return new ScriptedChatModel(script)
}

/**
 * Script that answers the n-th model call of a run with the n-th turn.
 */
export function turns(...script: Array<AIMessage | Script>): Script {
  return (messages) => {
    const turn = script[messages.filter((message) => AIMessage.isInstance(message)).length]

    if (turn === undefined) {
      throw new Error('scripted chat model ran out of turns')
    }

    return typeof turn === 'function' ? turn(messages) : turn
  }
}

export function structuredResponse(value: Record<string, unknown>): AIMessage {
  return toolCall(STRUCTURED_RESPONSE_TOOL, value)
}

export function toolCall(name: string, args: Record<string, unknown>): AIMessage {
  return new AIMessage({ content: '', tool_calls: [{ id: randomUUID(), name, args, type: 'tool_call' }] })
}
