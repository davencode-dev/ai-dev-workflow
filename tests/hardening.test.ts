import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runProcess, splitCommand } from '../src/core/process.ts';
import { runSequence, unsafeChange } from '../src/core/runner.ts';
import { isDocumentationOnly } from '../src/core/task-resolver.ts';
import { runValidations, taskValidationCommands } from '../src/core/validation.ts';
import { failureTail } from '../src/providers/agent-provider.ts';
import type { AgentProvider } from '../src/providers/agent-provider.ts';
import type { RepositoryConfig, ResolvedTask } from '../src/core/types.ts';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd }).toString().trim();

async function fixture(tasks: string, overrides: Partial<RepositoryConfig> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hardening-'));
  const repo = join(root, 'app');
  for (const dir of [root, repo]) {
    await mkdir(dir, { recursive: true });
    git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 'test@example.test'); git(dir, 'config', 'user.name', 'Test');
  }
  await writeFile(join(root, '.gitignore'), '.agent-runs/\napp/\n');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
  await writeFile(join(repo, 'TASKS.md'), tasks);
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'base');
  const config: RepositoryConfig = {
    id: 'app', path: repo, taskPrefix: 'APP', taskResolver: { kind: 'heading', path: 'TASKS.md', heading: '### {id}' },
    validation: ['true'], guidance: [], pilotEvidence: 'TASKS.md', taskTracking: 'TASKS.md', ...overrides,
  };
  return { root, repo, config };
}

class WritingProvider implements AgentProvider {
  id = 'fake';
  file = '';
  async available() { return { ok: true }; }
  async execute({ repository, task }: Parameters<AgentProvider['execute']>[0]) {
    await writeFile(join(repository.path, this.file || `${task.id}.md`), task.id);
    return { status: 'success' as const, output: 'ok', exitCode: 0 };
  }
}

const resolved = (content: string): ResolvedTask => ({ id: 'APP-001', document: 'TASKS.md', line: 1, content, documentationOnly: false });

test('splitCommand groups quoted arguments and honours escapes', () => {
  assert.deepEqual(splitCommand('npm test -- --grep "login flow"'), ['npm', 'test', '--', '--grep', 'login flow']);
  assert.deepEqual(splitCommand("node -e 'process.exit(0)'"), ['node', '-e', 'process.exit(0)']);
  assert.deepEqual(splitCommand('echo a\\ b ""'), ['echo', 'a b', '']);
  assert.throws(() => splitCommand('echo "open'), /Unterminated quote/);
  assert.throws(() => splitCommand('   '), /empty/);
});

test('runProcess kills on timeout and reports exit code 124', async () => {
  const result = await runProcess('node', ['-e', 'setTimeout(() => {}, 10000)'], process.cwd(), 200);
  assert.equal(result.exitCode, 124);
  assert.equal(result.timedOut, true);
  assert.match(result.output, /Timed out after 200ms/);
});

test('validations run quoted commands and only take script commands from task documents', async () => {
  const content = 'Run `npm test` then `npm run lint -- --fix`. Never `npm install left-pad` or `npm exec rimraf /`.';
  assert.deepEqual(taskValidationCommands(resolved(content)), ['npm test', 'npm run lint -- --fix']);
  const { config } = await fixture('### APP-001 — One\n', { validation: ['node -e "process.exit(0)"', 'node -e "process.exit(4)"', 'true'] });
  const results = await runValidations(config);
  assert.deepEqual(results.map((result) => result.exitCode), [0, 4]);
});

test('validations honour the registry command timeout', async () => {
  const { config } = await fixture('### APP-001 — One\n', { validation: ['node -e "setTimeout(() => {}, 10000)"'], commandTimeoutMs: 200 });
  const [result] = await runValidations(config);
  assert.equal(result.exitCode, 124);
});

test('explicit documentation marker overrides the legacy phrase heuristic', () => {
  assert.equal(isDocumentationOnly('- Documentation only: yes\n'), true);
  assert.equal(isDocumentationOnly('Documentation only, first.\n- Documentation only: no\n'), false);
  assert.equal(isDocumentationOnly('No application code changes.'), true);
  assert.equal(isDocumentationOnly('Fix the login button.'), false);
});

test('failureTail keeps the end of long output and leaves short output alone', () => {
  assert.equal(failureTail('short failure'), 'short failure');
  const long = Array.from({ length: 1000 }, (_, index) => `line ${index}`).join('\n');
  const tail = failureTail(long);
  assert.match(tail, /^\[earlier output truncated; showing the last 200 lines\]/);
  assert.match(tail, /line 999$/);
  assert.doesNotMatch(tail, /line 799\n/);
});

test('lockfile changes block unless the registry allows them; secrets always block', async () => {
  const { config } = await fixture('### APP-001 — One\n');
  assert.equal(unsafeChange(['src/a.ts', 'package-lock.json'], config), 'package-lock.json');
  assert.equal(unsafeChange(['src/a.ts', 'package-lock.json'], { ...config, allowLockfileChanges: true }), undefined);
  assert.equal(unsafeChange(['.env'], { ...config, allowLockfileChanges: true }), '.env');
  const provider = new WritingProvider(); provider.file = 'yarn.lock';
  const { report } = await runSequence({ root: (await fixture('')).root, provider, registry: [config], application: 'app', taskIds: ['APP-001'] });
  assert.equal(report.tasks[0].status, 'blocked');
  assert.match(report.tasks[0].reason ?? '', /allowLockfileChanges/);
});

test('closureGateScope code skips the gate for documentation tasks only', async () => {
  const tasks = '### APP-001 — Docs\n- Documentation only: yes\n### APP-002 — Code\n- Documentation only: no\n';
  const { root, repo, config } = await fixture(tasks, { androidBuild: 'false', closureGateScope: 'code' });
  const { report } = await runSequence({ root, provider: new WritingProvider(), registry: [config], application: 'app', taskIds: ['APP-001', 'APP-002'] });
  assert.deepEqual(report.tasks.map((task) => task.status), ['completed', 'failed']);
  assert.equal(report.tasks[0].androidBuild, undefined);
  assert.equal(report.tasks[0].commit?.message, 'docs(app): complete APP-001');
  assert.equal(report.tasks[1].androidBuild?.exitCode, 1);
  assert.equal(git(repo, 'rev-list', '--count', 'HEAD'), '2');
});

test('mobile gate failure stops the task before its commit', async () => {
  const { root, repo, config } = await fixture('### APP-001 — One\n', { mobileVerification: {} });
  await mkdir(join(repo, '.ai-dev-workflow'));
  await writeFile(join(repo, '.ai-dev-workflow', 'mobile-verification.json'), JSON.stringify({
    schemaVersion: 1, platform: 'android', appId: 'com.example.app',
    checks: [{ id: 'typecheck', command: { command: 'false' } }],
    build: { command: 'true', artifact: 'app.apk' },
    devices: { primary: { serial: 'emulator-test' }, isolation: 'reuse' },
    maestro: { command: { command: 'true' }, roots: ['.maestro'] },
    documentation: { inventory: 'docs/w.md', verification: 'docs/v.md', evidenceDir: 'docs/evidence' },
  }));
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'manifest');
  const { report } = await runSequence({ root, provider: new WritingProvider(), registry: [config], application: 'app', taskIds: ['APP-001'] });
  assert.equal(report.tasks[0].status, 'failed');
  assert.equal(report.tasks[0].mobileVerification?.status, 'FAIL');
  assert.match(report.tasks[0].reason ?? '', /false: FAIL/);
  assert.equal(git(repo, 'rev-list', '--count', 'HEAD'), '2');
});
