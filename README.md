# Local task orchestrator

Minimal local, provider-agnostic task orchestrator. Development-process configuration/documentation only; not production runtime code.

## Use

Create machine-local registry first. File is intentionally ignored because it can
contain private repository paths, commands, and project metadata:

```bash
cp config/repositories.example.json config/repositories.json
```

Edit copied file with your own repositories. Never commit it.

```bash
npm run tasks -- --agent codex example-app APP-003 APP-001 APP-002
npm run tasks -- --agent claude-code file-app FILE-002 FILE-004
npm run tasks -- --agent antigravity file-app FILE-002
npm run tasks -- --agent codex --dry-run example-app APP-003 APP-001
```

Providers: `codex`, `claude-code` (alias `claude`), `antigravity` (alias `agy`). Aliases resolve to the canonical id, so reports and resume commands always print the canonical name.

Requires Node 22+ plus an installed, authenticated `codex`, `claude`, or `agy` CLI. `--dry-run` checks provider, app/repo, every task document, preserved order, validation/build policy; invokes no agent, changes no app repo.

Codex: invoke `$run-tasks --agent codex example-app APP-003`. Claude Code: from this repo invoke `/run-tasks example-app APP-003`; command supplies `--agent claude-code`. Both forward to same runner.

## Create task definitions

`create-tasks` turns a brief report and optional screenshots into task documents only. `tasks`/`run-tasks` implements existing task IDs. Creation checks target Git state, task conventions and duplicates; splits independent problems; updates tracking; commits one docs-only change in target repo; never pushes or executes product work.

```bash
npm run create-tasks -- --agent codex example-app --description "Primary button is misaligned" --image "/path/screenshot.jpeg"
npm run create-tasks -- --agent claude-code file-app --description "Sign-in fails and exposes a raw error" --image "/path/account-error.jpeg"
npm run create-tasks -- --agent codex task-app --description "Icons do not load; dashboard flickers" --image "/path/icons.jpeg" --image "/path/dashboard.jpeg"
npm run create-tasks -- --dry-run task-app --description "Icons do not load" --image "/path/icons.jpeg"
```

Supported images: PNG, JPG/JPEG, WEBP. Reuse `--image` for each file. Images are inspected but not committed by default; `--persist-images` copies safe evidence names into registry-configured task evidence storage. `--single-task` rejects provider splits that cannot be scoped safely as one task. Existing open task text is checked before ID allocation; possible duplicates are reported without writing.

Codex: `$create-tasks task-app --description "Icons fail" --image "/path/icons.jpeg"`. Claude Code: `/create-tasks task-app --description "Icons fail" --image "/path/icons.jpeg"`. Both delegate to common command. Codex forwards images with its documented `--image` option. Claude Code and Antigravity receive image parent directories through documented `--add-dir`; provider must inspect only supplied image paths. Antigravity has no output-schema option, so its proposal schema travels in the prompt and JSON is parsed from the response.

## Architecture

`src/core/` owns CLI lifecycle: args, registry/task resolution, clean Git gates, ordered queue, validation/build policy, commit gate/creation, report, stop/resume. `src/providers/` owns one isolated CLI process per task and normalized output only. Provider adapters do not sequence, validate, build, commit, or interpret task workflow.

Registry template: [config/repositories.example.json](config/repositories.example.json). Local registry: ignored `config/repositories.json`. Canonical guidance is [guidance/task-execution.md](guidance/task-execution.md). Provider bridges are thin: Codex [SKILL.md](.agents/skills/run-tasks/SKILL.md), Claude [run-tasks.md](.claude/commands/run-tasks.md).

Every completed task gets one Conventional Commit. First failure/block stops queue; remaining tasks are skipped. Failed work is preserved unless future safe restoration is unambiguous. Resume exact command in report. Never pushes.

Validation commands come from the registry. When a repository exposes `build:android:local`, the exact command runs as a closure gate for every task, including documentation/planning tasks and every task in a multi-task queue. No replacement build command is invented.

## Reports

New JSON reports: `.agent-runs/`. They record provider, task docs/order, results, changed files, validation/build evidence, commits, Git states, resume. Historical `.codex-runs/` remains untouched; old status readers can continue reading it.

Both report directories are ignored because output may contain local paths, task content, and provider responses.

## Add provider

Implement `AgentProvider` in `src/providers/`, register it in `src/cli/run-tasks.ts`, and add adapter tests. Keep provider code limited to availability + one fresh process per task. No core provider branches.

## Verify

```bash
npm test
```

## Mobile verification

Mobile projects can add `.ai-dev-workflow/mobile-verification.json` with their
Android package, checks, build artifact, emulator roles, Maestro roots, manual
workflow gaps, and documentation paths. The generic runner then works for
different app layouts without embedding project-specific selectors or commands:

```bash
npm run verify-mobile -- --dry-run weshift
npm run verify-mobile -- weshift
```

See [guidance/mobile-verification.md](guidance/mobile-verification.md) and the
[manifest example](config/mobile-verification.example.json).
