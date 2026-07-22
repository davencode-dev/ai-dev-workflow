import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { runProcess } from './process.ts';
import type { CommandResult, RepositoryConfig, ResolvedTask } from './types.ts';

export async function runValidations(repository: RepositoryConfig, task?: ResolvedTask): Promise<CommandResult[]> {
  const output: CommandResult[] = [];
  const taskCommands = task ? [...task.content.matchAll(/`(npm(?:\s+run)?\s+[^`\n]+)`/g)].map((match) => match[1]) : [];
  for (const command of [...new Set([...repository.validation, ...taskCommands])]) { const [bin, ...args] = command.split(' '); const r = await runProcess(bin, args, repository.path); output.push({ command, ...r }); if (r.exitCode) break; }
  return output;
}
export async function runAndroidBuild(repository: RepositoryConfig): Promise<CommandResult | undefined> {
  if (!repository.androidBuild) return undefined;
  const packageJson = join(repository.path, 'package.json');
  if (!(await access(packageJson, constants.F_OK).then(() => true).catch(() => false))) return undefined;
  const text = await (await import('node:fs/promises')).readFile(packageJson, 'utf8');
  if (!JSON.parse(text).scripts?.['build:android:local']) return undefined;
  const [bin, ...args] = repository.androidBuild.split(' '); const r = await runProcess(bin, args, repository.path); return { command: repository.androidBuild, ...r };
}
