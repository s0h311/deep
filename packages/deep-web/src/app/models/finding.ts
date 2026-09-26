/** A Finding as the Findings Artifact records it: its ID, verbatim quote and the URL of its Source. */
export type Finding = { id: string; quote: string; source: string }

/** The Findings of a Findings Artifact, by ID: each is a `## Fn` section with a `URL:` line and a `> ` quote. */
export function parseFindings(markdown: string): Map<string, Finding> {
  return new Map(
    markdown
      .split(/^## /m)
      .slice(1)
      .flatMap((section) => {
        const id = section.match(/^F\d+(?=\n|$)/)?.[0]
        const quote = section
          .split('\n')
          .flatMap((line) => (line.startsWith('>') ? [line.replace(/^> ?/, '')] : []))
          .join('\n')

        return id ? [[id, { id, quote, source: section.match(/^URL: (.+)$/m)?.[1] ?? '' }] as const] : []
      }),
  )
}
