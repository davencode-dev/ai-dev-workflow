import { resolve } from 'node:path';
import { runSequence } from '../core/runner.ts';
import { loadRegistry } from '../core/repository-registry.ts';
import { providerUsage, selectProvider } from '../providers/registry.ts';

type Args = { agent: string; dryRun: boolean; retries: number; rollbackOnFailure: boolean; application: string; taskIds: string[] };

export function parseArgs(argv: string[]): Args {
  let agent = '';
  let dryRun = false;
  let retries = 0;
  let rollbackOnFailure = false;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--agent') {
      agent = argv[++i] ?? '';
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--rollback-on-failure') {
      rollbackOnFailure = true;
    } else if (arg === '--retries') {
      const val = argv[++i];
      retries = val ? Number.parseInt(val, 10) : 0;
      if (Number.isNaN(retries) || retries < 0) throw new Error('Option --retries requires a non-negative integer');
    } else if (arg.startsWith('--retries=')) {
      retries = Number.parseInt(arg.slice(10), 10);
      if (Number.isNaN(retries) || retries < 0) throw new Error('Option --retries requires a non-negative integer');
    } else {
      positional.push(arg);
    }
  }
  if (!agent || positional.length < 2 || positional.some((arg) => arg.startsWith('-'))) {
    throw new Error(`Usage: npm run tasks -- --agent ${providerUsage} [--dry-run] [--retries <N>] [--rollback-on-failure] <application> <TASK...>`);
  }
  return { agent, dryRun, retries, rollbackOnFailure, application: positional[0], taskIds: positional.slice(1) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(import.meta.dirname, '../..');
  const provider = selectProvider(args.agent);
  const result = await runSequence({
    root,
    provider,
    registry: await loadRegistry(root),
    application: args.application,
    taskIds: args.taskIds,
    dryRun: args.dryRun,
    retries: args.retries,
    rollbackOnFailure: args.rollbackOnFailure,
  });
  console.log(JSON.stringify({ report: result.reportPath, tasks: result.report.tasks.map(({ id, status }) => ({ id, status })), resume: result.report.resumeCommand }, null, 2));
}

if (import.meta.main) main().catch((error: Error) => { console.error(`ERROR: ${error.message}`); process.exitCode = 2; });
