import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SequenceReport } from './types.ts';

export async function writeReport(root: string, report: SequenceReport): Promise<string> {
  const directory = join(root, '.agent-runs'); await mkdir(directory, { recursive: true });
  const safe = report.startedAt.replace(/[:.]/g, '-'); const path = join(directory, `tasks-${safe}.json`);
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`); return path;
}
