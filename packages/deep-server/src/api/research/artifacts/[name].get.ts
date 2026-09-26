import { defineHandler } from 'nitro'
import { getRouterParam, HTTPError } from 'nitro/h3'
import { ArtifactNotFound } from '../../../features/research/index.ts'
import { research } from '../../../features/research/instance.ts'

export default defineHandler(async (event) => {
  const name = getRouterParam(event, 'name', { decode: true }) ?? ''

  try {
    return new Response(await research.readArtifact(name), {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  } catch (error) {
    if (error instanceof ArtifactNotFound) {
      throw new HTTPError({ status: 404, message: error.message })
    }

    throw error
  }
})
