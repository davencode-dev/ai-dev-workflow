import { existsSync } from 'node:fs';
import { Git } from './git.ts';
import { writeReport } from './reports.ts';
import { selectRepository } from './repository-registry.ts';
import { resolveTasks } from './task-resolver.ts';
import { runAndroidBuild, runValidations } from './validation.ts';
import { taskInstruction, retryInstruction, type AgentProvider } from '../providers/agent-provider.ts';
import type { RepositoryConfig, SequenceReport, TaskResult } from './types.ts';

export type RunOptions = {
  root: string;
  provider: AgentProvider;
  registry: RepositoryConfig[];
  application: string;
  taskIds: string[];
  dryRun?: boolean;
  retries?: number;
  rollbackOnFailure?: boolean;
};

export async function runSequence(options: RunOptions): Promise<{ report: SequenceReport; reportPath: string }> {
  const repository = selectRepository(options.registry, options.application);
  const resolved = await resolveTasks(repository, options.taskIds);
  const available = await options.provider.available();
  if (!available.ok) throw new Error(`Provider ${options.provider.id} unavailable: ${available.reason ?? 'unknown error'}`);
  const git = new Git();
  const workflowState = await git.status(options.root);
  const targetState = await git.status(repository.path);
  if (workflowState) throw new Error('ai-dev-workflow is dirty; commit or stash it before execution');
  if (targetState) throw new Error(`Target repository is dirty: ${repository.path}`);
  const report: SequenceReport = {
    provider: options.provider.id,
    repository: repository.path,
    requestedTasks: options.taskIds,
    resolvedTasks: resolved.map(({ id, document, line }) => ({ id, document, line })),
    startedAt: new Date().toISOString(),
    tasks: [],
    finalGitStates: { workflow: workflowState, target: targetState },
    resumeCommand: resume(options.provider.id, repository.id, options.taskIds, options.retries, options.rollbackOnFailure),
    dryRun: !!options.dryRun,
  };
  if (options.dryRun) {
    report.tasks = resolved.map((task) => ({
      id: task.id,
      status: 'dry-run',
      filesChanged: [],
      validations: repository.validation.map((command) => ({ command, exitCode: 0, output: 'would run' })),
      androidBuild: { command: repository.androidBuild ?? '', exitCode: 0, output: repository.androidBuild ? 'would run if script exists' : 'not configured' },
    }));
    report.endedAt = new Date().toISOString();
    const reportPath = await writeReport(options.root, report);
    return { report, reportPath };
  }

  const maxRetries = Math.max(0, options.retries ?? 0);
  for (let index = 0; index < resolved.length; index += 1) {
    const task = resolved[index];
    if (await git.status(repository.path)) {
      report.tasks.push(fail(task.id, 'blocked', 'Target repository became dirty before task'));
      markSkipped(report, resolved.slice(index + 1));
      break;
    }

    let taskCompleted = false;
    let attempts = 0;
    let lastFailureReason = '';
    let lastFilesChanged: string[] = [];
    let lastValidations: any[] = [];
    let lastAndroidBuild: any = undefined;
    let blockReason = '';

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      attempts = attempt + 1;
      const prompt = attempt === 0
        ? taskInstruction(task, repository)
        : retryInstruction(task, repository, lastFailureReason, attempt, maxRetries);

      const execution = await options.provider.execute({ repository, task, prompt });
      const filesChanged = await git.changedFiles(repository.path);
      lastFilesChanged = filesChanged;

      if (execution.status !== 'success') {
        lastFailureReason = execution.output;
        if (attempt < maxRetries) continue;
        break;
      }

      const invalid = filesChanged.find((file) => /(^|\/)(\.env|\.git|node_modules|\.pnpm-store)(\/|$)|(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(file));
      if (invalid) {
        blockReason = `Unsafe or unrelated changed file: ${invalid}`;
        break;
      }

      if (!filesChanged.length) {
        lastFailureReason = 'Provider reported success but task produced no changes';
        if (attempt < maxRetries) continue;
        blockReason = lastFailureReason;
        break;
      }

      const validations = await runValidations(repository, task);
      lastValidations = validations;
      const validationFailure = validations.find((result) => result.exitCode !== 0);
      const androidBuild = validationFailure ? undefined : await runAndroidBuild(repository);
      lastAndroidBuild = androidBuild;

      if (validationFailure || androidBuild?.exitCode) {
        lastFailureReason = validationFailure?.output ?? androidBuild?.output ?? 'Validation or build check failed';
        if (attempt < maxRetries) continue;
        break;
      }

      const message = `${task.documentationOnly ? 'docs' : 'feat'}(${repository.id}): complete ${task.id}`;
      const commit = await git.commit(repository.path, message);
      if (await git.status(repository.path)) {
        blockReason = 'Target repository not clean after commit';
        break;
      }

      report.tasks.push({
        id: task.id,
        status: 'completed',
        filesChanged,
        validations,
        androidBuild,
        commit,
        providerOutput: execution.output,
        attempts,
        retriesUsed: attempt,
      });
      taskCompleted = true;
      break;
    }

    if (!taskCompleted) {
      if (blockReason) {
        report.tasks.push(fail(task.id, 'blocked', blockReason, lastFilesChanged, attempts, attempts - 1));
      } else {
        report.tasks.push({
          id: task.id,
          status: 'failed',
          filesChanged: lastFilesChanged,
          validations: lastValidations,
          androidBuild: lastAndroidBuild,
          reason: lastFailureReason,
          attempts,
          retriesUsed: attempts - 1,
        });
      }
      if (options.rollbackOnFailure) {
        await git.discardChanges(repository.path);
      }
      markSkipped(report, resolved.slice(index + 1));
      break;
    }
  }

  report.endedAt = new Date().toISOString();
  report.finalGitStates = { workflow: await git.status(options.root), target: await git.status(repository.path) };
  const next = report.tasks.findIndex((task) => task.status !== 'completed');
  report.resumeCommand = resume(options.provider.id, repository.id, next < 0 ? [] : options.taskIds.slice(next), options.retries, options.rollbackOnFailure);
  const reportPath = await writeReport(options.root, report);
  return { report, reportPath };
}

function fail(id: string, status: 'failed' | 'blocked', reason: string, filesChanged: string[] = [], attempts = 1, retriesUsed = 0): TaskResult {
  return { id, status, reason, filesChanged, validations: [], attempts, retriesUsed };
}

function markSkipped(report: SequenceReport, tasks: { id: string }[]) {
  report.tasks.push(...tasks.map(({ id }) => ({ id, status: 'skipped' as const, filesChanged: [], validations: [] })));
}

export function resume(provider: string, app: string, ids: string[], retries?: number, rollbackOnFailure?: boolean) {
  if (!ids.length) return 'No resume required';
  const flags = [];
  if (retries && retries > 0) flags.push(`--retries ${retries}`);
  if (rollbackOnFailure) flags.push('--rollback-on-failure');
  const flagStr = flags.length ? ` ${flags.join(' ')}` : '';
  return `npm run tasks -- --agent ${provider}${flagStr} ${app} ${ids.join(' ')}`;
}
