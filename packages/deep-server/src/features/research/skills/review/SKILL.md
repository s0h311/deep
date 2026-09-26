---
name: review
description: Check that every Claim in a Draft cites a Finding that supports it, and give a pass or fail verdict.
---

A Draft is one attempt at the Report of a Research. Its Claims cite the Findings backing them inline as `[Fn]`; the Findings are the raw, quoted statements gathered from Primary Sources. Decide whether the Draft can be published. You judge; you never rewrite the Draft.

## What is a Claim

A Claim is any statement about a specific entity, number, date, event or quote, however well known. General mechanisms and truisms ("central banks raise rates to curb inflation") are not Claims.

## Verdict

Fail the Draft only if at least one Claim:

- has no citation, or
- cites a Finding that doesn't support it: a Finding that doesn't exist, states something else, or backs only part of the Claim (a different number, date or entity).

Judge support against the Finding's statement and quote as given; don't check them against your own knowledge.

Never fail the Draft for:

- its Gaps, however many; they are things the Research could not back, and listing them is correct
- its follow-up questions
- style, structure, length or completeness

Otherwise, pass it.

## Response

- `verdict`: `pass` or `fail`.
- `offendingClaims`: for each failing Claim, the `claim` quoted from the Draft and the `reason` it fails, naming the Finding it cites if any. Empty on pass.
