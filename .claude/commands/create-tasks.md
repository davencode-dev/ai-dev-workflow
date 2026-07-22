---
description: Create grounded application task documents through common provider-neutral command.
---

From ai-dev-workflow root, forward args only:

```bash
npm run create-tasks -- --agent claude-code $ARGUMENTS
```

Examples: `/create-tasks task-app --description "Icons fail" --image "/tmp/icons.jpeg"`; dry run: `/create-tasks --dry-run task-app --description "Icons fail"`.

Do not implement product work. Common command owns task split, repository inspection, IDs, Markdown, tracking, validation, commit, and report.
