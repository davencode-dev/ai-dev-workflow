---
name: run-tasks
description: Execute ordered application task documents sequentially with isolated commits, validation, evidence, and stop-on-failure. Use for `$run-tasks` or `/run-tasks` with an application id and ordered task ids.
argument-hint: "--agent <provider> [--dry-run] <application> <TASK-ID...>"
disable-model-invocation: true
---

# Run ordered tasks

Run from the `ai-dev-workflow` root, forwarding the short invocation only:

```bash
npm run tasks -- --agent codex example-app APP-003 APP-001 APP-002
```

Run with no arguments for the provider list and full flags. Use `--dry-run` before a live run.

Never bypass the common runner: it resolves every task before the provider starts, preserves the supplied order, opens one fresh session per task, owns git gates, validation, the Android closure gate, commits, and the `.agent-runs` report. It stops on the first failure or block, preserves ambiguous changes, and prints the exact resume command.
