import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { runProcess, splitCommand } from './process.ts';
import type { CommandResult, RepositoryConfig, ResolvedTask } from './types.ts';

export const defaultCommandTimeoutMs = 30 * 60 * 1000;

// Task documents are written by providers during create-tasks, so only commands that run the target
// repository's own scripts are taken from them. Anything else (npm install, npm exec, npm publish) is ignored.
const taskCommand = /^npm (?:test|run [\w:.-]+)(?:\s|$)/;

export function taskValidationCommands(task: ResolvedTask): string[] {
  return [...task.content.matchAll(/`(npm\s[^`\n]+)`/g)].map((match) => match[1].trim().replace(/\s+/g, ' ')).filter((command) => taskCommand.test(command));
}

async function run(command: string, repository: RepositoryConfig): Promise<CommandResult> {
  let argv: string[];
  try { argv = splitCommand(command); } catch (error) { return { command, exitCode: 2, output: (error as Error).message }; }
  const [bin, ...args] = argv;
  const result = await runProcess(bin, args, repository.path, repository.commandTimeoutMs ?? defaultCommandTimeoutMs);
  return { command, exitCode: result.exitCode, output: result.output };
}

export async function runValidations(repository: RepositoryConfig, task?: ResolvedTask): Promise<CommandResult[]> {
  const output: CommandResult[] = [];
  for (const command of new Set([...repository.validation, ...(task ? taskValidationCommands(task) : [])])) {
    const result = await run(command, repository);
    output.push(result);
    if (result.exitCode) break;
  }
  return output;
}

export async function runAndroidBuild(repository: RepositoryConfig): Promise<CommandResult | undefined> {
  if (!repository.androidBuild) return undefined;
  let argv: string[];
  try { argv = splitCommand(repository.androidBuild); } catch (error) { return { command: repository.androidBuild, exitCode: 2, output: (error as Error).message }; }
  const script = argv[0] === 'npm' && argv[1] === 'run' ? argv[2] : undefined;
  if (script) {
    const missing = await missingScript(repository, script);
    // A configured gate that cannot run is a failure, not a skip: no substitute command is invented.
    if (missing) return { command: repository.androidBuild, exitCode: 1, output: missing };
  }
  return run(repository.androidBuild, repository);
}

async function missingScript(repository: RepositoryConfig, script: string): Promise<string | undefined> {
  const packageJson = join(repository.path, 'package.json');
  if (!(await access(packageJson, constants.F_OK).then(() => true).catch(() => false))) return `Closure gate ${repository.androidBuild} is configured but ${packageJson} does not exist`;
  const scripts = JSON.parse(await readFile(packageJson, 'utf8')).scripts ?? {};
  return scripts[script] ? undefined : `Closure gate ${repository.androidBuild} is configured but package.json has no ${script} script`;
}
