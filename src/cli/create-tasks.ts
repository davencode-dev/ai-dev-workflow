import { resolve } from 'node:path';
import { createTasks } from '../core/create-tasks.ts';
import { loadRegistry } from '../core/repository-registry.ts';
import { ClaudeCodeProvider } from '../providers/claude-code-provider.ts';
import { CodexProvider } from '../providers/codex-provider.ts';

export type CreateArgs = { agent: string; application: string; description: string; images: string[]; dryRun: boolean; singleTask: boolean; persistImages: boolean };
export function parseCreateArgs(argv: string[]): CreateArgs {
  let agent = 'codex'; let description = ''; let dryRun = false; let singleTask = false; let persistImages = false; const images: string[] = []; const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) { const arg = argv[i]; if (arg === '--agent') agent = argv[++i] ?? ''; else if (arg === '--description') description = argv[++i] ?? ''; else if (arg === '--image') images.push(argv[++i] ?? ''); else if (arg === '--dry-run') dryRun = true; else if (arg === '--single-task') singleTask = true; else if (arg === '--persist-images') persistImages = true; else if (arg.startsWith('-')) throw new Error(`Unknown argument: ${arg}`); else positional.push(arg); }
  const application = positional.shift() ?? ''; if (!description && positional.length) description = positional.join(' ');
  if (!application || !description) throw new Error('Usage: npm run create-tasks -- --agent <codex|claude-code> [--dry-run] [--single-task] [--persist-images] <application> --description <text> [--image <path>...]');
  return { agent, application, description, images, dryRun, singleTask, persistImages };
}
async function main() { const args = parseCreateArgs(process.argv.slice(2)); const providers = { codex: new CodexProvider(), 'claude-code': new ClaudeCodeProvider() }; const provider = providers[args.agent as keyof typeof providers]; if (!provider) throw new Error(`Unknown provider: ${args.agent}`); const root = resolve(import.meta.dirname, '../..'); const result = await createTasks({ root, provider, registry: await loadRegistry(root), application: args.application, description: args.description, imagePaths: args.images, dryRun: args.dryRun, singleTask: args.singleTask, persistImages: args.persistImages }); console.log(JSON.stringify({ report: result.reportPath, created: result.report.created, duplicates: result.report.duplicates, run: result.report.runCommand }, null, 2)); }
if (import.meta.main) main().catch((error: Error) => { console.error(`ERROR: ${error.message}`); process.exitCode = 2; });
