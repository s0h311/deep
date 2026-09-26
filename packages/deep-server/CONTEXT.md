# Server

Runs an automated Research: a fixed sequence of Steps that turns a user's question into a Report whose every claim traces back to a Primary Source.

## Language

### Research

**Research**:
The single end-to-end run from the user's question to a verdict. Only one Research exists at a time: it begins with the user's first message and ends with a reset. Until then there is no Research.
_Avoid_: Session, job, project

**Reset**:
Ending the Research by deleting every Artifact, leaving no Research. The only way to start over once a Research is Failed or Completed.
_Avoid_: New research, clear

**Step**:
One of the fixed, sequential stages of a Research: Grilling, Source Catalogue, Retrieval, Draft, Review. Each Step is performed by its own agent.
_Avoid_: Phase, stage

**Orchestrator**:
The deterministic code that decides which Step runs next and what each Step's agent gets to see. Not an agent.
_Avoid_: Supervisor, planner

**Artifact**:
A file a Step produces. The set of existing Artifacts is the Research's state.
_Avoid_: Output, document

**Running**:
A Research whose Step is in progress right now.

**Awaiting Answer**:
A Research in the Grilling Step whose last question in the Grilling Transcript is still unanswered. The user's next message is taken as the answer.
_Avoid_: Paused, waiting

**Completed**:
A Research whose Draft passed Review and was published as the Report.

**Failed**:
A Research that ended without a Report: the Source Catalogue was empty, Retrieval produced no Findings, or all Rounds failed Review. Only a reset starts over.

**Interrupted**:
A Research stopped mid-Step (agent error, restart). Unlike Failed, it resumes from its Artifacts. On the stream, both end with the `failed` step; its reason tells them apart, and only an Interrupted Research resumes on the next message. A reset during a running Step ends that stream with `failed` too.
_Avoid_: Paused, crashed

### Artifacts

**Grilling Transcript** (GT):
The record of the Grilling Step's interview: the question and every question, recommended answer and answer asked so far. Kept after the GP is written.
_Avoid_: Working file, chat history

**Grilling Protocol** (GP):
The record of the Grilling Step: the agreed scope, goal and audience of the Research.
_Avoid_: Brief, requirements

**Topic**:
The short name the Grilling Step gives the Research; every Artifact from the GP on is named after it.
_Avoid_: Title, subject

**Source Catalogue** (SC):
The list of Sources the Research is allowed to draw from.
_Avoid_: Bibliography, source list

**Source**:
A host pattern (e.g. `ecb.europa.eu`, `*.deutsche-boerse.com`) identifying a Primary Source.
_Avoid_: Reference, link

**Primary Source**:
A publisher that originates the data or statement itself, as opposed to reporting on someone else's.
_Avoid_: Original source

**Finding**:
One raw, quoted statement gathered from a Source in the Source Catalogue during Retrieval, before any interpretation. Each Finding has a stable ID that Drafts cite.
_Avoid_: Note, fact, research data

**Report**:
The deliverable of a Research: summary, key facts, Gaps, suggested follow-up questions and Sources. Only a Draft that passed Review becomes the Report.
_Avoid_: Result, answer

**Draft**:
One Round's unreviewed attempt at the Report.

**Review**:
The verdict on a Draft: pass only if every Claim in it cites a Finding that supports it. A Review never edits the Draft.
_Avoid_: Check, evaluation

**Round**:
One Draft followed by its Review. A Research gets at most three.

**Claim**:
An assertion in a Draft about a specific entity, number, date, event or statement, however well known. Every Claim must cite a Finding. General mechanisms and truisms are not Claims.
_Avoid_: Fact, statement

**Gap**:
Something the Research wanted to know but could not back with a Primary Source. Gaps are a legitimate part of a Report, not a failure.
_Avoid_: Missing data, unknown
