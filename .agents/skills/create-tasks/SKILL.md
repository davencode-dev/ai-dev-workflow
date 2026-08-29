---
name: create-tasks
description: Turn a short issue report and optional screenshots into grounded, independently actionable task documents. Use for `$create-tasks` or `/create-tasks`, and for reported UI bugs, UX issues, state glitches, or backend errors that must become task definitions without implementing product work.
argument-hint: "--agent <provider> [--dry-run] <application> --description <text> [--image <path>...]"
disable-model-invocation: true
---

# Create tasks

Forward to the common command from the `ai-dev-workflow` root. Never implement the reported issue.

```bash
npm run create-tasks -- --agent codex <application> --description "<report>" --image "/path/image.png"
```

Run with no arguments for the provider list and full flags. Save attached images to disk and resolve absolute paths before invoking; repeat `--image` per file. Use `--dry-run` when scope or duplicates are uncertain, `--single-task` only when the report must stay one implementable unit.

The command owns repo resolution, screenshot validation, the provider proposal schema, duplicate checks, identifiers, task docs, tracking, git gates, commit, and report. It never executes product tasks and never pushes.
