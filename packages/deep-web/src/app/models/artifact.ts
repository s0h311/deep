/** What an Artifact is, as told by its name. `other` is any file the naming scheme doesn't know. */
export type ArtifactKind =
  | 'grilling_transcript'
  | 'grilling_protocol'
  | 'source_catalogue'
  | 'findings'
  | 'draft'
  | 'review'
  | 'report'
  | 'other'

/** An Artifact by its name, with its kind, readable label and, for a Draft or Review, its Round. */
export type Artifact = { name: string; kind: ArtifactKind; label: string; round?: number }

/** Whether an Artifact of this kind cites Findings as `[Fn]`: Drafts and the Report. */
export function citesFindings(kind: ArtifactKind | undefined): boolean {
  return kind === 'draft' || kind === 'report'
}

/** A Review's verdict on its Draft, from the Review's front matter. */
export type Verdict = 'pass' | 'fail'

/** An Artifact as the Artifact list shows it: a Review with its verdict once read. */
export type ListedArtifact = Artifact & { verdict?: Verdict }

export const GRILLING_TRANSCRIPT = 'grilling_transcript.json'

/** Every Artifact from the Grilling Protocol on is named `<Topic>_<suffix>`. */
const TOPIC_ARTIFACT =
  /^.+_(?:(grilling_protocol\.md|source_catalogue\.json|findings\.md|report\.md)|(draft|review)_(\d+)\.md)$/

const KINDS: Record<string, { kind: ArtifactKind; label: string }> = {
  'grilling_protocol.md': { kind: 'grilling_protocol', label: 'Grilling Protocol' },
  'source_catalogue.json': { kind: 'source_catalogue', label: 'Source Catalogue' },
  'findings.md': { kind: 'findings', label: 'Findings' },
  'report.md': { kind: 'report', label: 'Report' },
}

/** Where each kind comes in the Research's story; a Round is one Draft followed by its Review. */
const STEP_ORDER: (ArtifactKind | 'round')[] = [
  'grilling_transcript',
  'grilling_protocol',
  'source_catalogue',
  'findings',
  'round',
  'report',
  'other',
]

/** The Artifacts in Step order: Grilling Transcript, Grilling Protocol, Source Catalogue, Findings, each Round's Draft and Review, then the Report. */
export function inStepOrder(names: string[]): Artifact[] {
  return names
    .map(describe)
    .toSorted(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.round ?? 0) - (b.round ?? 0) ||
        Number(a.kind === 'review') - Number(b.kind === 'review') ||
        a.name.localeCompare(b.name),
    )
}

function describe(name: string): Artifact {
  if (name === GRILLING_TRANSCRIPT) {
    return { name, kind: 'grilling_transcript', label: 'Grilling Transcript' }
  }

  const [, suffix, roundKind, round] = name.match(TOPIC_ARTIFACT) ?? []

  if (suffix) {
    return { name, ...KINDS[suffix] }
  }

  if (roundKind === 'draft' || roundKind === 'review') {
    return {
      name,
      kind: roundKind,
      label: `Round ${round} · ${roundKind === 'draft' ? 'Draft' : 'Review'}`,
      round: Number(round),
    }
  }

  return { name, kind: 'other', label: name }
}

function rank({ kind, round }: Artifact): number {
  return STEP_ORDER.indexOf(round === undefined ? kind : 'round')
}
