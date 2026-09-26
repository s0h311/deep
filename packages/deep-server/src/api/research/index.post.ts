import { defineHandler } from 'nitro'
import { EventStream, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { createResearch, type Emit } from '../../features/research/index.ts'

const request = z.object({
  message: z.string(),
})

const research = createResearch()

export default defineHandler(async (event) => {
  const { message } = await readValidatedBody(event, request)

  const stream = new EventStream(event)

  const emit: Emit = async (data) => {
    await stream.push(JSON.stringify(data))
  }

  void research
    .send(message, emit)
    .catch(async (error: unknown) => await emit({ type: 'step', step: 'failed', reason: String(error) }))
    .finally(() => stream.close())

  return stream
})
