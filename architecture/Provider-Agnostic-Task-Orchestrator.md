# Provider-agnostic local task orchestrator

Status: active. Replaces prompt-heavy task execution direction.

```text
CLI/skill -> core runner -> registry + resolver -> provider adapter -> fresh agent process
                   |-> Git / validation / Android / commit / report
```

Core has no Codex/Claude operational branch. It receives `AgentProvider`; adapter owns executable availability and one process invocation. Registry owns resolved pilot paths, prefixes, task rules, validation/build policy, guidance/evidence pointers. New providers only implement interface.

No server, queue, DB, MCP, SDK, background worker, LangGraph, Temporal, or shared application runtime. Application repositories remain independent and registry-owned.

## Task-definition creation

`create-tasks` is adjacent to, not a replacement for, `run-tasks`: it creates and commits task definitions only. Core code resolves registry-owned task locations, validates screenshots, asks provider for a typed proposal, rejects malformed output/duplicates, allocates IDs, writes task Markdown and tracking, checks docs-only diffs, commits, and reports. Provider adapters only inspect repository/image context and return a structured proposal.
