import { defineHandler } from 'nitro'
import { EventStream, HTTPError, readValidatedBody } from 'nitro/h3'
import { z } from 'zod'
import { createResearch, type Emit, ResearchConflict } from '../../features/research/index.ts'

const request = z.object({
  message: z.string(),
})

const research = createResearch()

export default defineHandler(async (event) => {
  const { message } = await readValidatedBody(event, request)

  const stream = new EventStream(event)
  const started = Promise.withResolvers<void>()

  const emit: Emit = async (data) => {
    started.resolve()
    await stream.push(JSON.stringify(data))
  }

  const run = research.send(message, emit)

  // A conflict rejects the send before its first event, so it is answered with 409 instead of a stream.
  await Promise.race([started.promise, run]).catch(async (error: unknown) => {
    if (error instanceof ResearchConflict) {
      await stream.close()

      throw new HTTPError({ status: 409, message: error.message })
    }
  })

  void run
    .catch(async (error: unknown) => await emit({ type: 'step', step: 'failed', reason: String(error) }))
    .finally(() => stream.close())

  return stream
})
