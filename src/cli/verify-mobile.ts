import { resolve } from 'node:path';
import { loadRegistry } from '../core/repository-registry.ts';
import { runMobileVerification } from '../core/mobile-verification.ts';

export type VerifyMobileArgs = {
  application: string;
  manifestPath?: string;
  dryRun: boolean;
};

export function parseArgs(argv: string[]): VerifyMobileArgs {
  let manifestPath: string | undefined;
  let dryRun = false;
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--manifest') manifestPath = argv[++index];
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--help' || arg === '-h') throw new Error('Usage: npm run verify-mobile -- [--dry-run] [--manifest path] <application>');
    else positional.push(arg);
  }
  if (positional.length !== 1 || !positional[0] || positional[0].startsWith('-')) {
    throw new Error('Usage: npm run verify-mobile -- [--dry-run] [--manifest path] <application>');
  }
  return { application: positional[0], manifestPath, dryRun };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(import.meta.dirname, '../..');
  const result = await runMobileVerification({
    root,
    registry: await loadRegistry(root),
    application: args.application,
    manifestPath: args.manifestPath,
    dryRun: args.dryRun,
  });
  console.log(JSON.stringify({ report: result.reportPath, status: result.report.status, flows: result.report.flows.length, manual: result.report.manualWorkflows.length }, null, 2));
  if (!args.dryRun && ['FAIL', 'BLOCKED'].includes(result.report.status)) process.exitCode = 1;
}

if (import.meta.main) main().catch((error: Error) => { console.error(`ERROR: ${error.message}`); process.exitCode = 2; });
