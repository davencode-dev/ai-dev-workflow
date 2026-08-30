import { access, readFile } from 'node:fs/promises';
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
  const [bin, ...args] = repository.androidBuild.split(' ');
  const script = bin === 'npm' && args[0] === 'run' ? args[1] : undefined;
  if (script) {
    const missing = await missingScript(repository, script);
    // A configured gate that cannot run is a failure, not a skip: no substitute command is invented.
    if (missing) return { command: repository.androidBuild, exitCode: 1, output: missing };
  }
  const r = await runProcess(bin, args, repository.path);
  return { command: repository.androidBuild, ...r };
}

async function missingScript(repository: RepositoryConfig, script: string): Promise<string | undefined> {
  const packageJson = join(repository.path, 'package.json');
  if (!(await access(packageJson, constants.F_OK).then(() => true).catch(() => false))) return `Closure gate ${repository.androidBuild} is configured but ${packageJson} does not exist`;
  const scripts = JSON.parse(await readFile(packageJson, 'utf8')).scripts ?? {};
  return scripts[script] ? undefined : `Closure gate ${repository.androidBuild} is configured but package.json has no ${script} script`;
}
