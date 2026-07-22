---
description: Run ordered application tasks through common provider-neutral runner.
---

From ai-dev-workflow root, forward arguments only:

```bash
npm run tasks -- --agent claude-code $ARGUMENTS
```

Examples: `/run-tasks file-app FILE-002 FILE-004`; dry run: `/run-tasks --dry-run example-app APP-003`.

Do not implement task workflow here. Common runner owns resolution, git, validation, Android policy, commits, reports, stop/resume.
