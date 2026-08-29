---
description: Create grounded application task documents through common provider-neutral command.
argument-hint: "[--dry-run] <application> --description <text> [--image <path>...]"
disable-model-invocation: true
---

From ai-dev-workflow root, forward args only:

```bash
npm run create-tasks -- --agent claude-code $ARGUMENTS
```

Run with no arguments for the full flag list. Save pasted screenshots to disk first and pass resolved absolute paths. Examples: `/create-tasks task-app --description "Icons fail" --image "/tmp/icons.jpeg"`; dry run: `/create-tasks --dry-run task-app --description "Icons fail"`.

Never implement the reported work. The command owns task split, repository inspection, IDs, Markdown, tracking, validation, commit, and report.
