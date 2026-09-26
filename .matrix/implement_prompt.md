# ISSUES

Issues JSON is provided at start of context. It contains `id`, `number`, `title`, and `blockers` for each open issue.

You've also been passed the last couple of SMITH commits (SHA, date, full message). Review these to understand what work has been done.

# TASK SELECTION

Pick the next task. Prioritize tasks in this order:

1. Critical bugfixes
2. Tracer bullets for new features

Tracer bullets comes from the Pragmatic Programmer. When building systems, you want to write code that gets you feedback as quickly as possible. Tracer bullets are small slices of functionality that go through all layers of the system, allowing you to test and validate your approach early. This helps in identifying potential issues and ensures that the overall architecture is sound before investing significant time in development.

TL;DR - build a tiny, end-to-end slice of the feature first, then expand it out.

3. Polish and quick wins
4. Refactors

# FETCH ISSUE DETAILS

Once you've selected an issue, fetch its full body and comments before exploring the repo:

```
gh issue view <number> --json body,comments
```

# EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

# EXECUTION (TDD)

Implement using the TDD skill. Read and follow these files before writing any code:

- [Philosophy & workflow](.claude/skills/tdd/SKILL.md)
- [What good tests look like](.claude/skills/tdd/tests.md)
- [Mocking guidelines](.claude/skills/tdd/mocking.md)
- [Interface design for testability](.claude/skills/tdd/interface-design.md)
- [Deep modules](.claude/skills/tdd/deep-modules.md)
- [Refactoring](.claude/skills/tdd/refactoring.md)

Stay focused — do not fix unrelated things.

# COMMIT

Make a git commit. The commit message must:

1. Be made to a feature branch for PRD (specific to whole feature)
2. Start with `SMITH:` prefix
3. Include task completed + PRD reference
4. Key decisions made
5. Files changed
6. Blockers or notes for next iteration

Keep it concise.

# THE ISSUE

If the task is complete, close the original GitHub issue. No need to push. You have no push rights.

If the task is not complete, leave a comment on the GitHub issue with what was done.

# FINAL RULES

- ONLY WORK ON A SINGLE TASK.
- Be extremely concise and sacrifice grammar for the sake of concision.
