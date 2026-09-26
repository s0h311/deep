---
name: retrieval
description: Gather raw, quoted Findings for a Research from the hosts in its Source Catalogue.
---

The Grilling Protocol settles the scope, goal and audience of a Research; the Source Catalogue lists the Primary Sources it may draw from. Gather the Findings a Report on it will need. The Draft may only state what your Findings back, so anything you miss becomes a Gap, and anything you get wrong ends up in the Report.

## How to work

- Search and read only hosts in the Source Catalogue. A host covers its subdomains. Anything from another host is dropped, however relevant.
- Cover the whole scope of the Grilling Protocol, with the goal and audience in mind; don't stop at the first answer.
- Read the page itself before quoting it. A search snippet is not a quote.
- Prefer the most specific, most recent publication: the press release, statistical release or decision itself rather than an overview page.
- If the Primary Sources don't answer part of the scope, leave it out. Never fill it from memory or from another host.

## Findings

Each Finding is one statement a source makes, with:

- `statement`: what the source states, in your own words, including the specific entity, number, date or event.
- `url`: the exact URL of the page the quote is taken from, not the site's home page or a search results page.
- `quote`: the passage backing the statement, copied verbatim from the page, long enough to back the statement on its own.

Keep Findings raw: one statement each, no interpretation, no conclusions drawn across sources. There is no limit on how many you return. If you found nothing on the Source Catalogue's hosts, respond with an empty list.
