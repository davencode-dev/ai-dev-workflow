import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createTasks } from '../src/core/create-tasks.ts';
import { headroomProxyUrl } from '../src/core/headroom.ts';
import { loadRegistry } from '../src/core/repository-registry.ts';
import { runSequence } from '../src/core/runner.ts';
import { AntigravityProvider } from '../src/providers/antigravity-provider.ts';
import { ClaudeCodeProvider } from '../src/providers/claude-code-provider.ts';
import { CodexProvider } from '../src/providers/codex-provider.ts';
import type { AgentProvider, TaskProposalProvider } from '../src/providers/agent-provider.ts';
import type { RepositoryConfig } from '../src/core/types.ts';

// Stand-in for `headroom proxy`: /readyz, /stats requests.total, and a counter bumped by any other request.
async function fakeHeadroom(ready = 200, counter: 'total' | 'failed' = 'total') {
  let total = 0;
  const paths: string[] = [];
  const server: Server = createServer((request, response) => {
    if (request.url === '/readyz') { response.writeHead(ready).end('{}'); return; }
    if (request.url === '/stats') { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ requests: counter === 'total' ? { total, failed: 0 } : { total: 0, failed: total } })); return; }
    total += 1; paths.push(request.url ?? ''); response.writeHead(200).end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, paths, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd }).toString().trim();

async function fixture(headroomUrl: string) {
  const root = await mkdtemp(join(tmpdir(), 'headroom-'));
  const repo = join(root, 'app');
  for (const dir of [root, repo]) {
    await mkdir(dir, { recursive: true });
    git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 'test@example.test'); git(dir, 'config', 'user.name', 'Test');
  }
  await writeFile(join(root, '.gitignore'), '.agent-runs/\napp/\n');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
  await writeFile(join(repo, 'TASKS.md'), '### APP-001 — One\nTask.\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'base');
  const config: RepositoryConfig = {
    id: 'app', path: repo, taskPrefix: 'APP', taskResolver: { kind: 'heading', path: 'TASKS.md', heading: '### {id}' },
    validation: ['true'], guidance: [], pilotEvidence: 'TASKS.md', taskTracking: 'TASKS.md', headroom: { url: headroomUrl },
  };
  return { root, repo, config };
}

// Calls its proxy env var the way a real CLI would, unless told to bypass it.
class ProxiedProvider implements AgentProvider, TaskProposalProvider {
  id = 'fake'; bypass = false; envs: (Record<string, string> | undefined)[] = [];
  async available() { return { ok: true }; }
  proxyEnv(proxyUrl: string) { return { FAKE_BASE_URL: proxyUrl }; }
  async session(env?: Record<string, string>) {
    this.envs.push(env);
    if (!this.bypass && env?.FAKE_BASE_URL) await fetch(`${env.FAKE_BASE_URL}/v1/messages`, { method: 'POST', body: '{}' });
  }
  async execute({ repository, task, env }: Parameters<AgentProvider['execute']>[0]) {
    await this.session(env);
    await writeFile(join(repository.path, `${task.id}.md`), task.id);
    return { status: 'success' as const, output: 'ok', exitCode: 0 };
  }
  async propose({ env }: Parameters<TaskProposalProvider['propose']>[0]) {
    await this.session(env);
    return { status: 'success' as const, output: JSON.stringify({ tasks: [{ title: 'Fix spacing on login', type: 'bug', size: 'small', problem: 'p', impact: 'i', evidence: [], reproduction: [], scope: [], outOfScope: [], codeAreas: [], hypotheses: [], acceptance: [], validation: [], platforms: [], risks: [], dependencies: [] }] }), exitCode: 0 };
  }
}

test('adapters point each CLI at the proxy with the variables headroom wrap uses', () => {
  assert.deepEqual(new ClaudeCodeProvider().proxyEnv('http://127.0.0.1:8787/p/app'), { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8787/p/app', ENABLE_TOOL_SEARCH: 'true' });
  assert.deepEqual(new CodexProvider().proxyEnv('http://127.0.0.1:8787/p/app'), { OPENAI_BASE_URL: 'http://127.0.0.1:8787/p/app/v1' });
  assert.deepEqual(new AntigravityProvider().proxyEnv('http://127.0.0.1:8787/p/app'), { GOOGLE_GEMINI_BASE_URL: 'http://127.0.0.1:8787/p/app' });
});

test('a top-level headroom block reaches every application', async () => {
  const root = await mkdtemp(join(tmpdir(), 'headroom-registry-'));
  await mkdir(join(root, 'config'));
  await writeFile(join(root, 'config', 'repositories.json'), JSON.stringify({
    headroom: { url: 'http://127.0.0.1:8787/' },
    repositories: [{ id: 'a' }, { id: 'b c', headroom: { url: 'http://127.0.0.1:9999' } }],
  }));
  const [a, b] = await loadRegistry(root);
  assert.equal(headroomProxyUrl(a), 'http://127.0.0.1:8787/p/a');
  assert.equal(headroomProxyUrl(b), 'http://127.0.0.1:9999/p/b%20c');
});

test('sessions run through the proxy and the report carries the request evidence', async () => {
  const proxy = await fakeHeadroom();
  try {
    const { root, config } = await fixture(proxy.url);
    const provider = new ProxiedProvider();
    const { report } = await runSequence({ root, provider, registry: [config], application: 'app', taskIds: ['APP-001'] });
    assert.equal(report.tasks[0].status, 'completed');
    assert.deepEqual(provider.envs, [{ FAKE_BASE_URL: `${proxy.url}/p/app` }]);
    assert.deepEqual(proxy.paths, ['/p/app/v1/messages']);
    assert.deepEqual(report.tasks[0].headroom, [{ proxyUrl: `${proxy.url}/p/app`, requests: 1 }]);
  } finally { await proxy.close(); }
});

test('a session whose upstream calls failed still counts as routed through the proxy', async () => {
  const proxy = await fakeHeadroom(200, 'failed');
  try {
    const { root, config } = await fixture(proxy.url);
    const { report } = await runSequence({ root, provider: new ProxiedProvider(), registry: [config], application: 'app', taskIds: ['APP-001'] });
    assert.equal(report.tasks[0].status, 'completed');
    assert.equal(report.tasks[0].headroom?.[0].requests, 1);
  } finally { await proxy.close(); }
});

test('a session that bypasses the proxy blocks the task before its commit', async () => {
  const proxy = await fakeHeadroom();
  try {
    const { root, repo, config } = await fixture(proxy.url);
    const provider = new ProxiedProvider(); provider.bypass = true;
    const { report } = await runSequence({ root, provider, registry: [config], application: 'app', taskIds: ['APP-001'] });
    assert.equal(report.tasks[0].status, 'blocked');
    assert.match(report.tasks[0].reason ?? '', /sent no request through headroom/);
    assert.equal(git(repo, 'rev-list', '--count', 'HEAD'), '1');
  } finally { await proxy.close(); }
});

test('the run refuses to start when the proxy is down, not ready, or the provider cannot route', async () => {
  const notReady = await fakeHeadroom(503);
  const down = await fakeHeadroom(); await down.close();
  try {
    for (const [url, message] of [[notReady.url, /not ready/], [down.url, /unreachable/]] as const) {
      const { root, config } = await fixture(url);
      const provider = new ProxiedProvider();
      await assert.rejects(runSequence({ root, provider, registry: [config], application: 'app', taskIds: ['APP-001'], dryRun: true }), message);
      assert.equal(provider.envs.length, 0);
    }
    const { root, config } = await fixture(notReady.url);
    const unroutable: AgentProvider = { id: 'plain', available: async () => ({ ok: true }), execute: async () => ({ status: 'success', output: '' }) };
    await assert.rejects(runSequence({ root, provider: unroutable, registry: [config], application: 'app', taskIds: ['APP-001'] }), /cannot route through headroom/);
  } finally { await notReady.close(); }
});

test('create-tasks proposals go through the proxy too', async () => {
  const proxy = await fakeHeadroom();
  try {
    const { root, config } = await fixture(proxy.url);
    const provider = new ProxiedProvider();
    const { report } = await createTasks({ root, provider, registry: [config], application: 'app', description: 'Login button spacing is wrong on Android', imagePaths: [], dryRun: true });
    assert.deepEqual(report.headroom, { proxyUrl: `${proxy.url}/p/app`, requests: 1 });
    provider.bypass = true;
    await assert.rejects(createTasks({ root, provider, registry: [config], application: 'app', description: 'Login button spacing is wrong on Android', imagePaths: [], dryRun: true }), /sent no request through headroom/);
  } finally { await proxy.close(); }
});
