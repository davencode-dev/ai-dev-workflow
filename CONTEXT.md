# Context

Domain language for `ai-dev-workflow`. Use these words in prompts, task documents, commit messages, and code. When a term below and a synonym compete, the term below wins.

## Language

- **Application**: one target repository, addressed by its registry `id` (`example-app`). Never by path.
- **Registry**: `config/repositories.json`, machine-local and ignored. Owns every application's path, task prefix, task resolver, validation policy, Android build command, guidance pointers, and evidence locations. `config/repositories.example.json` is the published template.
- **Task document**: the Markdown file in the target repository that defines one unit of work, addressed by **task id** (`APP-003`). The runner implements task documents; `create-tasks` writes them.
- **Provider**: an agent CLI that runs one task in one fresh process (`codex`, `claude-code`, `antigravity`). A provider adapter reports availability and invokes the process. It never sequences, validates, builds, commits, or interprets workflow.
- **Bridge**: the thin per-harness entry point that forwards an invocation to the common command: `.agents/skills/*/SKILL.md` for Codex, `.claude/commands/*.md` for Claude Code. Bridges hold no workflow logic.
- **Core**: `src/core/`. Owns the whole lifecycle: args, resolution, git gates, ordered queue, validation, closure gate, commit, report, stop and resume. Core carries no per-provider branch.
- **Proposal**: the typed structure a provider returns during `create-tasks`, before any task id is allocated. Malformed proposals and duplicates are rejected without writing.
- **Closure gate**: the registry's `androidBuild` command, run after a task's validations and before its commit. It applies to every task in the queue, documentation tasks included. No substitute command is invented: a gate configured but unrunnable fails the task rather than being skipped.
- **Run report**: the JSON file written to `.agent-runs/` per invocation. Records provider, task order, results, changed files, validation and build evidence, commits, git states, and the resume command.
- **Resume command**: the exact re-invocation printed by a stopped run. Copy it; do not reconstruct it.
- **Dry run**: `--dry-run`. Checks provider, application, every task document, order, and policy. Invokes no agent and changes no target repository.
- **Instruction**: the prompt `src/providers/agent-provider.ts` builds for each attempt. It carries the task pointer, the prohibitions, and the **discipline**: a tight red-capable command before editing, and evidence rather than inspection before reporting done. A retry adds the **diagnosis** block: reproduce, minimise, three falsifiable hypotheses, one variable at a time.
- **Manifest**: `.ai-dev-workflow/mobile-verification.json` in a mobile target repository. To `verify-mobile` what the registry is to the runner.

## Relationships

- One registry holds many applications; one application holds many task documents.
- One run covers one application and an ordered list of task ids; each task gets one fresh provider process and one Conventional Commit.
- The first failure or block stops the queue. Remaining tasks are skipped, ambiguous changes are preserved, and the resume command is printed.
- `create-tasks` is adjacent to `run-tasks`, not a stage of it: it commits a docs-only change and never implements product work.
- Nothing in this repository ever pushes.

## Boundaries

A provider process runs with its working directory set to the target repository, so it loads that repository's `AGENTS.md`, skills, and guidance, never this repository's. The instruction is the only channel the orchestrator has for execution discipline; discipline belongs there, not in a skill file here.

Core, registry, and provider adapters are the only three layers. There is no server, queue, database, background worker, or shared application runtime; target repositories stay independent and registry-owned. Adding a provider means implementing `AgentProvider` in `src/providers/`, registering it, and adding adapter tests. It never means a branch in core.

`verify-mobile` is an Android-first execution adapter over a manifest, not application logic. Its stages are manifest validation, static checks, configured build artifact, device preparation and isolated flow execution, then report. The manifest model is deliberately not Expo-specific, so an iOS adapter can replace the device and build stages while reusing the rest.

## Flagged ambiguities

- "Task" alone conflated the document with the queued unit of execution. Say **task document** for the file, **task id** for the address.
- "Build" conflated a target repository's own build with the gate this runner enforces. The gate is the **closure gate**.
