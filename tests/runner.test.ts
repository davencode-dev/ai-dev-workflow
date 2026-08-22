import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseArgs } from '../src/cli/run-tasks.ts';
import { runSequence, resume } from '../src/core/runner.ts';
import { resolveTasks } from '../src/core/task-resolver.ts';
import type { AgentProvider } from '../src/providers/agent-provider.ts';
import type { RepositoryConfig } from '../src/core/types.ts';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'agent-runner-')); const repo = join(root, 'app');
  execFileSync('git', ['init', '-q'], { cwd: root }); execFileSync('git', ['config', 'user.email', 'test@example.test'], { cwd: root }); execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  await writeFile(join(root, '.gitignore'), '.agent-runs/\napp/\n'); await writeFile(join(root, 'base'), 'x'); execFileSync('git', ['add', '.'], { cwd: root }); execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  await mkdir(repo); execFileSync('git', ['init', '-q'], { cwd: repo }); execFileSync('git', ['config', 'user.email', 'test@example.test'], { cwd: repo }); execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  await writeFile(join(repo, 'TASKS.md'), '### APP-001 — One\nTask.\n### APP-002 — Two\nTask.\n'); await writeFile(join(repo, 'package.json'), '{"scripts":{"build:android:local":"true"}}\n'); execFileSync('git', ['add', '.'], { cwd: repo }); execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const config: RepositoryConfig = { id: 'example-app', path: repo, taskPrefix: 'APP', taskResolver: { kind: 'heading', path: 'TASKS.md', heading: '### {id}' }, validation: ['true'], androidBuild: 'true', guidance: ['AGENTS.md'], pilotEvidence: 'TASKS.md' };
  return { root, repo, config };
}
class FakeProvider implements AgentProvider {
  id = 'fake'; calls: string[] = []; failAt?: string; unsafeCacheAt?: string; unavailable = false;
  async available() { return this.unavailable ? { ok: false, reason: 'not installed' } : { ok: true }; }
  async execute({ repository, task }: Parameters<AgentProvider['execute']>[0]) { this.calls.push(task.id); if (task.id === this.failAt) return { status: 'failure' as const, output: 'agent failed', exitCode: 1 }; if (task.id === this.unsafeCacheAt) { await mkdir(join(repository.path, '.pnpm-store')); await writeFile(join(repository.path, '.pnpm-store', 'index.db'), 'cache'); } else await writeFile(join(repository.path, `${task.id}.txt`), task.id); return { status: 'success' as const, output: 'ok', exitCode: 0 }; }
}

test('parses CLI and rejects missing provider', () => {
  assert.deepEqual(parseArgs(['--agent', 'codex', '--dry-run', '--retries', '2', '--rollback-on-failure', 'example-app', 'APP-003', 'APP-001']), { agent: 'codex', dryRun: true, retries: 2, rollbackOnFailure: true, application: 'example-app', taskIds: ['APP-003', 'APP-001'] });
  assert.deepEqual(parseArgs(['--agent', 'codex', '--dry-run', 'example-app', 'APP-003', 'APP-001']), { agent: 'codex', dryRun: true, retries: 0, rollbackOnFailure: false, application: 'example-app', taskIds: ['APP-003', 'APP-001'] });
  assert.throws(() => parseArgs(['example-app', 'APP-001']));
});
test('resolver preserves order and rejects duplicate, wrong prefix, missing task', async () => {
  const { config } = await fixture(); assert.deepEqual((await resolveTasks(config, ['APP-002', 'APP-001'])).map((task) => task.id), ['APP-002', 'APP-001']);
  await assert.rejects(resolveTasks(config, ['APP-001', 'APP-001'])); await assert.rejects(resolveTasks(config, ['FILE-001'])); await assert.rejects(resolveTasks(config, ['APP-999']));
});
test('file task resolver resolves one File App-style document', async () => {
  const { repo } = await fixture(); await mkdir(join(repo, 'specs')); await writeFile(join(repo, 'specs', 'FILE-002-spacing.md'), '# task\n');
  const config: RepositoryConfig = { id: 'file-app', path: repo, taskPrefix: 'FILE', taskResolver: { kind: 'file', path: 'specs', pattern: '{id}-*.md' }, validation: [], guidance: [], pilotEvidence: 'specs' };
  assert.deepEqual((await resolveTasks(config, ['FILE-002'])).map((task) => task.id), ['FILE-002']);
});
test('dry run invokes no provider and reports commands', async () => {
  const { root, config } = await fixture(); const provider = new FakeProvider(); const result = await runSequence({ root, provider, registry: [config], application: 'example-app', taskIds: ['APP-002', 'APP-001'], dryRun: true });
  assert.deepEqual(provider.calls, []); assert.deepEqual(result.report.tasks.map((task) => task.status), ['dry-run', 'dry-run']); assert.match(result.reportPath, /\.agent-runs/);
});
test('one fresh provider call and commit per ordered task', async () => {
  const { root, repo, config } = await fixture(); const provider = new FakeProvider(); const result = await runSequence({ root, provider, registry: [config], application: 'example-app', taskIds: ['APP-002', 'APP-001'] });
  assert.deepEqual(provider.calls, ['APP-002', 'APP-001']); assert.deepEqual(result.report.tasks.map((task) => task.status), ['completed', 'completed']); assert.deepEqual(result.report.tasks.map((task) => task.androidBuild?.exitCode), [0, 0]); assert.equal(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repo }).toString().trim(), '3');
});
test('provider or validation failure stops queue, skips remainder, no failed commit', async () => {
  const { root, repo, config } = await fixture(); const provider = new FakeProvider(); provider.failAt = 'APP-002'; const result = await runSequence({ root, provider, registry: [config], application: 'example-app', taskIds: ['APP-001', 'APP-002'] });
  assert.deepEqual(provider.calls, ['APP-001', 'APP-002']); assert.deepEqual(result.report.tasks.map((task) => task.status), ['completed', 'failed']); assert.equal(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repo }).toString().trim(), '2'); assert.equal(result.report.resumeCommand, 'npm run tasks -- --agent fake example-app APP-002');
});
test('validation failure prevents commit', async () => {
  const { root, repo, config } = await fixture(); config.validation = ['false']; const provider = new FakeProvider(); const result = await runSequence({ root, provider, registry: [config], application: 'example-app', taskIds: ['APP-001'] });
  assert.equal(result.report.tasks[0].status, 'failed'); assert.equal(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repo }).toString().trim(), '1');
});
test('generated package-manager cache blocks commit', async () => {
  const { root, repo, config } = await fixture(); const provider = new FakeProvider(); provider.unsafeCacheAt = 'APP-001'; const result = await runSequence({ root, provider, registry: [config], application: 'example-app', taskIds: ['APP-001'] });
  assert.equal(result.report.tasks[0].status, 'blocked'); assert.match(result.report.tasks[0].reason ?? '', /\.pnpm-store/); assert.equal(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: repo }).toString().trim(), '1');
});
test('documentation-only task still runs the Android build at closure', async () => {
  const { root, config } = await fixture(); await writeFile(join(config.path, 'TASKS.md'), '### APP-001 — Plan\nDocumentation planning first; no application code changes.\n'); execFileSync('git', ['add', 'TASKS.md'], { cwd: config.path }); execFileSync('git', ['commit', '-qm', 'docs'], { cwd: config.path }); const provider = new FakeProvider(); const result = await runSequence({ root, provider, registry: [config], application: 'example-app', taskIds: ['APP-001'] });
  assert.equal(result.report.tasks[0].status, 'completed'); assert.equal(result.report.tasks[0].androidBuild?.command, 'true'); assert.equal(result.report.tasks[0].androidBuild?.exitCode, 0);
});
test('unavailable provider fails actionable preflight and resume command is safe', async () => {
  const { root, config } = await fixture(); const provider = new FakeProvider(); provider.unavailable = true;
  await assert.rejects(runSequence({ root, provider, registry: [config], application: 'example-app', taskIds: ['APP-001'] }), /unavailable/); assert.equal(resume('codex', 'example-app', ['APP-003']), 'npm run tasks -- --agent codex example-app APP-003');
});
