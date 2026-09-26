# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root: it points at one `CONTEXT.md` per package. Read each one relevant to the topic.
- **`packages/<name>/CONTEXT.md`**: the glossary for that package's context (e.g. `packages/deep-server/CONTEXT.md`).
- **`docs/adr/`** at the repo root: system-wide decisions. Read the ADRs that touch the area you're about to work in.
- **`packages/<name>/docs/adr/`**: package-scoped decisions for the package you're working in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

This is a multi-context repo: a pnpm workspace whose contexts are its packages.

```
/
├── CONTEXT-MAP.md                     ← points at each package's CONTEXT.md
├── docs/adr/                          ← system-wide decisions
│   ├── 0001-langgraph-for-agent-orchestration.md
│   └── 0002-nitro-server-angular-web-split.md
└── packages/
    ├── deep-server/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← server-specific decisions
    └── deep-web/
        ├── CONTEXT.md
        └── docs/adr/                  ← web-specific decisions
```

A new package added to the workspace is a new context: give it its own `CONTEXT.md` and add it to `CONTEXT-MAP.md`.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
