import { resolve } from 'node:path';
import { runSequence } from '../core/runner.ts';
import { loadRegistry } from '../core/repository-registry.ts';
import { CodexProvider } from '../providers/codex-provider.ts';
import { ClaudeCodeProvider } from '../providers/claude-code-provider.ts';

type Args = { agent: string; dryRun: boolean; application: string; taskIds: string[] };
export function parseArgs(argv: string[]): Args {
  let agent = ''; let dryRun = false; const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) { const arg = argv[i]; if (arg === '--agent') { agent = argv[++i] ?? ''; } else if (arg === '--dry-run') dryRun = true; else positional.push(arg); }
  if (!agent || positional.length < 2 || positional.some((arg) => arg.startsWith('-'))) throw new Error('Usage: npm run tasks -- --agent <codex|claude-code> [--dry-run] <application> <TASK...>');
  return { agent, dryRun, application: positional[0], taskIds: positional.slice(1) };
}
async function main() {
  const args = parseArgs(process.argv.slice(2)); const root = resolve(import.meta.dirname, '../..');
  const providers = { codex: new CodexProvider(), 'claude-code': new ClaudeCodeProvider() };
  const provider = providers[args.agent as keyof typeof providers]; if (!provider) throw new Error(`Unknown provider: ${args.agent}`);
  const result = await runSequence({ root, provider, registry: await loadRegistry(root), application: args.application, taskIds: args.taskIds, dryRun: args.dryRun });
  console.log(JSON.stringify({ report: result.reportPath, tasks: result.report.tasks.map(({ id, status }) => ({ id, status })), resume: result.report.resumeCommand }, null, 2));
}
if (import.meta.main) main().catch((error: Error) => { console.error(`ERROR: ${error.message}`); process.exitCode = 2; });
