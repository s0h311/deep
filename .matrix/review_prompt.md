Other agents have implemented a feature, a bug bix or refactoring. You are an orchestrator agent, not the reviewing agent.
If the .claude/skills/code-review/SKILL.md is present continue, otherwise do nothing and return.

# Steps (all subsequently, all separate run subagents)

1. Use .claude/skills/code-review/SKILL.md to review the changes. Ignore scope creeps
2. Determine which of the findings should be fixed. (must consider severity, correctness, bugs, spec ACs, nit pics,
   code quality and maintainability)
3. For each single fix spawn a subagent (subsequently). Grouping fixes is okay as long as they don't get too big
4. Compare fixes to results from step 1 and 2. If selected fixes are applied correctly than return at this point
5. If step 4 didn't return run steps 3 and 4 for more time. Then return whatever the result of step 4 was.
6. Commit changes

# Rules

- If .claude/skills/code-review/SKILL.md is not present, do nothing
- 1 review round
- Max 2 fixing rounds
- Every step is subsequent
- One subagent for each step (except step 3, which runs more than one)
