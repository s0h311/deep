import { defineHandler } from 'nitro'
import { EventStream, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { research } from '~/src/features/research'

const request = z.object({
  question: z.string(),
})

export default defineHandler(async (event) => {
  const { question } = await readValidatedBody(event, request)

  const stream = new EventStream(event)

  const writerFn: WriterFn = async (data) => {
    await stream.push(JSON.stringify(data))
  }

  void research({
    question,
    writerFn,
  })
    .catch(async () => await writerFn({ type: 'message', id: randomUUID(), content: 'API error' }))
    .finally(() => stream.close())

  return stream
})
