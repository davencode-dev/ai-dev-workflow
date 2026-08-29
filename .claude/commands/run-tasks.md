---
description: Run ordered application tasks through common provider-neutral runner.
argument-hint: "[--dry-run] <application> <TASK-ID...>"
disable-model-invocation: true
---

From ai-dev-workflow root, forward arguments only:

```bash
npm run tasks -- --agent claude-code $ARGUMENTS
```

Run with no arguments for the full flag list. Examples: `/run-tasks file-app FILE-002 FILE-004`; dry run: `/run-tasks --dry-run example-app APP-003`.

Never implement task workflow here. The runner owns resolution, git gates, validation, Android closure gate, commits, reports, stop/resume.
