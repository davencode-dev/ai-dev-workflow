---
name: run-tasks
description: Execute one or more ordered application task documents sequentially with isolated commits, validation, evidence, and stop-on-failure handling. Use when asked to run tasks with an application identifier and ordered task identifiers, including `/run-tasks` or `/run-task` requests.
---

# Run ordered tasks

Run from `ai-dev-workflow`:

```bash
npm run tasks -- --agent <codex|claude-code|antigravity> <application> <task-id> [task-id...]
```

Aliases: `claude` = `claude-code`, `agy` = `antigravity`.

Examples:

```text
$run-tasks --agent codex example-app APP-003 APP-001 APP-002
$run-tasks --agent claude-code file-app FILE-002 FILE-004
$run-tasks --agent agy file-app FILE-002
```

Use `--dry-run` before a live run. Do not bypass common runner: it resolves every task before provider starts, owns checks/validation/commits, writes `.agent-runs` report.

Forward short invocation only. Runner preserves order, one fresh session/task, stops first failure/block, preserves ambiguous changes, reports exact resume.
