import { defineHandler } from 'nitro'
import { getValidatedQuery, HTTPError } from 'nitro/h3'
import { z } from 'zod'
import { readResource } from '../../features/resources'

const query = z.object({
  path: z.string().min(1),
})

export default defineHandler(async (event) => {
  const { path } = await getValidatedQuery(event, query)

  const content = await readResource(path)

  if (content === undefined) {
    throw new HTTPError({ status: 404, message: `resource not found: ${path}` })
  }

  return new Response(content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
})
