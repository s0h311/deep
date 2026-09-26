import { defineHandler } from 'nitro'
import { EventStream, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { streamAgent } from '../../features/harness'
import type { WriterFn } from '../../features/harness/types'

const request = z.object({
  message: z.string(),
  threadId: z.uuid(),
})

export default defineHandler(async (event) => {
  const { message, threadId } = await readValidatedBody(event, request)

  const stream = new EventStream(event)

  const writerFn: WriterFn = async (data) => {
    await stream.push(JSON.stringify(data))
  }

  void streamAgent({
    humanMessage: message,
    threadId,
    writerFn,
  })
    .catch(async () => await writerFn({ type: 'message', id: randomUUID(), content: 'API error' }))
    .finally(() => stream.close())

  return stream
})
