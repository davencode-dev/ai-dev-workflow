import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { parseArgs } from '../src/cli/verify-mobile.ts';
import {
  discoverMaestroFlows,
  loadMobileManifest,
  parseMobileManifest,
  runMobileVerification,
} from '../src/core/mobile-verification.ts';
import type { RepositoryConfig } from '../src/core/types.ts';

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    platform: 'android',
    appId: 'com.example.app',
    checks: [{ id: 'typecheck', command: { command: 'true' } }],
    build: { command: 'true', artifact: 'build/app.apk' },
    devices: { primary: { serial: 'emulator-test' }, isolation: 'reuse' },
    maestro: { command: { command: 'true' }, roots: ['.maestro'], include: ['**/*.yaml'], exclude: ['**/subflows/**'] },
    documentation: { inventory: 'docs/workflows.md', verification: 'docs/verification.md', evidenceDir: 'docs/evidence' },
    ...overrides,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mobile-verify-'));
  const target = join(root, 'app');
  await mkdir(join(target, '.maestro', 'subflows'), { recursive: true });
  await mkdir(join(target, '.ai-dev-workflow'), { recursive: true });
  await mkdir(join(target, 'build'), { recursive: true });
  await writeFile(join(target, '.maestro', 'one.yaml'), 'appId: com.example.app\n');
  await writeFile(join(target, '.maestro', 'subflows', 'setup.yaml'), 'appId: com.example.app\n');
  await writeFile(join(target, 'build', 'app.apk'), 'fixture');
  await writeFile(join(target, '.ai-dev-workflow', 'mobile-verification.json'), JSON.stringify(manifest()));
  execFileSync('git', ['init', '-q'], { cwd: target });
  execFileSync('git', ['config', 'user.email', 'test@example.test'], { cwd: target });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: target });
  execFileSync('git', ['add', '.'], { cwd: target });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: target });
  const repository: RepositoryConfig = {
    id: 'fixture-app',
    path: target,
    taskPrefix: 'APP',
    taskResolver: { kind: 'file', path: 'tasks', pattern: '{id}-*.md' },
    validation: [],
    guidance: [],
    pilotEvidence: 'docs/workflows.md',
    taskTracking: 'docs/workflows.md',
  };
  return { root, target, repository };
}

test('parses mobile CLI arguments and rejects ambiguous input', () => {
  assert.deepEqual(parseArgs(['--dry-run', '--manifest', 'custom.json', 'weshift']), {
    application: 'weshift',
    manifestPath: 'custom.json',
    dryRun: true,
  });
  assert.throws(() => parseArgs([]), /Usage/);
  assert.throws(() => parseArgs(['one', 'two']), /Usage/);
});

test('validates manifest platform and required fields', () => {
  assert.equal(parseMobileManifest(manifest()).appId, 'com.example.app');
  assert.throws(() => parseMobileManifest(manifest({ platform: 'ios' })), /platform/);
  assert.throws(() => parseMobileManifest(manifest({ appId: '' })), /appId/);
  assert.throws(() => parseMobileManifest(manifest({ devices: { primary: {} } })), /avd or serial/);
});

test('loads manifests without allowing repository escape paths', async () => {
  const { target } = await fixture();
  const loaded = await loadMobileManifest(target);
  assert.equal(loaded.manifest.appId, 'com.example.app');
  await assert.rejects(loadMobileManifest(target, '../outside.json'), /escapes repository/);
});

test('discovers included Maestro flows and excludes subflows', async () => {
  const { target } = await fixture();
  const loaded = await loadMobileManifest(target);
  assert.deepEqual(await discoverMaestroFlows(target, loaded.manifest.maestro), ['.maestro/one.yaml']);
});

test('dry run reports planned checks, build, flow, and manual work', async () => {
  const { root, repository } = await fixture();
  const configured = parseMobileManifest(manifest({
    manualWorkflows: [{ id: 'manual-share', title: 'Sharing', reason: 'Needs two devices.' }],
  }));
  await writeFile(join(repository.path, '.ai-dev-workflow', 'mobile-verification.json'), JSON.stringify(configured));
  const result = await runMobileVerification({ root, registry: [repository], application: repository.id, dryRun: true });
  assert.equal(result.report.status, 'DRY_RUN');
  assert.equal(result.report.checks[0].status, 'DRY_RUN');
  assert.deepEqual(result.report.flows.map((flow) => flow.flow), ['.maestro/one.yaml']);
  assert.equal(result.report.manualWorkflows[0].status, 'MANUAL_REQUIRED');
});

test('a failed static check blocks build and device execution', async () => {
  const { root, repository } = await fixture();
  await writeFile(
    join(repository.path, '.ai-dev-workflow', 'mobile-verification.json'),
    JSON.stringify(manifest({ checks: [{ id: 'typecheck', command: { command: 'false' } }] })),
  );
  execFileSync('git', ['add', '.ai-dev-workflow/mobile-verification.json'], { cwd: repository.path });
  execFileSync('git', ['commit', '-qm', 'failure-fixture'], { cwd: repository.path });
  const result = await runMobileVerification({ root, registry: [repository], application: repository.id });
  assert.equal(result.report.status, 'FAIL');
  assert.equal(result.report.checks[0].status, 'FAIL');
  assert.equal(result.report.build?.status, 'BLOCKED');
  assert.equal(result.report.flows.length, 0);
});
