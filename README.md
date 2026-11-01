# ai-dev-workflow

Local, provider-agnostic task orchestrator. It creates task documents in target repositories and implements them one at a time, with isolated commits, validation, and evidence. Development-process configuration only; not production runtime code.

Vocabulary is defined once in [CONTEXT.md](CONTEXT.md). Agent rules are in [AGENTS.md](AGENTS.md).

## Setup

Requires Node 22+ and an installed, authenticated `codex`, `claude`, or `agy` CLI.

Create the machine-local registry. The file is ignored because it holds private repository paths, commands, and project metadata:

```bash
cp config/repositories.example.json config/repositories.json
```

To route every provider session through [headroom](https://github.com/headroomlabs-ai/headroom), start `headroom proxy --port 8787` and add `"headroom": { "url": "http://127.0.0.1:8787" }` at the top of `config/repositories.json`. Runs then refuse to start without the proxy, and a session that bypasses it blocks its task. Details in [CONTEXT.md](CONTEXT.md).

Optional registry fields: `commandTimeoutMs` and `providerTimeoutMs` (kill limits; 30 and 60 minutes by default), `closureGateScope` (`all` or `code`), `allowLockfileChanges`, and `mobileVerification` (gate each task on `verify-mobile`). Their meaning is in [CONTEXT.md](CONTEXT.md).

## Start from an idea

`/grill` is the entry point from Codex and Claude Code, and the only one they need. It interrogates you until a rough report is grounded, then drives the rest: dry run, approval, task documents, execution, resume. From Codex: `$grill`. From Claude Code: `/grill`. The process is [.agents/skills/grill/SKILL.md](.agents/skills/grill/SKILL.md).

The commands below are what it forwards to. Run them directly only to inspect or resume. The MCP servers are a separate surface and expose the same commands as tools without going through grill.

## Run tasks

```bash
npm run tasks -- --agent codex example-app APP-003 APP-001 APP-002
npm run tasks -- --agent claude-code file-app FILE-002 FILE-004
npm run tasks -- --agent codex --dry-run example-app APP-003 APP-001
```

Run any command with no arguments for its provider list and full flags. Providers are `codex`, `claude-code` (alias `claude`), and `antigravity` (alias `agy`); aliases resolve to the canonical id, so reports and resume commands always print the canonical name.

## Create task definitions

`create-tasks` turns a short report and optional screenshots into task documents only. It checks target git state, task conventions, and duplicates; splits independent problems; updates tracking; and commits one docs-only change in the target repository.

```bash
npm run create-tasks -- --agent codex example-app --description "Primary button is misaligned" --image "/path/screenshot.jpeg"
npm run create-tasks -- --dry-run task-app --description "Icons do not load" --image "/path/icons.jpeg"
```

Supported images are PNG, JPG/JPEG, and WEBP; repeat `--image` per file. Images are inspected but not committed unless `--persist-images` is passed. Codex forwards images with its own `--image` option; Claude Code and Antigravity receive the image parent directories through `--add-dir`. Antigravity has no output-schema option, so its proposal schema travels in the prompt.

## Verify mobile

Mobile repositories add `.ai-dev-workflow/mobile-verification.json` describing their Android package, checks, build artifact, emulator roles, Maestro roots, manual workflow gaps, and documentation paths.

```bash
npm run verify-mobile -- --dry-run weshift
npm run verify-mobile -- weshift
```

See [guidance/mobile-verification.md](guidance/mobile-verification.md) and the [manifest example](config/mobile-verification.example.json).

## MCP servers

```bash
npm run mcp:workflow
npm run mcp:android
```

Client configuration and the tool reference are in [guidance/mcp-servers.md](guidance/mcp-servers.md).

## Reports

Run reports are written to `.agent-runs/` and are ignored, because they can contain local paths, task content, and provider output. Historical `.codex-runs/` is left untouched.

## Verify

```bash
npm run check
```
