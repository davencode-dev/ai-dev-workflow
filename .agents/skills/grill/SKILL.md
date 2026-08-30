---
name: grill
description: Interrogate the user until a reported issue or idea is grounded enough to become task documents, then drive the full workflow: dry run, approval, create-tasks, run-tasks. Use for `$grill` or `/grill`, and whenever the user wants to start work from a rough idea rather than existing task ids.
argument-hint: "[application] [rough description of the issue or idea]"
disable-model-invocation: true
---

# Grill

Turn a rough idea into committed, implemented work. You produce one thing the rest of the workflow cannot produce for itself: a **description** sharp enough that the provider's proposal is worth approving. Everything after that is gates.

Read [CONTEXT.md](../../../CONTEXT.md) first for the vocabulary used below.

## 0. Facts before questions

Finding facts is your job; only decisions go to the user. Look these up inline before the first round:

```bash
cat config/repositories.json          # applications, prefixes, task locations
git status --short                    # this repo must be clean
```

Also check the target repository's git status and list its existing task documents at the registry's `taskResolver.path`. Never ask which application when the registry holds one, never ask whether a repository is clean, never ask what an existing task document says.

Both this repository and the target must be clean: `create-tasks` and `run-tasks` refuse to start otherwise. If either is dirty, stop and say which one.

Write nothing into either working tree during a grill. Drafts, notes, and the description file go in the OS temp directory.

## 1. Grill in rounds

Interview the user relentlessly until you reach a shared understanding. Map the work as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask now without guessing at answers you have not heard yet. Ask the whole frontier in one round, numbered, each with your recommended answer. Then wait.

```
❓ **Q1** - **<question title>**: <question body, may include multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body>

➡️ <your recommended answer>
```

A question whose answer depends on another question still open in this round belongs to a later round. Each round of answers pushes the frontier outward; recompute it and ask again.

Cover at minimum: observed behaviour versus expected, where it happens (route, screen, state), reproduction steps, whether screenshots exist, blast radius, and whether this is one problem or several. Provider (`codex`, `claude-code`, `antigravity`) and whether to pass `--retries` or `--rollback-on-failure` are also decisions; ask them in the last round, not the first.

The grill is done when the frontier is empty. Do not act on it until the user confirms.

## 2. Write the description

Compose the grounded report and write it to one temp file, for example `$TMPDIR/grill-description.txt`. Facts only; mark hypotheses as hypotheses. Show it to the user and get confirmation.

Pass it by file in every later command:

```bash
npm run create-tasks -- --agent <provider> --dry-run <application> --description "$(cat "$TMPDIR/grill-description.txt")" --image "/abs/path.png"
```

The replay in step 4 compares the description and the image list byte for byte against the dry-run report. Reading from the same file in both invocations is what makes the replay land. Repeat `--image` per screenshot, with absolute paths. Do not pass `--single-task`: it is a hard assertion that throws when the provider splits, not a preference.

## 3. Present the proposal

Read the report path the command printed and open that JSON.

If `duplicates` is non-empty the command stopped early by design: `proposed` and `created` are empty and no provider ran. Show the matched task ids and put it back to the user, either amend the existing task document or sharpen the description so it is not a duplicate. Do not continue to step 4.

Otherwise present every entry of `proposed`: title, problem, scope, out of scope, acceptance. Ask whether the split and the scope are right. If the user changes the description, the report is void; go back to step 2 and dry-run again.

## 4. Create the task documents

On approval, replay the exact proposal the user saw:

```bash
npm run create-tasks -- --agent <provider> <application> --description "$(cat "$TMPDIR/grill-description.txt")" --image "/abs/path.png" --proposal-report .agent-runs/create-tasks-<timestamp>.json
```

This commits one docs-only change in the target repository. Report the allocated task ids and the commit.

## 5. Gate, then run

Everything so far was documentation. `run-tasks` writes product code and commits it into the target repository, so stop and get an explicit yes before it.

Take `runCommand` from the report this live run wrote, not from the dry-run report: task ids are allocated at write time. Append `--retries <N>` or `--rollback-on-failure` if the grill settled on them, then run it.

Report the run report path, each task's result, the commits, and, if the queue stopped, the exact `resumeCommand`. Nothing here ever pushes.

## Resuming a stopped queue

The runner stops at the first failure or block and preserves the ambiguous changes, so the target repository is dirty and no further run can start until a human resolves it. Show the failing task's `reason` and its validation output, help the user decide what to keep, and only then run the report's `resumeCommand` verbatim. Do not reconstruct that command from the task ids.

This skill is the only entry point. When the user asks to create or run tasks directly, start at the step that matches what they already have rather than pointing them at another command.
