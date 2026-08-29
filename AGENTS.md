# AGENTS.md

Local, provider-agnostic task orchestrator. Development-process configuration only; no production runtime code.

Read [CONTEXT.md](CONTEXT.md) before working here. It is the domain language: application, registry, task document, provider, bridge, core, closure gate, run report, resume command.

## Rules

- Never push. Every command in this repository stops at the commit.
- Never bypass the common runner or reimplement its workflow in a bridge, a skill, or a prompt.
- Keep `src/core/` free of per-provider branches, and provider adapters free of sequencing, validation, commits, and workflow interpretation.
- Keep `config/repositories.json` out of git; publish changes through `config/repositories.example.json`.
- Run `npm test` before committing.

## Pointers

- Provider obligations during a task: [guidance/task-execution.md](guidance/task-execution.md).
- Engineering standards forwarded to target repositories: [guidance/engineering-best-practices.md](guidance/engineering-best-practices.md).
- Mobile verification and its manifest: [guidance/mobile-verification.md](guidance/mobile-verification.md).
- Running the MCP servers from a client: [guidance/mcp-servers.md](guidance/mcp-servers.md).
- React Native and Expo rules: [.agents/skills/react-native-skills/SKILL.md](.agents/skills/react-native-skills/SKILL.md).
