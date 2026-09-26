# Deterministic Orchestrator; agents are pure functions over Artifacts

A Research is driven by plain code, not a supervisor agent. The Orchestrator derives the next Step solely from which Artifacts exist in `.research` (no separate state file), reads the input Artifacts itself and inlines them into a fresh, single-message agent run, and writes the output Artifact from the agent's schema-validated structured response. Agents never touch `.research` and never see other Steps or earlier Rounds unless the Orchestrator hands them in. We chose this over agents reading and writing files themselves to keep each agent's context minimal (less hallucination), guarantee Artifact names and shapes, make the Review verdict a typed field, and get restart-resume for free.

## Consequences

- Every Artifact must carry enough to reconstruct state (e.g. the Review verdict lives in the review file's front-matter).
- Report structure and its Sources section are produced by code from the Draft's structured output and the Findings it cites, so Review judges content only.
