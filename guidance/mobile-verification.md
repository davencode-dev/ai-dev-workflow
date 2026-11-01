# Mobile verification workflow

Each mobile repository owns `.ai-dev-workflow/mobile-verification.json`. The
manifest describes commands, the Android package, emulator roles, Maestro flow
discovery, manual workflow gaps, and documentation paths. The generic command
does not know the app's routes, selectors, build system, or product semantics.

Run from `ai-dev-workflow`:

```bash
npm run verify-mobile -- --dry-run <application>
npm run verify-mobile -- <application>
```

The command validates the target manifest, runs configured checks, builds the
configured artifact, attaches to or starts configured emulator roles, installs
and launches the app, runs each discovered Maestro flow independently, and
writes a JSON report under `.agent-runs/`. It never commits, pushes, or edits
the target repository.

Each stage checks its own tools when it starts: check commands before the checks,
the build command before the build, `adb` and Maestro before the devices. A
machine without an emulator toolchain still runs the checks and the build.

To gate every task of `run-tasks` on this verification, add
`"mobileVerification": {}` to the application's registry entry (optionally
`{ "manifest": "<path>" }`). The runner then verifies each task's uncommitted
changes before committing them. Point Maestro's `testOutputDir` and the
evidence directory at ignored paths, or the evidence is committed with the task.

Static-check failures block dependent build/device stages. A failed Maestro
flow does not hide later flows. Manual workflows are reported as
`MANUAL_REQUIRED`; they must be driven through the emulator by the project
workflow owner and recorded in that project's documentation.

Use dedicated AVDs when a manifest declares `isolation: dedicated`. Never put
credentials, tokens, invite codes, or private service values in a manifest,
workflow document, screenshot filename, or verification report.
