# Task execution guidance

Runner resolves every requested task before modifying target repository. Preserve supplied order. For one task only: read task document and target repository guidance; implement only stated scope; do not prepare later tasks; do not commit/push or run the Android build yourself. After each task's validations, the runner executes the configured `npm run build:android:local` closure gate before creating that task's commit. Report changed files and validation evidence to runner.

Runner, not provider, checks Git, selects validations/build, reviews unsafe diff classes, creates focused commit, writes report, stops failure/block, emits resume command.

Target `AGENTS.md`/`CLAUDE.md` remain repository-local guidance. Common engineering security, component communication, state architecture, and rendering standards are defined in [guidance/engineering-best-practices.md](engineering-best-practices.md). Provider bridges forward invocation against these standards.
