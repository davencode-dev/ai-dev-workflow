---
name: create-tasks
description: Create grounded, independently actionable application task documents from an application identifier, short issue report, and optional screenshots. Use for `$create-tasks`, `/create-task`, reported UI bugs, UX issues, state glitches, or backend errors that must become task definitions without implementing product work.
---

# Create tasks

Forward only to common command from `ai-dev-workflow` root. Never implement reported task.

```bash
npm run create-tasks -- --agent codex <application> --description "<report>" --image "/path/image.png"
```

For attached images, save/resolve local paths first. Use repeated `--image`. Use `--dry-run` before live creation when scope or duplicates uncertain. Use `--single-task` only when report must stay one independently implementable unit. Add `--persist-images` only when task evidence should be committed.

Common command owns repo resolution, screenshot validation, provider proposal schema, duplicate checks, identifiers, task docs, tracking, Git gates, commit, and report. It never executes product tasks or pushes.
