# Provider-neutral mobile verification

```text
project manifest -> preflight -> checks -> Android build -> device roles
                                              |-> install/launch
                                              |-> Maestro flow matrix
                                              |-> manual workflow inventory
                         -> JSON report under ai-dev-workflow/.agent-runs
```

`verify-mobile` is an Android-first execution adapter, not application logic.
All project-specific commands, package IDs, AVDs, Maestro roots, exclusions,
and documentation paths come from the target repository's manifest.

The workflow has four boundaries:

1. Manifest/path/tool validation.
2. Independent static checks followed by the configured build artifact check.
3. Device preparation, install, launch, and isolated flow execution.
4. Report generation. Product repositories are never committed or pushed by
   this command.

The manifest model is deliberately not Expo-specific. A future iOS adapter can
reuse checks, artifacts, workflow status, and documentation fields while
replacing the device/build adapter.
