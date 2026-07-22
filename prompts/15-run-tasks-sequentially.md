# Legacy — prompt-driven ordered application tasks

Status: deprecated. Historical evidence only. Use `npm run tasks -- --agent <provider> <application> <task...>`; common runner now owns lifecycle.

Execute only sequence supplied in `SEQUENCE CONTEXT` appended below. Context is prevalidated; do not alter task order or resolve substitute tasks.

## Before sequence

1. Read `README.md`, `guidance/task-execution.md`, relevant task documents, and current Git status/history.
2. Confirm this repository and target application repository clean. If either is dirty, record `BLOCKED` in report and stop before application edits.
3. Keep report at supplied path. Record requested order before task one.

## Each task

For each task in supplied order only:

1. Read complete resolved task document and every applicable root/nested `AGENTS.md`.
2. Reconfirm target clean. Inspect only relevant implementation. Do not prepare later tasks.
3. Implement exact scope. No unrelated refactor, dependency update, migration, redesign, cleanup, or formatting churn.
4. Run task and repository required validation. If the repository exposes `npm run build:android:local`, run that exact command as the closure gate for every task, including documentation/planning tasks and every task in a multi-task sequence. Never invent substitute commands.
5. Review complete diff. Update task/pilot evidence required by task/repo guidance. Check acceptance criteria.
6. Commit one focused Conventional Commit in application repo. Never push. Record commit hash/message, files, validations, Android result, acceptance criteria, evidence/status files.
7. Continue only if acceptance, validations, commit, and clean application status all pass.

Update sequence report after every task, including failed/blocked status and skipped remainder.

## Failure

On failed/blocked task: do not commit partial work; restore only changes made by current task when target is known and safe; otherwise preserve tree and list uncommitted files/manual decision. Mark failure/block in report, stop immediately, list skipped tasks, and give exact safe resume command containing remaining IDs.

Never commit `ai-dev-workflow` during sequence except a separate final commit after full success when shared report/tracking changed. Do not mix application and workflow-repository changes.

## Final report

Report target, requested/completed/failed/skipped tasks, files per task, validation/Android results, application commits, evidence/status files, both Git statuses, and exact safe resume command.
